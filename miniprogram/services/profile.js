const PROFILE_KEY = 'daydayup.profile.v1';

function readProfile() {
  try {
    const raw = wx.getStorageSync(PROFILE_KEY);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.learners)) {
      return { learners: [], activeLearnerId: '' };
    }
    return raw;
  } catch (error) {
    console.warn('[profile] read failed', error);
    return { learners: [], activeLearnerId: '' };
  }
}

function writeProfile(profile) {
  wx.setStorageSync(PROFILE_KEY, profile);
  return profile;
}

function createLearnerId(userId) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `learner-${userId || 'local'}-${Date.now()}-${suffix}`;
}

function ensureDefaultLearner(userId, nickname) {
  const profile = readProfile();
  if (profile.learners.length > 0) {
    if (!profile.activeLearnerId) {
      profile.activeLearnerId = profile.learners[0].id;
      writeProfile(profile);
    }
    return profile;
  }

  const learner = {
    id: createLearnerId(userId),
    nickname: nickname || '小朋友',
    createdAt: new Date().toISOString(),
  };
  const next = {
    learners: [learner],
    activeLearnerId: learner.id,
  };
  writeProfile(next);
  return next;
}

function getActiveLearner() {
  const profile = readProfile();
  if (profile.learners.length === 0) {
    return null;
  }
  return profile.learners.find((learner) => learner.id === profile.activeLearnerId)
    || profile.learners[0];
}

function setActiveLearner(learnerId) {
  const profile = readProfile();
  if (!profile.learners.some((learner) => learner.id === learnerId)) {
    throw new Error('孩子档案不存在。');
  }
  profile.activeLearnerId = learnerId;
  writeProfile(profile);
  return profile;
}

function addLearner(nickname) {
  const name = typeof nickname === 'string' ? nickname.trim() : '';
  if (!name) {
    throw new Error('请填写孩子昵称。');
  }
  if (name.length > 20) {
    throw new Error('孩子昵称最多 20 个字。');
  }
  const profile = readProfile();
  if (profile.learners.length >= 3) {
    throw new Error('最多支持 3 个孩子档案。');
  }
  const learner = {
    id: createLearnerId('child'),
    nickname: name,
    createdAt: new Date().toISOString(),
  };
  const next = {
    learners: [...profile.learners, learner],
    activeLearnerId: profile.activeLearnerId || learner.id,
  };
  writeProfile(next);
  return learner;
}

module.exports = {
  readProfile,
  writeProfile,
  ensureDefaultLearner,
  getActiveLearner,
  setActiveLearner,
  addLearner,
};
