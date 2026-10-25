const MAX_CROP_SIDE = 1600;

function readFileAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: reject,
    });
  });
}

function getImageSize(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (info) => resolve({ width: info.width, height: info.height }),
      fail: reject,
    });
  });
}

function selectCanvasNode(page, selector) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(page)
      .select(selector)
      .fields({ node: true })
      .exec((result) => {
        const node = result && result[0] && result[0].node;
        if (!node) {
          const error = new Error('画布未就绪，请重试。');
          error.code = 'CANVAS_MISSING';
          reject(error);
          return;
        }
        resolve(node);
      });
  });
}

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => {
      const error = new Error('图片加载失败，请重新拍照。');
      error.code = 'IMAGE_LOAD_FAILED';
      reject(error);
    };
    image.src = src;
  });
}

function drawBand(canvas, image, band) {
  const width = Math.max(1, Math.min(MAX_CROP_SIDE, Math.round(band.outputWidth)));
  const height = Math.max(1, Math.round((band.outputHeight / band.outputWidth) * width));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in context) {
    context.imageSmoothingQuality = 'high';
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, band.left, band.top, band.width, band.height, 0, 0, width, height);
  return { width, height };
}

function exportCanvas(canvas, page, size) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath(
      {
        canvas,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        destWidth: size.width,
        destHeight: size.height,
        fileType: 'jpg',
        quality: 0.92,
        success: (result) => resolve(result.tempFilePath),
        fail: (error) => {
          const failure = new Error('裁图失败，请重试。');
          failure.code = 'CANVAS_EXPORT_FAILED';
          failure.cause = error;
          reject(failure);
        },
      },
      page,
    );
  });
}

// 逐题复用一个画布节点：每道题只重设 canvas.width/height 后重绘，避免反复创建画布。
async function createBandCropper(page, selector = '#band-canvas') {
  const canvas = await selectCanvasNode(page, selector);
  let loadedSrc = '';
  let loadedImage = null;

  return async function cropBand({ src, band }) {
    if (!band) {
      return null;
    }
    if (loadedSrc !== src) {
      loadedImage = await loadImage(canvas, src);
      loadedSrc = src;
    }
    const size = drawBand(canvas, loadedImage, band);
    const tempFilePath = await exportCanvas(canvas, page, size);
    return { tempFilePath, width: size.width, height: size.height };
  };
}

module.exports = {
  MAX_CROP_SIDE,
  readFileAsBase64,
  getImageSize,
  selectCanvasNode,
  loadImage,
  drawBand,
  exportCanvas,
  createBandCropper,
};
