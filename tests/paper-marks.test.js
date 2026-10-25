const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPaperMarksHandler,
  parseMarkResponse,
  normalizeMarks,
  SYSTEM_PROMPT,
} = require('../cloudfunctions/paper-marks/handler');
const {
  createHunyuanVision,
  extractText,
  toDataUrl,
} = require('../cloudfunctions/paper-marks/hunyuan-vision');
const {
  createTokenHubVision,
  buildRequestBody,
  extractContent,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} = require('../cloudfunctions/paper-marks/tokenhub-vision');

test('mark prompt states the three symbols and forbids body-shape false positives', () => {
  assert.match(SYSTEM_PROMPT, /check/);
  assert.match(SYSTEM_PROMPT, /star/);
  assert.match(SYSTEM_PROMPT, /triangle/);
  assert.match(SYSTEM_PROMPT, /题号/);
  assert.match(SYSTEM_PROMPT, /根号/);
});

test('mark response parses plain JSON and merges duplicate question numbers', () => {
  const parsed = parseMarkResponse(JSON.stringify({
    questions: [
      { questionNo: '1', marks: ['check'], confidence: 0.9 },
      { questionNo: '1', marks: ['star'], confidence: 0.7 },
      { questionNo: ' 2 ', marks: ['triangle'], confidence: 2 },
      { questionNo: '3', marks: [], confidence: 0.8 },
    ],
  }));

  assert.equal(parsed.questions.length, 2);
  assert.deepEqual(parsed.questions[0], { questionNo: '1', marks: ['check', 'star'], confidence: 0.9 });
  assert.deepEqual(parsed.questions[1], { questionNo: '2', marks: ['triangle'], confidence: 1 });
});

test('mark response tolerates code fences and surrounding prose', () => {
  const fenced = parseMarkResponse('分析如下：\n```json\n{"questions":[{"questionNo":"4","marks":["check"],"confidence":0.8}]}\n```\n完毕');
  assert.deepEqual(fenced.questions, [{ questionNo: '4', marks: ['check'], confidence: 0.8 }]);

  const prose = parseMarkResponse('结果 {"questions":[]} 结束');
  assert.deepEqual(prose.questions, []);
});

test('mark response discards original-paper correctness fields', () => {
  const parsed = parseMarkResponse(JSON.stringify({
    questions: [
      { questionNo: '5', marks: ['check'], confidence: 0.9, isCorrect: false, score: 0, verdict: 'wrong' },
      { questionNo: '6', marks: ['star'], confidence: 0.6 },
    ],
  }));

  assert.equal(parsed.discardedFields, 1);
  assert.equal(parsed.questions.length, 2);
  for (const question of parsed.questions) {
    assert.deepEqual(Object.keys(question).sort(), ['confidence', 'marks', 'questionNo']);
  }
});

test('mark response rejects non-JSON output', () => {
  assert.throws(
    () => parseMarkResponse('第3题有勾'),
    (error) => error.code === 'MARK_RESPONSE_INVALID',
  );
});

test('marks are normalised from symbols and unknown values dropped', () => {
  assert.deepEqual(normalizeMarks(['√', '★', '△', 'circle', 'check']), ['check', 'star', 'triangle']);
  assert.deepEqual(normalizeMarks('check'), []);
});

test('handler requires authentication, page confirmation, and valid image bytes', async () => {
  const build = (caller) => createPaperMarksHandler({
    getCaller: async () => caller,
    vision: { detectMarks: async () => ({ text: '{"questions":[]}', provider: 'mock', model: 'mock' }) },
  });

  await assert.rejects(
    () => build({})({ confirmedFullPage: true, imageBase64: 'AAAA' }),
    (error) => error.code === 'UNAUTHENTICATED',
  );
  await assert.rejects(
    () => build({ uid: 'u1', anonymous: true })({ confirmedFullPage: true, imageBase64: 'AAAA' }),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    () => build({ uid: 'u1' })({ imageBase64: 'AAAA' }),
    (error) => error.code === 'FULL_PAGE_CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    () => build({ uid: 'u1' })({ confirmedFullPage: true, imageBase64: 'not base64!' }),
    (error) => error.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    () => build({ uid: 'u1' })({
      confirmedFullPage: true,
      imageBase64: Buffer.alloc(7 * 1024 * 1024).toString('base64'),
    }),
    (error) => error.code === 'INVALID_REQUEST',
  );
});

test('handler returns marks, provider metadata, and caller id', async () => {
  const handler = createPaperMarksHandler({
    getCaller: async () => ({ uid: 'uid-7' }),
    vision: {
      detectMarks: async ({ mimeType }) => ({
        text: '{"questions":[{"questionNo":"2","marks":["star"],"confidence":0.88,"isCorrect":true}]}',
        provider: 'hunyuan',
        model: 'hunyuan-vision',
        usage: { TotalTokens: 2100 },
        mimeType,
      }),
    },
  });

  const result = await handler({
    confirmedFullPage: true,
    imageBase64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    mimeType: 'image/png',
  });

  assert.equal(result.callerId, 'uid-7');
  assert.equal(result.provider, 'hunyuan');
  assert.equal(result.discardedFields, 1);
  assert.deepEqual(result.questions, [{ questionNo: '2', marks: ['star'], confidence: 0.88 }]);
  assert.deepEqual(result.usage, { TotalTokens: 2100 });
});

