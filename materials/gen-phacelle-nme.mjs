import { writeFileSync } from 'node:fs';

// Stage 1: baseHS — warped fBm base field + plateauRim shaping, evaluated at 5 taps
// to produce the central-difference gradient the phacelle filter steers by.
// Emits vec4(h, gx * 0.75, gy * 0.75, rawH) matching noiseLib's baseHS + rawH for fade gating.
const baseHSCode = `vec3 bf_permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float bf_simplex(vec2 v, vec2 seed) {
  v += seed;
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = bf_permute(bf_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g) * 0.5;
}
float bf_fbm(vec2 p, float octaves, float persistence, float lacunarity, vec2 seed) {
  float amp = 1.0; float sum = 0.0; float norm = 0.0;
  vec2 sp = p;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= octaves) break;
    float n = bf_simplex(sp, seed) * 0.5 + 0.5;
    sum += n * amp; norm += amp;
    amp *= persistence;
    sp = mat2(0.8, -0.6, 0.6, 0.8) * sp * lacunarity;
  }
  return clamp(sum / max(norm, 0.0001), 0.0, 1.0);
}
vec2 bf_domainWarp(vec2 p, vec2 seed, float intensity, float freq, float octs, float persistence) {
  if (intensity < 0.0001) return p;
  vec2 q = vec2(
    bf_fbm(p * freq, octs, persistence, 2.0, seed + vec2(5.2, 1.3)),
    bf_fbm(p * freq, octs, persistence, 2.0, seed + vec2(6.8, 4.1)));
  vec2 r = vec2(
    bf_fbm(p * freq + 4.0 * q + vec2(1.7, 9.2), octs, persistence, 2.0, seed + vec2(0.4, 2.6)),
    bf_fbm(p * freq + 4.0 * q + vec2(8.3, 2.8), octs, persistence, 2.0, seed + vec2(9.1, 5.5)));
  return p + intensity * (r * 2.0 - 1.0);
}
float bf_baseAt(vec2 p, vec2 seed, float octaves, float persistence, float lacunarity, float wi, float wf, float wo) {
  vec2 wp = bf_domainWarp(p, seed, wi, wf, wo, persistence);
  return bf_fbm(wp, octaves, persistence, lacunarity, seed);
}
float bf_plateau(float h, float rimAmount) {
  if (rimAmount <= 0.001) return h;
  float rim = 0.42 + 0.14 * rimAmount;
  float plateauFloor = mix(rim, 0.66, rimAmount * 0.82);
  if (h >= rim) {
    float t = (h - rim) / max(1.0 - rim, 1e-4);
    float undulation = pow(t, 0.85);
    return mix(h, plateauFloor + (1.0 - plateauFloor) * undulation, rimAmount);
  }
  float t = clamp(h / max(rim, 1e-4), 0.0, 1.0);
  float incised = t * t * (3.0 - 2.0 * t) * pow(t, 0.55 + 0.85 * rimAmount);
  return mix(h, incised * plateauFloor, rimAmount);
}
// stage: vec4(plateau-shaped h, central-difference slope * 0.75, rawH)
void baseHS(vec2 uv, vec2 seed, float frequency, float octaves, float persistence, float lacunarity, float warpIntensity, float warpFrequency, float warpOctaves, float rimAmount, out vec4 result) {
  vec2 p = uv * frequency;
  float eps = 0.024;
  float rawH = bf_baseAt(p, seed, octaves, persistence, lacunarity, warpIntensity, warpFrequency, warpOctaves);
  float h = bf_plateau(rawH, rimAmount);
  float hxp = bf_plateau(bf_baseAt(p + vec2(eps, 0.0), seed, octaves, persistence, lacunarity, warpIntensity, warpFrequency, warpOctaves), rimAmount);
  float hxm = bf_plateau(bf_baseAt(p - vec2(eps, 0.0), seed, octaves, persistence, lacunarity, warpIntensity, warpFrequency, warpOctaves), rimAmount);
  float hyp = bf_plateau(bf_baseAt(p + vec2(0.0, eps), seed, octaves, persistence, lacunarity, warpIntensity, warpFrequency, warpOctaves), rimAmount);
  float hym = bf_plateau(bf_baseAt(p - vec2(0.0, eps), seed, octaves, persistence, lacunarity, warpIntensity, warpFrequency, warpOctaves), rimAmount);
  float gx = (hxp - hxm) / (2.0 * eps);
  float gy = (hyp - hym) / (2.0 * eps);
  result = vec4(h, gx * 0.75, gy * 0.75, rawH);
}`;

