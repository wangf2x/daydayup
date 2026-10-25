console.log('[question-ocr] boot start', process.version);

const { createTencentQuestionOcrFromEnvironment } = require('./process-import/tencent-question-ocr');
const { createQuestionOcrHandler } = require('./handler');

let ocr;
function getOcr() {
  if (!ocr) {
    ocr = createTencentQuestionOcrFromEnvironment();
  }
  return ocr;
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
    const handler = createQuestionOcrHandler({
      getCaller: async () => readCallerIdentity(),
      ocr: {
        recognizeQuestionBatch(request) {
          return getOcr().recognizeQuestionBatch(request);
        },
      },
    });
    return await handler(event);
  } catch (error) {
    console.error('[question-ocr] failed', (error && error.code) || '', (error && error.message) || error);
    return {
      error: {
        code: (error && error.code) || 'INTERNAL_ERROR',
        message: (error && error.message) || String(error),
      },
    };
  }
};
