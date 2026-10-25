const MENUS = [
  { id: 'organize', label: '整理', hint: '拍照导入的原卷题' },
  { id: 'variants', label: '举一反三', hint: 'AI 生成的同类题' },
  { id: 'challenge', label: '挑战赛', hint: '挑战答错迁入的题' },
  { id: 'mastered', label: '已掌握', hint: '手动标记掌握后迁入' },
  { id: 'all', label: '所有题型', hint: '以上四处去重汇总' },
];

// mark-v2 三类原因标签，符号必须叠加在题号上才算有效标记。
const LABELS = [
  { id: 'check', symbol: '√', label: '题型不熟悉' },
  { id: 'star', symbol: '☆', label: '完全不会' },
  { id: 'triangle', symbol: '△', label: '做题粗心' },
];

const ORIGINS = ['capture', 'generated', 'challenge'];

const ORIGIN_TO_MENU = {
  capture: 'organize',
  generated: 'variants',
  challenge: 'challenge',
};

function isKnownMenu(menuId) {
  return MENUS.some((menu) => menu.id === menuId);
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) {
    return [];
  }
  const known = new Set(LABELS.map((label) => label.id));
  return Array.from(new Set(labels.filter((label) => known.has(label))));
}

function originOf(question) {
  if (!question) {
    return 'capture';
  }
  if (ORIGINS.includes(question.origin)) {
    return question.origin;
  }
  return question.source === 'generated' ? 'generated' : 'capture';
}

function menuOf(question) {
  if (question && question.status === 'mastered') {
    return 'mastered';
  }
  return ORIGIN_TO_MENU[originOf(question)];
}

function listForMenu(questions, menuId) {
  if (!Array.isArray(questions)) {
    return [];
  }
  if (menuId === 'all' || !isKnownMenu(menuId)) {
    return questions.slice();
  }
  return questions.filter((question) => menuOf(question) === menuId);
}

// 灰色=包含（参与筛选），白色=排除。无标签题不受标签筛选影响，始终保留。
function filterByLabels(questions, excludedLabels) {
  if (!Array.isArray(questions)) {
    return [];
  }
  const excluded = new Set(normalizeLabels(excludedLabels));
  if (excluded.size === 0) {
    return questions.slice();
  }
  return questions.filter((question) => {
    const labels = normalizeLabels(question && question.labels);
    if (labels.length === 0) {
      return true;
    }
    return labels.some((label) => !excluded.has(label));
  });
}

function countMenus(questions) {
  const counts = {};
  for (const menu of MENUS) {
    counts[menu.id] = 0;
  }
  if (!Array.isArray(questions)) {
    return counts;
  }
  for (const question of questions) {
    counts[menuOf(question)] += 1;
    counts.all += 1;
  }
  return counts;
}

function labelsOf(question) {
  return normalizeLabels(question && question.labels).map((id) => {
    const match = LABELS.find((label) => label.id === id);
    return { id, symbol: match.symbol, label: match.label };
  });
}

module.exports = {
  MENUS,
  LABELS,
  ORIGINS,
  isKnownMenu,
  normalizeLabels,
  originOf,
  menuOf,
  listForMenu,
  filterByLabels,
  countMenus,
  labelsOf,
};
