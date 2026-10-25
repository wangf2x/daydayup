const profileService = require('../../services/profile');
const questionService = require('../../services/questions');
const { SUBJECTS, callCloudFunction, ensureSignedIn, describeError } = require('../../services/shared');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readFileAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: reject,
    });
  });
}

Page({
  data: {
    step: 'capture',
    subjects: SUBJECTS,
    learners: [],
    learnerIndex: 0,
    image: null,
    stem: '',
    subjectId: 'math',
    ocrComplete: true,
    recognizedUsage: null,
    busy: false,
    busyText: '',
    hint: '拍下带标记的单道题目，识别后可修改题干再保存。',
  },

  onLoad() {
    this.loadLearners();
  },

  loadLearners() {
    let profile = profileService.readProfile();
    if (profile.learners.length === 0) {
      const userId = getApp().globalData.authUserId;
      if (userId) {
        profile = profileService.ensureDefaultLearner(userId, '小朋友');
      }
    }
    const learners = profile.learners;
    const activeId = profile.activeLearnerId;
    let learnerIndex = learners.findIndex((learner) => learner.id === activeId);
    if (learnerIndex < 0) {
      learnerIndex = 0;
    }
    this.setData({ learners, learnerIndex });
  },

  onChooseImage() {
    if (this.data.busy) {
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file) {
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          wx.showModal({
            title: '图片过大',
            content: '单题图片请控制在 3 MB 以内，建议先裁剪到只有一道题。',
            showCancel: false,
          });
          return;
        }
        this.setData({
          image: { tempFilePath: file.tempFilePath, size: file.size },
          step: 'capture',
          stem: '',
          ocrComplete: true,
          recognizedUsage: null,
          hint: '确认图片里只有这一道题，再点「识别题干」。',
        });
      },
    });
  },

  onLearnerChange(event) {
    this.setData({ learnerIndex: Number(event.detail.value) });
  },

  onSubjectTap(event) {
    this.setData({ subjectId: event.currentTarget.dataset.id });
  },

  onStemInput(event) {
    this.setData({ stem: event.detail.value });
  },

  async onRecognize() {
    if (this.data.busy || !this.data.image) {
      return;
    }

    this.setData({ busy: true, busyText: '识别中…' });
    wx.showLoading({ title: '识别题干', mask: true });
    try {
      await ensureSignedIn();
      const imageBase64 = await readFileAsBase64(this.data.image.tempFilePath);
      const result = await callCloudFunction('question-ocr', {
        confirmedSingleQuestion: true,
        imageBase64,
        photoId: `import-${Date.now()}`,
      });
      const text = (result && result.text) || '';
      if (!text) {
        wx.showModal({
          title: '没有识别到题目',
          content: '请确认图片只包含一道题且清晰，或手动填写题干。',
          showCancel: false,
        });
      }
      this.setData({
        step: 'confirm',
        stem: text,
        ocrComplete: Boolean(result && result.complete),
        recognizedUsage: (result && result.usage) || null,
        hint: text ? '请核对题干，可手动修改后保存。' : '未识别到文字，请手动填写题干。',
      });
    } catch (error) {
      wx.showModal({
        title: '识别失败',
        content: describeError(error),
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ busy: false, busyText: '' });
    }
  },

  onManualInput() {
    this.setData({
      step: 'confirm',
      stem: '',
      ocrComplete: true,
      hint: '手动录入模式：请填写题干后保存。',
    });
  },

  onSave() {
    if (this.data.busy) {
      return;
    }
    const learner = this.data.learners[this.data.learnerIndex];
    if (!learner) {
      wx.showToast({ title: '请先创建孩子档案', icon: 'none' });
      return;
    }

    try {
      const question = questionService.addQuestion({
        learnerId: learner.id,
        learnerName: learner.nickname,
        subject: this.data.subjectId,
        stem: this.data.stem,
        source: this.data.image ? 'photo' : 'manual',
        ocrComplete: this.data.ocrComplete,
        usage: this.data.recognizedUsage,
      });
      profileService.setActiveLearner(learner.id);
      wx.showToast({ title: '已加入错题本', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 500);
      return question;
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '保存失败', icon: 'none' });
      return null;
    }
  },

  onRetake() {
    this.setData({
      step: 'capture',
      image: null,
      stem: '',
      ocrComplete: true,
      recognizedUsage: null,
      hint: '拍下带标记的单道题目，识别后可修改题干再保存。',
    });
  },
});
