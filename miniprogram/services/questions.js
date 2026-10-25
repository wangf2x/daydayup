const QUESTIONS_KEY = 'daydayup.questions.v1';
const SCHEMA_VERSION = 2;

const SUBJECT_STATUSES = ['auto_accepted', 'needs_selection', 'user_selected'];

const { ORIGINS, normalizeLabels, listForMenu, countMenus } = require('./menus');

function readAll() {
  try {
    const raw = wx.getStorageSync(QUESTIONS_KEY);
    return Array.isArray(raw) ? raw.map(migrate) : [];
  } catch (error) {
    console.warn('[questions] read failed', error);
    return [];
  }
}

function migrate(question) {
  if (!question || typeof question !== 'object') {
    return question;
  }
  if (question.schemaVersion === SCHEMA_VERSION) {
    return question;
  }
  return {
    ...question,
    schemaVersion: SCHEMA_VERSION,
    labels: normalizeLabels(question.labels),
    origin: ORIGINS.includes(question.origin)
      ? question.origin
      : question.source === 'generated' ? 'generated' : 'capture',
    subjectStatus: SUBJECT_STATUSES.includes(question.subjectStatus)
      ? question.subjectStatus
      : 'user_selected',
    referenceAnswer: typeof question.referenceAnswer === 'string' ? question.referenceAnswer : '',
    referenceParse: typeof question.referenceParse === 'string' ? question.referenceParse : '',
    knowledgePoints: Array.isArray(question.knowledgePoints) ? question.knowledgePoints : [],
    options: Array.isArray(question.options) ? question.options : [],
    sourcePhotoId: typeof question.sourcePhotoId === 'string' ? question.sourcePhotoId : '',
    pageRect: question.pageRect && typeof question.pageRect === 'object' ? question.pageRect : null,
  };
}

function writeAll(questions) {
  try {
    wx.setStorageSync(QUESTIONS_KEY, questions);
  } catch (error) {
    const failure = new Error('本机存储写入失败，可能是演示库已满。');
    failure.code = 'STORAGE_WRITE_FAILED';
    failure.cause = error;
    throw failure;
  }
  return questions;
}


function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addQuestion({
  learnerId,
  learnerName,
  subject,
  stem,
  source,
  ocrComplete,
  usage,
  labels,
  origin,
  subjectStatus,
  referenceAnswer,
  referenceParse,
  knowledgePoints,
  options,
  sourcePhotoId,
  pageRect,
}) {
  const text = normalizeText(stem);
  if (!text) {
    throw new Error('题干不能为空。');
  }
  if (!learnerId) {
    throw new Error('请选择孩子。');
  }
  if (!subject) {
    throw new Error('请选择科目。');
  }

  const question = {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: SCHEMA_VERSION,
    learnerId,
    learnerName: learnerName || '',
    subject,
    subjectStatus: SUBJECT_STATUSES.includes(subjectStatus) ? subjectStatus : 'user_selected',
    stem: text,
    options: Array.isArray(options) ? options : [],
    status: 'unmastered',
    labels: normalizeLabels(labels),
    origin: ORIGINS.includes(origin) ? origin : 'capture',
    source: source || 'photo',
    ocrComplete: ocrComplete !== false,
    ocrUsage: usage || null,
    referenceAnswer: typeof referenceAnswer === 'string' ? referenceAnswer : '',
    referenceParse: typeof referenceParse === 'string' ? referenceParse : '',
    knowledgePoints: Array.isArray(knowledgePoints) ? knowledgePoints : [],
    sourcePhotoId: typeof sourcePhotoId === 'string' ? sourcePhotoId : '',
    pageRect: pageRect && typeof pageRect === 'object' ? pageRect : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const questions = readAll();
  writeAll([question, ...questions]);
  return question;
}

function listQuestions({ learnerId } = {}) {
  const questions = readAll();
  const filtered = learnerId
    ? questions.filter((question) => question.learnerId === learnerId)
    : questions;
  return filtered.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function getQuestion(id) {
  return readAll().find((question) => question.id === id) || null;
}

function updateQuestion(id, patch) {
  const questions = readAll();
  const index = questions.findIndex((question) => question.id === id);
  if (index === -1) {
    throw new Error('题目不存在。');
  }

  const next = { ...questions[index], ...patch, updatedAt: new Date().toISOString() };
  if (patch && patch.stem !== undefined) {
    next.stem = normalizeText(patch.stem);
    if (!next.stem) {
      throw new Error('题干不能为空。');
    }
  }
  questions[index] = next;
  writeAll(questions);
  return next;
}

function removeQuestion(id) {
  const questions = readAll();
  const remaining = questions.filter((question) => question.id !== id);
  writeAll(remaining);
  return remaining.length !== questions.length;
}

function getStats(learnerId) {
  const questions = listQuestions({ learnerId });
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const createdThisWeek = questions.filter((question) => new Date(question.createdAt).getTime() >= weekAgo);
  return {
    total: questions.length,
    thisWeek: createdThisWeek.length,
    pendingReview: questions.filter((question) => question.status === 'unmastered').length,
  };
}

function countBySubject(learnerId) {
  const counts = {};
  for (const question of listQuestions({ learnerId })) {
    const current = counts[question.subject] || { total: 0, pending: 0 };
    current.total += 1;
    if (question.status !== 'mastered') {
      current.pending += 1;
    }
    counts[question.subject] = current;
  }
  return counts;
}

function listByMenu({ learnerId, subject, menu } = {}) {
  const questions = listQuestions({ learnerId }).filter(
    (question) => (!subject || question.subject === subject),
  );
  return listForMenu(questions, menu || 'all');
}

function countByMenu({ learnerId, subject } = {}) {
  const questions = listQuestions({ learnerId }).filter(
    (question) => (!subject || question.subject === subject),
  );
  return countMenus(questions);
}

function pickChallengeQuestions(learnerId, subject, limit = 5) {
  const pool = listQuestions({ learnerId }).filter(
    (question) => (!subject || question.subject === subject) && question.status !== 'mastered',
  );
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled.slice(0, limit);
}

module.exports = {
  SCHEMA_VERSION,
  addQuestion,
  listQuestions,
  listByMenu,
  countByMenu,
  getQuestion,
  updateQuestion,
  removeQuestion,
  getStats,
  countBySubject,
  pickChallengeQuestions,
};
