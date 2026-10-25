const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => {
    storage.set(key, value);
  },
};

const { QUESTION_BANK, listBySubject } = require('../miniprogram/data/question-bank');
const contestService = require('../miniprogram/services/contest');

test.beforeEach(() => {
  storage.clear();
});

test('question bank ships 30 questions for each of the three subjects', () => {
  assert.equal(listBySubject('math').length, 30);
  assert.equal(listBySubject('chinese').length, 30);
  assert.equal(listBySubject('english').length, 30);
  assert.equal(QUESTION_BANK.length, 90);
});

test('question bank entries are well formed and uniquely identified', () => {
  const ids = new Set();
  for (const question of QUESTION_BANK) {
    assert.ok(question.id && !ids.has(question.id), `duplicate or missing id: ${question.id}`);
    ids.add(question.id);
    assert.ok(['choice', 'fill', 'judge'].includes(question.type), `bad type: ${question.id}`);
    assert.ok([3, 4].includes(question.grade), `bad grade: ${question.id}`);
    assert.ok(typeof question.stem === 'string' && question.stem.length > 0, `missing stem: ${question.id}`);
    assert.ok(typeof question.answer === 'string' && question.answer.length > 0, `missing answer: ${question.id}`);
    if (question.type !== 'fill') {
      assert.ok(Array.isArray(question.options) && question.options.length >= 2, `missing options: ${question.id}`);
      assert.ok(question.options.includes(question.answer), `answer not among options: ${question.id}`);
    }
  }
});

test('answer normalisation ignores spacing, case, and punctuation', () => {
  assert.equal(contestService.normalizeAnswer('  15 时。 '), '15时');
  assert.equal(contestService.normalizeAnswer('E'), 'e');
  assert.equal(contestService.normalizeAnswer('You’re welcome'), 'you’rewelcome');
});

test('grading accepts listed alternatives and rejects wrong or empty answers', () => {
  const question = {
    answer: '180°',
    accept: ['180', '180度'],
  };
  assert.equal(contestService.isAnswerCorrect(question, '180°'), true);
  assert.equal(contestService.isAnswerCorrect(question, '180'), true);
  assert.equal(contestService.isAnswerCorrect(question, ' 180 度 '), true);
  assert.equal(contestService.isAnswerCorrect(question, '360'), false);
  assert.equal(contestService.isAnswerCorrect(question, ''), false);
  assert.equal(contestService.isAnswerCorrect(question, undefined), false);
});

test('subject contests draw only from their own subject and respect the batch size', () => {
  contestService.saveSettings({ difficulty: 'medium', questionCount: 10, allowSkip: false });

  const math = contestService.pickContestQuestions('math').questions;
  assert.equal(math.length, 10);
  assert.ok(math.every((question) => question.subject === 'math'));

  const mixed = contestService.pickContestQuestions('mixed').questions;
  assert.equal(mixed.length, 10);
  const subjects = new Set(mixed.map((question) => question.subject));
  assert.ok(subjects.size >= 2, 'mixed contest should cover more than one subject');
});

test('difficulty filtering prefers the requested level and reports fallback', () => {
  const mathPool = listBySubject('math');
  const easy = contestService.selectByDifficulty(mathPool, 'easy', 5);
  assert.equal(easy.questions.length, 5);
  assert.ok(easy.questions.every((question) => contestService.difficultyOf(question) === 'easy'));
  assert.equal(easy.fallback, false);

  const englishPool = listBySubject('english');
  const hard = contestService.selectByDifficulty(englishPool, 'hard', 20);
  assert.ok(hard.questions.length > 0);
  assert.equal(hard.questions.length, Math.min(20, englishPool.length));
  assert.equal(hard.fallback, true, 'hard pool is smaller than 20, so fallback is expected');
});

test('difficulty filtering stays disabled until the feature flag is turned on', () => {
  assert.equal(contestService.DIFFICULTY_ENABLED, false);
  contestService.saveSettings({ difficulty: 'easy', questionCount: 10, allowSkip: false });

  const picked = contestService.pickContestQuestions('math', { difficulty: 'easy', size: 10 });
  assert.equal(picked.difficulty, null);
  assert.equal(picked.fallback, false);
  assert.equal(picked.questions.length, 10);
  assert.ok(
    picked.questions.every((question) => question.subject === 'math'),
    'unfiltered picking still scopes to the contest subject',
  );
});

test('settings persist, normalise the question count, and default sanely', () => {
  const initial = contestService.readSettings();
  assert.deepEqual(initial, contestService.DEFAULT_SETTINGS);

  const saved = contestService.saveSettings({ allowSkip: true, difficulty: 'hard', questionCount: 13 });
  assert.equal(saved.allowSkip, true);
  assert.equal(saved.difficulty, 'hard');
  assert.equal(saved.questionCount, 15);

  const clamped = contestService.saveSettings({ questionCount: 99 });
  assert.equal(clamped.questionCount, 20);

  const invalid = contestService.saveSettings({ difficulty: 'impossible' });
  assert.equal(invalid.difficulty, contestService.DEFAULT_SETTINGS.difficulty);
});

test('contest results keep the best score and count plays', () => {
  contestService.saveResult('math', { correct: 6, total: 10 });
  contestService.saveResult('math', { correct: 9, total: 10 });
  const record = contestService.saveResult('math', { correct: 4, total: 10 });

  assert.equal(record.best, 9);
  assert.equal(record.last, 4);
  assert.equal(record.plays, 3);
  assert.equal(contestService.getResult('math').best, 9);
});

test('contest summaries expose bank size and personal best', () => {
  contestService.saveResult('english', { correct: 7, total: 10 });
  const summaries = contestService.getContestSummaries();
  const english = summaries.find((item) => item.id === 'english');

  assert.equal(summaries.length, 4);
  assert.equal(english.bankSize, 30);
  assert.equal(english.best, 7);
  assert.equal(contestService.getBankSize('mixed'), 90);
});
