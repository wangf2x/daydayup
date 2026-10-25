const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function normalizeIdentity(caller) {
  const openid = caller && typeof caller.openid === 'string' && caller.openid ? caller.openid : null;
  const uid = caller && typeof caller.uid === 'string' && caller.uid ? caller.uid : null;
  const anonymous = Boolean(caller && caller.anonymous === true);
  return { openid, uid, anonymous };
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

function createQuestionOcrHandler({ getCaller, ocr }) {
  if (typeof getCaller !== 'function' || !ocr || typeof ocr.recognizeQuestionBatch !== 'function') {
    throw new TypeError('Caller resolver and OCR adapter are required.');
  }

  return async function recognizeQuestion(event) {
    const identity = normalizeIdentity(await getCaller());
    if (!identity.openid && !identity.uid) {
      const error = new Error('Authentication is required.');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    if (identity.anonymous) {
      const error = new Error('Anonymous sessions cannot run billable OCR.');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (!event || event.confirmedSingleQuestion !== true) {
      const error = new Error('Confirm the image contains only one selected question.');
      error.code = 'SINGLE_QUESTION_CONFIRMATION_REQUIRED';
      throw error;
    }

    const imageBytes = decodeBase64Image(event.imageBase64);
    if (!imageBytes) {
      const error = new Error('imageBase64 must contain valid base64 image data.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    if (imageBytes.length > MAX_IMAGE_BYTES) {
      const error = new Error('The question image must be at most 3 MB.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }

    const result = await ocr.recognizeQuestionBatch({
      items: [{
        photoId: event.photoId || 'upload',
        regionId: event.regionId || 'question-1',
        crop: {
          imageBytes,
          isFullPage: false,
          containsOnlySelectedQuestion: true,
          includesUnmarkedQuestionText: false,
        },
      }],
    });

    const recognized = result.results[0] || {};
    return {
      text: recognized.stem || '',
      complete: Boolean(recognized.complete),
      usage: result.usage,
      callerId: identity.uid || identity.openid,
    };
  };
}

module.exports = {
  createQuestionOcrHandler,
  MAX_IMAGE_BYTES,
};
