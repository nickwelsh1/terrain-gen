import { UNIFORM_DECLS, NOISE_LIB, HEIGHT_SHAPING, COLORIZE } from './noiseLib.glsl.js';

// Master 2D fragment shader: heightAt -> Laplacian curvature -> shaping -> colorize.
export const FRAG_2D =
  UNIFORM_DECLS +
  NOISE_LIB +
  HEIGHT_SHAPING +
  COLORIZE +
  /* glsl */ `
varying vec2 vUv;

void main() {
  vec2 p = vUv * uFrequency;
  vec2 hr = erodedHeightAndRidge(p);
  float h = hr.x;
  float ridgeMap = hr.y;

  float lap = 0.0;
  if (abs(uLaplacianWeight) > 0.0001 || uColorMode == 2) {
    float eps = max(uLaplacianStep, 0.0005) * uFrequency;
    float rawLap = laplacianAt(p, eps) - ridgeMap * 2.2;
    lap = tanh(rawLap * 0.35);
    h = clamp(h - uLaplacianWeight * 0.22 * lap, 0.0, 1.0);
  }

  h = shapeHeight(h);

  vec3 col;
  if (uColorMode == 1) {
    col = hypsometric(h);
  } else if (uColorMode == 2) {
    col = curvatureRamp(lap) + h * 0.12;
  } else if (uColorMode == 3) {
    float dx = dFdx(h);
    float dy = dFdy(h);
    vec3 n = normalize(vec3(-dx * 40.0, -dy * 40.0, 1.0));
    col = n * 0.5 + 0.5;
  } else if (uColorMode == 4) {
    float slopeMag = length(vec2(dFdx(h), dFdy(h))) * 45.0;
    col = alpineDrainageRamp(h, ridgeMap, slopeMag);
  } else if (uColorMode == 5) {
    col = erosionRidgeRamp(h, ridgeMap);
  } else {
    col = vec3(h);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// 3D preview fragment shader: faceted normals via screen-space derivatives,
// directional diffuse + rim light over the same color ramps.
export const FRAG_3D =
  UNIFORM_DECLS +
  NOISE_LIB +
  HEIGHT_SHAPING +
  COLORIZE +
  /* glsl */ `
varying vec2 vUv;
varying float vHeight;
varying float vRidgeMap;
varying float vLap;
varying vec3 vViewPos;

void main() {
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 ldir = normalize(vec3(0.45, 0.55, 0.7));
  float diff = max(dot(n, ldir), 0.0);
  vec3 viewDir = normalize(-vViewPos);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);

  vec3 base = vec3(vHeight);
  if (uColorMode == 1) {
    base = hypsometric(vHeight);
  } else if (uColorMode == 2) {
    base = curvatureRamp(vLap) + vHeight * 0.12;
  } else if (uColorMode == 3) {
    float dx = dFdx(vHeight);
    float dy = dFdy(vHeight);
    vec3 nm = normalize(vec3(-dx * 40.0, -dy * 40.0, 1.0));
    base = nm * 0.5 + 0.5;
  } else if (uColorMode == 4) {
    float slopeMag = clamp(1.0 - abs(n.z), 0.0, 1.0) * 1.4;
    base = alpineDrainageRamp(vHeight, vRidgeMap, slopeMag);
  } else if (uColorMode == 5) {
    base = erosionRidgeRamp(vHeight, vRidgeMap);
  }
  vec3 col = base * (0.30 + 0.78 * diff) + rim * vec3(0.30, 0.55, 0.90) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;
