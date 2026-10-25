const MARK_LABELS = {
  check: { symbol: '√', label: '题型不熟悉' },
  star: { symbol: '☆', label: '完全不会' },
  triangle: { symbol: '△', label: '做题粗心' },
};

const BAND_MIN_HEIGHT = 90;
const BAND_MAX_HEIGHT = 170;
const BAND_UPSCALE = 2.5;
const BAND_PADDING_X = 8;
const BAND_PADDING_Y = 6;

// 题号通常位于题目区域左上角，只裁「题号带」再放大，模型才能分辨勾/星/圈。
function computeQuestionBand(rect, page) {
  if (!rect || !page) {
    return null;
  }
  const pageWidth = Number(page.width);
  const pageHeight = Number(page.height);
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) {
    return null;
  }

  const left = Math.max(0, Math.round(x * pageWidth) - BAND_PADDING_X);
  const top = Math.max(0, Math.round(y * pageHeight) - BAND_PADDING_Y);
  const right = Math.min(pageWidth, Math.round((x + w) * pageWidth) + BAND_PADDING_X);
  const vertical = Math.round(h * pageHeight);
  const height = Math.min(pageHeight - top, Math.max(BAND_MIN_HEIGHT, Math.min(vertical, BAND_MAX_HEIGHT)));
  const width = right - left;
  if (width < 20 || height < 20) {
    return null;
  }
  return {
    left,
    top,
    width,
    height,
    scale: BAND_UPSCALE,
    outputWidth: Math.round(width * BAND_UPSCALE),
    outputHeight: Math.round(height * BAND_UPSCALE),
  };
}

function normalizeMark(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (raw === 'star' || raw === '★' || raw === '☆') {
    return 'star';
  }
  if (raw === 'triangle' || raw === '△' || raw === '○' || raw === 'circle') {
    return 'triangle';
  }
  if (raw === 'check' || raw === '√' || raw === '✓') {
    return 'check';
  }
  return 'none';
}

function mergeQuestionMarks(entries) {
  const byQuestion = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.questionNo) {
      continue;
    }
    const mark = normalizeMark(entry.mark);
    if (mark === 'none') {
      continue;
    }
    const confidence = Number.isFinite(entry.confidence) ? entry.confidence : 0.5;
    const previous = byQuestion.get(entry.questionNo);
    if (!previous || confidence > previous.confidence) {
      byQuestion.set(entry.questionNo, {
        questionNo: entry.questionNo,
        mark,
        confidence,
        symbol: MARK_LABELS[mark].symbol,
        label: MARK_LABELS[mark].label,
      });
    }
  }
  return Array.from(byQuestion.values());
}

function buildQuestionNoList(questions) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const stem = String(question && question.stem ? question.stem : '').trim();
    const match = stem.match(/^(附加题)?\s*(\d{1,3})/);
    if (match) {
      return match[1] ? `附加题${match[2]}` : match[2];
    }
    if (/^附加题/.test(stem)) {
      return '附加题';
    }
    return String(index + 1);
  });
}

module.exports = {
  MARK_LABELS,
  BAND_MIN_HEIGHT,
  BAND_MAX_HEIGHT,
  BAND_UPSCALE,
  computeQuestionBand,
  normalizeMark,
  mergeQuestionMarks,
  buildQuestionNoList,
};
