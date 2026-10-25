const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => {
    storage.set(key, value);
  },
};

const questionService = require('../miniprogram/services/questions');
const profileService = require('../miniprogram/services/profile');

test.beforeEach(() => {
  storage.clear();
});

test('questions are stored newest first per learner', () => {
  const first = questionService.addQuestion({
    learnerId: 'learner-a',
    learnerName: '小明',
    subject: 'math',
    stem: '第一题',
  });
  const second = questionService.addQuestion({
    learnerId: 'learner-a',
    learnerName: '小明',
    subject: 'chinese',
    stem: '第二题',
  });
  questionService.addQuestion({
    learnerId: 'learner-b',
    learnerName: '小红',
    subject: 'math',
    stem: '别人的题',
  });

  const list = questionService.listQuestions({ learnerId: 'learner-a' });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id);
  assert.equal(list[1].id, first.id);
});

test('questions reject empty stems, missing learners, and missing subjects', () => {
  assert.throws(() => questionService.addQuestion({
    learnerId: 'learner-a', subject: 'math', stem: '   ',
  }), /题干不能为空/);
  assert.throws(() => questionService.addQuestion({
    subject: 'math', stem: '题目',
  }), /请选择孩子/);
  assert.throws(() => questionService.addQuestion({
    learnerId: 'learner-a', stem: '题目',
  }), /请选择科目/);
});

test('question updates keep the stem non-empty and refresh the timestamp', () => {
  const question = questionService.addQuestion({
    learnerId: 'learner-a',
    subject: 'math',
    stem: '原题干',
  });

  const updated = questionService.updateQuestion(question.id, { status: 'mastered' });
  assert.equal(updated.status, 'mastered');

  assert.throws(() => questionService.updateQuestion(question.id, { stem: '  ' }), /题干不能为空/);
});

test('removing a question deletes only that question', () => {
  const keep = questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '保留' });
  const drop = questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '删除' });

  assert.equal(questionService.removeQuestion(drop.id), true);
  assert.equal(questionService.listQuestions().length, 1);
  assert.equal(questionService.getQuestion(keep.id).stem, '保留');
  assert.equal(questionService.getQuestion(drop.id), null);
});

test('stats count totals, this week, and pending review for one learner', () => {
  questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '题一' });
  const done = questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '题二' });
  questionService.updateQuestion(done.id, { status: 'mastered' });
  questionService.addQuestion({ learnerId: 'b', subject: 'math', stem: '别人的题' });

  const stats = questionService.getStats('a');
  assert.equal(stats.total, 2);
  assert.equal(stats.thisWeek, 2);
  assert.equal(stats.pendingReview, 1);
});

test('subject counts separate total and pending per subject', () => {
  questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '数学一' });
  const mathTwo = questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '数学二' });
  questionService.updateQuestion(mathTwo.id, { status: 'mastered' });
  questionService.addQuestion({ learnerId: 'a', subject: 'chinese', stem: '语文一' });
  questionService.addQuestion({ learnerId: 'b', subject: 'math', stem: '别人' });

  const counts = questionService.countBySubject('a');
  assert.deepEqual(counts.math, { total: 2, pending: 1 });
  assert.deepEqual(counts.chinese, { total: 1, pending: 1 });
  assert.equal(counts.english, undefined);
});

test('challenge picks only pending questions, honours subject filter, and caps the batch', () => {
  for (let i = 0; i < 7; i += 1) {
    questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: `数学${i}` });
  }
  const mastered = questionService.addQuestion({ learnerId: 'a', subject: 'math', stem: '已掌握' });
  questionService.updateQuestion(mastered.id, { status: 'mastered' });
  questionService.addQuestion({ learnerId: 'a', subject: 'chinese', stem: '语文题' });

  const mathBatch = questionService.pickChallengeQuestions('a', 'math', 5);
  assert.equal(mathBatch.length, 5);
  assert.ok(mathBatch.every((question) => question.subject === 'math'));
  assert.ok(mathBatch.every((question) => question.status !== 'mastered'));

  const allBatch = questionService.pickChallengeQuestions('a', '', 20);
  assert.equal(allBatch.length, 8);
});

test('profile creates at most three learners and keeps an active learner', () => {
  const profile = profileService.ensureDefaultLearner('user-1', '老大');
  assert.equal(profile.learners.length, 1);
  assert.equal(profileService.getActiveLearner().nickname, '老大');

  profileService.addLearner('老二');
  const extra = profileService.addLearner('老三');
  assert.throws(() => profileService.addLearner('老四'), /最多支持 3 个孩子/);

  profileService.setActiveLearner(extra.id);
  assert.equal(profileService.getActiveLearner().nickname, '老三');
});
