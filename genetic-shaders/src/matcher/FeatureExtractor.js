import { fft2d, hannWindow, powerSpectrumProfile } from './FFT2D.js';

export const ANALYSIS_SIZE = 64;
export const ANALYSIS_SIZE_HI = 128;
export const ANALYSIS_SIZE_ULTRA = 256;
const REGION_SIZE = 8;
const HIST_BINS = 32;
const RADIAL_BINS = 32;
const ANGULAR_WEDGES = 8;
const LAP_BINS = 32;
const SLOPE_BINS = 32;

function histogramCdf(lum, bins) {
  const hist = new Float64Array(bins);
  for (let i = 0; i < lum.length; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(lum[i] * bins)));
    hist[b]++;
  }
  const cdf = new Float64Array(bins);
  let acc = 0;
  for (let i = 0; i < bins; i++) {
    acc += hist[i] / lum.length;
    cdf[i] = acc;
  }
  const histNorm = new Float64Array(bins);
  for (let i = 0; i < bins; i++) histNorm[i] = hist[i] / lum.length;

  // Extract robust quantiles (p10, p25, p50, p75, p90) from the 32-bin CDF
  // so tone adaptation isn't fooled by narrow bright bands or outlier spikes.
  const quantile = (q) => {
    for (let i = 0; i < bins; i++) {
      if (cdf[i] >= q) {
        const prev = i > 0 ? cdf[i - 1] : 0;
        const span = Math.max(1e-6, cdf[i] - prev);
        const frac = (q - prev) / span;
        return (i + frac) / bins;
      }
    }
    return 1.0;
  };
  const p10 = quantile(0.10);
  const p25 = quantile(0.25);
  const p50 = quantile(0.50);
  const p75 = quantile(0.75);
  const p90 = quantile(0.90);
  const iqr = Math.max(0.01, p75 - p25);

  return { hist: histNorm, cdf, p10, p25, p50, p75, p90, iqr };
}

