const SUBJECTS = [
  { id: 'math', label: '数学', color: '#3b7cff' },
  { id: 'chinese', label: '语文', color: '#16a34a' },
  { id: 'english', label: '英语', color: '#f59e0b' },
  { id: 'other', label: '其他', color: '#8b5cf6' },
];

function subjectLabel(id) {
  const match = SUBJECTS.find((subject) => subject.id === id);
  return match ? match.label : '其他';
}

function subjectColor(id) {
  const match = SUBJECTS.find((subject) => subject.id === id);
  return match ? match.color : '#8b5cf6';
}

let chain = Promise.resolve();

function withLock(task) {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function ensureSignedIn() {
  const app = getApp();
  if (app.globalData.authUserId) {
    return app.globalData.authUserId;
  }
  const user = await app.ensureWechatSession();
  app.globalData.authUserId = user.id;
  return user.id;
}

function describeError(error) {
  if (!error) {
    return '未知错误';
  }
  if (typeof error === 'string') {
    return error;
  }
  const parts = ['code', 'statusCode', 'status', 'error_description', 'message', 'errMsg']
    .map((key) => (error[key] ? `${key}: ${error[key]}` : ''))
    .filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' | ');
  }
  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return String(error);
  }
}

function callCloudFunction(name, data) {
  return withLock(async () => {
    await ensureSignedIn();
    const app = getApp();
    const response = await app.globalData.cloudbase.callFunction({ name, data });
    if (response && response.error) {
      const error = new Error(describeError(response.error));
      error.code = response.error.code;
      throw error;
    }
    const result = response && response.result;
    if (result && result.error) {
      const error = new Error(`${result.error.code}: ${result.error.message}`);
      error.code = result.error.code;
      throw error;
    }
    return result;
  });
}

module.exports = {
  SUBJECTS,
  subjectLabel,
  subjectColor,
  callCloudFunction,
  ensureSignedIn,
  describeError,
};
