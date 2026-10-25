const test = require('node:test');
const assert = require('node:assert/strict');

const { createPaperScanHandler, computeQuestionBand, clampRect } = require('../cloudfunctions/paper-scan/handler');
const { SINGLE_MARK_PROMPT } = require('../cloudfunctions/paper-scan/single-prompt');

const page = { width: 768, height: 1024 };

test('question band starts at the top of the question and stays inside the page', () => {
  const band = computeQuestionBand({ x: 0.047, y: 0.206, w: 0.443, h: 0.189 }, page);
  assert.deepEqual(band, { left: 28, top: 205, width: 356, height: 170 });

  const topEdge = computeQuestionBand({ x: 0, y: 0, w: 0.2, h: 0.05 }, page);
  assert.equal(topEdge.left, 0);
  assert.equal(topEdge.top, 0);
  assert.ok(topEdge.height >= 90, 'band keeps a minimum height for tiny question boxes');
});

test('band is rejected when the page size is unknown or the rect is degenerate', () => {
  assert.equal(computeQuestionBand({ x: 0.1, y: 0.1, w: 0.01, h: 0.01 }, { width: 0, height: 0 }), null);
  assert.equal(computeQuestionBand({ x: 1, y: 1, w: 0.001, h: 0.001 }, page), null);
});

test('rects are clamped into the page and invalid input is rejected', () => {
  assert.deepEqual(clampRect({ x: -0.2, y: 1.4, w: 2, h: 0 }), { x: 0, y: 1, w: 1, h: 0.01 });
  assert.equal(clampRect({ x: 'a', y: 0, w: 0.1, h: 0.1 }), null);
  assert.equal(clampRect(null), null);
});

test('plan mode returns per-question bands from the split result', async () => {
  const calls = [];
  const handler = createPaperScanHandler({
    getCaller: async () => ({ uid: 'u1' }),
    sharp: () => {
      throw new Error('sharp should not be used in plan mode');
    },
    split: {
      splitPage: async ({ photoId }) => {
        calls.push(photoId);
        return {
          page,
          usage: { provider: 'tencent-QuestionSplitOCR' },
          questions: [
            { index: 0, stem: '1. 第一题', rect: { x: 0.047, y: 0.069, w: 0.439, h: 0.125 }, subject: '', figureCount: 0 },
            { index: 1, stem: '2. 第二题', rect: { x: 0.047, y: 0.206, w: 0.443, h: 0.189 }, subject: '', figureCount: 1 },
          ],
        };
      },
    },
    vision: { detectMarks: async () => ({ text: '', provider: 'tokenhub', model: 'mock' }) },
  });

  const result = await handler({
    action: 'plan',
    imageBase64: Buffer.from([1, 2, 3]).toString('base64'),
  });

  assert.equal(result.mode, 'plan');
  assert.equal(result.questions.length, 2);
  assert.ok(result.questions[0].band, 'every question gets a band');
  assert.equal(calls.length, 1);
  assert.equal(result.callerId, 'u1');
});

test('mark mode crops the band through sharp and forwards the prompt', async () => {
  const operations = [];
  const sharp = (input) => {
    const api = {
      extract(options) {
        operations.push({ kind: 'extract', options });
        return api;
      },
      resize(options) {
        operations.push({ kind: 'resize', options });
        return api;
      },
      jpeg(options) {
        operations.push({ kind: 'jpeg', options });
        return api;
      },
      async toBuffer() {
        return Buffer.from([9, 9, 9]);
      },
    };
    assert.ok(Buffer.isBuffer(input), 'sharp receives the page buffer');
    return api;
  };

  const seen = [];
  const handler = createPaperScanHandler({
    getCaller: async () => ({ uid: 'u2' }),
    sharp,
    split: { splitPage: async () => ({ page, questions: [] }) },
    vision: {
      detectMarks: async (request) => {
        seen.push(request);
        return { text: '{"mark":"star","confidence":0.9}', provider: 'tokenhub', model: 'hunyuan-t1-vision' };
      },
    },
  });

  const result = await handler({
    action: 'mark',
    imageBase64: Buffer.from([1, 2, 3]).toString('base64'),
    page,
    rect: { x: 0.047, y: 0.206, w: 0.443, h: 0.189 },
    questionNo: '2',
    promptText: SINGLE_MARK_PROMPT,
  });

  assert.equal(result.mode, 'mark');
  assert.deepEqual(result.band, { left: 28, top: 205, width: 356, height: 170 });
  assert.equal(seen.length, 1);
  assert.deepEqual(operations[0], { kind: 'extract', options: { left: 28, top: 205, width: 356, height: 170 } });
  assert.deepEqual(operations[1], { kind: 'resize', options: { width: 890 } });
  assert.deepEqual(operations[2], { kind: 'jpeg', options: { quality: 92 } });
  assert.equal(seen[0].mimeType, 'image/jpeg');
  assert.equal(seen[0].promptText, SINGLE_MARK_PROMPT);
});

test('both modes require an authenticated non-anonymous caller', async () => {
  const build = (caller) => createPaperScanHandler({
    getCaller: async () => caller,
    sharp: () => ({ extract: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from([1]) }) }) }) }),
    split: { splitPage: async () => ({ page, questions: [] }) },
    vision: { detectMarks: async () => ({ text: '{}' }) },
  });

  await assert.rejects(
    () => build({})({ action: 'plan', imageBase64: 'AAAA' }),
    (error) => error.code === 'UNAUTHENTICATED',
  );
  await assert.rejects(
    () => build({ uid: 'u', anonymous: true })({ action: 'plan', imageBase64: 'AAAA' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('mark mode validates rect, page, and image payload', async () => {
  const handler = createPaperScanHandler({
    getCaller: async () => ({ uid: 'u' }),
    sharp: () => ({ extract: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from([1]) }) }) }) }),
    split: { splitPage: async () => ({ page, questions: [] }) },
    vision: { detectMarks: async () => ({ text: '{}' }) },
  });

  await assert.rejects(
    () => handler({ action: 'mark', imageBase64: 'AAAA', page, rect: null }),
    (error) => error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    () => handler({ action: 'mark', imageBase64: 'AAAA', page: null, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }),
    (error) => error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    () => handler({ action: 'mark', imageBase64: 'not base64!', page, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }),
    (error) => error.code === 'INVALID_REQUEST',
  );
});

test('single mark prompt pins the three symbol classes and forbids invention', () => {
  assert.match(SINGLE_MARK_PROMPT, /star/);
  assert.match(SINGLE_MARK_PROMPT, /triangle/);
  assert.match(SINGLE_MARK_PROMPT, /check/);
  assert.match(SINGLE_MARK_PROMPT, /圆圈/);
  assert.match(SINGLE_MARK_PROMPT, /none/);
});
