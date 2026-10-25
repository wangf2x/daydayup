const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

function createQuestionSplitHandler({ getCaller, split }) {
  if (typeof getCaller !== 'function' || !split || typeof split.splitPage !== 'function') {
    throw new TypeError('Caller resolver and question split adapter are required.');
  }

  return async function splitQuestionPage(event) {
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
    if (!event || event.confirmedFullPage !== true) {
      const error = new Error('Confirm the image is one full page of questions.');
      error.code = 'FULL_PAGE_CONFIRMATION_REQUIRED';
      throw error;
    }

    const imageBytes = decodeBase64Image(event.imageBase64);
    if (!imageBytes) {
      const error = new Error('imageBase64 must contain valid base64 image data.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    if (imageBytes.length > MAX_IMAGE_BYTES) {
      const error = new Error('The page image must be at most 6 MB.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }

    const result = await split.splitPage({
      photoId: typeof event.photoId === 'string' && event.photoId ? event.photoId : 'page',
      imageBytes,
    });

    return {
      page: result.page,
      questions: result.questions.map((question) => ({
        index: question.index,
        stem: question.stem,
        options: question.options,
        subject: question.subject,
        knowledgePoints: question.knowledgePoints,
        rightAnswer: question.rightAnswer,
        answers: question.answers,
        analysis: question.analysis,
        rect: question.rect,
        coordCount: question.coordCount,
        figureCount: question.figureCount,
        tableCount: question.tableCount,
      })),
      usage: result.usage,
      callerId: identity.uid || identity.openid,
    };
  };
}

module.exports = {
  createQuestionSplitHandler,
  MAX_IMAGE_BYTES,
};