// Stage 2: erosionPhacelle — Runevision 2026 Simple Phacelle Noise + fade-approach
// stacked-fade filter (straight gullies, edge rounding, dendritic ridge map).
// Ported verbatim from genetic-shaders chunks/erosion.glsl.js, namespaced er_*.
const erosionPhacelleCode = `const float ER_TAU = 6.28318530718;
float er_powInv(float t, float power) {
  return 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), max(power, 0.001));
}
float er_easeOut(float t) {
  float v = 1.0 - clamp(t, 0.0, 1.0);
  return 1.0 - v * v;
}
float er_smoothStart(float t, float smoothing) {
  if (t >= smoothing) return t - 0.5 * smoothing;
  return 0.5 * t * t / max(smoothing, 0.0001);
}
vec2 er_safeNormalize(vec2 n) {
  float l = length(n);
  return (l > 1e-6) ? (n / l) : vec2(0.0);
}
vec2 er_hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
vec4 er_phacelleNoise(vec2 p, vec2 normDir, float freq, float offsetCycles, float normalization, vec2 seed) {
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * freq * ER_TAU;
  float offset = offsetCycles * ER_TAU;
  vec2 pInt = floor(p);
  vec2 pFrac = fract(p);
  vec2 phaseDir = vec2(0.0);
  float weightSum = 0.0;
  for (int i = -1; i <= 2; i++) {
    for (int j = -1; j <= 2; j++) {
      vec2 gridOffset = vec2(float(i), float(j));
      vec2 gridPoint = pInt + gridOffset;
      vec2 randomOffset = er_hash22(gridPoint + seed) * 0.5;
      vec2 v = pFrac - gridOffset - randomOffset;
      float sqrDist = dot(v, v);
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
vec4 er_filter(vec2 p, vec3 baseHeightAndSlope, float fadeTargetIn, float scale, float strengthIn, float gullyWeight, float detail, float rounding, float cellScale, float normalization, int octaves, float lacunarity, float gain, vec2 seed) {
  float strength = strengthIn * scale;
  float fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);
  vec3 inputHS = baseHeightAndSlope;
  vec3 hAndS = baseHeightAndSlope;
  float safeScale = max(scale * cellScale, 0.005);
  float freq = 1.0 / safeScale;
  vec2 slope = baseHeightAndSlope.yz;
  float slopeLength = max(length(slope), 1e-6);
  float roundingMult = 1.0;
  vec4 roundingVec = vec4(rounding, rounding * 0.35, 0.1, 2.0);
  vec4 onset = vec4(1.25, 1.25, 2.8, 1.5);
  vec2 assumedSlope = vec2(0.7, 0.78);
  float roundingForInput = mix(roundingVec.y, roundingVec.x, clamp(fadeTarget + 0.5, 0.0, 1.0)) * roundingVec.z;
  float combiMask = er_easeOut(er_smoothStart(slopeLength * onset.x, roundingForInput * onset.x));
  float ridgeMapCombiMask = er_easeOut(slopeLength * onset.z);
  float ridgeMapFadeTarget = fadeTarget;
  vec2 gullySlope = mix(slope, (slope / slopeLength) * assumedSlope.x, assumedSlope.y);
  for (int eo = 0; eo < 5; eo++) {
    if (eo >= octaves) break;
    vec2 octSeed = seed + vec2(float(eo) * 17.3, float(eo) * 31.7);
    vec4 phacelle = er_phacelleNoise(p * freq, er_safeNormalize(gullySlope), cellScale, 0.25, normalization, octSeed);
    vec2 pZw = phacelle.zw * (-freq);
    float sloping = abs(phacelle.y);
    float sgn = (phacelle.y > 0.0) ? 1.0 : ((phacelle.y < 0.0) ? -1.0 : 0.0);
    gullySlope += sgn * pZw * strength * gullyWeight;
    vec3 octaveHS = vec3(phacelle.x, phacelle.y * pZw.x, phacelle.y * pZw.y);
    vec3 faded = mix(vec3(fadeTarget, 0.0, 0.0), octaveHS * gullyWeight, combiMask);
    hAndS += faded * strength;
    fadeTarget = faded.x;
    float roundingForOctave = mix(roundingVec.y, roundingVec.x, clamp(phacelle.x + 0.5, 0.0, 1.0)) * roundingMult;
    float newMask = er_easeOut(er_smoothStart(sloping * onset.y, roundingForOctave * onset.y));
    combiMask = er_powInv(combiMask, detail) * newMask;
    ridgeMapFadeTarget = mix(ridgeMapFadeTarget, octaveHS.x, ridgeMapCombiMask);
    float newRidgeMask = er_easeOut(sloping * onset.w);
    ridgeMapCombiMask *= newRidgeMask;
    strength *= gain;
    freq *= lacunarity;
    roundingMult *= roundingVec.w;
  }
  float ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
  return vec4(hAndS.x - inputHS.x, hAndS.y - inputHS.y, hAndS.z - inputHS.z, ridgeMap);
}
// stage: erodedHeightAndRidge (mode 1) — plateau-masked phacelle erosion. vec2(h, ridgeMap)
void erosionPhacelle(vec2 uv, float frequency, float scale, float h, float gx, float gy, float rawH, float rimAmount, float strength, float gullyWeight, float detail, float rounding, float cellScale, float normalization, float octaves, float lacunarity, float gain, vec2 seed, out vec2 result) {
  vec3 baseHS = vec3(h, gx, gy);
  float slopeMag = length(vec2(gx, gy));
  float rimThresh = 0.42 + 0.14 * rimAmount;
  float inBasin = 1.0 - smoothstep(rimThresh - 0.06, rimThresh + 0.14, rawH);
  float onRimWall = smoothstep(0.18, 0.75, slopeMag);
  float plateauMask = mix(1.0, clamp(max(inBasin, onRimWall * 0.85), 0.15, 1.0), rimAmount);
  float effStrength = strength * plateauMask;
  if (effStrength <= 0.0001) {
    result = vec2(h, 0.0);
    return;
  }
  float fadeTarget = clamp((h - 0.5) * 2.6 - rimAmount * inBasin * 0.85, -1.0, 1.0);
  vec2 ep = uv * frequency * 0.3333333;
  vec4 er = er_filter(ep, baseHS, fadeTarget, scale, effStrength, gullyWeight, detail, rounding, cellScale, normalization, int(floor(octaves + 0.5)), lacunarity, gain, seed + vec2(11.3, 23.7));
  result = vec2(clamp(h + er.x * 3.2, 0.0, 1.0), er.w * plateauMask);
}`;

