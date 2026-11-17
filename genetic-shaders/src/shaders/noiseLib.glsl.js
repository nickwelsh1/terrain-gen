import { NOISE_COMMON } from './chunks/noiseCommon.glsl.js';
import { PERLIN } from './chunks/perlin.glsl.js';
import { SIMPLEX } from './chunks/simplex.glsl.js';
import { WORLEY } from './chunks/worley.glsl.js';
import { FBM } from './chunks/fbm.glsl.js';
import { DOMAIN_WARP } from './chunks/domainWarp.glsl.js';
import { EROSION } from './chunks/erosion.glsl.js';
import { LAPLACIAN } from './chunks/laplacian.glsl.js';

// Uniform declarations shared by the 2D fragment shader and the 3D vertex shader.
export const UNIFORM_DECLS = /* glsl */ `
uniform vec2 uSeed;
uniform float uFrequency;
uniform int uOctaves;
uniform float uPersistence;
uniform float uLacunarity;
uniform int uNoiseType;
uniform float uWarpIntensity;
uniform float uWarpFrequency;
uniform int uWarpOctaves;
uniform int uErosionMode;
uniform float uErosionStrength;
uniform float uErosionScale;
uniform int uErosionOctaves;
uniform float uErosionGain;
uniform float uErosionLacunarity;
uniform float uErosionDetail;
uniform float uErosionGullyWeight;
uniform float uErosionRounding;
uniform float uErosionCellScale;
uniform float uErosionNormalization;
uniform float uPlateauRim;
uniform float uLaplacianWeight;
uniform float uLaplacianStep;
uniform float uRidgeSharpness;
uniform float uPeakRounding;
uniform float uContrast;
uniform float uBias;
uniform float uInvert;
uniform int uColorMode;
uniform float uDisplacementScale;
`;

