const { processImportBatch } = require('../cloudfunctions/shared/import-pipeline');
const { createMockAdapters } = require('../cloudfunctions/shared/mock-adapters');

async function main() {
  const adapters = createMockAdapters({
    detections: [{
      photoId: 'demo-photo',
      regionId: 'demo-question',
      markTypes: ['unfamiliar', 'careless'],
      markConfidence: 0.99,
      boundaryConfidence: 0.98,
    }],
    ocrResults: [{
      photoId: 'demo-photo',
      regionId: 'demo-question',
      stem: '演示题目：计算 6 ÷ 2。',
      parts: [{ prompt: '商是多少？', options: [] }],
      figures: [],
      complete: true,
      subject: '数学',
      subjectConfidence: 0.98,
      knowledgeCandidates: ['除法'],
    }],
  });
  const archived = [];
  const repository = {
    async setPhotoStatus() {},
    async setRegionStatus() {},
    async saveRecognizedDraft() {},
    async archiveQuestion(question) {
      archived.push(question);
    },
    async setPhotoRetention() {},
  };

  const result = await processImportBatch({
    batchId: 'demo-batch',
    photos: [{
      id: 'demo-photo',
      category: 'study',
      learnerId: 'demo-learner',
      uploadedAt: '2026-10-24T00:00:00.000Z',
      storageRef: 'mock://never-uploaded',
    }],
    ...adapters,
    repository,
    policy: {
      calibrated: true,
      minimumMarkConfidence: 0.9,
      minimumBoundaryConfidence: 0.9,
      minimumSubjectConfidence: 0.9,
    },
  });

  console.log(JSON.stringify({
    note: 'Mock-only flow; no image was uploaded and no external OCR was called.',
    result,
    archivedQuestion: archived[0],
    mockCalls: adapters.calls,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