// 1st-derivative central-difference Slope (|grad h|) and 2nd-derivative
// rotationally invariant 8-neighbor 3x3 Laplacian curvature profiles.
// Uses terrain-calibrated scales with perceptual sqrt-binning so real
// heightmap slopes/curvatures spread across all 32 bins instead of
// crowding into bin 0.
function geomorphologyProfiles(lum, size) {
  const nInterior = Math.max(1, (size - 2) * (size - 2));
  const lapHist = new Float64Array(LAP_BINS);
  const slopeHist = new Float64Array(SLOPE_BINS);
  const lapScale = 0.35;    // calibrated for procedural & DEM terrain curvature
  const slopeScale = 0.28;  // calibrated for procedural & DEM terrain gradients
  const flatThreshold = 0.012;
  let lapEnergy = 0;
  let slopeEnergy = 0;
  let ridgeEnergy = 0;
  let gullyEnergy = 0;
  let flatCount = 0;
  let extremaCount = 0;
  let reversalCount = 0;

  for (let y = 1; y < size - 1; y++) {
    const row = y * size;
    for (let x = 1; x < size - 1; x++) {
      const i = row + x;
      const c = lum[i];
      const l = lum[i - 1];
      const r = lum[i + 1];
      const u = lum[i - size];
      const d = lum[i + size];
      const ul = lum[i - size - 1];
      const ur = lum[i - size + 1];
      const dl = lum[i + size - 1];
      const dr = lum[i + size + 1];

      // Isotropic 8-neighbor Laplacian (rotationally invariant at 45 deg).
      // Signed: rawLap < 0 on convex ridges/peaks, rawLap > 0 in concave gullies/valleys.
      // Accumulate squared Laplacian (L2 energy) to capture skewness between
      // narrow incised gullies and broad plateaus (since linear sum integrates to ~0).
      const rawLap = 0.5 * (l + r + u + d) + 0.25 * (ul + ur + dl + dr) - 3.0 * c;
      if (rawLap < 0) ridgeEnergy += rawLap * rawLap;
      else gullyEnergy += rawLap * rawLap;
      const lap = Math.abs(rawLap);
      lapEnergy += lap;
      const lapNorm = Math.sqrt(Math.min(0.9999, lap / lapScale));
      const lb = Math.min(LAP_BINS - 1, Math.floor(lapNorm * LAP_BINS));
      lapHist[lb]++;

      // 1st-derivative Sobel / central-difference gradient magnitude |grad h|.
      const gx = (r - l) * 0.5 + (ur + dr - ul - dl) * 0.25;
      const gy = (d - u) * 0.5 + (dl + dr - ul - ur) * 0.25;
      const slope = Math.hypot(gx, gy);
      slopeEnergy += slope;
      if (slope < flatThreshold) flatCount++;
      const slopeNorm = Math.sqrt(Math.min(0.9999, slope / slopeScale));
      const sb = Math.min(SLOPE_BINS - 1, Math.floor(slopeNorm * SLOPE_BINS));
      slopeHist[sb]++;

      // 2D Local Extrema (micro-bump / pit count) vs 1D line/fold distinction:
      // A true 2D bump or pit reverses slope in BOTH X and Y simultaneously,
      // whereas a long 1D Worley Crackle line or smooth fold does not.
      const dxL = c - l;
      const dxR = r - c;
      const dyU = c - u;
      const dyD = d - c;
      const revX = (dxL * dxR) < -0.000008;
      const revY = (dyU * dyD) < -0.000008;
      if (revX || revY) reversalCount++;
      if (revX && revY && (dxL * dyU > 0)) extremaCount++;
    }
  }

  // Multi-scale gradient pyramid (step = 3px and step = 7px) to capture the ratio
  // of fine micro-bumps / dendritic tributaries (1px) to macro slopes (7px).
  let slope3Sum = 0;
  let slope3Cnt = 0;
  const s3 = Math.max(2, Math.round(size / 32));
  for (let y = s3; y < size - s3; y += 2) {
    const row = y * size;
    for (let x = s3; x < size - s3; x += 2) {
      const i = row + x;
      const gx3 = (lum[i + s3] - lum[i - s3]) * 0.5;
      const gy3 = (lum[i + s3 * size] - lum[i - s3 * size]) * 0.5;
      slope3Sum += Math.hypot(gx3, gy3);
      slope3Cnt++;
    }
  }
  const slope3Energy = slope3Cnt > 0 ? slope3Sum / slope3Cnt : slopeEnergy;

  let slope7Sum = 0;
  let slope7Cnt = 0;
  const s7 = Math.max(4, Math.round(size / 10));
  for (let y = s7; y < size - s7; y += 2) {
    const row = y * size;
    for (let x = s7; x < size - s7; x += 2) {
      const i = row + x;
      const gx7 = (lum[i + s7] - lum[i - s7]) * 0.5;
      const gy7 = (lum[i + s7 * size] - lum[i - s7 * size]) * 0.5;
      slope7Sum += Math.hypot(gx7, gy7);
      slope7Cnt++;
    }
  }
  const slope7Energy = slope7Cnt > 0 ? slope7Sum / slope7Cnt : slopeEnergy;

  lapEnergy /= nInterior;
  slopeEnergy /= nInterior;
  const flatFraction = flatCount / nInterior;
  const extremaDensity = extremaCount / nInterior;
  const reversalDensity = reversalCount / nInterior;
  const microMacroRatio = slopeEnergy / Math.max(slope7Energy, 0.004);
  const mesoMacroRatio = slope3Energy / Math.max(slope7Energy, 0.004);
  const gullyShare = gullyEnergy / Math.max(ridgeEnergy + gullyEnergy, 1e-6);

  const lapCdf = new Float64Array(LAP_BINS);
  const slopeCdf = new Float64Array(SLOPE_BINS);
  let lapAcc = 0;
  let slopeAcc = 0;
  for (let i = 0; i < LAP_BINS; i++) {
    lapAcc += lapHist[i] / nInterior;
    lapCdf[i] = lapAcc;
  }
  for (let i = 0; i < SLOPE_BINS; i++) {
    slopeAcc += slopeHist[i] / nInterior;
    slopeCdf[i] = slopeAcc;
  }

  return {
    lapCdf,
    lapEnergy,
    gullyShare,
    slopeCdf,
    slopeEnergy,
    flatFraction,
    extremaDensity,
    reversalDensity,
    microMacroRatio,
    mesoMacroRatio,
  };
}

