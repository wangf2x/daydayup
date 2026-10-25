const test = require('node:test');
const assert = require('node:assert/strict');

const { createTencentQuestionSplit, mapSplitResponse } = require('../cloudfunctions/process-import/tencent-question-split');
const { createQuestionSplitHandler } = require('../cloudfunctions/question-split/handler');

function polygon(left, top, right, bottom) {
  return {
    LeftTop: { X: left, Y: top },
    RightTop: { X: right, Y: top },
    RightBottom: { X: right, Y: bottom },
    LeftBottom: { X: left, Y: bottom },
  };
}

function sampleResponse() {
  return {
    QuestionInfo: [
      {
        Width: 1000,
        Height: 2000,
        ResultList: [
          {
            Question: [{ Text: '1. 计算 12 + 8 = ?' }],
            Option: [],
            Coord: [polygon(100, 100, 900, 300)],
            Subject: '数学',
            KnowledgePoints: ['加法'],
            RightAnswer: '20',
            Answer: [
              {
                Text: '20',
                AnswerElement: { IsCorrect: true, RightAnswer: '20', AnswerAnalysis: '' },
              },
            ],
            Parse: [],
          },
          {
            Question: [{ Text: '2. 下列词语中书写正确的是（　）' }, { Text: 'A. 再接再励' }],
            Option: [{ Text: 'A' }, { Text: 'B' }],
            Coord: [polygon(100, 400, 900, 700), polygon(100, 720, 900, 900)],
            Subject: '语文',
            KnowledgePoints: [],
            RightAnswer: 'B',
            Answer: [
              {
                Text: 'A',
                AnswerElement: { IsCorrect: false, RightAnswer: 'B', AnswerAnalysis: '应为再接再厉' },
              },
            ],
            Figure: [],
            Table: [],
          },
        ],
      },
    ],
  };
}

test('question split maps coordinates to relative page rectangles', () => {
  const mapped = mapSplitResponse(sampleResponse(), { photoId: 'page-1' });

  assert.deepEqual(mapped.page, { width: 1000, height: 2000 });
  assert.equal(mapped.questions.length, 2);

  const [first, second] = mapped.questions;
  assert.deepEqual(first.rect, { x: 0.1, y: 0.05, w: 0.8, h: 0.1 });
  assert.equal(first.subject, '数学');
  assert.deepEqual(first.knowledgePoints, ['加法']);
  assert.equal(first.rightAnswer, '20');
  assert.equal(first.answers[0].isCorrect, true);

  assert.equal(second.coordCount, 2, 'multi-block questions keep the coordinate count');
  assert.deepEqual(second.rect, { x: 0.1, y: 0.2, w: 0.8, h: 0.25 });
  assert.deepEqual(second.options, ['A', 'B']);
  assert.equal(second.answers[0].isCorrect, false);
  assert.equal(second.answers[0].analysis, '应为再接再厉');
});

test('question split reports missing correctness flags instead of guessing', () => {
  const response = sampleResponse();
  delete response.QuestionInfo[0].ResultList[0].Answer;
  const mapped = mapSplitResponse(response, { photoId: 'page-2' });

  assert.deepEqual(mapped.questions[0].answers, []);
  assert.equal(mapped.questions[1].answers[0].isCorrect, false);
});

test('question split adapter rejects oversized or empty page images', async () => {
  const client = {
    async QuestionSplitOCR() {
      return { QuestionInfo: [] };
    },
  };
  const split = createTencentQuestionSplit({ client });

  await assert.rejects(() => split.splitPage({ photoId: 'p', imageBytes: Buffer.alloc(0) }), RangeError);
  await assert.rejects(() => split.splitPage({ photoId: 'p', imageBytes: 'not-bytes' }), TypeError);
});

test('question split adapter sends the page as base64 without PDF mode', async () => {
  const calls = [];
  const client = {
    async QuestionSplitOCR(request) {
      calls.push(request);
      return sampleResponse();
    },
  };
  const split = createTencentQuestionSplit({ client, minIntervalMs: 0 });
  const result = await split.splitPage({
    photoId: 'page-3',
    imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ImageBase64, Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString('base64'));
  assert.equal(calls[0].IsPdf, false);
  assert.equal(result.questions.length, 2);
  assert.equal(result.usage.provider, 'tencent-QuestionSplitOCR');
});

test('question split handler requires a signed-in non-anonymous caller', async () => {
  const handler = createQuestionSplitHandler({
    getCaller: async () => ({}),
    split: { splitPage: async () => ({ page: {}, questions: [], usage: {} }) },
  });

  await assert.rejects(
    () => handler({ confirmedFullPage: true, imageBase64: 'AAAA' }),
    (error) => error.code === 'UNAUTHENTICATED',
  );

  const anonymousHandler = createQuestionSplitHandler({
    getCaller: async () => ({ uid: 'u1', anonymous: true }),
    split: { splitPage: async () => ({ page: {}, questions: [], usage: {} }) },
  });
  await assert.rejects(
    () => anonymousHandler({ confirmedFullPage: true, imageBase64: 'AAAA' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('question split handler validates confirmation, base64, and size', async () => {
  const handler = createQuestionSplitHandler({
    getCaller: async () => ({ uid: 'u1' }),
    split: { splitPage: async () => ({ page: {}, questions: [], usage: {} }) },
  });

  await assert.rejects(
    () => handler({ imageBase64: 'AAAA' }),
    (error) => error.code === 'FULL_PAGE_CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    () => handler({ confirmedFullPage: true, imageBase64: 'not base64!' }),
    (error) => error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    () => handler({ confirmedFullPage: true, imageBase64: Buffer.alloc(7 * 1024 * 1024).toString('base64') }),
    (error) => error.code === 'INVALID_REQUEST',
  );
});

test('question split handler returns normalized questions and caller id', async () => {
  const handler = createQuestionSplitHandler({
    getCaller: async () => ({ uid: 'uid-9' }),
    split: {
      splitPage: async ({ photoId }) => {
        const mapped = mapSplitResponse(sampleResponse(), { photoId });
        return mapped;
      },
    },
  });

  const result = await handler({
    confirmedFullPage: true,
    imageBase64: Buffer.from([1, 2, 3]).toString('base64'),
    photoId: 'page-9',
  });

  assert.equal(result.callerId, 'uid-9');
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].subject, '数学');
  assert.deepEqual(result.questions[1].rect, { x: 0.1, y: 0.2, w: 0.8, h: 0.25 });
});
