console.log('[paper-marks] boot start', process.version);

const { createPaperMarksHandler } = require('./handler');
const { resolveMarkModel } = require('./model-selection');

function createMockVision() {
  return {
    provider: 'mock',
    model: 'mock-vision',
    async detectMarks() {
      return {
        text: '{"questions":[]}',
        provider: 'mock',
        model: 'mock-vision',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function resolveProvider(environment = process.env) {
  const configured = String(environment.MARK_PROVIDER || '').toLowerCase();
  if (configured === 'mock' || configured === 'hunyuan' || configured === 'tokenhub') {
    return configured;
  }
  if (environment.TOKENHUB_API_KEY) {
    return 'tokenhub';
  }
  if (environment.HUNYUAN_SECRET_ID || environment.OCR_TENCENT_SECRET_ID) {
    return 'hunyuan';
  }
  return '';
}

let vision;
function getVision() {
  if (vision) {
    return vision;
  }
  const provider = resolveProvider();
  if (provider === 'mock') {
    vision = createMockVision();
  } else if (provider === 'tokenhub') {
    const { createTokenHubVisionFromEnvironment } = require('./tokenhub-vision');
    vision = createTokenHubVisionFromEnvironment();
  } else if (provider === 'hunyuan') {
    const { createHunyuanVisionFromEnvironment } = require('./hunyuan-vision');
    vision = createHunyuanVisionFromEnvironment();
  } else {
    const error = new Error(
      'No vision provider configured. Set TOKENHUB_API_KEY (MARK_PROVIDER=tokenhub) or HUNYUAN_SECRET_ID/HUNYUAN_SECRET_KEY.',
    );
    error.code = 'VISION_PROVIDER_NOT_CONFIGURED';
    throw error;
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
    const requestedModel = event && typeof event.model === 'string' && event.model ? event.model : undefined;
    const model = resolveMarkModel({
      mode: event && event.mode === 'single' ? 'single' : 'page',
      requestedModel,
      environment: process.env,
    });
    const handler = createPaperMarksHandler({
      getCaller: async () => readCallerIdentity(),
      vision: {
        detectMarks(request) {
          return getVision().detectMarks({ ...request, model });
        },
      },
    });
    return await handler(event);
  } catch (error) {
    console.error('[paper-marks] failed', (error && error.code) || '', (error && error.message) || error);
    return {
      error: {
        code: (error && error.code) || 'INTERNAL_ERROR',
        message: (error && error.message) || String(error),
      },
    };
  }
};
