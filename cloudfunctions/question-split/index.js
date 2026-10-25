console.log('[question-split] boot start', process.version);

const { createTencentQuestionSplitFromEnvironment } = require('./process-import/tencent-question-split');
const { createQuestionSplitHandler } = require('./handler');

let splitter;
function getSplitter() {
  if (!splitter) {
    splitter = createTencentQuestionSplitFromEnvironment();
  }
  return splitter;
}

function readCallerIdentity() {
  const contextKeys = String(process.env.TCB_CONTEXT_KEYS || process.env.WX_CONTEXT_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const pick = (key) => {
    if (contextKeys.length > 0 && !contextKeys.includes(key)) {
      return null;
    }
    const value = process.env[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    openid: pick('WX_OPENID'),
    uid: pick('TCB_UUID'),
    anonymous: pick('TCB_ISANONYMOUS_USER') === 'true',
  };
}

exports.main = async function main(event) {
  try {
    const handler = createQuestionSplitHandler({
      getCaller: async () => readCallerIdentity(),
      split: {
        splitPage(request) {
          return getSplitter().splitPage(request);
        },
      },
    });
    return await handler(event);
  } catch (error) {
    console.error('[question-split] failed', (error && error.code) || '', (error && error.message) || error);
    return {
      error: {
        code: (error && error.code) || 'INTERNAL_ERROR',
        message: (error && error.message) || String(error),
      },
    };
  }
};
