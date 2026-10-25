const profileService = require('../../services/profile');
const questionService = require('../../services/questions');
const { SUBJECTS } = require('../../services/shared');

Page({
  data: {
    subjects: [],
    learnerName: '',
    total: 0,
  },

  onShow() {
    const activeLearner = profileService.getActiveLearner();
    const learnerId = activeLearner ? activeLearner.id : '';
    const counts = questionService.countBySubject(learnerId);

    const subjects = SUBJECTS.map((subject) => {
      const count = counts[subject.id] || { total: 0, pending: 0 };
      return {
        ...subject,
        total: count.total,
        pending: count.pending,
        mastered: count.total - count.pending,
        percent: count.total === 0 ? 0 : Math.round(((count.total - count.pending) / count.total) * 100),
      };
    });

    this.setData({
      subjects,
      learnerName: activeLearner ? activeLearner.nickname : '',
      total: subjects.reduce((sum, subject) => sum + subject.total, 0),
    });
  },

  onOpenSubject(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/subject/index?subject=${id}` });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/import/index' });
  },
});
