const profileService = require('../../services/profile');
const questionService = require('../../services/questions');
const { SUBJECTS, ensureSignedIn } = require('../../services/shared');

Page({
  data: {
    learners: [],
    activeLearnerId: '',
    activeLearnerName: '',
    stats: { total: 0, thisWeek: 0, pendingReview: 0 },
    subjectCount: 0,
    ready: false,
  },

  onShow() {
    this.refresh();
    if (!getApp().globalData.authUserId && !this.autoSignInTried) {
      this.autoSignInTried = true;
      this.autoSignIn();
    }
  },

  async autoSignIn() {
    try {
      await ensureSignedIn();
      this.refresh();
    } catch (error) {
      console.warn('[home] silent sign-in failed', error && error.message);
    }
  },

  refresh() {
    const userId = getApp().globalData.authUserId;
    if (!userId) {
      this.setData({ ready: false, learners: [], activeLearnerName: '', stats: { total: 0, thisWeek: 0, pendingReview: 0 }, subjectCount: 0 });
      return;
    }

    const profile = profileService.ensureDefaultLearner(userId, '小朋友');
    const activeLearner = profileService.getActiveLearner();
    const learnerId = activeLearner ? activeLearner.id : '';
    const counts = questionService.countBySubject(learnerId);

    this.setData({
      ready: true,
      learners: profile.learners,
      activeLearnerId: learnerId,
      activeLearnerName: activeLearner ? activeLearner.nickname : '',
      stats: questionService.getStats(learnerId),
      subjectCount: SUBJECTS.filter((subject) => counts[subject.id] && counts[subject.id].total > 0).length,
    });
  },

  async onSignIn() {
    try {
      wx.showLoading({ title: '登录中', mask: true });
      await ensureSignedIn();
      wx.hideLoading();
      this.refresh();
    } catch (error) {
      wx.hideLoading();
      wx.showModal({
        title: '登录失败',
        content: (error && error.message) || '请稍后重试',
        showCancel: false,
      });
    }
  },

  onSwitchLearner(event) {
    const { id } = event.currentTarget.dataset;
    if (id === this.data.activeLearnerId) {
      return;
    }
    try {
      profileService.setActiveLearner(id);
      this.refresh();
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '切换失败', icon: 'none' });
    }
  },

  onCreateLearner() {
    wx.showModal({
      title: '新增孩子',
      editable: true,
      placeholderText: '孩子昵称',
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        try {
          profileService.addLearner(result.content);
          this.refresh();
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '添加失败', icon: 'none' });
        }
      },
    });
  },

  goLibrary() {
    wx.navigateTo({ url: '/pages/library/index' });
  },

  goChallenge() {
    wx.navigateTo({ url: '/pages/contest/index' });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/import/index' });
  },
});
