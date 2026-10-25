const test = require('node:test');
const assert = require('node:assert/strict');

const pageScan = require('../miniprogram/services/page-scan');

const imageSize = { width: 1600, height: 2133 };

function question(index, stem, rect, subject = '数学') {
  return { index, stem, rect, subject, options: [], knowledgePoints: [] };
}

test('subjects map from OCR labels and fall back to other', () => {
  assert.equal(pageScan.mapSubject('小学数学'), 'math');
  assert.equal(pageScan.mapSubject('语文'), 'chinese');
  assert.equal(pageScan.mapSubject('英语'), 'english');
  assert.equal(pageScan.mapSubject('物理'), 'other');
  assert.equal(pageScan.mapSubject(''), '');
  assert.equal(pageScan.mapSubject(undefined), '');
});

test('dominant subject wins by count and ignores unknown labels', () => {
  const questions = [
    question(0, '1.加法', null, '数学'),
    question(1, '2.减法', null, '数学'),
    question(2, '3.阅读', null, '语文'),
    question(3, '4.未知', null, ''),
  ];
  assert.equal(pageScan.dominantSubject(questions), 'math');
  assert.equal(pageScan.dominantSubject([{ subject: '' }]), '');
  assert.equal(pageScan.dominantSubject([]), '');
});

test('band output is clamped so one band cannot blow up the image tokens', () => {
  const wide = { left: 0, top: 0, width: 1200, height: 400, scale: 2.5, outputWidth: 3000, outputHeight: 1000 };
  const clamped = pageScan.clampBandOutput(wide);
  assert.equal(clamped.outputWidth, pageScan.MAX_BAND_OUTPUT_WIDTH);
  assert.equal(clamped.outputHeight, 200);
  assert.equal(clamped.left, 0);

  const small = { left: 5, top: 5, width: 100, height: 40, scale: 2.5, outputWidth: 250, outputHeight: 100 };
  assert.deepEqual(pageScan.clampBandOutput(small), small);
  assert.equal(pageScan.clampBandOutput(null), null);
});

test('crop plan derives question numbers from stems and keeps the band rect', () => {
  const plan = pageScan.buildCropPlan({
    questions: [
      question(0, '1.王大伯把一块长60米', { x: 0.05, y: 0.1, w: 0.5, h: 0.08 }),
      question(1, '附加题。共10分', { x: 0.05, y: 0.6, w: 0.9, h: 0.1 }),
    ],
    imageSize,
  });

  assert.equal(plan.items.length, 2);
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(plan.items.map((item) => item.questionNo), ['1', '附加题']);

  const band = plan.items[0].band;
  assert.equal(band.left, 72);
  assert.equal(band.top, 207);
  assert.equal(band.width, 448);
  assert.equal(band.height, 140);
  assert.ok(band.outputWidth <= pageScan.MAX_BAND_OUTPUT_WIDTH);
  assert.ok(band.outputHeight <= pageScan.MAX_BAND_OUTPUT_HEIGHT);

  assert.deepEqual(plan.items[0].rect, { x: 0.05, y: 0.1, w: 0.5, h: 0.08 });
  assert.equal(plan.items[0].subject, 'math');
});

test('crop plan skips questions without coordinates and stops at the page limit', () => {
  const plan = pageScan.buildCropPlan({
    questions: [
      question(0, '1.有坐标', { x: 0.05, y: 0.1, w: 0.5, h: 0.08 }),
      question(1, '2.没有坐标', null),
    ],
    imageSize,
  });
  assert.deepEqual(plan.items.map((item) => item.questionNo), ['1']);
  assert.deepEqual(plan.skipped, [{ index: 1, questionNo: '2', reason: 'NO_RECT' }]);

  const many = Array.from({ length: 15 }, (_, position) =>
    question(position, `${position + 1}.题目`, { x: 0.05, y: 0.02 * position, w: 0.5, h: 0.04 }),
  );
  const limited = pageScan.buildCropPlan({ questions: many, imageSize, limit: 3 });
  assert.equal(limited.items.length, 3);
  assert.equal(limited.skipped.length, 12);
  assert.equal(limited.skipped[0].reason, 'PAGE_QUESTION_LIMIT');
});

