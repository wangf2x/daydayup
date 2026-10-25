const { SYSTEM_PROMPT } = require('./handler');

const DEFAULT_MODEL = 'hunyuan-vision';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function toDataUrl(imageBytes, mimeType) {
  if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
    throw new TypeError('A page image must contain image bytes.');
  }
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    throw new RangeError('A page image must be between 1 byte and 6 MB.');
  }
  return `data:${mimeType || 'image/jpeg'};base64,${Buffer.from(imageBytes).toString('base64')}`;
}

function extractText(response) {
  const choice = response && Array.isArray(response.Choices) ? response.Choices[0] : null;
  const message = choice && choice.Message ? choice.Message : null;
  if (!message) {
    return '';
  }
  if (typeof message.Content === 'string' && message.Content.length > 0) {
    return message.Content;
  }
  if (Array.isArray(message.Contents)) {
    return message.Contents
      .map((part) => (part && typeof part.Text === 'string' ? part.Text : ''))
      .join('')
      .trim();
  }
  return '';
}

function createHunyuanVision({ client, model = DEFAULT_MODEL }) {
  if (!client || typeof client.ChatCompletions !== 'function') {
    throw new TypeError('A Tencent Hunyuan ChatCompletions client is required.');
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new TypeError('A Hunyuan vision model name is required.');
  }

  return {
    provider: 'hunyuan',
    model,
    async detectMarks({ imageBytes, mimeType, promptText }) {
      const response = await client.ChatCompletions({
        Model: model,
        Stream: false,
        Temperature: 0,
        Messages: [
          {
            Role: 'user',
            Contents: [
              { Type: 'text', Text: promptText || SYSTEM_PROMPT },
              { Type: 'image_url', ImageUrl: { Url: toDataUrl(imageBytes, mimeType) } },
            ],
          },
        ],
      });

      return {
        text: extractText(response),
        provider: 'hunyuan',
        model,
        usage: response && response.Usage ? response.Usage : null,
      };
    },
  };
}

function createHunyuanVisionFromEnvironment(environment = process.env) {
  const secretId = environment.HUNYUAN_SECRET_ID
    || environment.OCR_TENCENT_SECRET_ID
    || environment.TENCENTCLOUD_SECRET_ID;
  const secretKey = environment.HUNYUAN_SECRET_KEY
    || environment.OCR_TENCENT_SECRET_KEY
    || environment.TENCENTCLOUD_SECRET_KEY;
  const region = environment.HUNYUAN_REGION || environment.OCR_TENCENT_REGION || 'ap-guangzhou';
  const model = environment.HUNYUAN_MODEL || DEFAULT_MODEL;

  if (!secretId || !secretKey) {
    const error = new Error('HUNYUAN_SECRET_ID and HUNYUAN_SECRET_KEY are required in the function environment.');
    error.code = 'VISION_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const { hunyuan } = require('tencentcloud-sdk-nodejs-hunyuan');
  const client = new hunyuan.v20230901.Client({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'hunyuan.tencentcloudapi.com' } },
  });
  return createHunyuanVision({ client, model });
}

module.exports = {
  createHunyuanVision,
  createHunyuanVisionFromEnvironment,
  extractText,
  toDataUrl,
  DEFAULT_MODEL,
};
