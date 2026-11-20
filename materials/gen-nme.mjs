import { writeFileSync } from 'node:fs';

const warpedFbmCode = `vec3 gh_permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float gh_simplex(vec2 v, vec2 seed) {
  v += seed;
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = gh_permute(gh_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
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
float gh_fbm(vec2 p, float octaves, float persistence, float lacunarity, vec2 seed) {
  float amp = 1.0; float sum = 0.0; float norm = 0.0;
  vec2 sp = p;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= octaves) break;
    float n = gh_simplex(sp, seed) * 0.5 + 0.5;
    sum += n * amp; norm += amp;
    amp *= persistence;
    sp = mat2(0.8, -0.6, 0.6, 0.8) * sp * lacunarity;
  }
  return clamp(sum / max(norm, 0.0001), 0.0, 1.0);
}
vec2 gh_domainWarp(vec2 p, vec2 seed, float intensity, float freq, float octs, float persistence) {
  if (intensity < 0.0001) return p;
  vec2 q = vec2(
    gh_fbm(p * freq, octs, persistence, 2.0, seed + vec2(5.2, 1.3)),
    gh_fbm(p * freq, octs, persistence, 2.0, seed + vec2(6.8, 4.1)));
  vec2 r = vec2(
    gh_fbm(p * freq + 4.0 * q + vec2(1.7, 9.2), octs, persistence, 2.0, seed + vec2(0.4, 2.6)),
    gh_fbm(p * freq + 4.0 * q + vec2(8.3, 2.8), octs, persistence, 2.0, seed + vec2(9.1, 5.5)));
  return p + intensity * (r * 2.0 - 1.0);
}
// stage: baseHeightAt = fbm(domainWarp(uv * frequency))
void warpedFbm(vec2 uv, vec2 seed, float frequency, float octaves, float persistence, float lacunarity, float warpIntensity, float warpFrequency, float warpOctaves, out float result) {
  vec2 p = uv * frequency;
  vec2 wp = gh_domainWarp(p, seed, warpIntensity, warpFrequency, warpOctaves, persistence);
  result = gh_fbm(wp, octaves, persistence, lacunarity, seed);
}`;