test('hunyuan adapter sends text plus inline image and reads the message content', async () => {
  const calls = [];
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const client = {
    async ChatCompletions(request) {
      calls.push(request);
      return {
        Choices: [{ Message: { Role: 'assistant', Content: '{"questions":[]}' } }],
        Usage: { PromptTokens: 1500, CompletionTokens: 20, TotalTokens: 1520 },
      };
    },
  };

  const vision = createHunyuanVision({ client, model: 'hunyuan-vision' });
  const result = await vision.detectMarks({ imageBytes, mimeType: 'image/jpeg' });

  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.Model, 'hunyuan-vision');
  assert.equal(request.Stream, false);
  assert.equal(request.Messages[0].Role, 'user');
  assert.equal(request.Messages[0].Contents[0].Type, 'text');
  assert.equal(request.Messages[0].Contents[0].Text, SYSTEM_PROMPT);
  assert.equal(request.Messages[0].Contents[1].Type, 'image_url');
  assert.equal(
    request.Messages[0].Contents[1].ImageUrl.Url,
    `data:image/jpeg;base64,${imageBytes.toString('base64')}`,
  );
  assert.equal(result.text, '{"questions":[]}');
  assert.equal(result.provider, 'hunyuan');
  assert.deepEqual(result.usage, { PromptTokens: 1500, CompletionTokens: 20, TotalTokens: 1520 });
});

test('hunyuan adapter rejects empty or oversized images and odd payloads', async () => {
  const vision = createHunyuanVision({
    client: { ChatCompletions: async () => ({ Choices: [] }) },
    model: 'hunyuan-vision',
  });

  await assert.rejects(() => vision.detectMarks({ imageBytes: Buffer.alloc(0) }), RangeError);
  await assert.rejects(() => vision.detectMarks({ imageBytes: 'nope' }), TypeError);
  assert.equal(extractText({ Choices: [] }), '');
  assert.equal(
    extractText({ Choices: [{ Message: { Contents: [{ Type: 'text', Text: 'a' }, { Type: 'text', Text: 'b' }] } }] }),
    'ab',
  );
  assert.match(toDataUrl(Buffer.from([1, 2, 3]), 'image/png'), /^data:image\/png;base64,/);
});

test('tokenhub body uses OpenAI-compatible chat completions with an inline image', () => {
  const body = buildRequestBody({
    model: 'hy-vision-2.0-instruct',
    imageBytes: Buffer.from([0xff, 0xd8]),
    mimeType: 'image/jpeg',
  });

  assert.equal(body.model, 'hy-vision-2.0-instruct');
  assert.equal(body.stream, false);
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.equal(body.messages[0].content[0].text, SYSTEM_PROMPT);
  assert.equal(body.messages[0].content[1].type, 'image_url');
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('tokenhub adapter sends the bearer key and reads choices content', async () => {
  const calls = [];
  const vision = createTokenHubVision({
    apiKey: 'sk-test',
    request: async (options) => {
      calls.push(options);
      return {
        choices: [{ message: { role: 'assistant', content: '{"questions":[{"questionNo":"3","marks":["check"],"confidence":0.8}]}' } }],
        usage: { prompt_tokens: 1400, completion_tokens: 30, total_tokens: 1430 },
      };
    },
  });

  const result = await vision.detectMarks({
    imageBytes: Buffer.from([1, 2, 3]),
    mimeType: 'image/png',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_BASE_URL);
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.model, DEFAULT_MODEL);
  assert.equal(result.provider, 'tokenhub');
  assert.equal(result.model, DEFAULT_MODEL);
  assert.deepEqual(result.usage, { prompt_tokens: 1400, completion_tokens: 30, total_tokens: 1430 });

  const parsed = parseMarkResponse(result.text);
  assert.deepEqual(parsed.questions, [{ questionNo: '3', marks: ['check'], confidence: 0.8 }]);
});

test('tokenhub adapter allows a per-request model override for comparisons', async () => {
  const calls = [];
  const vision = createTokenHubVision({
    apiKey: 'sk-test',
    request: async (options) => {
      calls.push(options);
      return { choices: [{ message: { content: '{"questions":[]}' } }] };
    },
  });

  await vision.detectMarks({
    imageBytes: Buffer.from([9]),
    model: 'deepseek/deepseek-flash',
  });

  assert.equal(calls[0].body.model, 'deepseek/deepseek-flash');
});

test('tokenhub adapter refuses to start without an API key', () => {
  assert.throws(
    () => createTokenHubVision({ apiKey: '' }),
    (error) => error.code === 'VISION_PROVIDER_NOT_CONFIGURED',
  );
});

test('tokenhub adapter rejects oversized images and odd payloads', async () => {
  const vision = createTokenHubVision({
    apiKey: 'sk-test',
    request: async () => ({ choices: [] }),
  });

  await assert.rejects(() => vision.detectMarks({ imageBytes: Buffer.alloc(0) }), RangeError);
  await assert.rejects(() => vision.detectMarks({ imageBytes: 'nope' }), TypeError);
  assert.equal(extractContent({ choices: [] }), '');
  assert.equal(extractContent({ choices: [{ message: { content: [{ type: 'text', text: 'x' }] } }] }), 'x');
});
