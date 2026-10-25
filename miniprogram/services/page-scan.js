const marks = require('./marks');

const MAX_QUESTIONS_PER_PAGE = 12;
const MAX_BAND_OUTPUT_WIDTH = 720;
const MAX_BAND_OUTPUT_HEIGHT = 300;
const COARSE_GROUP_HEIGHT = 0.25;

const MARK_CYCLE = ['none', 'check', 'star', 'triangle'];

const SUBJECT_BY_TEXT = {
  数学: 'math',
  语文: 'chinese',
  英语: 'english',
};

function mapSubject(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) {
    return '';
  }
  for (const key of Object.keys(SUBJECT_BY_TEXT)) {
    if (text.indexOf(key) >= 0) {
      return SUBJECT_BY_TEXT[key];
    }
  }
  return 'other';
}

function dominantSubject(questions) {
  const counts = new Map();
  for (const question of Array.isArray(questions) ? questions : []) {
    const id = mapSubject(question && question.subject);
    if (!id) {
      continue;
    }
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  counts.forEach((count, id) => {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  });
  return best;
}

// 裁剪输出限制在 720x300 内：题号带放大 2.5 倍已够看清符号，再大只会更慢——单题视觉判断必须留在小程序 15 秒调用窗口内。
function clampBandOutput(band) {
  if (!band || !band.outputWidth || !band.outputHeight) {
    return band;
  }
  const ratio = Math.min(
    1,
    MAX_BAND_OUTPUT_WIDTH / band.outputWidth,
    MAX_BAND_OUTPUT_HEIGHT / band.outputHeight,
  );
  if (ratio >= 1) {
    return band;
  }
  return {
    ...band,
    outputWidth: Math.max(1, Math.round(band.outputWidth * ratio)),
    outputHeight: Math.max(1, Math.round(band.outputHeight * ratio)),
  };
}

// 切题服务按版面分组：题间距很小的一页可能整页被并成 1 道大题，此时只能覆盖第一条题号带。
function isCoarseGrouping(items) {
  if (!Array.isArray(items) || items.length !== 1) {
    return false;
  }
  const rect = items[0] && items[0].rect;
  return Boolean(rect && Number.isFinite(rect.h) && rect.h >= COARSE_GROUP_HEIGHT);
}

function buildCropPlan({ questions, imageSize, limit = MAX_QUESTIONS_PER_PAGE } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const width = Number(imageSize && imageSize.width);
  const height = Number(imageSize && imageSize.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      items: [],
      skipped: list.map((question, position) => ({
        index: Number.isInteger(question && question.index) ? question.index : position,
        questionNo: '',
        reason: 'IMAGE_SIZE_UNKNOWN',
      })),
      coarse: false,
    };
  }

  const page = { width, height };
  const numbers = marks.buildQuestionNoList(list.map((question) => ({ stem: question && question.stem })));
  const items = [];
  const skipped = [];

  list.forEach((question, position) => {
    const index = Number.isInteger(question && question.index) ? question.index : position;
    const questionNo = numbers[position];
    if (items.length >= limit) {
      skipped.push({ index, questionNo, reason: 'PAGE_QUESTION_LIMIT' });
      return;
    }
    const band = clampBandOutput(marks.computeQuestionBand(question && question.rect, page));
    if (!band) {
      skipped.push({ index, questionNo, reason: 'NO_RECT' });
      return;
    }
    items.push({
      index,
      questionNo,
      stem: String((question && question.stem) || ''),
      options: Array.isArray(question && question.options) ? question.options : [],
      subject: mapSubject(question && question.subject),
      knowledgePoints: Array.isArray(question && question.knowledgePoints) ? question.knowledgePoints : [],
      rect: question.rect,
      band,
    });
  });

  return { items, skipped, coarse: isCoarseGrouping(items) };
}

function rowFromMark(item, result) {
  const mark = marks.normalizeMark(result && result.mark);
  const known = mark !== 'none' && marks.MARK_LABELS[mark];
  return {
    index: item.index,
    questionNo: item.questionNo,
    stem: item.stem,
    options: item.options,
    subject: item.subject,
    pageRect: item.rect || null,
    confidence: Number.isFinite(result && result.confidence) ? result.confidence : 0,
    failed: Boolean(result && result.failed),
    mark,
    symbol: known ? marks.MARK_LABELS[mark].symbol : '',
    label: known ? marks.MARK_LABELS[mark].label : '未标记',
    selected: mark !== 'none',
  };
}

// 未标记题默认不归档（未标记＝孩子没标，不进入错题集），只把识别到标记的行勾选上。
function buildPreviewRows({ items, results } = {}) {
  const byIndex = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    if (result && Number.isInteger(result.index)) {
      byIndex.set(result.index, result);
    }
  }
  return (Array.isArray(items) ? items : []).map((item) => rowFromMark(item, byIndex.get(item.index)));
}

function nextMark(mark) {
  const current = marks.normalizeMark(mark);
  const position = MARK_CYCLE.indexOf(current);
  return MARK_CYCLE[(position + 1) % MARK_CYCLE.length];
}

function applyMark(row, mark) {
  const next = marks.normalizeMark(mark);
  const known = next !== 'none' && marks.MARK_LABELS[next];
  return {
    ...row,
    mark: next,
    symbol: known ? marks.MARK_LABELS[next].symbol : '',
    label: known ? marks.MARK_LABELS[next].label : '未标记',
    selected: next !== 'none',
  };
}

function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const marked = list.filter((row) => row && marks.normalizeMark(row.mark) !== 'none');
  const selected = marked.filter((row) => row.selected);
  return {
    total: list.length,
    marked: marked.length,
    selected: selected.length,
    failed: list.filter((row) => row && row.failed).length,
  };
}

function toQuestionPayloads({ rows, subjectId, photoId } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((row) => row && row.selected && marks.normalizeMark(row.mark) !== 'none' && String(row.stem || '').trim())
    .map((row) => ({
      subject: subjectId || row.subject || 'other',
      stem: String(row.stem).trim(),
      source: 'photo',
      ocrComplete: true,
      labels: [marks.normalizeMark(row.mark)],
      origin: 'capture',
      sourcePhotoId: photoId || '',
      pageRect: row.pageRect || null,
    }));
}

module.exports = {
  MAX_QUESTIONS_PER_PAGE,
  MAX_BAND_OUTPUT_WIDTH,
  MAX_BAND_OUTPUT_HEIGHT,
  COARSE_GROUP_HEIGHT,
  MARK_CYCLE,
  mapSubject,
  dominantSubject,
  clampBandOutput,
  isCoarseGrouping,
  buildCropPlan,
  buildPreviewRows,
  nextMark,
  applyMark,
  summarizeRows,
  toQuestionPayloads,
};
