// Shared hash utilities and octave rotation matrix.
export const NOISE_COMMON = /* glsl */ `
// Deterministic vec2 -> vec2 hash in [-1, 1]
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

// Deterministic vec2 -> float hash in [0, 1]
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Rotation applied between fBm octaves to break axial alignment.
const mat2 OCT_ROT = mat2(0.8, -0.6, 0.6, 0.8);
`;
