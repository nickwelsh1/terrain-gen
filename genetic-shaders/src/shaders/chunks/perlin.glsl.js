// 2D classic gradient (Perlin) noise. Output ~[-1, 1].
export const PERLIN = /* glsl */ `
float perlinNoise(vec2 p, vec2 seed) {
  vec2 pi = floor(p);
  vec2 pf = fract(p);
  vec2 w = pf * pf * pf * (pf * (pf * 6.0 - 15.0) + 10.0); // quintic fade

  float a = dot(hash22(pi + seed), pf);
  float b = dot(hash22(pi + vec2(1.0, 0.0) + seed), pf - vec2(1.0, 0.0));
  float c = dot(hash22(pi + vec2(0.0, 1.0) + seed), pf - vec2(0.0, 1.0));
  float d = dot(hash22(pi + vec2(1.0, 1.0) + seed), pf - vec2(1.0, 1.0));

  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.41421356;
}
`;