const plateauRimCode = `// stage: applyPlateauRim — plateau preserved above rim, incised canyon below
void plateauRim(float h, float rimAmount, out float result) {
  if (rimAmount <= 0.001) { result = h; return; }
  float rim = 0.42 + 0.14 * rimAmount;
  float plateauFloor = mix(rim, 0.66, rimAmount * 0.82);
  if (h >= rim) {
    float t = (h - rim) / max(1.0 - rim, 1e-4);
    float undulation = pow(t, 0.85);
    result = mix(h, plateauFloor + (1.0 - plateauFloor) * undulation, rimAmount);
  } else {
    float t = clamp(h / max(rim, 1e-4), 0.0, 1.0);
    float incised = t * t * (3.0 - 2.0 * t) * pow(t, 0.55 + 0.85 * rimAmount);
    result = mix(h, incised * plateauFloor, rimAmount);
  }
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

const hypsometricCode = `// stage: hypsometric ramp — water -> teal -> grass -> rock -> snow
void hypsometric(float h, out vec3 result) {
  vec3 c = mix(vec3(0.03, 0.09, 0.23), vec3(0.05, 0.35, 0.45), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(0.30, 0.55, 0.25), smoothstep(0.35, 0.55, h));
  c = mix(c, vec3(0.62, 0.55, 0.40), smoothstep(0.55, 0.75, h));
  c = mix(c, vec3(0.92, 0.93, 0.97), smoothstep(0.75, 1.0, h));
  result = c;
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
const customBlock = (id, name, code, inputs, outputs, inParams, outParams) => ({
  customType: "BABYLON.CustomBlock", id, name, target: 4, inputs, outputs,
  options: { code: code.split("\n"), functionName: name, target: "Neutral", inParameters: inParams, outParameters: outParams },
});

const matrixValue = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const blocks = [
  inputBlock(1, "position", { mode: 1, attributeName: "position", type: 8, value: [0, 0, 0], valueType: "BABYLON.Vector3" }),
  inputBlock(2, "wvp", { systemValue: 6, type: 128, value: matrixValue, valueType: "BABYLON.Matrix" }),
  { customType: "BABYLON.TransformBlock", id: 3, name: "clipPos", target: 4, inputs: [inp("vector", 1), inp("transform", 2)], outputs: [out("output"), out("xyz")], complementZ: 0, complementW: 1 },
  {
    customType: "BABYLON.VertexOutputBlock", id: 4, name: "vertexOutput", target: 1,
    inputs: [{ name: "vector", displayName: "vector", inputName: "vector", targetBlockId: 3, targetConnectionName: "output" }],
    outputs: [],
  },
  inputBlock(5, "uv", { mode: 1, attributeName: "uv", type: 4, value: [0, 0], valueType: "BABYLON.Vector2" }),
  inputBlock(6, "seed", { type: 4, value: [137.5, 223.9], valueType: "BABYLON.Vector2" }),
  inputBlock(7, "frequency", { min: 0.5, max: 16, value: 4 }),
  inputBlock(8, "octaves", { min: 1, max: 8, value: 5 }),
  inputBlock(9, "persistence", { min: 0.15, max: 0.85, value: 0.5 }),
  inputBlock(10, "lacunarity", { min: 1.5, max: 3.2, value: 2 }),
  inputBlock(11, "warpIntensity", { min: 0, max: 2.5, value: 0.3 }),
  inputBlock(12, "warpFrequency", { min: 0.1, max: 8, value: 0.7 }),
  inputBlock(13, "warpOctaves", { min: 1, max: 4, value: 2 }),
  customBlock(14, "warpedFbm", warpedFbmCode,
    [inp("uv", 5), inp("seed", 6), inp("frequency", 7), inp("octaves", 8), inp("persistence", 9), inp("lacunarity", 10), inp("warpIntensity", 11), inp("warpFrequency", 12), inp("warpOctaves", 13)],
    [out("h")],
    [{ name: "uv", type: "Vector2" }, { name: "seed", type: "Vector2" }, { name: "frequency", type: "Float" }, { name: "octaves", type: "Float" }, { name: "persistence", type: "Float" }, { name: "lacunarity", type: "Float" }, { name: "warpIntensity", type: "Float" }, { name: "warpFrequency", type: "Float" }, { name: "warpOctaves", type: "Float" }],
    [{ name: "h", type: "Float" }]),
  inputBlock(15, "rimAmount", { min: 0, max: 1, value: 0 }),
  customBlock(16, "plateauRim", plateauRimCode,
    [inp("h", 14, "h"), inp("rimAmount", 15)],
    [out("h")],
    [{ name: "h", type: "Float" }, { name: "rimAmount", type: "Float" }],
    [{ name: "h", type: "Float" }]),
  inputBlock(17, "ridgeSharpness", { min: 0.1, max: 4, value: 1 }),
  inputBlock(18, "contrast", { min: 0.2, max: 4, value: 1 }),
  inputBlock(19, "bias", { min: -1, max: 1, value: 0 }),
  inputBlock(20, "invert", { min: 0, max: 1, value: 0 }),
  inputBlock(21, "peakRounding", { min: 0, max: 1, value: 0 }),
  customBlock(22, "shapeHeight", shapeHeightCode,
    [inp("h", 16, "h"), inp("ridgeSharpness", 17), inp("contrast", 18), inp("bias", 19), inp("invert", 20), inp("peakRounding", 21)],
    [out("h")],
    [{ name: "h", type: "Float" }, { name: "ridgeSharpness", type: "Float" }, { name: "contrast", type: "Float" }, { name: "bias", type: "Float" }, { name: "invert", type: "Float" }, { name: "peakRounding", type: "Float" }],
    [{ name: "h", type: "Float" }]),
  customBlock(23, "hypsometric", hypsometricCode,
    [inp("h", 22, "h")],
    [out("col")],
    [{ name: "h", type: "Float" }],
    [{ name: "col", type: "Color3" }]),
  inputBlock(24, "alpha", { isConstant: true, value: 1 }),
  {
    customType: "BABYLON.FragmentOutputBlock", id: 25, name: "fragmentOutput", target: 2,
    inputs: [free("rgba"), { name: "rgb", displayName: "rgb", inputName: "rgb", targetBlockId: 23, targetConnectionName: "col" }, inp("a", 24), free("glow")],
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
  blocks, outputNodes: [4, 25],
  comment: "genetic-shaders pipeline as stage blocks: warpedFbm -> plateauRim -> shapeHeight -> hypsometric",
  editorData: { locations },
};

writeFileSync("materials/genetic-height.nme.json", JSON.stringify(doc, null, 2));
console.log("written materials/genetic-height.nme.json");
