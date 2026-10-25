const profileService = require('../../services/profile');
const questionService = require('../../services/questions');
const contestService = require('../../services/contest');
const menus = require('../../services/menus');
const { subjectLabel, subjectColor } = require('../../services/shared');

function formatDate(iso) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Page({
  data: {
    subjectId: 'math',
    subjectName: '数学',
    subjectColor: '#3b7cff',
    menu: 'organize',
    menuCounts: {},
    menus: menus.MENUS,
    labelChips: [],
    excludedLabels: [],
    questions: [],
    pending: 0,
    mastered: 0,
    emptyText: '',
  },

  onLoad(options) {
    const subjectId = options.subject || 'math';
    const contest = contestService.getContest(subjectId);
    const result = contestService.getResult(subjectId);
    this.setData({
      subjectId,
      subjectName: subjectLabel(subjectId),
      subjectColor: subjectColor(subjectId),
      contestTitle: contest ? contest.title : `${subjectLabel(subjectId)}赛`,
      contestSize: contest ? contest.size : 0,
      bankSize: contestService.getBankSize(subjectId),
      contestBest: result.best || 0,
      contestPlays: result.plays || 0,
    });
    wx.setNavigationBarTitle({ title: `${subjectLabel(subjectId)}` });
  },

  onShow() {
    this.load();
  },

  load() {
    const activeLearner = profileService.getActiveLearner();
    const learnerId = activeLearner ? activeLearner.id : '';
    const all = questionService
      .listQuestions({ learnerId })
      .filter((question) => question.subject === this.data.subjectId);

    const inMenu = menus.listForMenu(all, this.data.menu);
    const visible = menus.filterByLabels(inMenu, this.data.excludedLabels);
    const questions = visible.map((question) => ({
      ...question,
      preview: question.stem.length > 70 ? `${question.stem.slice(0, 70)}…` : question.stem,
      dateText: formatDate(question.createdAt),
      statusLabel: question.status === 'mastered' ? '已掌握' : '待复习',
      labelChips: menus.labelsOf(question),
    }));

    this.setData({
      menuCounts: questionService.countByMenu({ learnerId, subject: this.data.subjectId }),
      labelChips: menus.LABELS.map((label) => ({
        ...label,
        excluded: this.data.excludedLabels.includes(label.id),
      })),
      questions,
      pending: questions.filter((question) => question.status !== 'mastered').length,
      mastered: questions.filter((question) => question.status === 'mastered').length,
      emptyText: this.emptyTextFor(inMenu.length),
    });
  },

  emptyTextFor(menuSize) {
    if (menuSize === 0) {
      const menu = menus.MENUS.find((item) => item.id === this.data.menu);
      return `这个菜单还没有题目（${menu ? menu.hint : ''}）`;
    }
    return '当前标签筛选下没有题目，点一下白色标签即可恢复。';
  },

  onSwitchMenu(event) {
    const { id } = event.currentTarget.dataset;
    if (id === this.data.menu) {
      return;
    }
    this.setData({ menu: id, excludedLabels: [] }, () => this.load());
  },

  onToggleLabel(event) {
    const { id } = event.currentTarget.dataset;
    const excluded = this.data.excludedLabels.includes(id)
      ? this.data.excludedLabels.filter((label) => label !== id)
      : [...this.data.excludedLabels, id];
    this.setData({ excludedLabels: excluded }, () => this.load());
  },

  onResetFilters() {
    this.setData({ excludedLabels: [] }, () => this.load());
  },

  onOpenQuestion(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/question/index?id=${id}` });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/import/index' });
  },

  startChallenge() {
    wx.navigateTo({ url: `/pages/challenge/index?contest=${this.data.subjectId}` });
  },
});
