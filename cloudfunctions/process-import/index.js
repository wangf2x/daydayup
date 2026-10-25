let cloud;
try {
  cloud = require('wx-server-sdk');
} catch (error) {
  throw new Error(
    'CloudBase runtime dependency is missing; install the function dependencies before deployment.',
    { cause: error },
  );
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async function main() {
  const context = cloud.getWXContext();
  if (!context || !context.OPENID) {
    const error = new Error('Authentication is required.');
    error.code = 'UNAUTHENTICATED';
    throw error;
  }

  const error = new Error(
    'Import processing is disabled until authenticated repository, calibrated detector, and selected-question cropper are configured. Tencent QuestionOCR adapter is implemented but not yet wired to this runtime.',
  );
  error.code = 'IMPORT_RUNTIME_NOT_CONFIGURED';
  throw error;
};
