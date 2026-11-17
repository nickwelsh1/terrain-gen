// Base noise dispatcher + multi-octave fBm / ridged multifractal accumulator.
// noiseType: 0 Perlin, 1 Simplex, 2 Worley F1, 3 Worley crackle,
//            4 Ridged multifractal, 5 Perlin-Worley hybrid.
export const FBM = /* glsl */ `
float baseNoise(int type, vec2 p, vec2 seed) {
  // Single-assignment form avoids ANGLE uninitialized-temp warnings.
  float n = 0.5;
  if (type == 0) {
    n = perlinNoise(p, seed) * 0.5 + 0.5;
  } else if (type == 1) {
    n = simplexNoise(p, seed) * 0.5 + 0.5;
  } else if (type == 2) {
    n = 1.0 - clamp(worleyF(p, seed).x, 0.0, 1.0);
  } else if (type == 3) {
    vec2 f = worleyF(p, seed);
    n = clamp((f.y - f.x) * 1.6, 0.0, 1.0);
  } else if (type == 5) {
    float per = perlinNoise(p, seed) * 0.5 + 0.5;
    float wor = 1.0 - clamp(worleyF(p * 1.7, seed + vec2(3.1, 7.7)).x, 0.0, 1.0);
    n = clamp(mix(per, wor, 0.55) + 0.15 * (per - 0.5), 0.0, 1.0);
  } else {
    // type 4 (ridged) is handled inside fbm; fallback to perlin.
    n = perlinNoise(p, seed) * 0.5 + 0.5;
  }
  return n;
}

float fbm(vec2 p, int type, int octaves, float persistence, float lacunarity, vec2 seed) {
  float amp = 1.0;
  float sum = 0.0;
  float norm = 0.0;
  float weight = 1.0;
  vec2 sp = p;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 0.5;
    if (type == 4) {
      // Musgrave-style ridged multifractal: sharp creases, octave feedback weight.
      n = 1.0 - abs(perlinNoise(sp, seed));
      n = n * n * weight;
      weight = clamp(n * 2.0, 0.0, 1.0);
    } else {
      n = baseNoise(type, sp, seed);
    }
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    sp = OCT_ROT * sp * lacunarity;
  }
  return clamp(sum / max(norm, 0.0001), 0.0, 1.0);
}
`;