// Full noise pipeline: hashes -> noises -> fBm -> domain warp -> erosion -> heightAt -> laplacianAt.
// heightAt(p) expects p already scaled into noise space (uv * uFrequency).
export const NOISE_LIB =
  NOISE_COMMON +
  PERLIN +
  SIMPLEX +
  WORLEY +
  FBM +
  DOMAIN_WARP +
  EROSION +
  /* glsl */ `
float baseHeightAt(vec2 p) {
  vec2 wp = domainWarp(p, uSeed, uWarpIntensity, uWarpFrequency, uWarpOctaves, uPersistence);
  return fbm(wp, uNoiseType, uOctaves, uPersistence, uLacunarity, uSeed);
}

// Non-clamping Plateau / Canyon Rim transfer function:
// When rimAmount > 0, the upper ~55-65% of the heightfield is preserved as a
// gently undulating plateau (keeping subtle fBm relief), while the lower basin
// plunges down a steep rim into an incised canyon floor.
float applyPlateauRim(float h, float rimAmount) {
  if (rimAmount <= 0.001) return h;
  float rim = 0.42 + 0.14 * rimAmount;
  float plateauFloor = mix(rim, 0.66, rimAmount * 0.82);
  if (h >= rim) {
    float t = (h - rim) / max(1.0 - rim, 1e-4);
    // Gentle non-zero slope on the upland plateau preserves subtle terrain undulations.
    float undulation = pow(t, 0.85);
    return mix(h, plateauFloor + (1.0 - plateauFloor) * undulation, rimAmount);
  } else {
    float t = clamp(h / max(rim, 1e-4), 0.0, 1.0);
    // Steep rim wall plunging into a carved canyon basin.
    float incised = t * t * (3.0 - 2.0 * t) * pow(t, 0.55 + 0.85 * rimAmount);
    return mix(h, incised * plateauFloor, rimAmount);
  }
}

// Evaluates the base heightfield and applies the selected single-pass erosion filter.
// Returns vec2(erodedHeight, ridgeMap) where ridgeMap is in [-1, 1] (+ridges, -gullies).
vec2 erodedHeightAndRidge(vec2 p) {
  float rawH = baseHeightAt(p);
  float h = applyPlateauRim(rawH, uPlateauRim);
  if (uErosionMode == 0 || uErosionStrength <= 0.0001) {
    return vec2(h, 0.0);
  }

  // Smooth central-difference gradient of the shaped base heightfield.
  float eps = 0.024;
  float hxp = applyPlateauRim(baseHeightAt(p + vec2(eps, 0.0)), uPlateauRim);
  float hxm = applyPlateauRim(baseHeightAt(p - vec2(eps, 0.0)), uPlateauRim);
  float hyp = applyPlateauRim(baseHeightAt(p + vec2(0.0, eps)), uPlateauRim);
  float hym = applyPlateauRim(baseHeightAt(p - vec2(0.0, eps)), uPlateauRim);
  float gx = (hxp - hxm) / (2.0 * eps);
  float gy = (hyp - hym) / (2.0 * eps);
  vec3 baseHS = vec3(h, gx * 0.75, gy * 0.75);
  vec2 ep = p * 0.3333333;
  vec4 er = vec4(0.0);

  // When uPlateauRim > 0, gate erosion so the high gentle plateau keeps only
  // subtle shallow swales (~16% erosion) while the canyon rim & incised basin
  // receive full dendritic tributary carving (100% erosion).
  float rimThresh = 0.42 + 0.14 * uPlateauRim;
  float slopeMag = length(vec2(gx, gy));
  float inBasin = 1.0 - smoothstep(rimThresh - 0.06, rimThresh + 0.14, rawH);
  float onRimWall = smoothstep(0.18, 0.75, slopeMag);
  float plateauMask = mix(1.0, clamp(max(inBasin, onRimWall * 0.85), 0.15, 1.0), uPlateauRim);
  float effStrength = uErosionStrength * plateauMask;

  if (uErosionMode == 1) {
    // Shift fadeTarget negative inside incised canyon basins so gullies carve
    // downward into the canyon walls rather than raising pointy peaks on the plateau.
    float fadeTarget = clamp((h - 0.5) * 2.6 - uPlateauRim * inBasin * 0.85, -1.0, 1.0);
    er = erosionFilterRunevision(
      ep,
      baseHS,
      fadeTarget,
      uErosionScale,
      effStrength,
      uErosionGullyWeight,
      uErosionDetail,
      uErosionRounding,
      uErosionCellScale,
      uErosionNormalization,
      uErosionOctaves,
      uErosionLacunarity,
      uErosionGain,
      uSeed + vec2(11.3, 23.7)
    );
    h = clamp(h + er.x * 3.2, 0.0, 1.0);
  } else {
    er = erosionFilterClassic(
      ep,
      baseHS,
      uErosionScale,
      effStrength,
      uErosionGullyWeight,
      uErosionDetail,
      uErosionRounding,
      uErosionCellScale,
      uErosionNormalization,
      uErosionOctaves,
      uErosionLacunarity,
      uErosionGain,
      uSeed + vec2(11.3, 23.7)
    );
    h = clamp(h + er.x * 2.4, 0.0, 1.0);
  }

  return vec2(h, er.w * plateauMask);
}

// heightAt(p) is used by the 5-tap Laplacian stencil; evaluates baseHeightAt(p)
// with plateau rim shaping so Laplacian curvature doesn't re-run erosion 5x/pixel.
float heightAt(vec2 p) {
  return applyPlateauRim(baseHeightAt(p), uPlateauRim);
}
` +
  LAPLACIAN;

// Post-heightfield shaping (ridge power, contrast, bias, invert, peak rounding).
// Kept separate so the 3D vertex shader can reuse it for displacement.
export const HEIGHT_SHAPING = /* glsl */ `
// Exponential soft-cap: above breakpoint c the height decelerates smoothly
// (slope-continuous at c) and asymptotes toward 1.0, rounding pointy tips.
float roundPeaks(float h, float amount) {
  if (amount <= 0.001) return h;
  float w = 0.45 * amount;
  float c = 1.0 - w;
  if (h <= c) return h;
  return c + w * (1.0 - exp(-(h - c) / w));
}

float shapeHeight(float h) {
  h = pow(clamp(h, 0.0, 1.0), uRidgeSharpness);
  h = clamp((h - 0.5) * uContrast + 0.5 + uBias, 0.0, 1.0);
  if (uInvert > 0.5) h = 1.0 - h;
  return roundPeaks(h, uPeakRounding);
}
`;

