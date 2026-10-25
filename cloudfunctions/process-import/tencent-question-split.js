const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MIN_INTERVAL_MS = 550;

const CORNERS = ['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'];

function toBase64(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
    throw new TypeError('A full page must contain PNG/JPEG image bytes.');
  }
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    throw new RangeError('A page image must be between 1 byte and 10 MB.');
  }
  return Buffer.from(imageBytes).toString('base64');
}

function normalizePolygons(coord) {
  if (!Array.isArray(coord)) {
    return [];
  }
  return coord
    .map((polygon) => {
      if (!polygon || typeof polygon !== 'object') {
        return null;
      }
      const points = CORNERS
        .map((corner) => polygon[corner])
        .filter((point) => point && Number.isFinite(point.X) && Number.isFinite(point.Y));
      if (points.length < 4) {
        return null;
      }
      const xs = points.map((point) => point.X);
      const ys = points.map((point) => point.Y);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    })
    .filter(Boolean);
}

function boundingRect(boxes) {
  if (boxes.length === 0) {
    return null;
  }
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

function toRelativeRect(rect, width, height) {
  if (!rect || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Number((rect.left / width).toFixed(4)),
    y: Number((rect.top / height).toFixed(4)),
    w: Number(((rect.right - rect.left) / width).toFixed(4)),
    h: Number(((rect.bottom - rect.top) / height).toFixed(4)),
  };
}

function elementTexts(elements) {
  if (!Array.isArray(elements)) {
    return [];
  }
  return elements
    .map((element) => (element && typeof element.Text === 'string' ? element.Text.trim() : ''))
    .filter(Boolean);
}

function answerElements(elements) {
  if (!Array.isArray(elements)) {
    return [];
  }
  return elements.map((element) => {
    const answer = element && element.AnswerElement;
    return {
      text: element && typeof element.Text === 'string' ? element.Text.trim() : '',
      isCorrect: answer && typeof answer.IsCorrect === 'boolean' ? answer.IsCorrect : null,
      analysis: answer && typeof answer.AnswerAnalysis === 'string' ? answer.AnswerAnalysis : '',
      rightAnswer: answer && typeof answer.RightAnswer === 'string' ? answer.RightAnswer : '',
    };
  });
}

function mapSplitResponse(response, { photoId }) {
  const pages = response && Array.isArray(response.QuestionInfo) ? response.QuestionInfo : [];
  const questions = [];
  let width = 0;
  let height = 0;

  for (const page of pages) {
    if (!page || typeof page !== 'object') {
      continue;
    }
    const pageWidth = Number.isFinite(page.Width) && page.Width > 0 ? page.Width : page.OrgWidth;
    const pageHeight = Number.isFinite(page.Height) && page.Height > 0 ? page.Height : page.OrgHeight;
    if (!width && Number.isFinite(pageWidth)) {
      width = pageWidth;
    }
    if (!height && Number.isFinite(pageHeight)) {
      height = pageHeight;
    }

    const resultLists = Array.isArray(page.ResultList) ? page.ResultList : [];
    resultLists.forEach((result, position) => {
      if (!result || typeof result !== 'object') {
        return;
      }
      const coordBoxes = normalizePolygons(result.Coord);
      const answers = answerElements(result.Answer);
      const analysis = answerElements(result.Parse);
      const stem = elementTexts(result.Question).join('\n').trim();
      const options = elementTexts(result.Option);

      questions.push({
        index: position,
        photoId,
        stem,
        options,
        subject: typeof result.Subject === 'string' ? result.Subject : '',
        knowledgePoints: Array.isArray(result.KnowledgePoints) ? result.KnowledgePoints : [],
        rightAnswer: typeof result.RightAnswer === 'string' ? result.RightAnswer : '',
        answers,
        analysis,
        coordCount: coordBoxes.length,
        figureCount: Array.isArray(result.Figure) ? result.Figure.length : 0,
        tableCount: Array.isArray(result.Table) ? result.Table.length : 0,
        rect: toRelativeRect(boundingRect(coordBoxes), width, height),
      });
    });
  }

  return {
    page: { width, height },
    questions,
    usage: {
      provider: 'tencent-QuestionSplitOCR',
      requestCount: 1,
      imageCount: 1,
    },
  };
}

function createTencentQuestionSplit({
  client,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = Date.now,
}) {
  if (!client || typeof client.QuestionSplitOCR !== 'function') {
    throw new TypeError('A Tencent QuestionSplitOCR client is required.');
  }

  let lastRequestAt = null;

  return {
    async splitPage({ photoId, imageBytes }) {
      if (lastRequestAt !== null) {
        const remaining = minIntervalMs - (now() - lastRequestAt);
        if (remaining > 0) {
          await wait(remaining);
        }
      }
      const response = await client.QuestionSplitOCR({
        ImageBase64: toBase64(imageBytes),
        IsPdf: false,
      });
      lastRequestAt = now();
      return mapSplitResponse(response, { photoId });
    },
  };
}

function createTencentQuestionSplitFromEnvironment(environment = process.env) {
  const secretId = environment.OCR_TENCENT_SECRET_ID || environment.TENCENTCLOUD_SECRET_ID;
  const secretKey = environment.OCR_TENCENT_SECRET_KEY || environment.TENCENTCLOUD_SECRET_KEY;
  const region = environment.OCR_TENCENT_REGION || environment.TENCENTCLOUD_REGION;
  if (!secretId || !secretKey || !region) {
    const error = new Error(
      'OCR_TENCENT_SECRET_ID, OCR_TENCENT_SECRET_KEY, and OCR_TENCENT_REGION are required in the function environment.',
    );
    error.code = 'OCR_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const { ocr } = require('tencentcloud-sdk-nodejs-ocr');
  const client = new ocr.v20181119.Client({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com' } },
  });
  return createTencentQuestionSplit({ client });
}

module.exports = {
  createTencentQuestionSplit,
  createTencentQuestionSplitFromEnvironment,
  mapSplitResponse,
  MAX_IMAGE_BYTES,
};
