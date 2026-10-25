const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTencentQuestionOcr,
  createTencentQuestionOcrFromEnvironment,
} = require('../cloudfunctions/process-import/tencent-question-ocr');

function makeItem(overrides = {}) {
  return {
    photoId: 'photo-1',
    regionId: 'region-1',
    crop: {
      imageBytes: Buffer.from('selected-crop'),
      isFullPage: false,
      containsOnlySelectedQuestion: true,
      includesUnmarkedQuestionText: false,
    },
    ...overrides,
  };
}

test('Tencent QuestionOCR submits only verified selected-question crop bytes', async () => {
  const requests = [];
  const ocr = createTencentQuestionOcr({
    client: {
      async QuestionOCR(request) {
        requests.push(request);
        return {
          RequestId: 'request-1',
          QuestionInfo: [{
            ResultList: [{
              Question: [{ Text: '有一个长方形。' }, { Text: '求面积。' }],
              Option: [{ Text: 'A. 12' }, { Text: 'B. 18' }],
              Answer: [{ Text: '答案不应进入题干' }],
            }],
          }],
        };
      },
    },
    minIntervalMs: 0,
  });

  const response = await ocr.recognizeQuestionBatch({ items: [makeItem()] });

  assert.deepEqual(requests, [{
    ImageBase64: Buffer.from('selected-crop').toString('base64'),
    IsPdf: false,
  }]);
  assert.deepEqual(response.usage, {
    provider: 'tencent-QuestionOCR',
    requestCount: 1,
    imageCount: 1,
  });
  assert.deepEqual(response.results[0], {
    photoId: 'photo-1',
    regionId: 'region-1',
    stem: '有一个长方形。\n求面积。',
    parts: [{ prompt: '', options: ['A. 12', 'B. 18'] }],
    figures: [],
    complete: true,
    subject: null,
    subjectConfidence: 0,
    knowledgeCandidates: [],
  });
  assert.equal(response.results[0].stem.includes('答案不应进入题干'), false);
});

test('Tencent OCR refuses full-page, unverified, or empty crop data', async () => {
  const ocr = createTencentQuestionOcr({
    client: { async QuestionOCR() { throw new Error('must not be called'); } },
    minIntervalMs: 0,
  });

  await assert.rejects(ocr.recognizeQuestionBatch({
    items: [makeItem({ crop: { ...makeItem().crop, isFullPage: true } })],
  }), /verified selected-question crop/);
  await assert.rejects(ocr.recognizeQuestionBatch({
    items: [makeItem({ crop: { ...makeItem().crop, includesUnmarkedQuestionText: true } })],
  }), /verified selected-question crop/);
  await assert.rejects(ocr.recognizeQuestionBatch({
    items: [makeItem({ crop: { ...makeItem().crop, imageBytes: Buffer.alloc(0) } })],
  }), /between 1 byte and 7 MB/);
});

test('Tencent QuestionOCR respects the documented two-requests-per-second limit', async () => {
  const requestedAt = [];
  const waits = [];
  let clock = 1000;
  const ocr = createTencentQuestionOcr({
    client: {
      async QuestionOCR() {
        requestedAt.push(clock);
        return { QuestionInfo: [] };
      },
    },
    minIntervalMs: 550,
    now: () => clock,
    wait: async (duration) => {
      waits.push(duration);
      clock += duration;
    },
  });

  const response = await ocr.recognizeQuestionBatch({
    items: [
      makeItem({ regionId: 'region-1' }),
      makeItem({ regionId: 'region-2' }),
    ],
  });

  assert.deepEqual(requestedAt, [1000, 1550]);
  assert.deepEqual(waits, [550]);
  assert.equal(response.results.length, 2);
});

test('Tencent QuestionOCR client requires credentials only from protected function environment', () => {
  assert.throws(() => createTencentQuestionOcrFromEnvironment({}), {
    code: 'OCR_PROVIDER_NOT_CONFIGURED',
  });
  const adapter = createTencentQuestionOcrFromEnvironment({
    OCR_TENCENT_SECRET_ID: 'unit-test-secret-id',
    OCR_TENCENT_SECRET_KEY: 'unit-test-secret-key',
    OCR_TENCENT_REGION: 'ap-shanghai',
  });
  assert.equal(typeof adapter.recognizeQuestionBatch, 'function');

  const legacyAdapter = createTencentQuestionOcrFromEnvironment({
    TENCENTCLOUD_SECRET_ID: 'unit-test-secret-id',
    TENCENTCLOUD_SECRET_KEY: 'unit-test-secret-key',
    TENCENTCLOUD_REGION: 'ap-guangzhou',
  });
  assert.equal(typeof legacyAdapter.recognizeQuestionBatch, 'function');
});
