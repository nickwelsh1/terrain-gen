// Maps a genotype's genes onto three.js uniform objects.

export function createUniforms() {
  return {
    uSeed: { value: [137.5, 241.3] },
    uFrequency: { value: 4.0 },
    uOctaves: { value: 5 },
    uPersistence: { value: 0.5 },
    uLacunarity: { value: 2.0 },
    uNoiseType: { value: 1 },
    uWarpIntensity: { value: 0.0 },
    uWarpFrequency: { value: 1.0 },
    uWarpOctaves: { value: 2 },
    uErosionMode: { value: 0 },
    uErosionStrength: { value: 0.0 },
    uErosionScale: { value: 0.15 },
    uErosionOctaves: { value: 4 },
    uErosionGain: { value: 0.5 },
    uErosionLacunarity: { value: 2.0 },
    uErosionDetail: { value: 1.5 },
    uErosionGullyWeight: { value: 0.5 },
    uErosionRounding: { value: 0.1 },
    uErosionCellScale: { value: 0.7 },
    uErosionNormalization: { value: 0.5 },
    uPlateauRim: { value: 0.0 },
    uLaplacianWeight: { value: 0.0 },
    uLaplacianStep: { value: 0.008 },
    uRidgeSharpness: { value: 1.0 },
    uPeakRounding: { value: 0.0 },
    uContrast: { value: 1.0 },
    uBias: { value: 0.0 },
    uInvert: { value: 0.0 },
    uColorMode: { value: 0 },
    uDisplacementScale: { value: 0.28 },
  };
}

// Derives a deterministic vec2 seed offset from the scalar seed gene.
export function seedToVec2(seed) {
  const a = (seed % 61.7) * 3.13;
  const b = (seed % 43.9) * 7.77;
  return [a, b];
}

export function syncUniforms(uniforms, genotype) {
  const g = genotype.genes;
  uniforms.uSeed.value = seedToVec2(g.seed);
  uniforms.uFrequency.value = g.frequency;
  uniforms.uOctaves.value = Math.round(g.octaves);
  uniforms.uPersistence.value = g.persistence;
  uniforms.uLacunarity.value = g.lacunarity;
  uniforms.uNoiseType.value = Math.round(g.noiseType);
  uniforms.uWarpIntensity.value = g.warpIntensity;
  uniforms.uWarpFrequency.value = g.warpFrequency;
  uniforms.uWarpOctaves.value = Math.round(g.warpOctaves);
  uniforms.uErosionMode.value = Math.round(g.erosionMode);
  uniforms.uErosionStrength.value = g.erosionStrength;
  uniforms.uErosionScale.value = g.erosionScale;
  uniforms.uErosionOctaves.value = Math.round(g.erosionOctaves);
  uniforms.uErosionGain.value = g.erosionGain;
  uniforms.uErosionLacunarity.value = g.erosionLacunarity;
  uniforms.uErosionDetail.value = g.erosionDetail;
  uniforms.uErosionGullyWeight.value = g.erosionGullyWeight;
  uniforms.uErosionRounding.value = g.erosionRounding;
  uniforms.uErosionCellScale.value = g.erosionCellScale;
  uniforms.uErosionNormalization.value = g.erosionNormalization;
  uniforms.uPlateauRim.value = g.plateauRim ?? 0.0;
  uniforms.uLaplacianWeight.value = g.laplacianWeight;
  uniforms.uLaplacianStep.value = g.laplacianStep;
  uniforms.uRidgeSharpness.value = g.ridgeSharpness;
  uniforms.uPeakRounding.value = g.peakRounding ?? 0.0;
  uniforms.uContrast.value = g.contrast;
  uniforms.uBias.value = g.bias;
  uniforms.uInvert.value = g.invert;
  uniforms.uColorMode.value = Math.round(g.colorMode);
  uniforms.uDisplacementScale.value = g.displacementScale;
}
