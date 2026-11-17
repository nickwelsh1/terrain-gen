// Single-pass procedural terrain erosion filters:
//   Mode 1: Rune Skovbo Johansen (runevision) 2026 "Advanced Terrain Erosion Filter"
//           using Simple Phacelle Noise, Fade Approach, Stacked Fading, Straight Gullies,
//           Edge Rounding, and Dendritic Ridge Map. (MPL-2.0 compatible attribution)
//           Blog: https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html
//   Mode 2: Clay John (2018) & Felix Westin / Fewes (2023) Classic Gavoronoise Erosion
//           using frequency-scaled slope-aligned Gabor-Voronoi waves with curl feedback.
//
// Requires hash22(vec2) from noiseCommon.glsl.js.

export const EROSION = /* glsl */ `
const float EROSION_TAU = 6.28318530718;

float erosionPowInv(float t, float power) {
  return 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), max(power, 0.001));
}

float erosionEaseOut(float t) {
  float v = 1.0 - clamp(t, 0.0, 1.0);
  return 1.0 - v * v;
}

float erosionSmoothStart(float t, float smoothing) {
  if (t >= smoothing) return t - 0.5 * smoothing;
  return 0.5 * t * t / max(smoothing, 0.0001);
}

vec2 erosionSafeNormalize(vec2 n) {
  float l = length(n);
  return (l > 1e-6) ? (n / l) : vec2(0.0);
}

// Rune Skovbo Johansen's Simple Phacelle Noise (phase + cell directional stripe noise).
// Returns vec4(cosWave, sinWave, sideDir.x, sideDir.y).
vec4 phacelleNoise(
  vec2 p,
  vec2 normDir,
  float freq,
  float offsetCycles,
  float normalization,
  vec2 seed
) {
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * freq * EROSION_TAU;
  float offset = offsetCycles * EROSION_TAU;

  vec2 pInt = floor(p);
  vec2 pFrac = fract(p);

  vec2 phaseDir = vec2(0.0);
  float weightSum = 0.0;

  for (int i = -1; i <= 2; i++) {
    for (int j = -1; j <= 2; j++) {
      vec2 gridOffset = vec2(float(i), float(j));
      vec2 gridPoint = pInt + gridOffset;
      vec2 randomOffset = hash22(gridPoint + seed) * 0.5;
      vec2 v = pFrac - gridOffset - randomOffset;

      float sqrDist = dot(v, v);
      // Subtracting 0.01111 brings the Gaussian smoothly to zero at distance^2 = 2.25.
      float weight = max(exp(-sqrDist * 2.0) - 0.01111, 0.0);
      weightSum += weight;

      float waveInput = dot(v, sideDir) + offset;
      phaseDir += vec2(cos(waveInput), sin(waveInput)) * weight;
    }
  }

  vec2 interpolated = phaseDir / max(weightSum, 1e-5);
  float magRaw = length(interpolated);
  float magnitude = max(max(1.0 - normalization, magRaw), 1e-5);
  vec2 normalized = interpolated / magnitude;
  return vec4(normalized.x, normalized.y, sideDir.x, sideDir.y);
}

// Mode 1: Runevision 2026 Advanced Terrain Erosion Filter.
// Returns vec4(heightDelta, slopeDeltaX, slopeDeltaY, ridgeMap).
vec4 erosionFilterRunevision(
  vec2 p,
  vec3 baseHeightAndSlope,
  float fadeTargetIn,
  float scale,
  float strengthIn,
  float gullyWeight,
  float detail,
  float rounding,
  float cellScale,
  float normalization,
  int octaves,
  float lacunarity,
  float gain,
  vec2 seed
) {
  float strength = strengthIn * scale;
  float fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);

  vec3 inputHS = baseHeightAndSlope;
  vec3 hAndS = baseHeightAndSlope;

  float safeScale = max(scale * cellScale, 0.005);
  float freq = 1.0 / safeScale;
  vec2 slope = baseHeightAndSlope.yz;
  float slopeLength = max(length(slope), 1e-6);
  float roundingMult = 1.0;

  // Runevision's tuned onset & assumed-slope constants:
  // rounding vec4(ridgeRounding, creaseRounding, inputMult, octaveLacunarityMult)
  vec4 roundingVec = vec4(rounding, rounding * 0.35, 0.1, 2.0);
  vec4 onset = vec4(1.25, 1.25, 2.8, 1.5);
  vec2 assumedSlope = vec2(0.7, 0.78);

  float roundingForInput = mix(
    roundingVec.y,
    roundingVec.x,
    clamp(fadeTarget + 0.5, 0.0, 1.0)
  ) * roundingVec.z;

  float combiMask = erosionEaseOut(erosionSmoothStart(
    slopeLength * onset.x,
    roundingForInput * onset.x
  ));

  float ridgeMapCombiMask = erosionEaseOut(slopeLength * onset.z);
  float ridgeMapFadeTarget = fadeTarget;

  vec2 gullySlope = mix(
    slope,
    (slope / slopeLength) * assumedSlope.x,
    assumedSlope.y
  );

  for (int eo = 0; eo < 5; eo++) {
    if (eo >= octaves) break;

    vec2 octSeed = seed + vec2(float(eo) * 17.3, float(eo) * 31.7);
    vec4 phacelle = phacelleNoise(
      p * freq,
      erosionSafeNormalize(gullySlope),
      cellScale,
      0.25,
      normalization,
      octSeed
    );

    vec2 pZw = phacelle.zw * (-freq);
    float sloping = abs(phacelle.y);

    // Straight gullies: sign(sin) fakes constant triangle-wave sides so child gullies branch cleanly.
    float sgn = (phacelle.y > 0.0) ? 1.0 : ((phacelle.y < 0.0) ? -1.0 : 0.0);
    gullySlope += sgn * pZw * strength * gullyWeight;

    vec3 octaveHS = vec3(phacelle.x, phacelle.y * pZw.x, phacelle.y * pZw.y);
    vec3 faded = mix(vec3(fadeTarget, 0.0, 0.0), octaveHS * gullyWeight, combiMask);
    hAndS += faded * strength;

    fadeTarget = faded.x;

    float roundingForOctave = mix(
      roundingVec.y,
      roundingVec.x,
      clamp(phacelle.x + 0.5, 0.0, 1.0)
    ) * roundingMult;

    float newMask = erosionEaseOut(erosionSmoothStart(
      sloping * onset.y,
      roundingForOctave * onset.y
    ));
    combiMask = erosionPowInv(combiMask, detail) * newMask;

    ridgeMapFadeTarget = mix(ridgeMapFadeTarget, octaveHS.x, ridgeMapCombiMask);
    float newRidgeMask = erosionEaseOut(sloping * onset.w);
    ridgeMapCombiMask *= newRidgeMask;

    strength *= gain;
    freq *= lacunarity;
    roundingMult *= roundingVec.w;
  }

  float ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
  return vec4(hAndS.x - inputHS.x, hAndS.y - inputHS.y, hAndS.z - inputHS.z, ridgeMap);
}

// Mode 2 helper: Clay John / Fewes 4x4 cellular Gavoronoise directional wave kernel.
// Returns vec3(cosWave, dWave/dx, dWave/dy).
vec3 gavoronoiseErosion(vec2 p, vec2 dir, float normalization, vec2 seed) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  vec3 va = vec3(0.0);
  float wt = 0.0;

  for (int i = -2; i <= 1; i++) {
    for (int j = -2; j <= 1; j++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = hash22(ip - o + seed) * 0.5;
      vec2 pp = fp + o - h;
      float d = dot(pp, pp);
      float w = exp(-d * 2.0);
      wt += w;
      float mag = dot(pp, dir);
      va += vec3(cos(mag * EROSION_TAU), -sin(mag * EROSION_TAU) * dir) * w;
    }
  }

  vec3 res = va / max(wt, 1e-5);
  // Optional partial amplitude stabilization controlled by normalization gene
  if (normalization > 0.01) {
    float waveAmp = clamp(abs(res.x), max(1.0 - normalization * 0.7, 0.25), 1.0);
    res.x = res.x / max(waveAmp, 0.25);
  }
  return res;
}

// Mode 2: Classic Clay John / Fewes Frequency-Approach Erosion Filter.
// Returns vec4(heightDelta, slopeDeltaX, slopeDeltaY, ridgeMap).
vec4 erosionFilterClassic(
  vec2 p,
  vec3 baseHeightAndSlope,
  float scale,
  float strengthIn,
  float gullyWeight,
  float detail,
  float rounding,
  float cellScale,
  float normalization,
  int octaves,
  float lacunarity,
  float gain,
  vec2 seed
) {
  float tiles = 1.0 / max(scale * cellScale * 1.35, 0.02);
  float slopeStrength = 1.6 + gullyWeight * 2.8;
  float branchStrength = 1.0 + detail * 1.25;

  // Curl of the slope vector drives Gavoronoise stripe direction
  vec2 dir = baseHeightAndSlope.zy * vec2(1.0, -1.0) * slopeStrength;

  vec3 h = vec3(0.0);
  float a = 0.5;
  float f = 1.0;

  // Smooth valley damping (Fewes' WATER_HEIGHT valleybulge suppression scaled by rounding)
  float valleySmooth = mix(1.0, smoothstep(0.15, 0.55, baseHeightAndSlope.x), clamp(rounding * 2.5, 0.0, 1.0));
  a *= valleySmooth;

  for (int eo = 0; eo < 5; eo++) {
    if (eo >= octaves) break;
    vec2 octSeed = seed + vec2(float(eo) * 19.1, float(eo) * 29.3);
    vec2 branchDir = dir + h.zy * vec2(1.0, -1.0) * branchStrength;
    vec3 er = gavoronoiseErosion(p * tiles * f, branchDir, normalization, octSeed);
    h += er * a * vec3(1.0, f, f);
    a *= gain;
    f *= lacunarity;
  }

  float heightDelta = h.x * strengthIn * 0.42;
  float ridgeMap = clamp(h.x * 1.4, -1.0, 1.0);
  return vec4(heightDelta, h.y * strengthIn * 0.42, h.z * strengthIn * 0.42, ridgeMap);
}
`;