const shapeHeightCode = `// stage: shapeHeight = ridgeSharpness pow -> contrast/bias -> invert -> roundPeaks
void shapeHeight(float h, float ridgeSharpness, float contrast, float bias, float invert, float peakRounding, out float result) {
  h = pow(clamp(h, 0.0, 1.0), ridgeSharpness);
  h = clamp((h - 0.5) * contrast + 0.5 + bias, 0.0, 1.0);
  if (invert > 0.5) h = 1.0 - h;
  if (peakRounding > 0.001) {
    float w = 0.45 * peakRounding;
    float c = 1.0 - w;
    if (h > c) h = c + w * (1.0 - exp(-(h - c) / w));
  }
  result = h;
}`;

// Stage 4: alpineDrainage — colorMode 4 ramp; slopeMag from screen-space
// derivatives of the shaped height, exactly as heightmap.frag does.
const alpineDrainageCode = `vec3 ad_ramp(float h, float ridgeMap, float slopeMag) {
  vec3 valleyGrass = vec3(0.16, 0.30, 0.14);
  vec3 dryDirt     = vec3(0.48, 0.41, 0.31);
  vec3 cliffRock   = vec3(0.33, 0.31, 0.29);
  vec3 highSnow    = vec3(0.92, 0.94, 0.98);
  vec3 streamCol   = vec3(0.74, 0.84, 0.92);
  vec3 col = mix(valleyGrass, dryDirt, smoothstep(0.20, 0.62, h));
  float rockMask = clamp(slopeMag * 0.85 + smoothstep(0.45, 0.80, h) * 0.35, 0.0, 1.0);
  col = mix(col, cliffRock, rockMask);
  float ridgeHighlight = smoothstep(0.10, 0.75, ridgeMap);
  col = mix(col, vec3(0.68, 0.61, 0.50), ridgeHighlight * 0.38);
  float snowMask = smoothstep(0.68, 0.88, h - slopeMag * 0.14 + ridgeMap * 0.05);
  col = mix(col, highSnow, snowMask);
  float drainage = smoothstep(-0.08, -0.58, ridgeMap) * (1.0 - snowMask * 0.6);
  col = mix(col, streamCol, drainage * 0.78);
  return col;
}
void alpineDrainage(float h, float ridge, out vec3 result) {
  float slopeMag = length(vec2(dFdx(h), dFdy(h))) * 45.0;
  result = ad_ramp(h, ridge, slopeMag);
}`;

