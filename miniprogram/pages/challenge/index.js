const contestService = require('../../services/contest');

Page({
  data: {
    contestId: '',
    contestTitle: '',
    phase: 'loading',
    questions: [],
    results: [],
    index: 0,
    current: null,
    answered: false,
    lastCorrect: false,
    lastExplanation: '',
    inputValue: '',
    selectedAnswer: '',
    correct: 0,
    wrong: 0,
    skipped: 0,
    total: 0,
    allowSkip: false,
    difficultyLabel: '中',
    fallbackNote: '',
    summaryText: '',
    best: 0,
  },

  onLoad(options) {
    const contestId = options.contest || 'mixed';
    const contest = contestService.getContest(contestId);
    this.setData({
      contestId,
      contestTitle: contest ? contest.title : '挑战赛',
    });
    if (contest) {
      wx.setNavigationBarTitle({ title: contest.title });
    }
    this.start();
  },

  start() {
    const settings = contestService.readSettings();
    const picked = contestService.pickContestQuestions(this.data.contestId, {
      difficulty: settings.difficulty,
      size: settings.questionCount,
    });

    if (picked.questions.length === 0) {
      this.setData({ phase: 'empty' });
      return;
    }

    this.setData({
      phase: 'running',
      questions: picked.questions,
      results: picked.questions.map(() => null),
      index: 0,
      current: picked.questions[0],
      answered: false,
      lastCorrect: false,
      lastExplanation: '',
      inputValue: '',
      selectedAnswer: '',
      correct: 0,
      wrong: 0,
      skipped: 0,
      total: picked.questions.length,
      allowSkip: settings.allowSkip,
      difficultyLabel: contestService.DIFFICULTY_ENABLED
        ? contestService.difficultyLabel(picked.difficulty)
        : '混合',
      fallbackNote: picked.fallback ? '该难度题目不足，已补足其它难度' : '',
      summaryText: '',
      best: contestService.getResult(this.data.contestId).best || 0,
    });
  },

  onOptionTap(event) {
    if (this.data.answered) {
      return;
    }
    this.submitAnswer(event.currentTarget.dataset.option);
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  onSubmitFill() {
    if (this.data.answered) {
      return;
    }
    this.submitAnswer(this.data.inputValue);
  },

  submitAnswer(userAnswer) {
    const question = this.data.current;
    if (!question) {
      return;
    }
    const isCorrect = contestService.isAnswerCorrect(question, userAnswer);
    const results = this.data.results.slice();
    results[this.data.index] = { status: isCorrect ? 'correct' : 'wrong', userAnswer };

    this.setData({
      results,
      answered: true,
      selectedAnswer: String(userAnswer === undefined || userAnswer === null ? '' : userAnswer),
      lastCorrect: isCorrect,
      lastExplanation: question.explain || '',
      correct: results.filter((item) => item && item.status === 'correct').length,
      wrong: results.filter((item) => item && item.status === 'wrong').length,
    });
  },

  onNext() {
    const nextIndex = this.data.index + 1;
    if (nextIndex >= this.data.questions.length) {
      this.finish();
      return;
    }
    this.goTo(nextIndex);
  },

  onPrev() {
    if (this.data.index === 0) {
      return;
    }
    this.goTo(this.data.index - 1);
  },

  onSkip() {
    if (this.data.answered) {
      return;
    }
    const results = this.data.results.slice();
    results[this.data.index] = { status: 'skipped' };
    this.setData({
      results,
      skipped: results.filter((item) => item && item.status === 'skipped').length,
    });
    this.onNext();
  },

  goTo(index) {
    const result = this.data.results[index];
    const skipped = Boolean(result && result.status === 'skipped');
    const answered = Boolean(result) && !skipped;
    this.setData({
      index,
      current: this.data.questions[index],
      answered,
      lastCorrect: answered && result.status === 'correct',
      lastExplanation: answered ? this.data.questions[index].explain || '' : '',
      inputValue: answered && result.userAnswer ? String(result.userAnswer) : '',
      selectedAnswer: answered && result.userAnswer ? String(result.userAnswer) : '',
    });
  },

  finish() {
    const total = this.data.questions.length;
    const results = this.data.results;
    const correct = results.filter((item) => item && item.status === 'correct').length;
    const wrong = results.filter((item) => item && item.status === 'wrong').length;
    const skipped = total - correct - wrong;
    const record = contestService.saveResult(this.data.contestId, { correct, total });

    this.setData({
      phase: 'finished',
      correct,
      wrong,
      skipped,
      best: record.best,
      summaryText: skipped > 0
        ? `共 ${total} 题，答对 ${correct} 题，答错 ${wrong} 题，未作答 ${skipped} 题。`
        : `共 ${total} 题，答对 ${correct} 题，答错 ${wrong} 题。`,
    });
  },

  onRestart() {
    this.start();
  },

  onExit() {
    wx.navigateBack({ delta: 1 });
  },
});
