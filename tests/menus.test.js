const test = require('node:test');
const assert = require('node:assert/strict');

const menus = require('../miniprogram/services/menus');

const storage = new Map();
global.wx = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => {
    storage.set(key, value);
  },
};

const questions = require('../miniprogram/services/questions');

test.beforeEach(() => {
  storage.clear();
});

test('menus expose the five designed entries in order', () => {
  assert.deepEqual(
    menus.MENUS.map((menu) => menu.id),
    ['organize', 'variants', 'challenge', 'mastered', 'all'],
  );
  assert.deepEqual(
    menus.LABELS.map((label) => label.id),
    ['check', 'star', 'triangle'],
  );
});

test('menu classification is exclusive for the first four menus', () => {
  const captured = { id: 'a', origin: 'capture', status: 'unmastered', labels: [] };
  const generated = { id: 'b', origin: 'generated', status: 'unmastered', labels: [] };
  const challenged = { id: 'c', origin: 'challenge', status: 'unmastered', labels: [] };
  const mastered = { id: 'd', origin: 'capture', status: 'mastered', labels: ['check'] };

  assert.equal(menus.menuOf(captured), 'organize');
  assert.equal(menus.menuOf(generated), 'variants');
  assert.equal(menus.menuOf(challenged), 'challenge');
  assert.equal(menus.menuOf(mastered), 'mastered', 'mastery wins over origin');

  const counts = menus.countMenus([captured, generated, challenged, mastered]);
  assert.deepEqual(counts, { organize: 1, variants: 1, challenge: 1, mastered: 1, all: 4 });
});

test('legacy questions migrate to the organize menu', () => {
  const legacy = { id: 'x', status: 'unmastered' };
  assert.equal(menus.originOf(legacy), 'capture');
  assert.equal(menus.menuOf(legacy), 'organize');

  const generatedLegacy = { id: 'y', source: 'generated' };
  assert.equal(menus.originOf(generatedLegacy), 'generated');
});

test('label filter keeps untagged questions and multi-tag questions with a grey label', () => {
  const list = [
    { id: 'none', labels: [] },
    { id: 'check', labels: ['check'] },
    { id: 'check-star', labels: ['check', 'star'] },
    { id: 'triangle', labels: ['triangle'] },
  ];

  const all = menus.filterByLabels(list, []);
  assert.equal(all.length, 4, 'no white chips keeps everything');

  const withoutCheck = menus.filterByLabels(list, ['check']);
  assert.deepEqual(withoutCheck.map((item) => item.id), ['none', 'check-star', 'triangle']);

  const withoutCheckStar = menus.filterByLabels(list, ['check', 'star']);
  assert.deepEqual(withoutCheckStar.map((item) => item.id), ['none', 'triangle']);

  const withoutAll = menus.filterByLabels(list, ['check', 'star', 'triangle']);
  assert.deepEqual(withoutAll.map((item) => item.id), ['none'], 'untagged questions survive full exclusion');
});

test('labels are normalised and unknown values dropped', () => {
  assert.deepEqual(menus.normalizeLabels(['check', 'check', 'bogus', 'star']), ['check', 'star']);
  assert.deepEqual(menus.normalizeLabels(undefined), []);
  assert.deepEqual(menus.labelsOf({ labels: ['triangle'] }), [
    { id: 'triangle', symbol: '△', label: '做题粗心' },
  ]);
});

test('stored questions keep labels, origin, and split metadata', () => {
  const created = questions.addQuestion({
    learnerId: 'L1',
    subject: 'math',
    stem: '1. 计算 12 + 8 = ?',
    labels: ['check', 'star'],
    origin: 'capture',
    subjectStatus: 'auto_accepted',
    referenceAnswer: '20',
    referenceParse: '先算个位再算十位',
    knowledgePoints: ['加法'],
    options: ['19', '20'],
    sourcePhotoId: 'photo-1',
    pageRect: { x: 0.1, y: 0.05, w: 0.8, h: 0.1 },
  });

  assert.deepEqual(created.labels, ['check', 'star']);
  assert.equal(created.schemaVersion, questions.SCHEMA_VERSION);
  assert.equal(created.subjectStatus, 'auto_accepted');
  assert.equal(created.referenceAnswer, '20');
  assert.deepEqual(created.knowledgePoints, ['加法']);
  assert.equal(created.sourcePhotoId, 'photo-1');
  assert.deepEqual(created.pageRect, { x: 0.1, y: 0.05, w: 0.8, h: 0.1 });

  const byMenu = questions.listByMenu({ learnerId: 'L1', subject: 'math', menu: 'organize' });
  assert.equal(byMenu.length, 1);

  const counts = questions.countByMenu({ learnerId: 'L1', subject: 'math' });
  assert.equal(counts.organize, 1);
  assert.equal(counts.all, 1);
});

test('legacy stored questions are migrated on read', () => {
  storage.set('daydayup.questions.v1', [
    {
      id: 'q-legacy',
      learnerId: 'L1',
      subject: 'math',
      stem: '旧题',
      status: 'unmastered',
      source: 'photo',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ]);

  const [migrated] = questions.listQuestions({ learnerId: 'L1' });
  assert.equal(migrated.schemaVersion, questions.SCHEMA_VERSION);
  assert.deepEqual(migrated.labels, []);
  assert.equal(migrated.origin, 'capture');
  assert.equal(migrated.subjectStatus, 'user_selected');
  assert.equal(migrated.referenceAnswer, '');
  assert.equal(migrated.pageRect, null);
  assert.equal(menus.menuOf(migrated), 'organize');
});
