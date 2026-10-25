const SINGLE_MARK_PROMPT = [
  '这张图是从作业某一页裁出来的「题号附近」小区域，已放大。',
  '请判断：该区域的题号上是否叠加了手写符号？是什么符号？',
  '三种类型：',
  '- check：两笔直线组成的「√ / ✓」。',
  '- star：五角星，可能是多角星、多线圈叠成的星、★ 或 ☆。',
  '- triangle：三角形 △，或一个圆圈 ○ / 椭圆圈。',
  '判定要点：',
  '1. 只看压在题号上或紧贴题号的手写符号；印刷体文字、印刷图形、根号、序号下划线都不算。',
  '2. 五角星与勾必须区分：有多个尖角或多圈叠成的星形判 star，不要判 check。',
  '3. 圆圈与三角同属 triangle 类。只要题号附近出现任意闭合的圆圈或椭圆圈（哪怕画得歪、有缺口、和数字笔画粘连），一律判 triangle。',
  '4. 只要出现由三条边围成的尖角形状（△），哪怕它压在数字上方、和数字笔画交叠，也判 triangle。',
  '5. 手写符号常常只有一半压在题号上，另一半落在空白处；请查看整个区域，不要只看题号正中央。',
  '6. 确认区域内确实没有任何手写痕迹时，才输出 mark 为 "none"。',
  '只输出 JSON，不要解释，不要代码块。',
  '输出格式：{"mark":"star","confidence":0.9}',
  'mark 只能是 check、star、triangle、none 之一。',
].join('\n');

const MARKS = ['check', 'star', 'triangle'];

const SYSTEM_PROMPT = [
  '你是小学作业版面分析助手。任务：找出「题号上或紧贴题号位置」的手写标记，并正确区分三种符号。',
  '标记来源不限：无论是孩子还是家长或老师画的，只要题号位置有手写符号就要识别出来。',
  '三种类型，务必区分清楚：',
  '- check（勾）：两笔直线组成的「√ / ✓」。',
  '- star（五角星）：星形，可能被画成多个尖角、多个圈线叠成的星、★ 或 ☆。看到「像五角星/多角星/花瓣状」的符号一律判 star，不要判成 check。',
  '- triangle（三角/圆圈）：三角形 △、手绘三角，或一个圆圈 ○ / 椭圆圈。圆圈与三角同属这一类。',
  '判定范围规则：',
  '1. 符号压在题号上、或紧贴题号（如「2.」「(3)」「三、」的前后紧邻位置）。',
  '2. 正文里的根号 √2、印刷几何图形、印刷五角星装饰不算手写标记；但手绘的圈、星、三角算。',
  '3. 同一题号上有多个不同符号时全部列出（例如同时有勾和星）。',
  '4. 大题下某个小问被标记，仍归属到该大题号。',
  '5. 附加题、带文字的题号（如「附加题2」）按原样作为 questionNo 输出。',
  '6. 严格只报你真正看到符号的题号。没有符号的题号绝对不要输出；宁可漏报也不要编造。',
  '7. confidence 反映你对该符号类型判断的把握。',
  '只输出 JSON，不要解释，不要 Markdown 代码块。',
  '输出格式：{"questions":[{"questionNo":"2","marks":["star"],"confidence":0.9}]}',
  'marks 只能是 check、star、triangle 三者之一，可多选。',
  '没有找到任何标记时输出：{"questions":[]}',
].join('\n');

const FORBIDDEN_FIELDS = ['isCorrect', 'iscorrect', 'verdict', 'score', 'studentAnswer', 'student_answer', 'correct'];

function normalizeMarks(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => String(item || '').trim().toLowerCase())
    .map((item) => (item === 'star' || item === '★' || item === '☆' ? 'star' : item))
    .map((item) => (item === 'triangle' || item === '△' || item === '三角' ? 'triangle' : item))
    .map((item) => (item === 'check' || item === '√' || item === '✓' ? 'check' : item))
    .filter((item) => MARKS.includes(item));
  return Array.from(new Set(normalized));
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, number));
}

function normalizeQuestionNo(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, '').slice(0, 12);
}