const inp = (name, from, conn = "output") => ({ name, displayName: name, inputName: name, targetBlockId: from, targetConnectionName: conn });
const free = (name) => ({ name, displayName: name });
const out = (name) => ({ name, displayName: name });
const inputBlock = (id, name, extra) => ({
  customType: "BABYLON.InputBlock", id, name, target: 1, inputs: [], outputs: [out("output")],
  mode: 0, min: 0, max: 0, isBoolean: false, matrixMode: 0, isConstant: false,
  groupInInspector: "", convertToGammaSpace: false, convertToLinearSpace: false,
  animationType: 0, type: 1, value: 0, valueType: "number", ...extra,
});
const floatIn = (name) => ({ name, type: "Float" });
const customBlock = (id, name, code, inputs, outputs, inParams, outParams) => ({
  customType: "BABYLON.CustomBlock", id, name, target: 4, inputs, outputs,
  options: { code: code.split("\n"), functionName: name, target: "Neutral", inParameters: inParams, outParameters: outParams },
});
const splitter = (id, name, from, conn) => ({
  customType: "BABYLON.VectorSplitterBlock", id, name, target: 4,
  inputs: [inp("xyzw", from, conn)],
  outputs: [out("xyz"), out("x"), out("y"), out("z"), out("w"), out("xy")],
});

