const questionService = require('../../services/questions');
const { SUBJECTS, subjectLabel, subjectColor } = require('../../services/shared');

function formatDateTime(iso) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    id: '',
    question: null,
    subjects: SUBJECTS,
    editing: false,
    draftStem: '',
    draftSubjectId: 'math',
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    this.load();
  },

  load() {
    const question = questionService.getQuestion(this.data.id);
    if (!question) {
      wx.showToast({ title: '题目不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
      return;
    }
    this.setData({
      question: {
        ...question,
        subjectLabel: subjectLabel(question.subject),
        subjectColor: subjectColor(question.subject),
        createdText: formatDateTime(question.createdAt),
      },
      draftStem: question.stem,
      draftSubjectId: question.subject,
    });
  },

  onEdit() {
    this.setData({ editing: true });
  },

  onCancelEdit() {
    this.setData({ editing: false, draftStem: this.data.question.stem, draftSubjectId: this.data.question.subject });
  },

  onStemInput(event) {
    this.setData({ draftStem: event.detail.value });
  },

  onSubjectTap(event) {
    this.setData({ draftSubjectId: event.currentTarget.dataset.id });
  },

  onSaveEdit() {
    try {
      questionService.updateQuestion(this.data.id, {
        stem: this.data.draftStem,
        subject: this.data.draftSubjectId,
      });
      this.setData({ editing: false });
      this.load();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '保存失败', icon: 'none' });
    }
  },

  onToggleMastered() {
    const nextStatus = this.data.question.status === 'unmastered' ? 'mastered' : 'unmastered';
    try {
      questionService.updateQuestion(this.data.id, { status: nextStatus });
      this.load();
      wx.showToast({ title: nextStatus === 'mastered' ? '已标记掌握' : '已放回待复习', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '操作失败', icon: 'none' });
    }
  },

  onDelete() {
    wx.showModal({
      title: '删除题目',
      content: '删除后无法恢复，确定删除这道题吗？',
      confirmColor: '#e5484d',
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        questionService.removeQuestion(this.data.id);
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
      },
    });
  },
});