// Color ramps used by both fragment shaders.
export const COLORIZE = /* glsl */ `
vec3 hypsometric(float h) {
  vec3 c = mix(vec3(0.03, 0.09, 0.23), vec3(0.05, 0.35, 0.45), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(0.30, 0.55, 0.25), smoothstep(0.35, 0.55, h));
  c = mix(c, vec3(0.62, 0.55, 0.40), smoothstep(0.55, 0.75, h));
  c = mix(c, vec3(0.92, 0.93, 0.97), smoothstep(0.75, 1.0, h));
  return c;
}

// lap < 0 at convex peaks/ridges, > 0 in concave valleys.
vec3 curvatureRamp(float lap) {
  vec3 ridge = vec3(0.85, 0.30, 0.25);
  vec3 mid = vec3(0.07, 0.08, 0.11);
  vec3 valley = vec3(0.25, 0.45, 0.90);
  return (lap <= 0.0) ? mix(mid, ridge, clamp(-lap, 0.0, 1.0))
                     : mix(mid, valley, clamp(lap, 0.0, 1.0));
}

// Runevision/Fewes-inspired alpine terrain palette with dendritic drainage streaks.
vec3 alpineDrainageRamp(float h, float ridgeMap, float slopeMag) {
  vec3 valleyGrass = vec3(0.16, 0.30, 0.14);
  vec3 dryDirt     = vec3(0.48, 0.41, 0.31);
  vec3 cliffRock   = vec3(0.33, 0.31, 0.29);
  vec3 highSnow    = vec3(0.92, 0.94, 0.98);
  vec3 streamCol   = vec3(0.74, 0.84, 0.92);

  vec3 col = mix(valleyGrass, dryDirt, smoothstep(0.20, 0.62, h));
  float rockMask = clamp(slopeMag * 0.85 + smoothstep(0.45, 0.80, h) * 0.35, 0.0, 1.0);
  col = mix(col, cliffRock, rockMask);

  // Ridge crests catch warm highlights; deep gullies collect dendritic sediment/water streaks.
  float ridgeHighlight = smoothstep(0.10, 0.75, ridgeMap);
  col = mix(col, vec3(0.68, 0.61, 0.50), ridgeHighlight * 0.38);

  float snowMask = smoothstep(0.68, 0.88, h - slopeMag * 0.14 + ridgeMap * 0.05);
  col = mix(col, highSnow, snowMask);

  float drainage = smoothstep(-0.08, -0.58, ridgeMap) * (1.0 - snowMask * 0.6);
  col = mix(col, streamCol, drainage * 0.78);
  return col;
}

// Direct visualization of Runevision's dendritic ridge/gully map (-1 gullies .. +1 ridges).
vec3 erosionRidgeRamp(float h, float ridgeMap) {
  float r = clamp(ridgeMap * 0.5 + 0.5, 0.0, 1.0);
  vec3 gully = vec3(0.05, 0.09, 0.15);
  vec3 neutral = vec3(0.26, 0.29, 0.34);
  vec3 crest = vec3(0.95, 0.91, 0.82);
  vec3 col = (ridgeMap < 0.0)
    ? mix(gully, neutral, clamp(ridgeMap + 1.0, 0.0, 1.0))
    : mix(neutral, crest, clamp(ridgeMap, 0.0, 1.0));
  float channel = smoothstep(-0.22, -0.68, ridgeMap);
  col = mix(col, vec3(0.32, 0.75, 0.95), channel * 0.65);
  return col * (0.75 + 0.30 * h) + vec3(r * 0.04);
}
`;