const matrixValue = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const blocks = [
  inputBlock(1, "position", { mode: 1, attributeName: "position", type: 8, value: [0, 0, 0], valueType: "BABYLON.Vector3" }),
  inputBlock(2, "wvp", { systemValue: 6, type: 128, value: matrixValue, valueType: "BABYLON.Matrix" }),
  { customType: "BABYLON.TransformBlock", id: 3, name: "clipPos", target: 4, inputs: [inp("vector", 42), inp("transform", 2)], outputs: [out("output"), out("xyz")], complementZ: 0, complementW: 1 },
  {
    customType: "BABYLON.VertexOutputBlock", id: 4, name: "vertexOutput", target: 1,
    inputs: [{ name: "vector", displayName: "vector", inputName: "vector", targetBlockId: 3, targetConnectionName: "output" }],
    outputs: [],
  },
  inputBlock(5, "uv", { mode: 1, attributeName: "uv", type: 4, value: [0, 0], valueType: "BABYLON.Vector2" }),
  inputBlock(6, "seed", { type: 4, value: [137.5, 223.9], valueType: "BABYLON.Vector2" }),
  inputBlock(7, "frequency", { min: 0.2, max: 5, value: 0.5 }),
  inputBlock(8, "octaves", { min: 1, max: 8, value: 5 }),
  inputBlock(9, "persistence", { min: 0.15, max: 0.85, value: 0.5 }),
  inputBlock(10, "lacunarity", { min: 1.5, max: 3.2, value: 2 }),
  inputBlock(11, "warpIntensity", { min: 0, max: 2.5, value: 0.3 }),
  inputBlock(12, "warpFrequency", { min: 0.1, max: 8, value: 0.7 }),
  inputBlock(13, "warpOctaves", { min: 1, max: 4, value: 2 }),
  inputBlock(14, "rimAmount", { min: 0, max: 1, value: 0.35 }),
  customBlock(15, "baseHS", baseHSCode,
    [inp("uv", 5), inp("seed", 6), inp("frequency", 7), inp("octaves", 8), inp("persistence", 9), inp("lacunarity", 10), inp("warpIntensity", 11), inp("warpFrequency", 12), inp("warpOctaves", 13), inp("rimAmount", 14)],
    [out("result")],
    [{ name: "uv", type: "Vector2" }, { name: "seed", type: "Vector2" }, ...["frequency", "octaves", "persistence", "lacunarity", "warpIntensity", "warpFrequency", "warpOctaves", "rimAmount"].map(floatIn)],
    [{ name: "result", type: "Vector4" }]),
  splitter(16, "hsSplit", 15, "result"),
  inputBlock(17, "erScale", { min: 0.05, max: 0.5, value: 0.15 }),
  inputBlock(18, "erStrength", { min: 0, max: 0.4, value: 0.2 }),
  inputBlock(19, "gullyWeight", { min: 0.15, max: 1, value: 0.5 }),
  inputBlock(20, "erDetail", { min: 0.5, max: 3, value: 1.5 }),
  inputBlock(21, "erRounding", { min: 0, max: 0.5, value: 0.1 }),
  inputBlock(22, "cellScale", { min: 0.45, max: 1.1, value: 0.7 }),
  inputBlock(23, "erNormalization", { min: 0, max: 0.85, value: 0.5 }),
  inputBlock(24, "erOctaves", { min: 1, max: 5, value: 4 }),
  inputBlock(25, "erLacunarity", { min: 1.5, max: 2.8, value: 2 }),
  inputBlock(26, "erGain", { min: 0.25, max: 0.75, value: 0.5 }),
  customBlock(27, "erosionPhacelle", erosionPhacelleCode,
    [inp("uv", 5), inp("frequency", 7), inp("scale", 17), inp("h", 16, "x"), inp("gx", 16, "y"), inp("gy", 16, "z"), inp("rawH", 16, "w"), inp("rimAmount", 14), inp("strength", 18), inp("gullyWeight", 19), inp("detail", 20), inp("rounding", 21), inp("cellScale", 22), inp("normalization", 23), inp("octaves", 24), inp("lacunarity", 25), inp("gain", 26), inp("seed", 6)],
    [out("result")],
    [{ name: "uv", type: "Vector2" }, ...["frequency", "scale", "h", "gx", "gy", "rawH", "rimAmount", "strength", "gullyWeight", "detail", "rounding", "cellScale", "normalization", "octaves", "lacunarity", "gain"].map(floatIn), { name: "seed", type: "Vector2" }],
    [{ name: "result", type: "Vector2" }]),
  splitter(28, "hrSplit", 27, "result"),
  inputBlock(29, "ridgeSharpness", { min: 0.1, max: 4, value: 1 }),
  inputBlock(30, "contrast", { min: 0.2, max: 4, value: 1 }),
  inputBlock(31, "bias", { min: -1, max: 1, value: 0 }),
  inputBlock(32, "invert", { min: 0, max: 1, value: 0 }),
  inputBlock(33, "peakRounding", { min: 0, max: 1, value: 0 }),
  customBlock(34, "shapeHeight", shapeHeightCode,
    [inp("h", 28, "x"), inp("ridgeSharpness", 29), inp("contrast", 30), inp("bias", 31), inp("invert", 32), inp("peakRounding", 33)],
    [out("h")],
    [floatIn("h"), floatIn("ridgeSharpness"), floatIn("contrast"), floatIn("bias"), floatIn("invert"), floatIn("peakRounding")],
    [floatIn("h")]),
  customBlock(35, "alpineDrainage", alpineDrainageCode,
    [inp("h", 34, "h"), inp("ridge", 28, "y")],
    [out("result")],
    [floatIn("h"), floatIn("ridge")],
    [{ name: "result", type: "Color3" }]),
  inputBlock(36, "alpha", { isConstant: true, value: 1 }),
  inputBlock(38, "normal", { mode: 1, attributeName: "normal", type: 8, value: [0, 0, 0], valueType: "BABYLON.Vector3" }),
  inputBlock(39, "displacementScale", { min: 0, max: 2, value: 1 }),
  {
    customType: "BABYLON.MultiplyBlock", id: 40, name: "hScaled", target: 4,
    inputs: [inp("left", 34, "h"), inp("right", 39)],
    outputs: [out("output")],
  },
  {
    customType: "BABYLON.ScaleBlock", id: 41, name: "normalOffset", target: 4,
    inputs: [inp("input", 38), inp("factor", 40)],
    outputs: [out("output")],
  },
  {
    customType: "BABYLON.AddBlock", id: 42, name: "displacedPos", target: 4,
    inputs: [inp("left", 1), inp("right", 41)],
    outputs: [out("output")],
  },
  {
    customType: "BABYLON.FragmentOutputBlock", id: 37, name: "fragmentOutput", target: 2,
    inputs: [free("rgba"), { name: "rgb", displayName: "rgb", inputName: "rgb", targetBlockId: 35, targetConnectionName: "result" }, inp("a", 36), free("glow")],
    outputs: [],
  },
];

