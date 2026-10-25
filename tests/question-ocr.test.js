const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuestionOcrHandler } = require('../cloudfunctions/question-ocr/handler');

const CROP_BASE64 = Buffer.from('single question crop').toString('base64');

function createHandler({ caller = { uid: 'owner-uid' } } = {}) {
  const calls = [];
  const handler = createQuestionOcrHandler({
    getCaller: async () => caller,
    ocr: {
      async recognizeQuestionBatch(request) {
        calls.push(request);
        return {
          results: [{ photoId: request.items[0].photoId, stem: '1+1=？', complete: true }],
          usage: { provider: 'tencent-QuestionOCR', requestCount: 1, imageCount: 1 },
        };
      },
    },
  });
  return { handler, calls };
}

test('question OCR requires an authenticated non-anonymous caller', async () => {
  const missing = createHandler({ caller: {} });
  await assert.rejects(missing.handler({
    confirmedSingleQuestion: true,
    imageBase64: CROP_BASE64,
  }), { code: 'UNAUTHENTICATED' });

  const anonymous = createHandler({ caller: { uid: 'anon', anonymous: true } });
  await assert.rejects(anonymous.handler({
    confirmedSingleQuestion: true,
    imageBase64: CROP_BASE64,
  }), { code: 'FORBIDDEN' });

  assert.equal(missing.calls.length + anonymous.calls.length, 0);
});

test('question OCR requires an explicit single-question confirmation', async () => {
  const { handler, calls } = createHandler();

  await assert.rejects(handler({ imageBase64: CROP_BASE64 }), {
    code: 'SINGLE_QUESTION_CONFIRMATION_REQUIRED',
  });
  assert.equal(calls.length, 0);
});

test('question OCR rejects invalid base64 and oversized images', async () => {
  const { handler, calls } = createHandler();

  await assert.rejects(handler({
    confirmedSingleQuestion: true,
    imageBase64: 'not-base64!',
  }), { code: 'INVALID_REQUEST' });

  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString('base64');
  await assert.rejects(handler({
    confirmedSingleQuestion: true,
    imageBase64: oversized,
  }), { code: 'INVALID_REQUEST' });

  assert.equal(calls.length, 0);
});

test('question OCR returns recognized text and marks the crop as a verified single question', async () => {
  const { handler, calls } = createHandler();

  const result = await handler({
    confirmedSingleQuestion: true,
    imageBase64: CROP_BASE64,
    photoId: 'photo-1',
  });

  assert.equal(result.text, '1+1=？');
  assert.equal(result.complete, true);
  assert.equal(result.callerId, 'owner-uid');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items[0].crop.isFullPage, false);
  assert.equal(calls[0].items[0].crop.containsOnlySelectedQuestion, true);
});
