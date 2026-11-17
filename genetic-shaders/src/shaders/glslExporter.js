import { NOISE_COMMON } from './chunks/noiseCommon.glsl.js';
import { PERLIN } from './chunks/perlin.glsl.js';
import { SIMPLEX } from './chunks/simplex.glsl.js';
import { WORLEY } from './chunks/worley.glsl.js';
import { FBM } from './chunks/fbm.glsl.js';
import { DOMAIN_WARP } from './chunks/domainWarp.glsl.js';
import { EROSION } from './chunks/erosion.glsl.js';
import { LAPLACIAN } from './chunks/laplacian.glsl.js';
import { seedToVec2 } from './uniforms.js';

// Generates a self-contained, Shadertoy-compatible GLSL fragment shader
// with the genotype's gene values baked in as constants.
export function generateStandaloneGLSL(genotype) {
  const g = genotype.genes;
  const [sx, sy] = seedToVec2(g.seed);
  const f = (v) => {
    const s = Number(v).toFixed(5);
    return s.includes('.') ? s : s + '.0';
  };

  const consts = /* glsl */ `
// --- Baked genotype constants ---
const vec2  SEED                  = vec2(${f(sx)}, ${f(sy)});
const float FREQUENCY             = ${f(g.frequency)};
const int   OCTAVES               = ${Math.round(g.octaves)};
const float PERSISTENCE           = ${f(g.persistence)};
const float LACUNARITY            = ${f(g.lacunarity)};
const int   NOISE_TYPE            = ${Math.round(g.noiseType)}; // 0 Perlin, 1 Simplex, 2 Worley F1, 3 Worley Crackle, 4 Ridged, 5 Perlin-Worley
const float WARP_INTENSITY        = ${f(g.warpIntensity)};
const float WARP_FREQUENCY        = ${f(g.warpFrequency)};
const int   WARP_OCTAVES          = ${Math.round(g.warpOctaves)};
const int   EROSION_MODE          = ${Math.round(g.erosionMode)}; // 0 Off, 1 Runevision Phacelle, 2 Classic Gavoronoise
const float EROSION_STRENGTH      = ${f(g.erosionStrength)};
const float EROSION_SCALE         = ${f(g.erosionScale)};
const int   EROSION_OCTAVES       = ${Math.round(g.erosionOctaves)};
const float EROSION_GAIN          = ${f(g.erosionGain)};
const float EROSION_LACUNARITY    = ${f(g.erosionLacunarity)};
const float EROSION_DETAIL        = ${f(g.erosionDetail)};
const float EROSION_GULLY_WEIGHT  = ${f(g.erosionGullyWeight)};
const float EROSION_ROUNDING      = ${f(g.erosionRounding)};
const float EROSION_CELL_SCALE    = ${f(g.erosionCellScale)};
const float EROSION_NORMALIZATION = ${f(g.erosionNormalization)};
const float PLATEAU_RIM           = ${f(g.plateauRim ?? 0.0)};
const float LAPLACIAN_WEIGHT      = ${f(g.laplacianWeight)};
const float LAPLACIAN_STEP        = ${f(g.laplacianStep)};
const float RIDGE_SHARPNESS       = ${f(g.ridgeSharpness)};
const float PEAK_ROUNDING         = ${f(g.peakRounding ?? 0.0)};
const float CONTRAST              = ${f(g.contrast)};
const float BIAS                  = ${f(g.bias)};
const float INVERT                = ${f(g.invert)};
`;

  const heightFn = /* glsl */ `
float baseHeightAt(vec2 p) {
  vec2 wp = domainWarp(p, SEED, WARP_INTENSITY, WARP_FREQUENCY, WARP_OCTAVES, PERSISTENCE);
  return fbm(wp, NOISE_TYPE, OCTAVES, PERSISTENCE, LACUNARITY, SEED);
}

float applyPlateauRim(float h, float rimAmount) {
  if (rimAmount <= 0.001) return h;
  float rim = 0.42 + 0.14 * rimAmount;
  float plateauFloor = mix(rim, 0.66, rimAmount * 0.82);
  if (h >= rim) {
    float t = (h - rim) / max(1.0 - rim, 1e-4);
    float undulation = pow(t, 0.85);
    return mix(h, plateauFloor + (1.0 - plateauFloor) * undulation, rimAmount);
  } else {
    float t = clamp(h / max(rim, 1e-4), 0.0, 1.0);
    float incised = t * t * (3.0 - 2.0 * t) * pow(t, 0.55 + 0.85 * rimAmount);
    return mix(h, incised * plateauFloor, rimAmount);
  }
}

vec2 erodedHeightAndRidge(vec2 p) {
  float rawH = baseHeightAt(p);
  float h = applyPlateauRim(rawH, PLATEAU_RIM);
  if (EROSION_MODE == 0 || EROSION_STRENGTH <= 0.0001) {
    return vec2(h, 0.0);
  }
  float eps = 0.024;
  float hxp = applyPlateauRim(baseHeightAt(p + vec2(eps, 0.0)), PLATEAU_RIM);
  float hxm = applyPlateauRim(baseHeightAt(p - vec2(eps, 0.0)), PLATEAU_RIM);
  float hyp = applyPlateauRim(baseHeightAt(p + vec2(0.0, eps)), PLATEAU_RIM);
  float hym = applyPlateauRim(baseHeightAt(p - vec2(0.0, eps)), PLATEAU_RIM);
  float gx = (hxp - hxm) / (2.0 * eps);
  float gy = (hyp - hym) / (2.0 * eps);
  vec3 baseHS = vec3(h, gx * 0.75, gy * 0.75);
  vec2 ep = p * 0.3333333;
  vec4 er = vec4(0.0);
  float rimThresh = 0.42 + 0.14 * PLATEAU_RIM;
  float slopeMag = length(vec2(gx, gy));
  float inBasin = 1.0 - smoothstep(rimThresh - 0.06, rimThresh + 0.14, rawH);
  float onRimWall = smoothstep(0.18, 0.75, slopeMag);
  float plateauMask = mix(1.0, clamp(max(inBasin, onRimWall * 0.85), 0.15, 1.0), PLATEAU_RIM);
  float effStrength = EROSION_STRENGTH * plateauMask;
  if (EROSION_MODE == 1) {
    float fadeTarget = clamp((h - 0.5) * 2.6 - PLATEAU_RIM * inBasin * 0.85, -1.0, 1.0);
    er = erosionFilterRunevision(
      ep, baseHS, fadeTarget,
      EROSION_SCALE, effStrength, EROSION_GULLY_WEIGHT,
      EROSION_DETAIL, EROSION_ROUNDING, EROSION_CELL_SCALE,
      EROSION_NORMALIZATION, EROSION_OCTAVES, EROSION_LACUNARITY,
      EROSION_GAIN, SEED + vec2(11.3, 23.7)
    );
    h = clamp(h + er.x * 3.2, 0.0, 1.0);
  } else {
    er = erosionFilterClassic(
      ep, baseHS,
      EROSION_SCALE, effStrength, EROSION_GULLY_WEIGHT,
      EROSION_DETAIL, EROSION_ROUNDING, EROSION_CELL_SCALE,
      EROSION_NORMALIZATION, EROSION_OCTAVES, EROSION_LACUNARITY,
      EROSION_GAIN, SEED + vec2(11.3, 23.7)
    );
    h = clamp(h + er.x * 2.4, 0.0, 1.0);
  }
  return vec2(h, er.w * plateauMask);
}

float heightAt(vec2 p) {
  return applyPlateauRim(baseHeightAt(p), PLATEAU_RIM);
}
`;

  const main = /* glsl */ `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = uv * FREQUENCY;

  vec2 hr = erodedHeightAndRidge(p);
  float h = hr.x;
  float ridgeMap = hr.y;

  if (abs(LAPLACIAN_WEIGHT) > 0.0001) {
    float eps = max(LAPLACIAN_STEP, 0.0005) * FREQUENCY;
    float lap = tanh((laplacianAt(p, eps) - ridgeMap * 2.2) * 0.35);
    h = clamp(h - LAPLACIAN_WEIGHT * 0.22 * lap, 0.0, 1.0);
  }

  h = pow(clamp(h, 0.0, 1.0), RIDGE_SHARPNESS);
  h = clamp((h - 0.5) * CONTRAST + 0.5 + BIAS, 0.0, 1.0);
  if (INVERT > 0.5) h = 1.0 - h;
  if (PEAK_ROUNDING > 0.001) {
    float w = 0.45 * PEAK_ROUNDING;
    float c = 1.0 - w;
    if (h > c) h = c + w * (1.0 - exp(-(h - c) / w));
  }

  fragColor = vec4(vec3(h), 1.0);
}
`;

  return [
    '// Exported from Smart Procedural Shader Generator',
    '// Paste into https://www.shadertoy.com/new or any GLSL host with mainImage().',
    '',
    NOISE_COMMON.trim(),
    PERLIN.trim(),
    SIMPLEX.trim(),
    WORLEY.trim(),
    FBM.trim(),
    DOMAIN_WARP.trim(),
    EROSION.trim(),
    consts.trim(),
    heightFn.trim(),
    LAPLACIAN.trim(),
    main.trim(),
    '',
  ].join('\n\n');
}
