import { UNIFORM_DECLS, NOISE_LIB, HEIGHT_SHAPING } from './noiseLib.glsl.js';

// Passthrough vertex shader for 2D fullscreen quads (PlaneGeometry(2,2)).
export const VERT_2D = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Displaced-mesh vertex shader for the 3D heightmap preview.
// Reuses the identical noise pipeline (including the Laplacian curvature
// pass) for displacement so the mesh matches the 2D fragment output.
export const VERT_3D =
  UNIFORM_DECLS +
  NOISE_LIB +
  HEIGHT_SHAPING +
  /* glsl */ `
varying vec2 vUv;
varying float vHeight;
varying float vRidgeMap;
varying float vLap;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vec2 p = uv * uFrequency;
  vec2 hr = erodedHeightAndRidge(p);
  float h = hr.x;
  vLap = 0.0;
  if (abs(uLaplacianWeight) > 0.0001 || uColorMode == 2) {
    float eps = max(uLaplacianStep, 0.0005) * uFrequency;
    float lap = tanh((laplacianAt(p, eps) - hr.y * 2.2) * 0.35);
    h = clamp(h - uLaplacianWeight * 0.22 * lap, 0.0, 1.0);
    vLap = lap;
  }
  h = shapeHeight(h);
  vHeight = h;
  vRidgeMap = hr.y;
  vec3 pos = position;
  pos.z += h * uDisplacementScale;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
