const profileService = require('../../services/profile');
const questionService = require('../../services/questions');
const pageScan = require('../../services/page-scan');
const { readFileAsBase64, getImageSize, createBandCropper } = require('../../services/canvas-crop');
const { SUBJECTS, callCloudFunction, ensureSignedIn, describeError } = require('../../services/shared');

const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MAX_PAGE_WIDTH = 1600;

const HINT_CAPTURE = '拍一整页作业，尽量把题号拍全、画面平整。只识别题号上的手写标记（√／☆／△／○），未标记的题不入库。';
const HINT_PREVIEW = '核对每题标记：点标记可切换（√→☆→△→无），只有勾选的行会保存。';

// 单题模式默认用较准的 t1，但它偶尔会超过小程序 15 秒窗口；一次超时就换快的 hy-vision 兜底，避免同一题反复等 15 秒。
const FALLBACK_MODEL = 'hy-vision-2.0-instruct';

function requestBandMark(imageBase64, questionNo, model) {
  const payload = {
    confirmedFullPage: true,
    mode: 'single',
    questionNo,
    mimeType: 'image/jpeg',
    imageBase64,
  };
  if (model) {
    payload.model = model;
  }
  return callCloudFunction('paper-marks', payload);
}

async function requestBandMarkWithFallback(imageBase64, questionNo) {
  try {
    return await requestBandMark(imageBase64, questionNo);
  } catch (firstError) {
    console.warn('[import] mark fallback model', questionNo, describeError(firstError));
    return requestBandMark(imageBase64, questionNo, FALLBACK_MODEL);
  }
}

function compressPage(photo) {
  if (photo.width <= MAX_PAGE_WIDTH) {
    return Promise.resolve(photo);
  }
  return new Promise((resolve) => {
    wx.compressImage({
      src: photo.tempFilePath,
      quality: 88,
      compressedWidth: MAX_PAGE_WIDTH,
      success: async (result) => {
        const size = await getImageSize(result.tempFilePath);
        resolve({ tempFilePath: result.tempFilePath, size: 0, width: size.width, height: size.height });
      },
      fail: () => resolve(photo),
    });
  });
}