function stripCodeFence(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function hasForbiddenField(entry) {
  return Object.keys(entry || {}).some((key) => FORBIDDEN_FIELDS.includes(key));
}

// 视觉模型只负责“哪几题、哪类标记”；任何原卷对错结论在这里被丢弃（R10/A32）。
function parseMarkResponse(text) {
  const payload = stripCodeFence(text);
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    const error = new Error('视觉模型没有返回可解析的 JSON。');
    error.code = 'MARK_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }

  const rawQuestions = Array.isArray(parsed && parsed.questions) ? parsed.questions : [];
  const seen = new Map();
  let discardedFields = 0;

  for (const entry of rawQuestions) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (hasForbiddenField(entry)) {
      discardedFields += 1;
    }
    const questionNo = normalizeQuestionNo(entry.questionNo);
    const marks = normalizeMarks(entry.marks);
    if (!questionNo || marks.length === 0) {
      continue;
    }
    const previous = seen.get(questionNo);
    if (previous) {
      previous.marks = Array.from(new Set([...previous.marks, ...marks]));
      previous.confidence = Math.max(previous.confidence, normalizeConfidence(entry.confidence));
    } else {
      seen.set(questionNo, {
        questionNo,
        marks,
        confidence: normalizeConfidence(entry.confidence),
      });
    }
  }

  return {
    questions: Array.from(seen.values()),
    discardedFields,
  };
}

function decodeBase64Image(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    return null;
  }
  return bytes;
}

function parseSingleMarkResponse(text) {
  const payload = stripCodeFence(text);
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    const error = new Error('视觉模型没有返回可解析的 JSON。');
    error.code = 'MARK_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  const raw = String((parsed && parsed.mark) || '').trim().toLowerCase();
  const normalized = normalizeMarks([raw]);
  const mark = raw === 'none' || raw === '' ? 'none' : normalized[0] || 'none';
  return {
    mark,
    confidence: normalizeConfidence(parsed && parsed.confidence),
    discardedFields: Object.keys(parsed || {}).some((key) => FORBIDDEN_FIELDS.includes(key)) ? 1 : 0,
  };
}

function createPaperMarksHandler({ getCaller, vision, maxBytes = 6 * 1024 * 1024 }) {
  if (typeof getCaller !== 'function' || !vision || typeof vision.detectMarks !== 'function') {
    throw new TypeError('Caller resolver and vision adapter are required.');
  }

  return async function detectPaperMarks(event) {
    const caller = (await getCaller()) || {};
    const identifier = caller.uid || caller.openid || null;
    if (!identifier) {
      const error = new Error('Authentication is required.');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    if (caller.anonymous === true) {
      const error = new Error('Anonymous sessions cannot run billable vision models.');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (!event || event.confirmedFullPage !== true) {
      const error = new Error('Confirm the image is one full page of homework.');
      error.code = 'FULL_PAGE_CONFIRMATION_REQUIRED';
      throw error;
    }

    const imageBytes = decodeBase64Image(event.imageBase64);
    if (!imageBytes) {
      const error = new Error('imageBase64 must contain valid base64 image data.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    if (imageBytes.length > maxBytes) {
      const error = new Error(`The page image must be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      error.code = 'INVALID_REQUEST';
      throw error;
    }

    const result = await vision.detectMarks({
      imageBytes,
      mimeType: typeof event.mimeType === 'string' && event.mimeType ? event.mimeType : 'image/jpeg',
      mode: event.mode === 'single' ? 'single' : 'page',
      promptText: event.mode === 'single' ? SINGLE_MARK_PROMPT : SYSTEM_PROMPT,
    });

    if (event.mode === 'single') {
      const single = parseSingleMarkResponse(result && result.text);
      return {
        mode: 'single',
        questionNo: typeof event.questionNo === 'string' ? event.questionNo : '',
        mark: single.mark,
        marks: single.mark === 'none' ? [] : [single.mark],
        confidence: single.confidence,
        discardedFields: single.discardedFields,
        provider: result.provider,
        model: result.model,
        usage: result.usage || null,
        callerId: identifier,
      };
    }

    const parsed = parseMarkResponse(result && result.text);

    return {
      questions: parsed.questions,
      discardedFields: parsed.discardedFields,
      provider: result.provider,
      model: result.model,
      usage: result.usage || null,
      callerId: identifier,
    };
  };
}

module.exports = {
  createPaperMarksHandler,
  parseMarkResponse,
  normalizeMarks,
  SYSTEM_PROMPT,
  MARKS,
};
