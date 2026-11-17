// Two-stage iterative domain warping (iq-style q/r fields).
export const DOMAIN_WARP = /* glsl */ `
vec2 domainWarp(vec2 p, vec2 seed, float intensity, float freq, int octs, float persistence) {
  if (intensity < 0.0001) return p;
  vec2 q = vec2(
    fbm(p * freq, 1, octs, persistence, 2.0, seed + vec2(5.2, 1.3)),
    fbm(p * freq, 1, octs, persistence, 2.0, seed + vec2(6.8, 4.1)));
  vec2 r = vec2(
    fbm(p * freq + 4.0 * q + vec2(1.7, 9.2), 1, octs, persistence, 2.0, seed + vec2(0.4, 2.6)),
    fbm(p * freq + 4.0 * q + vec2(8.3, 2.8), 1, octs, persistence, 2.0, seed + vec2(9.1, 5.5)));
  return p + intensity * (r * 2.0 - 1.0);
}
`;