Page({
  data: {
    step: 'capture',
    subjects: SUBJECTS,
    learners: [],
    learnerIndex: 0,
    subjectId: 'math',
    image: null,
    rows: [],
    summary: { total: 0, marked: 0, selected: 0, failed: 0 },
    skippedCount: 0,
    coarse: false,
    manualStem: '',
    busy: false,
    scanText: '',
    hint: HINT_CAPTURE,
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
      sizeType: ['original'],
      success: async (result) => {
        const file = result.tempFiles[0];
        if (!file) {
          return;
        }
        if (file.size > MAX_PAGE_BYTES) {
          wx.showModal({
            title: '图片过大',
            content: '整页照片请控制在 6 MB 以内，可调低相机像素或离远一点重拍。',
            showCancel: false,
          });
          return;
        }
        const size = await getImageSize(file.tempFilePath);
        this.setData({
          image: { tempFilePath: file.tempFilePath, size: file.size, width: size.width, height: size.height },
          step: 'capture',
          rows: [],
          summary: { total: 0, marked: 0, selected: 0, failed: 0 },
          skippedCount: 0,
          hint: '确认整页题目都在画面里，再点「识别标记」。',
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

  onManualStemInput(event) {
    this.setData({ manualStem: event.detail.value });
  },

  onManualInput() {
    this.setData({ step: 'manual', manualStem: '', hint: '手动录入：填写题干并选择科目后保存。' });
  },

  async onScanPage() {
    if (this.data.busy || !this.data.image) {
      return;
    }
    this.setData({ busy: true, scanText: '正在压缩整页照片…' });
    wx.showLoading({ title: '切题中', mask: true });
    try {
      await ensureSignedIn();
      const photo = await compressPage(this.data.image);
      this.setData({ image: { ...this.data.image, ...photo } });

      this.setData({ scanText: '正在识别题目位置…' });
      const pageBase64 = await readFileAsBase64(photo.tempFilePath);
      const split = await callCloudFunction('question-split', {
        confirmedFullPage: true,
        imageBase64: pageBase64,
        photoId: `page-${Date.now()}`,
      });
      const questions = (split && split.questions) || [];
      if (questions.length === 0) {
        wx.hideLoading();
        wx.showModal({
          title: '没有切出题目',
          content: '换一张更清晰、题目更完整的整页照片，或改用手动录入。',
          showCancel: false,
        });
        this.setData({ busy: false, scanText: '' });
        return;
      }

      const plan = pageScan.buildCropPlan({
        questions,
        imageSize: { width: photo.width, height: photo.height },
      });
      if (plan.items.length === 0) {
        wx.hideLoading();
        wx.showModal({
          title: '无法定位题号',
          content: '这一页没有拿到题目坐标，请重拍或改用手动录入。',
          showCancel: false,
        });
        this.setData({ busy: false, scanText: '' });
        return;
      }

      this.setData({ step: 'scanning' });
      const cropper = await createBandCropper(this);
      const results = [];
      for (let position = 0; position < plan.items.length; position += 1) {
        const item = plan.items[position];
        this.setData({ scanText: `正在判断第 ${item.questionNo} 题的标记（${position + 1}/${plan.items.length}）` });
        try {
          const crop = await cropper({ src: photo.tempFilePath, band: item.band });
          const bandBase64 = await readFileAsBase64(crop.tempFilePath);
          const markResult = await requestBandMarkWithFallback(bandBase64, item.questionNo);
          results.push({
            index: item.index,
            mark: markResult && markResult.mark,
            confidence: markResult && markResult.confidence,
          });
        } catch (error) {
          console.warn('[import] mark failed', item.questionNo, describeError(error));
          results.push({ index: item.index, mark: 'none', failed: true });
        }
      }

      const rows = pageScan.buildPreviewRows({ items: plan.items, results });
      wx.hideLoading();
      this.setData({
        step: 'preview',
        rows,
        summary: pageScan.summarizeRows(rows),
        skippedCount: plan.skipped.length,
        coarse: plan.coarse,
        subjectId: pageScan.dominantSubject(questions) || this.data.subjectId,
        hint: HINT_PREVIEW,
      });
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: '识别失败', content: describeError(error), showCancel: false });
      this.setData({ step: 'capture', hint: HINT_CAPTURE });
    } finally {
      this.setData({ busy: false, scanText: '' });
    }
  },

  onRowToggle(event) {
    const index = Number(event.currentTarget.dataset.index);
    const rows = this.data.rows.map((row) => {
      if (row.index !== index || row.mark === 'none') {
        return row;
      }
      return { ...row, selected: !row.selected };
    });
    this.setData({ rows, summary: pageScan.summarizeRows(rows) });
  },

  onRowMarkTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const rows = this.data.rows.map((row) =>
      (row.index === index ? pageScan.applyMark(row, pageScan.nextMark(row.mark)) : row),
    );
    this.setData({ rows, summary: pageScan.summarizeRows(rows) });
  },

  onToggleAll(event) {
    const selected = event.currentTarget.dataset.selected === true || event.currentTarget.dataset.selected === 'true';
    const rows = this.data.rows.map((row) => (row.mark === 'none' ? row : { ...row, selected }));
    this.setData({ rows, summary: pageScan.summarizeRows(rows) });
  },

  persist(payloads) {
    if (this.data.busy) {
      return;
    }
    const learner = this.data.learners[this.data.learnerIndex];
    if (!learner) {
      wx.showToast({ title: '请先创建孩子档案', icon: 'none' });
      return;
    }
    if (payloads.length === 0) {
      wx.showToast({ title: '没有需要保存的题目', icon: 'none' });
      return;
    }

    let saved = 0;
    let failed = 0;
    for (const payload of payloads) {
      try {
        questionService.addQuestion({ ...payload, learnerId: learner.id, learnerName: learner.nickname });
        saved += 1;
      } catch (error) {
        failed += 1;
        console.warn('[import] save failed', describeError(error));
      }
    }

    profileService.setActiveLearner(learner.id);
    if (saved === 0) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      return;
    }
    wx.showToast({
      title: failed > 0 ? `已保存 ${saved} 题，${failed} 题失败` : `已保存 ${saved} 题`,
      icon: failed > 0 ? 'none' : 'success',
    });
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 600);
  },

  onSaveAll() {
    this.persist(
      pageScan.toQuestionPayloads({
        rows: this.data.rows,
        subjectId: this.data.subjectId,
        photoId: this.data.image ? `page-${Date.now()}` : '',
      }),
    );
  },

  onSaveManual() {
    const stem = String(this.data.manualStem || '').trim();
    if (!stem) {
      wx.showToast({ title: '请填写题干', icon: 'none' });
      return;
    }
    this.persist([
      {
        subject: this.data.subjectId,
        stem,
        source: 'manual',
        ocrComplete: true,
        labels: [],
        origin: 'capture',
        pageRect: null,
      },
    ]);
  },

  onRetake() {
    this.setData({
      step: 'capture',
      image: null,
      rows: [],
      summary: { total: 0, marked: 0, selected: 0, failed: 0 },
      skippedCount: 0,
      coarse: false,
      manualStem: '',
      hint: HINT_CAPTURE,
    });
  },
});
