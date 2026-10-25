const test = require('node:test');
const assert = require('node:assert/strict');

const marks = require('../miniprogram/services/marks');

const page = { width: 768, height: 1024 };

test('question band covers the number line at the top of a question', () => {
  const band = marks.computeQuestionBand({ x: 0.047, y: 0.206, w: 0.443, h: 0.189 }, page);
  assert.deepEqual(band, {
    left: 28,
    top: 205,
    width: 356,
    height: 170,
    scale: 2.5,
    outputWidth: 890,
    outputHeight: 425,
  });
});

test('question band keeps a minimum height and clamps to the page edge', () => {
  const tiny = marks.computeQuestionBand({ x: 0, y: 0, w: 0.2, h: 0.01 }, page);
  assert.equal(tiny.left, 0);
  assert.equal(tiny.top, 0);
  assert.ok(tiny.height >= marks.BAND_MIN_HEIGHT);

  assert.equal(marks.computeQuestionBand({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { width: 0, height: 0 }), null);
  assert.equal(marks.computeQuestionBand(null, page), null);
});

test('marks normalise symbols and unknown values become none', () => {
  assert.equal(marks.normalizeMark('★'), 'star');
  assert.equal(marks.normalizeMark('○'), 'triangle');
  assert.equal(marks.normalizeMark('√'), 'check');
  assert.equal(marks.normalizeMark('blur'), 'none');
});

test('merging keeps the highest confidence per question and drops none', () => {
  const merged = marks.mergeQuestionMarks([
    { questionNo: '2', mark: 'check', confidence: 0.4 },
    { questionNo: '2', mark: 'star', confidence: 0.9 },
    { questionNo: '4', mark: 'none', confidence: 0.95 },
    { questionNo: '附加题2', mark: 'star', confidence: 0.8 },
  ]);

  assert.deepEqual(merged.map((item) => `${item.questionNo}:${item.mark}`), ['2:star', '附加题2:star']);
  assert.equal(merged[0].symbol, '☆');
  assert.equal(merged[0].label, '完全不会');
});

test('question numbers come from the stems and fall back to the index', () => {
  const list = marks.buildQuestionNoList([
    { stem: '1.王大伯把一块长60米' },
    { stem: '2.新素养几何直观' },
    { stem: '' },
    { stem: '附加题。(共10分)' },
  ]);
  assert.deepEqual(list, ['1', '2', '3', '附加题']);
});
