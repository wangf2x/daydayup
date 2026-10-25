const test = require('node:test');
const assert = require('node:assert/strict');
const { processImportBatch } = require('../cloudfunctions/shared/import-pipeline');
const { createMockAdapters } = require('../cloudfunctions/shared/mock-adapters');
const { createProcessImportHandler } = require('../cloudfunctions/process-import/handler');

const policy = {
  calibrated: true,
  minimumMarkConfidence: 0.9,
  minimumBoundaryConfidence: 0.9,
  minimumSubjectConfidence: 0.9,
};

const fixedNow = () => new Date('2026-10-24T00:00:00.000Z');

function makePhoto(id = 'photo-1', overrides = {}) {
  return {
    id,
    category: 'study',
    learnerId: 'learner-1',
    uploadedAt: '2026-10-01T00:00:00.000Z',
    storageRef: `private/${id}`,
    ...overrides,
  };
}

function makeDetection(overrides = {}) {
  return {
    photoId: 'photo-1',
    regionId: 'region-1',
    markTypes: ['unfamiliar'],
    markConfidence: 0.98,
    boundaryConfidence: 0.97,
    ...overrides,
  };
}

function makeOcrResult(overrides = {}) {
  return {
    photoId: 'photo-1',
    regionId: 'region-1',
    stem: '一盒彩笔有 12 支，分给 3 个小朋友。',
    parts: [{ prompt: '平均每人分几支？', options: [] }],
    figures: [],
    complete: true,
    subject: '数学',
    subjectConfidence: 0.97,
    knowledgeCandidates: ['除法'],
    verdict: 'incorrect',
    studentAnswer: '4',
    score: 0,
    ...overrides,
  };
}

function makeRepository() {
  const writes = {
    photoStatuses: [],
    regionStatuses: [],
    drafts: [],
    questions: [],
    retention: [],
  };
  return {
    writes,
    async setPhotoStatus(photoId, status) {
      writes.photoStatuses.push({ photoId, status });
    },
    async setRegionStatus(photoId, regionId, status) {
      writes.regionStatuses.push({ photoId, regionId, status });
    },
    async saveRecognizedDraft(draft) {
      writes.drafts.push(draft);
    },
    async archiveQuestion(question) {
      writes.questions.push(question);
    },
    async setPhotoRetention(photoId, retention) {
      writes.retention.push({ photoId, ...retention });
    },
  };
}

