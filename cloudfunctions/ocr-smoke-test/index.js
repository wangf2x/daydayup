console.log('[ocr-smoke-test] boot start', process.version);

let cloud;
try {
  cloud = require('wx-server-sdk');
} catch (error) {
  console.error('[ocr-smoke-test] wx-server-sdk load failed', error && error.message);
  throw new Error(
    'CloudBase runtime dependency is missing; install function dependencies before deployment.',
    { cause: error },
  );
}

const { createTencentQuestionOcrFromEnvironment } = require('./process-import/tencent-question-ocr');
const { createOcrSmokeTestHandler } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
console.log('[ocr-smoke-test] boot ready');

let ocr;
function getOcr() {
  if (!ocr) {
    ocr = createTencentQuestionOcrFromEnvironment();
  }
  return ocr;
}

function getConfiguredIdentities() {
  return [process.env.OCR_TEST_ALLOWED_IDENTITIES, process.env.OCR_TEST_ALLOWED_OPENID]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(',')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveCropHashes() {
  const configured = process.env.OCR_TEST_ALLOWED_CROP_SHA256;
  if (!configured) {
    const error = new Error('OCR_TEST_ALLOWED_CROP_SHA256 must contain the approved crop hashes.');
    error.code = 'OCR_TEST_NOT_CONFIGURED';
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(configured);
  } catch (cause) {
    const error = new Error(
      'OCR_TEST_ALLOWED_CROP_SHA256 must be a JSON object of crop labels to SHA-256 hashes.',
      { cause },
    );
    error.code = 'OCR_TEST_NOT_CONFIGURED';
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('OCR_TEST_ALLOWED_CROP_SHA256 must be a JSON object of crop labels to SHA-256 hashes.');
    error.code = 'OCR_TEST_NOT_CONFIGURED';
    throw error;
  }
  return parsed;
}

function toClientError(error) {
  return {
    code: (error && error.code) || 'INTERNAL_ERROR',
    message: (error && error.message) || String(error),
  };
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

function describeContext() {
  const identity = readCallerIdentity();
  return {
    contextKeys: String(process.env.TCB_CONTEXT_KEYS || process.env.WX_CONTEXT_KEYS || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean),
    identity,
  };
}

exports.main = async function main(event) {
  console.log('[ocr-smoke-test] invoke', JSON.stringify({
    action: event && event.action,
    confirmBillableOcr: event && event.confirmBillableOcr === true,
    itemCount: Array.isArray(event && event.items) ? event.items.length : 0,
  }));

  try {
    const consoleToken = process.env.OCR_TEST_CONSOLE_TOKEN;
    if (event && event.action === 'diagnostics') {
      if (!consoleToken || event.consoleToken !== consoleToken) {
        return { error: { code: 'UNAUTHENTICATED', message: 'Console token is required for diagnostics.' } };
      }
      return describeContext();
    }

    const handler = createOcrSmokeTestHandler({
      getCaller: async () => readCallerIdentity(),
      allowedIdentities: getConfiguredIdentities(),
      consoleToken,
      resolveCropHashes,
      ocr: {
        recognizeQuestionBatch(request) {
          return getOcr().recognizeQuestionBatch(request);
        },
      },
    });
    return await handler(event);
  } catch (error) {
    console.error('[ocr-smoke-test] failed', (error && error.code) || '', (error && error.message) || error);
    if (error && error.stack) {
      console.error(String(error.stack).split('\n').slice(0, 8).join('\n'));
    }
    return { error: toClientError(error) };
  }
};
