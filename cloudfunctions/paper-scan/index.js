console.log('[paper-scan] boot start', process.version);

const sharp = require('sharp');
const { createPaperScanHandler } = require('./handler');
const { createTencentQuestionSplitFromEnvironment } = require('./process-import/tencent-question-split');
const { createTokenHubVisionFromEnvironment } = require('./tokenhub-vision');
const { SINGLE_MARK_PROMPT } = require('./single-prompt');

let splitter;
function getSplitter() {
  if (!splitter) {
    splitter = createTencentQuestionSplitFromEnvironment();
  }
  return splitter;
}

let vision;
function getVision() {
  if (!vision) {
    vision = createTokenHubVisionFromEnvironment();
  }
  return vision;
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
    const handler = createPaperScanHandler({
      getCaller: async () => readCallerIdentity(),
      sharp,
      split: {
        splitPage(request) {
          return getSplitter().splitPage(request);
        },
      },
      vision: {
        detectMarks(request) {
          return getVision().detectMarks({
            ...request,
            model: event && event.model,
            promptText: request.promptText || SINGLE_MARK_PROMPT,
          });
        },
      },
    });
    return await handler(event);
  } catch (error) {
    console.error('[paper-scan] failed', (error && error.code) || '', (error && error.message) || error);
    return {
      error: {
        code: (error && error.code) || 'INTERNAL_ERROR',
        message: (error && error.message) || String(error),
      },
    };
  }
};
