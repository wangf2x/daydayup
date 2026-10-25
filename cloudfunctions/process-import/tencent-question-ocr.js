const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const DEFAULT_MIN_INTERVAL_MS = 550;

function imageToBase64(crop) {
  if (!crop || crop.isFullPage !== false
    || crop.containsOnlySelectedQuestion !== true
    || crop.includesUnmarkedQuestionText !== false) {
    throw new Error('Tencent OCR accepts only a verified selected-question crop.');
  }

  const image = crop.imageBytes;
  if (!Buffer.isBuffer(image) && !(image instanceof Uint8Array)) {
    throw new TypeError('A selected-question crop must contain PNG/JPEG image bytes.');
  }
  if (image.length === 0 || image.length > MAX_IMAGE_BYTES) {
    throw new RangeError('Selected-question crop must be between 1 byte and 7 MB.');
  }
  return Buffer.from(image).toString('base64');
}

function extractElementText(elements) {
  if (!Array.isArray(elements)) {
    return [];
  }
  return elements
    .map((element) => element && typeof element.Text === 'string' ? element.Text.trim() : '')
    .filter(Boolean);
}

function mapQuestionResponse(response, item) {
  const questionInfo = response && Array.isArray(response.QuestionInfo)
    ? response.QuestionInfo
    : [];
  const resultLists = questionInfo.flatMap((page) =>
    page && Array.isArray(page.ResultList) ? page.ResultList : []);
  const stem = resultLists
    .flatMap((result) => extractElementText(result.Question))
    .join('\n')
    .trim();
  const options = resultLists.flatMap((result) => extractElementText(result.Option));

  return {
    photoId: item.photoId,
    regionId: item.regionId,
    stem,
    parts: options.length > 0 ? [{ prompt: '', options }] : [],
    figures: [],
    complete: stem.length > 0,
    subject: null,
    subjectConfidence: 0,
    knowledgeCandidates: [],
  };
}

function createTencentQuestionOcr({
  client,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = Date.now,
}) {
  if (!client || typeof client.QuestionOCR !== 'function') {
    throw new TypeError('A Tencent QuestionOCR client is required.');
  }
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new RangeError('minIntervalMs must be a non-negative number.');
  }

  return {
    async recognizeQuestionBatch({ items }) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new TypeError('At least one selected-question crop is required.');
      }

      const results = [];
      let lastRequestAt = null;
      for (const item of items) {
        if (!item || typeof item.photoId !== 'string' || typeof item.regionId !== 'string') {
          throw new TypeError('Each selected-question crop must have photo and region IDs.');
        }
        if (lastRequestAt !== null) {
          const remaining = minIntervalMs - (now() - lastRequestAt);
          if (remaining > 0) {
            await wait(remaining);
          }
        }

        const response = await client.QuestionOCR({
          ImageBase64: imageToBase64(item.crop),
          IsPdf: false,
        });
        lastRequestAt = now();
        results.push(mapQuestionResponse(response, item));
      }

      return {
        results,
        usage: {
          provider: 'tencent-QuestionOCR',
          requestCount: items.length,
          imageCount: items.length,
        },
      };
    },
  };
}

function createTencentQuestionOcrFromEnvironment(environment = process.env) {
  // CloudBase rejects function environment keys prefixed with TENCENTCLOUD_, so the
  // OCR-specific names are preferred and the SDK defaults remain as a fallback.
  const secretId = environment.OCR_TENCENT_SECRET_ID || environment.TENCENTCLOUD_SECRET_ID;
  const secretKey = environment.OCR_TENCENT_SECRET_KEY || environment.TENCENTCLOUD_SECRET_KEY;
  const region = environment.OCR_TENCENT_REGION || environment.TENCENTCLOUD_REGION;
  if (!secretId || !secretKey || !region) {
    const error = new Error(
      'OCR_TENCENT_SECRET_ID, OCR_TENCENT_SECRET_KEY, and OCR_TENCENT_REGION are required in the function environment.',
    );
    error.code = 'OCR_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const { ocr } = require('tencentcloud-sdk-nodejs-ocr');
  const client = new ocr.v20181119.Client({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com' } },
  });
  return createTencentQuestionOcr({ client });
}

module.exports = {
  createTencentQuestionOcr,
  createTencentQuestionOcrFromEnvironment,
  mapQuestionResponse,
};
