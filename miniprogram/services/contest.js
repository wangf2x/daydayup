const { QUESTION_BANK, listBySubject, shuffle } = require('../data/question-bank');

const CONTESTS = [
  {
    id: 'math',
    title: '数学赛',
    subtitle: '计算 · 应用 · 图形',
    subject: 'math',
    size: 10,
    emoji: '➗',
    color: '#3b7cff',
  },
  {
    id: 'chinese',
    title: '语文赛',
    subtitle: '字词 · 古诗 · 句子',
    subject: 'chinese',
    size: 10,
    emoji: '📖',
    color: '#16a34a',
  },
  {
    id: 'english',
    title: '英语赛',
    subtitle: '单词 · 句型 · 语法',
    subject: 'english',
    size: 10,
    emoji: '🔤',
    color: '#f59e0b',
  },
  {
    id: 'mixed',
    title: '大综合赛',
    subtitle: '语数英混合抽题',
    subject: '',
    size: 15,
    emoji: '🏆',
    color: '#8b5cf6',
  },
];

const RESULTS_KEY = 'daydayup.contest-results.v1';
const SETTINGS_KEY = 'daydayup.contest-settings.v1';

const DIFFICULTY_LEVELS = [
  { id: 'easy', label: '易', hint: '基础题为主' },
  { id: 'medium', label: '中', hint: '课本常见题' },
  { id: 'hard', label: '难', hint: '需要多步思考' },
];

const DEFAULT_SETTINGS = {
  allowSkip: false,
  difficulty: 'medium',
  questionCount: 10,
};

// 难度筛选暂不启用：抽题按全难度随机，分级逻辑保留供后续开启。
const DIFFICULTY_ENABLED = false;

const HARD_OVERRIDES = new Set([
  'm10', 'm23', 'm28', 'm29',
  'c16', 'c21', 'c26', 'c27',
  'e11', 'e23', 'e25', 'e26', 'e30',
]);

function difficultyOf(question) {
  if (HARD_OVERRIDES.has(question.id)) {
    return 'hard';
  }
  if (question.type === 'judge' || question.grade === 3 && question.type === 'choice') {
    return 'easy';
  }
  if (question.type === 'fill') {
    return question.grade === 3 ? 'medium' : 'hard';
  }
  return 'medium';
}

function readSettings() {
  try {
    const raw = wx.getStorageSync(SETTINGS_KEY);
    if (!raw || typeof raw !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    const difficulty = DIFFICULTY_LEVELS.some((level) => level.id === raw.difficulty)
      ? raw.difficulty
      : DEFAULT_SETTINGS.difficulty;
    const questionCount = Number.isFinite(raw.questionCount)
      ? Math.min(20, Math.max(5, Math.round(raw.questionCount / 5) * 5))
      : DEFAULT_SETTINGS.questionCount;
    return {
      allowSkip: raw.allowSkip === true,
      difficulty,
      questionCount,
    };
  } catch (error) {
    console.warn('[contest] read settings failed', error);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(patch) {
  const next = { ...readSettings(), ...patch };
  const normalized = {
    allowSkip: next.allowSkip === true,
    difficulty: DIFFICULTY_LEVELS.some((level) => level.id === next.difficulty)
      ? next.difficulty
      : DEFAULT_SETTINGS.difficulty,
    questionCount: Math.min(20, Math.max(5, Math.round(Number(next.questionCount) / 5) * 5 || 10)),
  };
  try {
    wx.setStorageSync(SETTINGS_KEY, normalized);
  } catch (error) {
    console.warn('[contest] save settings failed', error);
  }
  return normalized;
}

function difficultyLabel(id) {
  const level = DIFFICULTY_LEVELS.find((item) => item.id === id);
  return level ? level.label : '中';
}

function getContest(contestId) {
  return CONTESTS.find((contest) => contest.id === contestId) || null;
}

function normalizeAnswer(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?；;：:“”"'（）()《》]/g, '')
    .toLowerCase();
}

function isAnswerCorrect(question, userAnswer) {
  const candidates = [question.answer, ...(question.accept || [])];
  const normalizedUser = normalizeAnswer(userAnswer);
  if (!normalizedUser) {
    return false;
  }
  return candidates.some((candidate) => normalizeAnswer(candidate) === normalizedUser);
}

function selectByDifficulty(pool, difficulty, size) {
  const preferred = pool.filter((question) => difficultyOf(question) === difficulty);
  const fallback = preferred.length < size;
  const source = fallback ? pool : preferred;
  return { questions: shuffle(source).slice(0, size), fallback };
}

function pickContestQuestions(contestId, options = {}) {
  const contest = getContest(contestId);
  if (!contest) {
    return { questions: [], fallback: false };
  }

  const settings = readSettings();
  const difficulty = DIFFICULTY_ENABLED ? options.difficulty || settings.difficulty : null;
  const size = options.size || settings.questionCount || contest.size;
  const pool = contest.subject ? listBySubject(contest.subject) : QUESTION_BANK;

  if (!difficulty) {
    return { questions: shuffle(pool).slice(0, size), fallback: false, difficulty: null, size };
  }

  const picked = selectByDifficulty(pool, difficulty, size);
  return { questions: picked.questions, fallback: picked.fallback, difficulty, size };
}

function readResults() {
  try {
    const raw = wx.getStorageSync(RESULTS_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (error) {
    console.warn('[contest] read results failed', error);
    return {};
  }
}

function saveResult(contestId, { correct, total, finishedAt }) {
  const results = readResults();
  const previous = results[contestId] || { best: 0, plays: 0 };
  const record = {
    best: Math.max(previous.best || 0, correct),
    last: correct,
    total,
    plays: (previous.plays || 0) + 1,
    finishedAt: finishedAt || new Date().toISOString(),
  };
  results[contestId] = record;
  try {
    wx.setStorageSync(RESULTS_KEY, results);
  } catch (error) {
    console.warn('[contest] save result failed', error);
  }
  return record;
}

function getResult(contestId) {
  const results = readResults();
  return results[contestId] || { best: 0, last: 0, total: 0, plays: 0, finishedAt: '' };
}

function getBankSize(contestId) {
  const contest = getContest(contestId);
  if (!contest) {
    return 0;
  }
  return contest.subject ? listBySubject(contest.subject).length : QUESTION_BANK.length;
}

function getContestSummaries() {
  return CONTESTS.map((contest) => {
    const bankSize = contest.subject ? listBySubject(contest.subject).length : QUESTION_BANK.length;
    const result = getResult(contest.id);
    return { ...contest, bankSize, best: result.best || 0, plays: result.plays || 0 };
  });
}

module.exports = {
  CONTESTS,
  DIFFICULTY_LEVELS,
  DIFFICULTY_ENABLED,
  DEFAULT_SETTINGS,
  getContest,
  getBankSize,
  difficultyOf,
  difficultyLabel,
  readSettings,
  saveSettings,
  selectByDifficulty,
  pickContestQuestions,
  isAnswerCorrect,
  normalizeAnswer,
  saveResult,
  getResult,
  getContestSummaries,
};
