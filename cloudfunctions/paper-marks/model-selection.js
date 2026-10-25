// 单题模式只送一块放大后的题号带，模型可以慢慢看；整页模式必须快，超过 15 秒就会撞小程序调用窗口。
const SINGLE_MODE_DEFAULT_MODEL = 'hunyuan-t1-vision-20250916';
const PAGE_MODE_DEFAULT_MODEL = 'hy-vision-2.0-instruct';

function resolveMarkModel({ mode, requestedModel, environment = {} } = {}) {
  const requested = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (requested) {
    return requested;
  }
  if (mode === 'single') {
    return environment.TOKENHUB_MODEL_SINGLE || SINGLE_MODE_DEFAULT_MODEL;
  }
  return environment.TOKENHUB_MODEL || PAGE_MODE_DEFAULT_MODEL;
}

module.exports = {
  SINGLE_MODE_DEFAULT_MODEL,
  PAGE_MODE_DEFAULT_MODEL,
  resolveMarkModel,
};
