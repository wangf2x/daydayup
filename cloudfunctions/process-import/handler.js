const { processImportBatch } = require('../shared/import-pipeline');

function createProcessImportHandler({
  getCaller,
  repository,
  detector,
  cropper,
  ocr,
  policy,
  now,
}) {
  if (!getCaller || !repository) {
    throw new TypeError('Authenticated caller and repository adapters are required.');
  }

  return async function handle(event) {
    const caller = await getCaller();
    if (!caller || typeof caller.openid !== 'string' || caller.openid.length === 0) {
      const error = new Error('Authentication is required.');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    if (!event || typeof event.batchId !== 'string') {
      const error = new Error('A batch ID is required.');
      error.code = 'INVALID_REQUEST';
      throw error;
    }

    const batch = await repository.getImportBatch(event.batchId);
    if (!batch || !(await repository.canAccessBatch(caller.openid, batch))) {
      const error = new Error('Import batch was not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return processImportBatch({
      batchId: batch.id,
      photos: batch.photos,
      detector,
      cropper,
      ocr,
      repository,
      policy,
      now,
    });
  };
}

module.exports = { createProcessImportHandler };
