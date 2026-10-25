const { createHash, timingSafeEqual } = require('node:crypto');

const MAX_ITEMS = 2;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_CROP_LABELS = new Set([
  'p29-q2',
  'p30-extra-q2',
]);

function normalizeIdentity(caller) {
  const openid = caller && typeof caller.openid === 'string' && caller.openid ? caller.openid : null;
  const uid = caller && typeof caller.uid === 'string' && caller.uid ? caller.uid : null;
  const anonymous = Boolean(caller && caller.anonymous === true);
  return { openid, uid, anonymous };
}

function toAllowedIdentitySet(allowedIdentities) {
  if (allowedIdentities instanceof Set) {
    return allowedIdentities;
  }
  if (Array.isArray(allowedIdentities)) {
    return new Set(allowedIdentities.filter((value) => typeof value === 'string' && value.length > 0));
  }
  return new Set();
}

function isAllowedIdentity(identity, allowedIdentities) {
  if (identity.openid && allowedIdentities.has(identity.openid)) {
    return true;
  }
  return Boolean(identity.uid && allowedIdentities.has(identity.uid));
}

function decodeBase64Image(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    return null;
  }
  return bytes;
}

function hashesMatch(imageBytes, expectedHex) {
  if (typeof expectedHex !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHex)) {
    return false;
  }
  const actual = createHash('sha256').update(imageBytes).digest();
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createOcrSmokeTestHandler({
  getCaller,
  allowedIdentities,
  consoleToken,
  resolveCropHashes,
  ocr,
}) {
  if (typeof getCaller !== 'function'
    || typeof resolveCropHashes !== 'function'
    || !ocr
    || typeof ocr.recognizeQuestionBatch !== 'function') {
    throw new TypeError('Caller resolver, crop hashes, and OCR adapter are required.');
  }

  const identityAllowlist = toAllowedIdentitySet(allowedIdentities);
  const consoleSecret = typeof consoleToken === 'string' && consoleToken.length > 0 ? consoleToken : null;

  return async function runOcrSmokeTest(event) {
    const identity = normalizeIdentity(await getCaller());
    const authenticated = Boolean(identity.openid || identity.uid);
    const callerIsAllowed = isAllowedIdentity(identity, identityAllowlist);
    const consoleAllowed = Boolean(consoleSecret)
      && Boolean(event)
      && event.consoleToken === consoleSecret;
    const bootstrapWhoami = Boolean(event)
      && event.action === 'whoami'
      && identityAllowlist.size === 0
      && authenticated;

    if (!callerIsAllowed && !consoleAllowed && !bootstrapWhoami) {
      const error = new Error(
        identity.anonymous
          ? 'Anonymous CloudBase sessions cannot run billable OCR.'
          : authenticated
            ? 'This OCR smoke test is restricted to its configured owner.'
            : 'Authentication is required.',
      );
      error.code = authenticated ? 'FORBIDDEN' : 'UNAUTHENTICATED';
      throw error;
    }

    if (event.action === 'whoami') {
      if (consoleAllowed) {
        const error = new Error('Identity discovery requires a Mini Program caller.');
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      return { identity: { openid: identity.openid, uid: identity.uid } };
    }

    if (!event || event.confirmBillableOcr !== true) {
      const error = new Error('Explicit billable OCR confirmation is required.');
      error.code = 'BILLABLE_OCR_CONFIRMATION_REQUIRED';
      throw error;
    }
    if (!Array.isArray(event.items) || event.items.length < 1 || event.items.length > MAX_ITEMS) {
      const error = new Error(`Submit between 1 and ${MAX_ITEMS} confirmed selected question crops.`);
      error.code = 'INVALID_REQUEST';
      throw error;
    }

    const expectedCropHashes = resolveCropHashes();
    const items = event.items.map((item, index) => {
      if (!item || typeof item.cropLabel !== 'string' || !ALLOWED_CROP_LABELS.has(item.cropLabel)) {
        const error = new Error(`items[${index}] must use an allowed crop label.`);
        error.code = 'INVALID_REQUEST';
        throw error;
      }

      const imageBytes = decodeBase64Image(item.imageBase64);
      if (!imageBytes) {
        const error = new Error(`items[${index}].imageBase64 must contain valid base64 image data.`);
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      if (imageBytes.length > MAX_IMAGE_BYTES) {
        const error = new Error(`items[${index}] exceeds the 3 MB crop limit.`);
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      if (!hashesMatch(imageBytes, expectedCropHashes[item.cropLabel])) {
        const error = new Error(`items[${index}] does not match the approved crop for ${item.cropLabel}.`);
        error.code = 'CROP_NOT_APPROVED';
        throw error;
      }

      return {
        photoId: item.cropLabel,
        regionId: item.cropLabel,
        crop: {
          imageBytes,
          isFullPage: false,
          containsOnlySelectedQuestion: true,
          includesUnmarkedQuestionText: false,
        },
      };
    });

    const result = await ocr.recognizeQuestionBatch({ items });
    return {
      results: result.results.map((item) => ({
        cropLabel: item.photoId,
        text: item.stem,
        complete: item.complete,
      })),
      usage: result.usage,
    };
  };
}

module.exports = { createOcrSmokeTestHandler };
