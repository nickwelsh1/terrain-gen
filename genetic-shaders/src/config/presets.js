import { defaults } from './parameterSchema.js';

function preset(overrides) {
  return { ...defaults(), ...overrides };
}

// Starter presets keyed by display name. Values are raw genotype genes.
export const PRESETS = {
  'Soft Foothills': preset({
    noiseType: 1, frequency: 3.2, octaves: 5, persistence: 0.48, lacunarity: 2.0,
    warpIntensity: 0.03, warpFrequency: 0.7, ridgeSharpness: 1.0,
  }),
  'Jagged Ridges': preset({
    noiseType: 4, frequency: 3.4, octaves: 6, persistence: 0.52, lacunarity: 2.15,
    warpIntensity: 0.3, warpFrequency: 1.0, laplacianWeight: 0.55, ridgeSharpness: 1.35,
  }),
  'Cellular Cracks': preset({
    noiseType: 3, frequency: 5.0, octaves: 4, persistence: 0.45, lacunarity: 2.2,
    warpIntensity: 0.25, warpFrequency: 1.6, contrast: 1.35,
  }),
  'Warped Continents': preset({
    noiseType: 0, frequency: 2.4, octaves: 6, persistence: 0.55, lacunarity: 2.0,
    warpIntensity: 1.35, warpFrequency: 1.1, warpOctaves: 3,
  }),
  'Coral Stone': preset({
    noiseType: 5, frequency: 6.5, octaves: 5, persistence: 0.42, lacunarity: 2.4,
    warpIntensity: 0.6, warpFrequency: 2.2, laplacianWeight: -0.35, contrast: 1.2,
  }),
  'Eroded Valleys': preset({
    noiseType: 1, frequency: 4.2, octaves: 7, persistence: 0.55, lacunarity: 1.9,
    warpIntensity: 0.9, warpFrequency: 1.8, laplacianWeight: 0.8, laplacianStep: 0.012,
    ridgeSharpness: 1.6,
  }),
  'Runevision Eroded Peaks': preset({
    noiseType: 0, frequency: 3.0, octaves: 4, persistence: 0.35, lacunarity: 2.0,
    warpIntensity: 0.18, warpFrequency: 1.2,
    erosionMode: 1, erosionStrength: 0.22, erosionScale: 0.15, erosionOctaves: 5,
    erosionGain: 0.5, erosionLacunarity: 2.0, erosionDetail: 1.5,
    erosionGullyWeight: 0.5, erosionRounding: 0.10, erosionCellScale: 0.70,
    erosionNormalization: 0.50, contrast: 1.15,
  }),
  'Dendritic Badlands': preset({
    noiseType: 1, frequency: 2.8, octaves: 4, persistence: 0.40, lacunarity: 2.05,
    warpIntensity: 0.30, warpFrequency: 1.4,
    erosionMode: 1, erosionStrength: 0.28, erosionScale: 0.13, erosionOctaves: 5,
    erosionGain: 0.52, erosionLacunarity: 2.05, erosionDetail: 2.15,
    erosionGullyWeight: 0.65, erosionRounding: 0.02, erosionCellScale: 0.68,
    erosionNormalization: 0.60, ridgeSharpness: 1.25, contrast: 1.22,
  }),
  'Grand Canyon Plateau': preset({
    noiseType: 1, frequency: 1.85, octaves: 6, persistence: 0.46, lacunarity: 2.15,
    warpIntensity: 0.22, warpFrequency: 1.15, warpOctaves: 2,
    erosionMode: 1, erosionStrength: 0.28, erosionScale: 0.12, erosionOctaves: 5,
    erosionGain: 0.54, erosionLacunarity: 2.10, erosionDetail: 2.25,
    erosionGullyWeight: 0.72, erosionRounding: 0.06, erosionCellScale: 0.66,
    erosionNormalization: 0.58, plateauRim: 0.72, ridgeSharpness: 1.15,
    contrast: 1.18, bias: 0.06,
  }),
  'Classic Gavoronoise Hills': preset({
    noiseType: 0, frequency: 3.2, octaves: 4, persistence: 0.38, lacunarity: 2.0,
    warpIntensity: 0.15, warpFrequency: 1.1,
    erosionMode: 2, erosionStrength: 0.20, erosionScale: 0.18, erosionOctaves: 5,
    erosionGain: 0.50, erosionLacunarity: 2.0, erosionDetail: 1.8,
    erosionGullyWeight: 0.60, erosionRounding: 0.15, erosionCellScale: 0.75,
    erosionNormalization: 0.45, contrast: 1.12,
  }),
};

export const DEFAULT_PRESET = 'Soft Foothills';