const depthOf = new Map();
const depth = (id, seen = new Set()) => {
  if (depthOf.has(id)) return depthOf.get(id);
  if (seen.has(id)) return 0;
  seen.add(id);
  const block = blocks.find((b) => b.id === id);
  const preds = (block?.inputs ?? []).filter((i) => i.targetBlockId != null).map((i) => i.targetBlockId);
  const d = preds.length ? 1 + Math.max(...preds.map((p) => depth(p, seen))) : 0;
  depthOf.set(id, d);
  return d;
};
const columnRow = new Map();
const locations = blocks.map((b) => {
  const col = depth(b.id);
  const row = columnRow.get(col) ?? 0;
  columnRow.set(col, row + 1);
  return { blockId: b.id, x: col * 340, y: row * 180 };
});

const doc = {
  ignoreAlpha: false, maxSimultaneousLights: 4, mode: 0, forceAlphaBlending: false,
  blocks, outputNodes: [4, 37],
  comment: "genetic-shaders mode-1 pipeline: baseHS -> erosionPhacelle (Runevision Simple Phacelle Noise, stacked fades, dendritic ridgeMap) -> shapeHeight -> alpineDrainage",
  editorData: { locations },
};

writeFileSync("materials/genetic-phacelle.nme.json", JSON.stringify(doc, null, 2));
console.log("written materials/genetic-phacelle.nme.json");