test('unmarked photos never call OCR and receive the 30-day retention window', async () => {
  const adapters = createMockAdapters();
  const repository = makeRepository();
  const result = await processImportBatch({
    batchId: 'batch-1',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.questionCount, 0);
  assert.equal(adapters.calls.ocrRequests, 0);
  assert.deepEqual(repository.writes.photoStatuses, [
    { photoId: 'photo-1', status: 'no_marks' },
  ]);
  assert.equal(result.originalExpiresAt, '2026-10-31T00:00:00.000Z');
});

test('low-confidence marks do not reach cropper or OCR', async () => {
  const adapters = createMockAdapters({
    detections: [makeDetection({ markConfidence: 0.4 })],
  });
  const repository = makeRepository();
  const result = await processImportBatch({
    batchId: 'batch-2',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(result.status, 'needs_attention');
  assert.equal(adapters.calls.cropper, 0);
  assert.equal(adapters.calls.ocrRequests, 0);
  assert.deepEqual(repository.writes.regionStatuses, [
    { photoId: 'photo-1', regionId: 'region-1', status: 'needs_retake' },
  ]);
});

test('multiple marks on one question are deduplicated and archived once', async () => {
  const adapters = createMockAdapters({
    detections: [
      makeDetection({ markTypes: ['unfamiliar'] }),
      makeDetection({ markTypes: ['careless'] }),
    ],
    ocrResults: [makeOcrResult()],
  });
  const repository = makeRepository();
  const result = await processImportBatch({
    batchId: 'batch-3',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(result.questionCount, 1);
  assert.equal(result.archivedCount, 1);
  assert.equal(adapters.calls.ocrRequests, 1);
  assert.equal(adapters.calls.ocrQuestionItems, 1);
  assert.equal(repository.writes.questions.length, 1);
  assert.deepEqual(repository.writes.questions[0].markTypes, [
    'unfamiliar',
    'careless',
  ]);
  assert.equal(repository.writes.questions[0].mastery, 'unmastered');
  assert.equal(repository.writes.questions[0].collection, 'organized');
  assert.equal('verdict' in repository.writes.questions[0], false);
  assert.equal('studentAnswer' in repository.writes.questions[0], false);
  assert.equal('score' in repository.writes.questions[0], false);
  assert.equal(result.originalExpiresAt, '2027-04-24T00:00:00.000Z');
});

test('one photo with multiple marked questions sends only safe crops in one batch call', async () => {
  const adapters = createMockAdapters({
    detections: [
      makeDetection({ regionId: 'region-1' }),
      makeDetection({ regionId: 'region-2' }),
      makeDetection({ regionId: 'region-3' }),
    ],
    ocrResults: [
      makeOcrResult({ regionId: 'region-1' }),
      makeOcrResult({ regionId: 'region-2' }),
      makeOcrResult({ regionId: 'region-3' }),
    ],
  });
  const repository = makeRepository();
  const result = await processImportBatch({
    batchId: 'batch-4',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(result.questionCount, 3);
  assert.equal(result.archivedCount, 3);
  assert.equal(adapters.calls.ocrRequests, 1);
  assert.equal(adapters.calls.ocrQuestionItems, 3);
  assert.equal(repository.writes.questions.length, 3);
});

test('same region ID on separate pages stays isolated in one batch', async () => {
  const adapters = createMockAdapters({
    detections: [
      makeDetection({ regionId: 'q1' }),
      makeDetection({ photoId: 'photo-2', regionId: 'q1' }),
    ],
    ocrResults: [
      makeOcrResult({ regionId: 'q1', stem: '第一张照片的题目' }),
      makeOcrResult({ photoId: 'photo-2', regionId: 'q1', stem: '第二张照片的题目' }),
    ],
  });
  const repository = makeRepository();
  await processImportBatch({
    batchId: 'batch-4b',
    photos: [makePhoto('photo-1'), makePhoto('photo-2')],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(adapters.calls.ocrQuestionItems, 2);
  assert.deepEqual(
    repository.writes.questions.map((question) => question.stem).sort(),
    ['第一张照片的题目', '第二张照片的题目'],
  );
});

test('unsafe full-page crops are blocked before OCR', async () => {
  const adapters = createMockAdapters({
    detections: [makeDetection()],
  });
  adapters.cropper.cropMarkedQuestion = async ({ region }) => ({
    photoId: region.photoId,
    regionId: region.regionId,
    containsOnlySelectedQuestion: false,
    includesUnmarkedQuestionText: true,
    isFullPage: true,
  });
  const repository = makeRepository();
  await processImportBatch({
    batchId: 'batch-5',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(adapters.calls.ocrRequests, 0);
  assert.equal(repository.writes.questions.length, 0);
});

test('uncertain subject saves a draft but does not auto-archive', async () => {
  const adapters = createMockAdapters({
    detections: [makeDetection()],
    ocrResults: [makeOcrResult({ subject: null, subjectConfidence: 0 })],
  });
  const repository = makeRepository();
  const result = await processImportBatch({
    batchId: 'batch-6',
    photos: [makePhoto()],
    ...adapters,
    repository,
    policy,
    now: fixedNow,
  });

  assert.equal(result.status, 'needs_attention');
  assert.equal(repository.writes.drafts.length, 1);
  assert.equal(repository.writes.questions.length, 0);
  assert.deepEqual(repository.writes.regionStatuses, [
    { photoId: 'photo-1', regionId: 'region-1', status: 'needs_subject' },
  ]);
});

test('private photos bypass both detector and OCR', async () => {
  const result = await processImportBatch({
    batchId: 'batch-7',
    photos: [makePhoto('private-1', { category: 'private' })],
  });

  assert.equal(result.status, 'private_stored');
});

test('automatic recognition fails closed until confidence policy is calibrated', async () => {
  const adapters = createMockAdapters({
    detections: [makeDetection()],
    ocrResults: [makeOcrResult()],
  });
  await assert.rejects(
    processImportBatch({
      batchId: 'batch-8',
      photos: [makePhoto()],
      ...adapters,
      repository: makeRepository(),
      policy: { ...policy, calibrated: false },
    }),
    { code: 'MARK_POLICY_UNCALIBRATED' },
  );
  assert.equal(adapters.calls.detector, 0);
  assert.equal(adapters.calls.ocrRequests, 0);
});

test('unauthenticated callers cannot load an import batch', async () => {
  let batchReads = 0;
  const handler = createProcessImportHandler({
    getCaller: async () => null,
    repository: {
      async getImportBatch() {
        batchReads += 1;
      },
    },
  });

  await assert.rejects(handler({ batchId: 'batch-private' }), { code: 'UNAUTHENTICATED' });
  assert.equal(batchReads, 0);
});

test('callers without batch access cannot trigger detection or OCR', async () => {
  let detectionCalls = 0;
  let ocrCalls = 0;
  const handler = createProcessImportHandler({
    getCaller: async () => ({ openid: 'parent-a' }),
    detector: {
      async detectMarkedRegions() {
        detectionCalls += 1;
        return [makeDetection()];
      },
    },
    cropper: {},
    ocr: {
      async recognizeQuestionBatch() {
        ocrCalls += 1;
        return { results: [], usage: { requestCount: 1, imageCount: 1, provider: 'mock' } };
      },
    },
    repository: {
      async getImportBatch() {
        return { id: 'batch-b', ownerOpenId: 'parent-b', photos: [makePhoto()] };
      },
      async canAccessBatch() {
        return false;
      },
    },
    policy,
  });

  await assert.rejects(handler({ batchId: 'batch-b' }), { code: 'NOT_FOUND' });
  assert.equal(detectionCalls, 0);
  assert.equal(ocrCalls, 0);
});