// Coarse REGION_SIZE x REGION_SIZE maps of regional mean luminance and
// regional local standard deviation (roughness). Also returns the sorted
// regional roughness profile so the scorer can distinguish "smooth everywhere
// except one bright/rough band" from "uniform contrast/noise everywhere"
// even when spatial layout lock is off.
function regionProfiles(lum, size) {
  const numRegions = REGION_SIZE * REGION_SIZE;
  const regions = new Float32Array(numRegions);
  const regionRoughness = new Float32Array(numRegions);
  const cell = size / REGION_SIZE;
  const area = cell * cell;

  for (let ry = 0; ry < REGION_SIZE; ry++) {
    for (let rx = 0; rx < REGION_SIZE; rx++) {
      let sum = 0;
      let sumSq = 0;
      for (let y = ry * cell; y < (ry + 1) * cell; y++) {
        for (let x = rx * cell; x < (rx + 1) * cell; x++) {
          const v = lum[y * size + x];
          sum += v;
          sumSq += v * v;
        }
      }
      const idx = ry * REGION_SIZE + rx;
      const mean = sum / area;
      regions[idx] = mean;
      regionRoughness[idx] = Math.sqrt(Math.max(0, sumSq / area - mean * mean));
    }
  }

  const sortedRegionRoughness = Float32Array.from(regionRoughness).sort();
  return { regions, regionRoughness, sortedRegionRoughness };
}

// Extracts the multi-metric feature signature of a luminance field:
//   hist/cdf    - 32-bin intensity histogram + CDF (for Wasserstein-1) + quantiles
//   radial      - 32-bin radially averaged log FFT power spectrum
//   angular     - 8-wedge directional FFT energy
//   lapCdf/energy - Laplacian curvature profile + signed gullyShare
//   slopeCdf/energy/flatFraction - Slope steepness profile + smooth-area fraction
//   mean/std/p50/iqr - global & robust moments
//   regions/regionRoughness/sortedRegionRoughness - 8x8 spatial & sparsity profiles
export function extractFeatures(lum, size = ANALYSIS_SIZE) {
  let mean = 0;
  for (let i = 0; i < lum.length; i++) mean += lum[i];
  mean /= lum.length;
  let variance = 0;
  for (let i = 0; i < lum.length; i++) {
    const d = lum[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / lum.length);

  const { hist, cdf, p10, p25, p50, p75, p90, iqr } = histogramCdf(lum, HIST_BINS);
  const windowed = hannWindow(lum, size);
  const { re, im } = fft2d(windowed, size);
  const { radial, angular, bands } = powerSpectrumProfile(re, im, size, RADIAL_BINS, ANGULAR_WEDGES);
  const {
    lapCdf,
    lapEnergy,
    gullyShare,
    slopeCdf,
    slopeEnergy,
    flatFraction,
    extremaDensity,
    reversalDensity,
    microMacroRatio,
    mesoMacroRatio,
  } = geomorphologyProfiles(lum, size);
  const { regions, regionRoughness, sortedRegionRoughness } = regionProfiles(lum, size);

  return {
    hist,
    cdf,
    p10,
    p25,
    p50,
    p75,
    p90,
    iqr,
    radial,
    angular,
    bands,
    lapCdf,
    lapEnergy,
    gullyShare,
    slopeCdf,
    slopeEnergy,
    flatFraction,
    extremaDensity,
    reversalDensity,
    microMacroRatio,
    mesoMacroRatio,
    mean,
    std,
    regions,
    regionRoughness,
    sortedRegionRoughness,
  };
}
