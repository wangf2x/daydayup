function createMockAdapters({ detections = [], ocrResults = [] } = {}) {
  const calls = {
    detector: 0,
    cropper: 0,
    ocrRequests: 0,
    ocrQuestionItems: 0,
  };

  return {
    calls,
    detector: {
      async detectMarkedRegions() {
        calls.detector += 1;
        return detections;
      },
    },
    cropper: {
      async cropMarkedQuestion({ region }) {
        calls.cropper += 1;
        return {
          photoId: region.photoId,
          regionId: region.regionId,
          containsOnlySelectedQuestion: true,
          includesUnmarkedQuestionText: false,
          isFullPage: false,
          mock: true,
        };
      },
    },
    ocr: {
      async recognizeQuestionBatch({ items }) {
        calls.ocrRequests += 1;
        calls.ocrQuestionItems += items.length;
        const requested = new Set(items.map((item) => `${item.photoId}:${item.regionId}`));
        return {
          results: ocrResults.filter((result) =>
            requested.has(`${result.photoId}:${result.regionId}`),
          ),
          usage: {
            requestCount: 1,
            imageCount: items.length,
            billedUnits: null,
            provider: 'mock',
          },
        };
      },
    },
  };
}

module.exports = { createMockAdapters };
