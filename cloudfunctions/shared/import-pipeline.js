const VALID_MARK_TYPES = new Set(['unfamiliar', 'unable', 'careless']);
const FINAL_REGION_STATES = new Set(['archived', 'skipped', 'no_marks']);

class ImportPipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImportPipelineError';
    this.code = code;
  }
}

function addUtcDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addUtcMonths(value, months) {
  const date = new Date(value);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date;
}

function validatePolicy(policy) {
  if (!policy || policy.calibrated !== true) {
    throw new ImportPipelineError(
      'MARK_POLICY_UNCALIBRATED',
      'Automatic recognition is disabled until confidence thresholds are calibrated.',
    );
  }

  for (const key of ['minimumMarkConfidence', 'minimumBoundaryConfidence', 'minimumSubjectConfidence']) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1) {
      throw new ImportPipelineError(
        'INVALID_CONFIDENCE_POLICY',
        `A calibrated ${key} between 0 and 1 is required.`,
      );
    }
  }
}

function groupRegions(detections) {
  const grouped = new Map();
  for (const detection of detections) {
    if (
      !detection ||
      typeof detection.photoId !== 'string' ||
      typeof detection.regionId !== 'string' ||
      !Array.isArray(detection.markTypes) ||
      detection.markTypes.length === 0 ||
      detection.markTypes.some((type) => !VALID_MARK_TYPES.has(type)) ||
      (detection.contextPhotoIds !== undefined &&
        (!Array.isArray(detection.contextPhotoIds) ||
          detection.contextPhotoIds.some((photoId) => typeof photoId !== 'string'))) ||
      !Number.isFinite(detection.markConfidence) ||
      !Number.isFinite(detection.boundaryConfidence)
    ) {
      throw new ImportPipelineError(
        'INVALID_DETECTION_RESULT',
        'The detector returned a malformed marked-question region.',
      );
    }

    const key = `${detection.photoId}:${detection.regionId}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...detection,
        markTypes: [...new Set(detection.markTypes)],
        contextPhotoIds: Array.isArray(detection.contextPhotoIds)
          ? [...new Set(detection.contextPhotoIds)]
          : [],
      });
      continue;
    }

    current.markTypes = [...new Set([...current.markTypes, ...detection.markTypes])];
    current.contextPhotoIds = [
      ...new Set([
        ...current.contextPhotoIds,
        ...(Array.isArray(detection.contextPhotoIds) ? detection.contextPhotoIds : []),
      ]),
    ];
    current.markConfidence = Math.min(current.markConfidence, detection.markConfidence);
    current.boundaryConfidence = Math.min(
      current.boundaryConfidence,
      detection.boundaryConfidence,
    );
  }
  return [...grouped.values()];
}

function regionKey(photoId, regionId) {
  return `${photoId}:${regionId}`;
}

function sanitizeOcrResult(result, photoId, regionId) {
  if (!result || result.photoId !== photoId || result.regionId !== regionId) {
    throw new ImportPipelineError(
      'OCR_RESULT_MISMATCH',
      'OCR response did not match the requested question region.',
    );
  }

  if (
    typeof result.stem !== 'string' ||
    typeof result.complete !== 'boolean' ||
    !Array.isArray(result.parts) ||
    !Array.isArray(result.figures) ||
    result.parts.some((part) => !part || typeof part !== 'object') ||
    result.figures.some((figure) => !figure || typeof figure !== 'object')
  ) {
    throw new ImportPipelineError(
      'INVALID_OCR_RESULT',
      'OCR response does not match the question schema.',
    );
  }

  return {
    regionId,
    stem: result.stem,
    parts: result.parts.map((part) => ({
      prompt: String(part.prompt || ''),
      options: Array.isArray(part.options) ? part.options.map(String) : [],
    })),
    figures: result.figures.map((figure) => ({
      assetRef: String(figure.assetRef || ''),
      position: Number.isInteger(figure.position) ? figure.position : 0,
      caption: String(figure.caption || ''),
    })),
    complete: result.complete,
    subject: typeof result.subject === 'string' ? result.subject : null,
    subjectConfidence: Number.isFinite(result.subjectConfidence)
      ? result.subjectConfidence
      : 0,
    knowledgeCandidates: Array.isArray(result.knowledgeCandidates)
      ? result.knowledgeCandidates.map(String)
      : [],
  };
}

async function processImportBatch({
  batchId,
  photos,
  detector,
  cropper,
  ocr,
  repository,
  policy,
  now = () => new Date(),
}) {
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new ImportPipelineError('EMPTY_IMPORT_BATCH', 'At least one photo is required.');
  }
  if (photos.some((photo) => photo.category === 'private')) {
    if (photos.length !== 1 || photos[0].category !== 'private') {
      throw new ImportPipelineError(
        'MIXED_PHOTO_CATEGORIES',
        'Private photos must not be mixed into a study import batch.',
      );
    }
    return { batchId, status: 'private_stored', questionCount: 0, ocrRequestCount: 0 };
  }
  if (!detector || !repository) {
    throw new ImportPipelineError(
      'IMPORT_ADAPTER_MISSING',
      'A detector and repository are required for study imports.',
    );
  }
  validatePolicy(policy);
  if (photos.some((photo) => photo.category !== 'study')) {
    throw new ImportPipelineError('INVALID_PHOTO_CATEGORY', 'Only study photos can be recognized.');
  }

  const photoIds = new Set(photos.map((photo) => photo.id));
  if (
    photoIds.size !== photos.length ||
    photos.some((photo) =>
      !photo.id ||
      !photo.uploadedAt ||
      Number.isNaN(new Date(photo.uploadedAt).getTime()) ||
      typeof photo.storageRef !== 'string')
  ) {
    throw new ImportPipelineError(
      'INVALID_PHOTO_BATCH',
      'Photo IDs must be unique and each photo needs an upload timestamp.',
    );
  }

  const detections = await detector.detectMarkedRegions({ batchId, photos });
  if (!Array.isArray(detections)) {
    throw new ImportPipelineError('INVALID_DETECTION_RESULT', 'Detector result must be an array.');
  }
  const regions = groupRegions(detections);
  const regionStates = new Map();
  const safeCrops = [];
  const stateKey = (photoId, regionId) => `${photoId}:${regionId}`;

  const contextPhotoIds = new Set(
    regions.flatMap((region) => region.contextPhotoIds || []),
  );
  for (const photo of photos) {
    if (!regions.some((region) => region.photoId === photo.id)) {
      await repository.setPhotoStatus(
        photo.id,
        contextPhotoIds.has(photo.id) ? 'context_only' : 'no_marks',
      );
    }
  }

  for (const region of regions) {
    const photo = photos.find((item) => item.id === region.photoId);
    if (!photo) {
      throw new ImportPipelineError(
        'DETECTION_PHOTO_MISMATCH',
        'Detector returned a region for a photo outside this batch.',
      );
    }

    if (
      region.markConfidence < policy.minimumMarkConfidence ||
      region.boundaryConfidence < policy.minimumBoundaryConfidence
    ) {
      regionStates.set(stateKey(photo.id, region.regionId), 'needs_retake');
      await repository.setRegionStatus(photo.id, region.regionId, 'needs_retake');
      continue;
    }
    if (
      Array.isArray(region.contextPhotoIds) &&
      region.contextPhotoIds.some((contextPhotoId) => !photoIds.has(contextPhotoId))
    ) {
      regionStates.set(stateKey(photo.id, region.regionId), 'needs_retake');
      await repository.setRegionStatus(photo.id, region.regionId, 'needs_retake');
      continue;
    }

    if (!cropper || typeof cropper.cropMarkedQuestion !== 'function') {
      throw new ImportPipelineError('CROPPER_ADAPTER_INVALID', 'A question cropper is required.');
    }
    const crop = await cropper.cropMarkedQuestion({ batchId, photos, region });
    if (
      !crop ||
      crop.regionId !== region.regionId ||
      crop.photoId !== region.photoId ||
      crop.containsOnlySelectedQuestion !== true ||
      crop.includesUnmarkedQuestionText !== false ||
      crop.isFullPage !== false
    ) {
      regionStates.set(stateKey(photo.id, region.regionId), 'needs_retake');
      await repository.setRegionStatus(photo.id, region.regionId, 'needs_retake');
      continue;
    }
    safeCrops.push({ crop, region, photo });
  }

  let ocrRequestCount = 0;
  let providerUsage = null;
  if (safeCrops.length > 0) {
    if (typeof ocr.recognizeQuestionBatch !== 'function') {
      throw new ImportPipelineError('OCR_ADAPTER_INVALID', 'Batch OCR adapter is required.');
    }
    const response = await ocr.recognizeQuestionBatch({
      batchId,
      items: safeCrops.map(({ crop, region }) => ({
        regionId: region.regionId,
        photoId: region.photoId,
        markTypes: region.markTypes,
        crop,
      })),
    });
    if (!response || !Array.isArray(response.results)) {
      throw new ImportPipelineError('INVALID_OCR_BATCH', 'OCR batch response is malformed.');
    }
    ocrRequestCount = response.usage?.requestCount;
    if (
      !Number.isInteger(ocrRequestCount) ||
      ocrRequestCount < 1 ||
      response.usage.imageCount !== safeCrops.length ||
      typeof response.usage.provider !== 'string'
    ) {
      throw new ImportPipelineError(
        'INVALID_OCR_USAGE',
        'OCR usage must report at least one provider request for a non-empty batch.',
      );
    }
    providerUsage = response.usage || null;
    const resultMap = new Map();
    const requestedRegionIds = new Set(
      safeCrops.map(({ region }) => regionKey(region.photoId, region.regionId)),
    );
    for (const result of response.results) {
      if (
        !result ||
        typeof result.photoId !== 'string' ||
        typeof result.regionId !== 'string'
      ) {
        throw new ImportPipelineError(
          'INVALID_OCR_RESULT',
          'OCR result is missing its photo and region identifiers.',
        );
      }
      if (!requestedRegionIds.has(regionKey(result.photoId, result.regionId))) {
        throw new ImportPipelineError(
          'UNREQUESTED_OCR_RESULT',
          'OCR returned a result for a region that was not submitted.',
        );
      }
      const key = regionKey(result.photoId, result.regionId);
      if (resultMap.has(key)) {
        throw new ImportPipelineError('DUPLICATE_OCR_RESULT', 'OCR returned a duplicate region.');
      }
      resultMap.set(key, result);
    }

    for (const item of safeCrops) {
      const { region, photo } = item;
      const key = regionKey(photo.id, region.regionId);
      const rawResult = resultMap.get(key);
      if (!rawResult) {
        regionStates.set(stateKey(photo.id, region.regionId), 'needs_correction');
        await repository.setRegionStatus(photo.id, region.regionId, 'needs_correction');
        continue;
      }
      const result = sanitizeOcrResult(rawResult, photo.id, region.regionId);
      if (!result.complete || !result.stem.trim()) {
        regionStates.set(stateKey(photo.id, region.regionId), 'needs_correction');
        await repository.setRegionStatus(photo.id, region.regionId, 'needs_correction');
        continue;
      }
      if (
        !result.subject ||
        result.subjectConfidence < policy.minimumSubjectConfidence
      ) {
        regionStates.set(stateKey(photo.id, region.regionId), 'needs_subject');
        await repository.saveRecognizedDraft({
          photoId: photo.id,
          regionId: region.regionId,
          markTypes: region.markTypes,
          content: result,
        });
        await repository.setRegionStatus(photo.id, region.regionId, 'needs_subject');
        continue;
      }

      await repository.archiveQuestion({
        photoId: photo.id,
        regionId: region.regionId,
        learnerId: photo.learnerId,
        subject: result.subject,
        markTypes: region.markTypes,
        stem: result.stem,
        parts: result.parts,
        figures: result.figures,
        knowledgeCandidates: result.knowledgeCandidates,
        origin: 'photo',
        mastery: 'unmastered',
        collection: 'organized',
      });
      regionStates.set(stateKey(photo.id, region.regionId), 'archived');
    }
  }

  const unresolved = [...regionStates.values()].some(
    (status) => !FINAL_REGION_STATES.has(status),
  );
  const hasAnyMarkedRegion = regions.length > 0;
  const completedAt = now();
  const unresolvedPhotoIds = new Set();
  for (const region of regions) {
    const status = regionStates.get(stateKey(region.photoId, region.regionId));
    if (status && !FINAL_REGION_STATES.has(status)) {
      unresolvedPhotoIds.add(region.photoId);
      for (const contextPhotoId of region.contextPhotoIds || []) {
        unresolvedPhotoIds.add(contextPhotoId);
      }
    }
  }
  const relatedPhotoIds = new Set(contextPhotoIds);
  for (const region of regions) {
    relatedPhotoIds.add(region.photoId);
  }
  let latestRetentionExpiry = null;
  for (const photo of photos) {
    const expiry = unresolvedPhotoIds.has(photo.id)
      ? addUtcDays(photo.uploadedAt, 30)
      : hasAnyMarkedRegion && relatedPhotoIds.has(photo.id)
        ? addUtcMonths(completedAt, 6)
        : addUtcDays(photo.uploadedAt, 30);
    if (!latestRetentionExpiry || expiry > latestRetentionExpiry) {
      latestRetentionExpiry = expiry;
    }
    await repository.setPhotoRetention(photo.id, {
      originalExpiresAt: expiry.toISOString(),
      deleteOriginalOnly: true,
    });
  }

  return {
    batchId,
    status: unresolved ? 'needs_attention' : 'processed',
    questionCount: regions.length,
    archivedCount: [...regionStates.values()].filter((status) => status === 'archived').length,
    ocrRequestCount,
    providerUsage,
    originalExpiresAt: latestRetentionExpiry?.toISOString() || null,
  };
}

module.exports = {
  ImportPipelineError,
  processImportBatch,
};
