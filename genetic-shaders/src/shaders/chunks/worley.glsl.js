// 2D Worley / cellular Voronoi noise. Returns (F1, F2) Euclidean distances.
export const WORLEY = /* glsl */ `
vec2 worleyF(vec2 p, vec2 seed) {
  vec2 pi = floor(p);
  vec2 pf = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(pi + g + seed) * 0.5 + 0.5;
      vec2 r = g + o - pf;
      float d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
`;
