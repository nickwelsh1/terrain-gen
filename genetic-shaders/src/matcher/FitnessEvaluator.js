import { extractFeatures } from './FeatureExtractor.js';

// Composite fitness weights across the four geomorphology metric families:
//   0th derivative: Elevation Histogram CDF
//   1st derivative: Slope / Gradient Steepness CDF
//   2nd derivative: Isotropic 8-neighbor Laplacian Curvature CDF
//   Spectral:       2D FFT Radial + Angular Power Spectrum
const W_HIST = 0.30;
const W_FFT = 0.35;
const W_LAP = 0.20;
const W_SLOPE = 0.15;

// 1D Wasserstein / Earth Mover's distance between two CDFs.
function emd(cdfA, cdfB) {
  let d = 0;
  for (let i = 0; i < cdfA.length; i++) d += Math.abs(cdfA[i] - cdfB[i]);
  return d / cdfA.length;
}

// Normalized L2 distance between two unit-sum vectors.
function l2(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const t = a[i] - b[i];
    d += t * t;
  }
  return Math.sqrt(d / a.length);
}

// Maps a distance to a 0..1 similarity with a soft knee.
function similarity(dist, knee) {
  return Math.exp(-dist / knee);
}

// Two-sided symmetric ratio in [0, 1]: penalizes candidates that are
// EITHER too washed-out/smooth OR too rough/noisy/warped relative to the target.
function symmetricRatio(a, b, floor = 0.0015) {
  const va = Math.max(a, floor);
  const vb = Math.max(b, floor);
  return Math.min(va, vb) / Math.max(va, vb);
}

// Scores one candidate luminance field against precomputed target features.
// opts: { layout — include 8x8 regional structure, crisp — weight curvature,
// slope, and spectral detail more heavily }
// Returns { total, hist, fft, lap, slope, layout, features } each in [0, 1].
export function scoreCandidate(candidateLum, targetFeatures, opts = {}) {
  const cand = extractFeatures(candidateLum, Math.sqrt(candidateLum.length));

  // Sparsity / regional roughness distribution distance: distinguishes a target
  // that is smooth over most of the canvas with a localized bright band from a
  // candidate with high-contrast bumps everywhere.
  const sparsityDist = (cand.sortedRegionRoughness && targetFeatures.sortedRegionRoughness)
    ? l2(cand.sortedRegionRoughness, targetFeatures.sortedRegionRoughness)
    : 0;
  const flatDist = Math.abs((cand.flatFraction ?? 0) - (targetFeatures.flatFraction ?? 0));

  const histDist =
    0.72 * emd(cand.cdf, targetFeatures.cdf) +
    0.28 * sparsityDist;

  const bandDist = (cand.bands && targetFeatures.bands)
    ? l2(cand.bands, targetFeatures.bands)
    : 0;
  const fftDist =
    0.54 * l2(cand.radial, targetFeatures.radial) +
    0.28 * bandDist +
    0.18 * l2(cand.angular, targetFeatures.angular);

  const asymDist = Math.abs((cand.gullyShare ?? 0.5) - (targetFeatures.gullyShare ?? 0.5));
  const extremaDist = Math.abs((cand.extremaDensity ?? 0) - (targetFeatures.extremaDensity ?? 0)) * 2.5;
  const reversalDist = Math.abs((cand.reversalDensity ?? 0) - (targetFeatures.reversalDensity ?? 0)) * 1.2;
  const lapDist =
    0.46 * emd(cand.lapCdf, targetFeatures.lapCdf) +
    0.22 * Math.abs(cand.lapEnergy - targetFeatures.lapEnergy) * 4.0 +
    0.14 * asymDist +
    0.18 * (0.55 * extremaDist + 0.45 * reversalDist);

  const scaleRatioDist = Math.abs((cand.microMacroRatio ?? 0.3) - (targetFeatures.microMacroRatio ?? 0.3)) * 0.35;
  const slopeDist =
    0.44 * emd(cand.slopeCdf, targetFeatures.slopeCdf) +
    0.22 * Math.abs(cand.slopeEnergy - targetFeatures.slopeEnergy) * 3.5 +
    0.18 * flatDist +
    0.16 * scaleRatioDist;

  // Calibrated knees so unrelated / over-warped images don't get 75%+ scores.
  const hist = similarity(histDist, 0.13);
  const fft = similarity(fftDist, 0.048);
  const lap = similarity(lapDist, 0.115);
  const slope = similarity(slopeDist, 0.115);

  // Bonus for matching brightness/contrast moments (including median & IQR).
  const medianDiff = Math.abs((cand.p50 ?? cand.mean) - (targetFeatures.p50 ?? targetFeatures.mean));
  const iqrDiff = Math.abs((cand.iqr ?? cand.std) - (targetFeatures.iqr ?? targetFeatures.std));
  const moment =
    0.35 * similarity(Math.abs(cand.mean - targetFeatures.mean), 0.12) +
    0.25 * similarity(medianDiff, 0.12) +
    0.20 * similarity(Math.abs(cand.std - targetFeatures.std), 0.10) +
    0.20 * similarity(iqrDiff, 0.10);

  // Crisp-ridge mode shifts weight toward curvature, slope, and spectral detail.
  const wFft = opts.crisp ? 0.32 : W_FFT;
  const wLap = opts.crisp ? 0.30 : W_LAP;
  const wSlope = opts.crisp ? 0.20 : W_SLOPE;
  const wHist = opts.crisp ? 0.18 : W_HIST;
  const total = wHist * hist + wFft * fft + wLap * lap + wSlope * slope;

  // Two-sided roughness, bump/branch reversal, and multi-scale detail guard:
  // penalizes candidates that lack micro-bumps/branches OR are overly warped/noisy.
  const lapRatio = symmetricRatio(cand.lapEnergy, targetFeatures.lapEnergy, 0.0012);
  const slopeRatio = symmetricRatio(cand.slopeEnergy, targetFeatures.slopeEnergy, 0.0025);
  const revRatio = symmetricRatio(cand.reversalDensity ?? 0.02, targetFeatures.reversalDensity ?? 0.02, 0.008);
  const extRatio = symmetricRatio(cand.extremaDensity ?? 0.004, targetFeatures.extremaDensity ?? 0.004, 0.0015);
  const detail = 0.35 * lapRatio + 0.30 * slopeRatio + 0.20 * revRatio + 0.15 * extRatio;
  const detailFloor = opts.crisp ? 0.45 : 0.56;
  let blended = (0.88 * total + 0.12 * moment) * (detailFloor + (1 - detailFloor) * detail);

  // Regional 8x8 layout similarity (both regional brightness and regional roughness).
  const regMeanDist = l2(cand.regions, targetFeatures.regions);
  const regRoughDist = (cand.regionRoughness && targetFeatures.regionRoughness)
    ? l2(cand.regionRoughness, targetFeatures.regionRoughness)
    : 0;
  const layout = similarity(0.75 * regMeanDist + 0.25 * regRoughDist, 0.14);
  if (opts.layout) {
    blended = 0.72 * blended + 0.28 * layout;
  }

  return { total: blended, hist, fft, lap, slope, layout, features: cand };
}
