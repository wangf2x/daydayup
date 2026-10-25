const contestService = require('../../services/contest');

const COUNT_OPTIONS = [5, 10, 15, 20];

Page({
  data: {
    allowSkip: false,
    difficultyEnabled: contestService.DIFFICULTY_ENABLED,
    difficultyIndex: 1,
    difficultyLevels: contestService.DIFFICULTY_LEVELS,
    difficultyHint: '',
    countIndex: 1,
    countOptions: COUNT_OPTIONS,
    questionCount: 10,
  },

  onLoad() {
    const settings = contestService.readSettings();
    const difficultyIndex = Math.max(
      0,
      contestService.DIFFICULTY_LEVELS.findIndex((level) => level.id === settings.difficulty),
    );
    const countIndex = Math.max(0, COUNT_OPTIONS.indexOf(settings.questionCount));

    this.setData({
      allowSkip: settings.allowSkip,
      difficultyIndex,
      difficultyHint: contestService.DIFFICULTY_LEVELS[difficultyIndex].hint,
      countIndex,
      questionCount: COUNT_OPTIONS[countIndex],
    });
  },

  onToggleSkip(event) {
    this.setData({ allowSkip: event.detail.value });
  },

  onDifficultyChange(event) {
    if (!this.data.difficultyEnabled) {
      return;
    }
    const difficultyIndex = Number(event.detail.value);
    this.setData({
      difficultyIndex,
      difficultyHint: contestService.DIFFICULTY_LEVELS[difficultyIndex].hint,
    });
  },

  onCountChange(event) {
    const countIndex = Number(event.detail.value);
    this.setData({ countIndex, questionCount: COUNT_OPTIONS[countIndex] });
  },

  onSave() {
    const patch = {
      allowSkip: this.data.allowSkip,
      questionCount: COUNT_OPTIONS[this.data.countIndex],
    };
    if (this.data.difficultyEnabled) {
      patch.difficulty = contestService.DIFFICULTY_LEVELS[this.data.difficultyIndex].id;
    }
    contestService.saveSettings(patch);
    wx.showToast({ title: '设置已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 400);
  },

  onReset() {
    const defaults = contestService.DEFAULT_SETTINGS;
    const difficultyIndex = contestService.DIFFICULTY_LEVELS.findIndex((level) => level.id === defaults.difficulty);
    const countIndex = COUNT_OPTIONS.indexOf(defaults.questionCount);
    this.setData({
      allowSkip: defaults.allowSkip,
      difficultyIndex,
      difficultyHint: contestService.DIFFICULTY_LEVELS[difficultyIndex].hint,
      countIndex,
      questionCount: COUNT_OPTIONS[countIndex],
    });
    wx.showToast({ title: '已恢复默认', icon: 'none' });
  },
});
