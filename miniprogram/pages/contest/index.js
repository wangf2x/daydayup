const contestService = require('../../services/contest');

Page({
  data: {
    contests: [],
    settingsSummary: '',
  },

  onShow() {
    const settings = contestService.readSettings();
    const difficultyText = contestService.DIFFICULTY_ENABLED
      ? `难度${contestService.difficultyLabel(settings.difficulty)}`
      : '混合难度';
    this.setData({
      contests: contestService.getContestSummaries(),
      settingsSummary: `本局 ${settings.questionCount} 题 · ${difficultyText}${settings.allowSkip ? ' · 可跳题' : ''}`,
    });
  },

  onStart(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/challenge/index?contest=${id}` });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },
});
