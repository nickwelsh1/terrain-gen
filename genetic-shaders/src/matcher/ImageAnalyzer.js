import { ANALYSIS_SIZE_ULTRA } from './FeatureExtractor.js';

// Loads an image File/Blob, center-crops it to a square (stretching would
// skew the FFT spectrum) and downsamples to ANALYSIS_SIZE_ULTRA normalized
// [0,1] luminance, FlippedY to match WebGL readback orientation. The buffer
// is kept at 256x256 max resolution so the matcher can switch 64/128/256 without reload.
export async function loadImageLuminance(file) {
  const bitmap = await createImageBitmap(file);
  const s = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - s) / 2;
  const sy = (bitmap.height - s) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_SIZE_ULTRA;
  canvas.height = ANALYSIS_SIZE_ULTRA;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, ANALYSIS_SIZE_ULTRA, ANALYSIS_SIZE_ULTRA);

  const { data } = ctx.getImageData(0, 0, ANALYSIS_SIZE_ULTRA, ANALYSIS_SIZE_ULTRA);
  const lum = new Float32Array(ANALYSIS_SIZE_ULTRA * ANALYSIS_SIZE_ULTRA);
  for (let y = 0; y < ANALYSIS_SIZE_ULTRA; y++) {
    for (let x = 0; x < ANALYSIS_SIZE_ULTRA; x++) {
      // Flip rows so the target matches GL readback orientation.
      const src = (ANALYSIS_SIZE_ULTRA - 1 - y) * ANALYSIS_SIZE_ULTRA + x;
      const i = src * 4;
      lum[y * ANALYSIS_SIZE_ULTRA + x] =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
  }

  // 256px center-cropped thumbnail for UI preview & lossless checkpoint restore.
  const thumb = document.createElement('canvas');
  thumb.width = ANALYSIS_SIZE_ULTRA;
  thumb.height = ANALYSIS_SIZE_ULTRA;
  thumb.getContext('2d').drawImage(bitmap, sx, sy, s, s, 0, 0, ANALYSIS_SIZE_ULTRA, ANALYSIS_SIZE_ULTRA);
  bitmap.close();

  return { lum, lumSize: ANALYSIS_SIZE_ULTRA, thumbUrl: thumb.toDataURL('image/png') };
}

// Reconstructs a master luminance buffer from a saved data URL thumbnail (used by search resume).
export async function loadLuminanceFromDataUrl(dataUrl, targetSize = ANALYSIS_SIZE_ULTRA) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, targetSize, targetSize);
  const lum = new Float32Array(targetSize * targetSize);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const src = (targetSize - 1 - y) * targetSize + x;
      const i = src * 4;
      lum[y * targetSize + x] =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
  }
  return { lum, lumSize: targetSize };
}

// Box-filter downsample between square luminance buffers (fromSize >= toSize).
export function downsampleLuminance(lum, fromSize, toSize) {
  if (fromSize === toSize) return lum;
  const out = new Float32Array(toSize * toSize);
  const ratio = fromSize / toSize;
  for (let y = 0; y < toSize; y++) {
    for (let x = 0; x < toSize; x++) {
      let sum = 0;
      for (let dy = 0; dy < ratio; dy++) {
        for (let dx = 0; dx < ratio; dx++) {
          sum += lum[(y * ratio + dy) * fromSize + (x * ratio + dx)];
        }
      }
      out[y * toSize + x] = sum / (ratio * ratio);
    }
  }
  return out;
}

// Builds a Float32Array luminance buffer straight from RGBA pixels.
// `flipY` converts bottom-up GL readback into top-down row order.
export function rgbaToLuminance(rgba, size, flipY = false) {
  const lum = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcY = flipY ? size - 1 - y : y;
      const i = (srcY * size + x) * 4;
      lum[y * size + x] =
        (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    }
  }
  return lum;
}