test('crop plan refuses to guess when the image size is unknown', () => {
  const plan = pageScan.buildCropPlan({
    questions: [question(0, '1.题目', { x: 0.1, y: 0.1, w: 0.5, h: 0.1 })],
    imageSize: { width: 0, height: 0 },
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped[0].reason, 'IMAGE_SIZE_UNKNOWN');
});

test('a single tall group is flagged as coarse so the UI can warn about missed marks', () => {
  const tall = pageScan.buildCropPlan({
    questions: [question(0, '1.整页被并成一道大题', { x: 0.07, y: 0.09, w: 0.32, h: 0.73 })],
    imageSize,
  });
  assert.equal(tall.items.length, 1);
  assert.equal(tall.coarse, true);

  const normal = pageScan.buildCropPlan({
    questions: [question(0, '1.普通题', { x: 0.05, y: 0.1, w: 0.5, h: 0.08 })],
    imageSize,
  });
  assert.equal(normal.coarse, false);

  const many = pageScan.buildCropPlan({
    questions: [
      question(0, '1.甲', { x: 0.05, y: 0.1, w: 0.5, h: 0.08 }),
      question(1, '2.乙', { x: 0.05, y: 0.3, w: 0.5, h: 0.08 }),
    ],
    imageSize,
  });
  assert.equal(many.coarse, false);
  assert.equal(pageScan.isCoarseGrouping([]), false);
});

test('preview rows mark detected questions as selected and unmarked ones not', () => {
  const items = [
    { index: 0, questionNo: '1', stem: '1.甲', options: [], subject: 'math', rect: { x: 0.1 } },
    { index: 1, questionNo: '2', stem: '2.乙', options: [], subject: 'math', rect: { x: 0.2 } },
    { index: 2, questionNo: '3', stem: '3.丙', options: [], subject: 'math', rect: { x: 0.3 } },
  ];
  const rows = pageScan.buildPreviewRows({
    items,
    results: [
      { index: 0, mark: 'star', confidence: 0.9 },
      { index: 1, mark: 'none', confidence: 0.93 },
      { index: 2, mark: 'triangle', confidence: 0.6, failed: true },
    ],
  });

  assert.deepEqual(rows.map((row) => `${row.questionNo}:${row.mark}:${row.selected}`), [
    '1:star:true',
    '2:none:false',
    '3:triangle:true',
  ]);
  assert.equal(rows[0].symbol, '☆');
  assert.equal(rows[0].label, '完全不会');
  assert.equal(rows[1].symbol, '');
  assert.equal(rows[1].label, '未标记');
  assert.equal(rows[2].failed, true);
  assert.deepEqual(rows[0].pageRect, { x: 0.1 });

  const missing = pageScan.buildPreviewRows({ items, results: [] });
  assert.ok(missing.every((row) => row.mark === 'none' && row.selected === false));
});

test('mark cycling goes none to check to star to triangle and back', () => {
  assert.equal(pageScan.nextMark('none'), 'check');
  assert.equal(pageScan.nextMark('check'), 'star');
  assert.equal(pageScan.nextMark('star'), 'triangle');
  assert.equal(pageScan.nextMark('triangle'), 'none');
  assert.equal(pageScan.nextMark(undefined), 'check');
  assert.equal(pageScan.nextMark('圆圈'), 'check');
});

test('applying a mark refreshes symbol, label and selection', () => {
  const base = { index: 0, questionNo: '1', stem: '1.甲', mark: 'none', selected: false };
  const starred = pageScan.applyMark(base, 'star');
  assert.equal(starred.mark, 'star');
  assert.equal(starred.symbol, '☆');
  assert.equal(starred.selected, true);

  const cleared = pageScan.applyMark(starred, 'none');
  assert.equal(cleared.mark, 'none');
  assert.equal(cleared.symbol, '');
  assert.equal(cleared.selected, false);
});

test('summaries count marked, selected and failed rows', () => {
  const summary = pageScan.summarizeRows([
    { mark: 'star', selected: true },
    { mark: 'none', selected: false },
    { mark: 'triangle', selected: true, failed: true },
    { mark: 'check', selected: false },
  ]);
  assert.deepEqual(summary, { total: 4, marked: 3, selected: 2, failed: 1 });
  assert.deepEqual(pageScan.summarizeRows(undefined), { total: 0, marked: 0, selected: 0, failed: 0 });
});

test('question payloads keep only selected marked rows with a stem', () => {
  const payloads = pageScan.toQuestionPayloads({
    subjectId: 'math',
    photoId: 'page-1',
    rows: [
      { selected: true, mark: 'star', stem: '2.新素养', pageRect: { x: 0.2 }, subject: 'chinese' },
      { selected: false, mark: 'star', stem: '3.未勾选', pageRect: null },
      { selected: true, mark: 'none', stem: '4.无标记', pageRect: null },
      { selected: true, mark: 'check', stem: '   ', pageRect: null },
      { selected: true, mark: 'triangle', stem: '5.粗心', pageRect: { x: 0.5 } },
    ],
  });

  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], {
    subject: 'math',
    stem: '2.新素养',
    source: 'photo',
    ocrComplete: true,
    labels: ['star'],
    origin: 'capture',
    sourcePhotoId: 'page-1',
    pageRect: { x: 0.2 },
  });
  assert.deepEqual(payloads[1].labels, ['triangle']);
  assert.equal(payloads[1].pageRect.x, 0.5);
});
