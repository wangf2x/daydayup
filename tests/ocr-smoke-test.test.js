const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createOcrSmokeTestHandler } = require('../cloudfunctions/ocr-smoke-test/handler');

const CROP_BYTES = Buffer.from('approved selected crop');
const CROP_BASE64 = CROP_BYTES.toString('base64');
const CROP_HASH = createHash('sha256').update(CROP_BYTES).digest('hex');

function createTestHandler({
  caller = { uid: 'owner-uid' },
  allowedIdentities = ['owner-uid'],
  consoleToken,
  cropHashes = { 'p29-q2': CROP_HASH, 'p30-extra-q2': CROP_HASH },
} = {}) {
  const calls = [];
  const handler = createOcrSmokeTestHandler({
    getCaller: async () => caller,
    allowedIdentities,
    consoleToken,
    resolveCropHashes: () => cropHashes,
    ocr: {
      async recognizeQuestionBatch(request) {
        calls.push(request);
        return {
          results: request.items.map((item) => ({
            photoId: item.photoId,
            stem: '识别出的题目文字',
            complete: true,
          })),
          usage: { provider: 'tencent-QuestionOCR', requestCount: request.items.length, imageCount: request.items.length },
        };
      },
    },
  });
  return { handler, calls };
}

test('OCR smoke test requires an allowed caller and explicit billing confirmation', async () => {
  const unauthenticated = createTestHandler({ caller: {} });
  await assert.rejects(unauthenticated.handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'UNAUTHENTICATED' });
  assert.equal(unauthenticated.calls.length, 0);

  const forbidden = createTestHandler({ caller: { uid: 'someone-else', openid: 'wx-openid-other' } });
  await assert.rejects(forbidden.handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'FORBIDDEN' });
  assert.equal(forbidden.calls.length, 0);

  const noConfirmation = createTestHandler();
  await assert.rejects(noConfirmation.handler({
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'BILLABLE_OCR_CONFIRMATION_REQUIRED' });
  assert.equal(noConfirmation.calls.length, 0);
});

test('OCR smoke test rejects anonymous CloudBase sessions', async () => {
  const anonymous = createTestHandler({ caller: { uid: 'anon-uid', anonymous: true } });

  await assert.rejects(anonymous.handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'FORBIDDEN' });
  assert.equal(anonymous.calls.length, 0);
});

test('OCR smoke test accepts either a CloudBase user ID or a WeChat OpenID as owner', async () => {
  const viaOpenId = createTestHandler({
    caller: { openid: 'wx-openid-owner' },
    allowedIdentities: ['wx-openid-owner'],
  });
  const result = await viaOpenId.handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  });
  assert.equal(viaOpenId.calls.length, 1);
  assert.equal(result.results[0].cropLabel, 'p29-q2');
});

test('OCR smoke test sends both approved crops in one batch call', async () => {
  const { handler, calls } = createTestHandler();

  const result = await handler({
    confirmBillableOcr: true,
    items: [
      { cropLabel: 'p29-q2', imageBase64: CROP_BASE64 },
      { cropLabel: 'p30-extra-q2', imageBase64: CROP_BASE64 },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].items.length, 2);
  assert.ok(calls[0].items.every((item) => item.crop.isFullPage === false));
  assert.ok(calls[0].items.every((item) => item.crop.containsOnlySelectedQuestion === true));
  assert.deepEqual(result.results.map((item) => item.cropLabel), ['p29-q2', 'p30-extra-q2']);
});

test('OCR smoke test rejects unapproved labels, invalid base64, and oversized batches', async () => {
  const { handler, calls } = createTestHandler();

  await assert.rejects(handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q4-sub3', imageBase64: CROP_BASE64 }],
  }), { code: 'INVALID_REQUEST' });

  await assert.rejects(handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: 'not-base64!' }],
  }), { code: 'INVALID_REQUEST' });

  await assert.rejects(handler({
    confirmBillableOcr: true,
    items: [
      { cropLabel: 'p29-q2', imageBase64: CROP_BASE64 },
      { cropLabel: 'p29-q2', imageBase64: CROP_BASE64 },
      { cropLabel: 'p29-q2', imageBase64: CROP_BASE64 },
    ],
  }), { code: 'INVALID_REQUEST' });

  assert.equal(calls.length, 0);
});

test('OCR smoke test rejects image bytes that do not match the approved crop digest', async () => {
  const { handler, calls } = createTestHandler();

  await assert.rejects(handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: Buffer.from('different image').toString('base64') }],
  }), { code: 'CROP_NOT_APPROVED' });
  assert.equal(calls.length, 0);
});

test('OCR smoke test only reports the caller identity before an owner is configured', async () => {
  const bootstrap = createTestHandler({ allowedIdentities: [] });

  const identity = await bootstrap.handler({ action: 'whoami' });
  assert.deepEqual(identity, { identity: { openid: null, uid: 'owner-uid' } });

  await assert.rejects(bootstrap.handler({
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'FORBIDDEN' });
  assert.equal(bootstrap.calls.length, 0);
});

test('OCR smoke test honors a console token only when explicitly configured', async () => {
  const withToken = createTestHandler({ caller: {}, allowedIdentities: [], consoleToken: 'one-time-token' });
  const result = await withToken.handler({
    consoleToken: 'one-time-token',
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  });
  assert.equal(withToken.calls.length, 1);
  assert.equal(result.results[0].cropLabel, 'p29-q2');

  const wrongToken = createTestHandler({ caller: {}, allowedIdentities: [], consoleToken: 'one-time-token' });
  await assert.rejects(wrongToken.handler({
    consoleToken: 'guessed-token',
    confirmBillableOcr: true,
    items: [{ cropLabel: 'p29-q2', imageBase64: CROP_BASE64 }],
  }), { code: 'UNAUTHENTICATED' });
  assert.equal(wrongToken.calls.length, 0);

  await assert.rejects(withToken.handler({ action: 'whoami', consoleToken: 'one-time-token' }), {
    code: 'INVALID_REQUEST',
  });
});
