const https = require('node:https');
const { SYSTEM_PROMPT } = require('./handler');

const DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1/chat/completions';
const DEFAULT_MODEL = 'hy-vision-2.0-instruct';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;

function toDataUrl(imageBytes, mimeType) {
  if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
    throw new TypeError('A page image must contain image bytes.');
  }
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    throw new RangeError('A page image must be between 1 byte and 6 MB.');
  }
  return `data:${mimeType || 'image/jpeg'};base64,${Buffer.from(imageBytes).toString('base64')}`;
}

function buildRequestBody({ model, imageBytes, mimeType, promptText }) {
  return {
    model,
    stream: false,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText || SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: toDataUrl(imageBytes, mimeType) } },
        ],
      },
    ],
  };
}

function httpPostJson({ url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const target = new URL(url);
    const request = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (error) {
            parsed = null;
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            const failure = new Error(
              `TokenHub request failed with status ${response.statusCode}: ${text.slice(0, 300)}`,
            );
            failure.code = 'VISION_REQUEST_FAILED';
            failure.statusCode = response.statusCode;
            failure.body = parsed;
            reject(failure);
            return;
          }
          if (!parsed) {
            const failure = new Error('TokenHub returned a non-JSON response.');
            failure.code = 'VISION_RESPONSE_INVALID';
            reject(failure);
            return;
          }
          resolve(parsed);
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      const failure = new Error('TokenHub request timed out.');
      failure.code = 'VISION_TIMEOUT';
      reject(failure);
    });
    request.on('error', (error) => {
      const failure = new Error(`TokenHub request error: ${error && error.message}`);
      failure.code = 'VISION_REQUEST_FAILED';
      failure.cause = error;
      reject(failure);
    });
    request.write(payload);
    request.end();
  });
}

function extractContent(response) {
  const choice = response && Array.isArray(response.choices) ? response.choices[0] : null;
  const message = choice && choice.message ? choice.message : null;
  if (!message) {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function createTokenHubVision({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  request = httpPostJson,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    const error = new Error('TOKENHUB_API_KEY is required for the TokenHub vision provider.');
    error.code = 'VISION_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  if (typeof request !== 'function') {
    throw new TypeError('A request function is required.');
  }

  return {
    provider: 'tokenhub',
    model,
    async detectMarks({ imageBytes, mimeType, model: overrideModel, promptText }) {
      const usedModel = typeof overrideModel === 'string' && overrideModel.length > 0
        ? overrideModel
        : model;
      const response = await request({
        url: baseUrl,
        headers: { authorization: `Bearer ${apiKey}` },
        body: buildRequestBody({ model: usedModel, imageBytes, mimeType, promptText }),
        timeoutMs,
      });

      return {
        text: extractContent(response),
        provider: 'tokenhub',
        model: usedModel,
        usage: response && response.usage ? response.usage : null,
      };
    },
  };
}

function createTokenHubVisionFromEnvironment(environment = process.env) {
  const apiKey = environment.TOKENHUB_API_KEY;
  if (!apiKey) {
    const error = new Error('TOKENHUB_API_KEY is required in the function environment.');
    error.code = 'VISION_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return createTokenHubVision({
    apiKey,
    baseUrl: environment.TOKENHUB_BASE_URL || DEFAULT_BASE_URL,
    model: environment.TOKENHUB_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(environment.TOKENHUB_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  });
}

module.exports = {
  createTokenHubVision,
  createTokenHubVisionFromEnvironment,
  buildRequestBody,
  extractContent,
  toDataUrl,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
};
