const test = require('node:test');
const assert = require('node:assert/strict');

const selection = require('../cloudfunctions/paper-marks/model-selection');

test('single mode uses the slower, more accurate vision model by default', () => {
  assert.equal(selection.resolveMarkModel({ mode: 'single' }), selection.SINGLE_MODE_DEFAULT_MODEL);
  assert.equal(selection.SINGLE_MODE_DEFAULT_MODEL, 'hunyuan-t1-vision-20250916');
});

test('page mode keeps the fast model so the call stays inside the mini program window', () => {
  assert.equal(selection.resolveMarkModel({ mode: 'page' }), selection.PAGE_MODE_DEFAULT_MODEL);
  assert.equal(selection.resolveMarkModel({}), selection.PAGE_MODE_DEFAULT_MODEL);
  assert.equal(selection.PAGE_MODE_DEFAULT_MODEL, 'hy-vision-2.0-instruct');
});

test('environment overrides apply per mode', () => {
  assert.equal(
    selection.resolveMarkModel({ mode: 'single', environment: { TOKENHUB_MODEL_SINGLE: 'custom-single' } }),
    'custom-single',
  );
  assert.equal(
    selection.resolveMarkModel({ mode: 'page', environment: { TOKENHUB_MODEL: 'custom-page' } }),
    'custom-page',
  );
  // TOKENHUB_MODEL no longer leaks into single mode.
  assert.equal(
    selection.resolveMarkModel({ mode: 'single', environment: { TOKENHUB_MODEL: 'custom-page' } }),
    selection.SINGLE_MODE_DEFAULT_MODEL,
  );
});

test('an explicit per-call model wins over every default', () => {
  assert.equal(
    selection.resolveMarkModel({
      mode: 'single',
      requestedModel: '  deepseek/deepseek-flash  ',
      environment: { TOKENHUB_MODEL_SINGLE: 'custom-single' },
    }),
    'deepseek/deepseek-flash',
  );
  assert.equal(selection.resolveMarkModel({ mode: 'page', requestedModel: '' }), selection.PAGE_MODE_DEFAULT_MODEL);
});
