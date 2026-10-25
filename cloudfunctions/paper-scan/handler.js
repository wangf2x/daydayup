const { createHash } = require('node:crypto');

const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const BAND_MIN_HEIGHT = 90;
const BAND_MAX_HEIGHT = 170;
const UPSCALE = 2.5;
const CROP_QUALITY = 92;

function normalizeIdentity(caller) {
  const openid = caller && typeof caller.openid === 'string' && caller.openid ? caller.openid : null;
  const uid = caller && typeof caller.uid === 'string' && caller.uid ? caller.uid : null;
  const anonymous = Boolean(caller && caller.anonymous === true);
  return { openid, uid, anonymous };
}

function decodeBase64Image(value, maxBytes = MAX_PAGE_BYTES) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value || bytes.length > maxBytes) {
    return null;
  }
  return bytes;
}

function clampRect(rect) {
  if (!rect || typeof rect !== 'object') {
    return null;
  }
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) {
    return null;
  }
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1), w: Math.min(Math.max(w, 0.01), 1), h: Math.min(Math.max(h, 0.01), 1) };
}

// 题号通常位于题目区域左上角，这里只裁「题号带」，避免把整题题干送进模型。
function computeQuestionBand(rect, page) {
  const pageWidth = page && Number.isFinite(page.width) ? page.width : 0;
  const pageHeight = page && Number.isFinite(page.height) ? page.height : 0;
  if (pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }
  const left = Math.max(0, Math.round(rect.x * pageWidth) - 8);
  const top = Math.max(0, Math.round(rect.y * pageHeight) - 6);
  const right = Math.min(pageWidth, Math.round((rect.x + rect.w) * pageWidth) + 8);
  const bandHeight = Math.round(rect.h * pageHeight);
  const height = Math.min(pageHeight - top, Math.max(BAND_MIN_HEIGHT, Math.min(bandHeight, BAND_MAX_HEIGHT)));
  const width = right - left;
  if (width < 20 || height < 20) {
    return null;
  }
  return { left, top, width, height };
}

function createPaperScanHandler({ getCaller, split, vision, sharp, maxPageBytes = MAX_PAGE_BYTES }) {
  if (typeof getCaller !== 'function' || !split || typeof split.splitPage !== 'function'
    || !vision || typeof vision.detectMarks !== 'function' || typeof sharp !== 'function') {
    throw new TypeError('Caller resolver, split adapter, vision adapter, and sharp are required.');
  }

  const requireCaller = async () => {
    const identity = normalizeIdentity(await getCaller());
    if (!identity.openid && !identity.uid) {
      const error = new Error('Authentication is required.');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    if (identity.anonymous) {
      const error = new Error('Anonymous sessions cannot run billable models.');
      error.code = 'FORBIDDEN';
      throw error;
    }
    return identity;
  };

  async function cropBand(imageBytes, band) {
    const buffer = await sharp(imageBytes)
      .extract({ left: band.left, top: band.top, width: band.width, height: band.height })
      .resize({ width: Math.round(band.width * UPSCALE) })
      .jpeg({ quality: CROP_QUALITY })
      .toBuffer();
    return buffer;
  }

  return async function scan(event) {
    const identity = await requireCaller();
    const imageBytes = decodeBase64Image(event && event.imageBase64, maxPageBytes);
    if (!imageBytes) {
      const error = new Error('imageBase64 must contain valid base64 page image data.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const pageId = createHash('sha256').update(imageBytes).digest('hex').slice(0, 16);

    if (event.action === 'mark') {
      const rect = clampRect(event.rect);
      if (!rect) {
        const error = new Error('rect with x/y/w/h is required for mark mode.');
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const page = event.page && Number.isFinite(event.page.width) ? event.page : null;
      if (!page) {
        const error = new Error('page width/height are required for mark mode.');
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const band = computeQuestionBand(rect, page);
      if (!band) {
        const error = new Error('The question band cannot be located from the given rect.');
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const cropped = await cropBand(imageBytes, band);
      const result = await vision.detectMarks({
        imageBytes: cropped,
        mimeType: 'image/jpeg',
        promptText: event.promptText,
      });
      return {
        mode: 'mark',
        pageId,
        band,
        questionNo: typeof event.questionNo === 'string' ? event.questionNo : '',
        text: result.text,
        provider: result.provider,
        model: result.model,
        usage: result.usage || null,
        callerId: identity.uid || identity.openid,
      };
    }

    const splitResult = await split.splitPage({ photoId: pageId, imageBytes });
    return {
      mode: 'plan',
      pageId,
      page: splitResult.page,
      usage: splitResult.usage || null,
      questions: splitResult.questions.map((question) => ({
        index: question.index,
        stem: question.stem,
        rect: question.rect,
        band: question.rect ? computeQuestionBand(question.rect, splitResult.page) : null,
        subject: question.subject,
        figureCount: question.figureCount,
      })),
      callerId: identity.uid || identity.openid,
    };
  };
}

module.exports = {
  createPaperScanHandler,
  computeQuestionBand,
  clampRect,
  decodeBase64Image,
  MAX_PAGE_BYTES,
};
