import { SCHEMA, GENES, DISPLAY_GENES } from '../config/parameterSchema.js';
import { Genotype } from './Genotype.js';

// Box-Muller gaussian sample, mean 0 / stddev 1.
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Fraction of each continuous gene's range that sigma=1 mutation can travel.
const MUTATION_STEP = 0.07;

// Relative dominant spatial frequency of each noise family at uFrequency = 1:
// 0: Perlin, 1: Simplex, 2: Worley F1, 3: Worley Crackle, 4: Ridged, 5: Perlin-Worley
export const NOISE_FREQ_SCALE = [1.0, 1.6, 1.05, 1.75, 1.7, 1.35];

// Converts a frequency from oldNoiseType to newNoiseType so perceived feature
// scale stays invariant when jumping across noise families.
export function normalizeFrequencyForNoise(freq, oldType, newType) {
  const sOld = NOISE_FREQ_SCALE[oldType] ?? 1.0;
  const sNew = NOISE_FREQ_SCALE[newType] ?? 1.0;
  return freq * (sOld / sNew);
}

// Computes per-group mutation multipliers from current fitness sub-scores
// { hist, fft, lap, slope, layout } in [0, 1].
// Protects converged groups (> 0.92) and boosts groups with large deficits.
export function computeGroupMultipliers(subScores) {
  if (!subScores) return null;
  const fft = subScores.fft ?? 0.5;
  const lap = subScores.lap ?? 0.5;
  const slope = subScores.slope ?? 0.5;
  const hist = subScores.hist ?? 0.5;
  const layout = subScores.layout ?? fft;

  const groupScore = {
    core: 0.60 * fft + 0.25 * slope + 0.15 * layout,
    warp: 0.45 * fft + 0.30 * slope + 0.25 * layout,
    erosion: 0.50 * lap + 0.35 * slope + 0.15 * fft,
    curvature: 0.65 * lap + 0.35 * slope,
    tone: 0.75 * hist + 0.25 * slope,
  };

  const mult = {};
  for (const [grp, s] of Object.entries(groupScore)) {
    if (s > 0.92) {
      mult[grp] = 0.45;
    } else {
      const deficit = Math.max(0, 1 - s);
      mult[grp] = Math.min(1.5, 0.75 + deficit * 1.4);
    }
  }
  return mult;
}

// Mutates a genotype in place of construction; returns a new validated Genotype.
//   intensity      sigma in [0.01, 1.0] driven by the variation slider
//   distanceScale  radial multiplier so outer grid rings explore further
//   mutationRate   probability that any given gene is touched at all
//   locked         Set of gene keys that must not change
//   allowDisplay   whether display-only genes (colorMode...) may mutate
//   metricGuided   whether to weight gene groups by sub-score deficits
//   subScores      optional { hist, fft, lap, slope, layout } in [0, 1]
export function mutateGenotype(genotype, {
  intensity = 0.35,
  distanceScale = 1.0,
  mutationRate = 1.0,
  locked = new Set(),
  allowDisplay = true,
  metricGuided = false,
  subScores = null,
  rng = Math.random,
} = {}) {
  const genes = { ...genotype.genes };
  const oldNoiseType = genes.noiseType;
  const oldErosionMode = genes.erosionMode;
  const groupMult = metricGuided ? computeGroupMultipliers(subScores) : null;

  for (const def of SCHEMA) {
    if (locked.has(def.key)) continue;
    if (!allowDisplay && DISPLAY_GENES.includes(def.key)) continue;

    const gMult = groupMult?.[def.group] ?? 1.0;
    const effRate = Math.min(1.0, mutationRate * (groupMult ? (0.65 + 0.35 * gMult) : 1.0));
    if (rng() > effRate) continue;

    const range = def.max - def.min;
    const sigma = Math.max(0.01, intensity) * distanceScale * gMult;

    if (def.type === 'float') {
      let delta = gaussian(rng) * sigma * range * MUTATION_STEP;
      // Prevent runaway upward random-walk drift into high-warp swirly soup
      // on both warpIntensity and warpFrequency unless fitness selects for it.
      if (def.key === 'warpIntensity') {
        if (delta > 0 && genes.warpIntensity > 0.35) delta *= 0.38;
        if (subScores && (subScores.slope ?? 1) < 0.78 && genes.warpIntensity > 0.25) {
          delta -= 0.025 * sigma * range;
        }
      } else if (def.key === 'warpFrequency') {
        if (delta > 0 && genes.warpFrequency > 1.5) delta *= 0.35;
        if (genes.warpFrequency > 2.2) delta -= 0.02 * sigma * range;
      } else if (def.key === 'contrast') {
        if (delta > 0 && genes.contrast > 1.35) delta *= 0.45;
      }
      genes[def.key] += delta;
    } else if (def.type === 'int') {
      // Discrete genes jump up/down by 1 (rarely 2) scaled by intensity.
      if (rng() < sigma * 0.8) {
        const jump = rng() < 0.15 * sigma ? 2 : 1;
        genes[def.key] += rng() < 0.5 ? jump : -jump;
      }
    } else if (def.type === 'enum') {
      // Enum genes re-roll with probability proportional to intensity.
      const enumProb = def.key === 'erosionMode' ? sigma * 0.45 : sigma * 0.35;
      if (rng() < enumProb) {
        genes[def.key] = def.min + Math.floor(rng() * (def.max - def.min + 1));
      }
    } else if (def.type === 'bool') {
      if (rng() < sigma * 0.2) genes[def.key] = 1 - genes[def.key];
    }
  }

  // Cross-noise frequency normalization: keep dominant wavelength consistent
  // when mutating from one noise family to another.
  if (genes.noiseType !== oldNoiseType && !locked.has('frequency')) {
    genes.frequency = normalizeFrequencyForNoise(genes.frequency, oldNoiseType, genes.noiseType);
  }

  // Coupled erosion activation: when erosionMode mutates from Off (0) to an active
  // mode (1 or 2) while strength is near zero, seed a visible erosionStrength so
  // the new mode actually manifests in the child tile. Likewise, if erosionStrength
  // mutates upward while mode is Off, wake up erosionMode so erosion genes get explored.
  if (oldErosionMode === 0 && genes.erosionMode > 0 && genes.erosionStrength < 0.05 && !locked.has('erosionStrength')) {
    genes.erosionStrength = 0.11 + rng() * 0.16;
  } else if (oldErosionMode === 0 && genes.erosionMode === 0 && !locked.has('erosionMode')) {
    if (genes.erosionStrength > 0.025 || rng() < intensity * distanceScale * 0.24) {
      genes.erosionMode = rng() < 0.68 ? 1 : 2;
      if (!locked.has('erosionStrength') && genes.erosionStrength < 0.06) {
        genes.erosionStrength = 0.10 + rng() * 0.16;
      }
    }
  }

  // Seed gets a small chance of a full re-roll for a fresh basin of attraction.
  const seedProb = metricGuided && subScores?.layout != null && subScores.layout < 0.72
    ? intensity * 0.22
    : intensity * 0.12;
  if (!locked.has('seed') && rng() < seedProb) {
    genes.seed = rng() * GENES.seed.max;
  }

  return new Genotype(genes, locked);
}

// Analytically adjusts tone genes (contrast, bias, and invert when layout is active)
// so a candidate's mean and standard deviation align with the target's moments.
export function adaptToneToTarget(genotype, candFeatures, targetFeatures, locked = new Set(), opts = {}) {
  if (!candFeatures || !targetFeatures) return genotype;
  const genes = { ...genotype.genes };

  // When spatial layout matching is active, check whether inverting luminance
  // flips negative regional correlation into positive correlation.
  if (opts.layout && !locked.has('invert') && candFeatures.regions && targetFeatures.regions) {
    let cov = 0;
    for (let i = 0; i < candFeatures.regions.length; i++) {
      cov += (candFeatures.regions[i] - candFeatures.mean) * (targetFeatures.regions[i] - targetFeatures.mean);
    }
    if (cov < -0.02) {
      genes.invert = 1 - genes.invert;
    }
  } else if (!locked.has('invert') && candFeatures.gullyShare != null && targetFeatures.gullyShare != null) {
    // Canyon vs. Mountain polarity: if the target has incised dark canyons
    // (gullyShare > 0.52) while the candidate has protruding bright ridges
    // (gullyShare < 0.48), or vice versa, flip invert so ridges become canyons.
    const cPol = candFeatures.gullyShare - 0.5;
    const tPol = targetFeatures.gullyShare - 0.5;
    if (cPol * tPol < -0.0012) {
      genes.invert = 1 - genes.invert;
    }
  }

  const inv = genes.invert > 0.5;
  const cCenter = 0.55 * (candFeatures.p50 ?? candFeatures.mean) + 0.45 * candFeatures.mean;
  const tCenter = 0.55 * (targetFeatures.p50 ?? targetFeatures.mean) + 0.45 * targetFeatures.mean;
  const cMean = inv ? 1.0 - cCenter : cCenter;
  const tMean = inv ? 1.0 - tCenter : tCenter;
  const cOld = Math.max(0.5, genes.contrast);
  const bOld = genes.bias;
  const h0Offset = (cMean - 0.5 - bOld) / cOld;

  // Use a blend of IQR (p75 - p25) and std so a localized bright band in an
  // otherwise smooth target doesn't blow up global contrast across the whole tile.
  const cSpread = 0.60 * (candFeatures.iqr ?? candFeatures.std) + 0.40 * candFeatures.std;
  const tSpread = 0.60 * (targetFeatures.iqr ?? targetFeatures.std) + 0.40 * targetFeatures.std;

  if (!locked.has('contrast') && cSpread > 1e-3 && tSpread > 1e-3) {
    let ratio = Math.min(1.55, Math.max(0.55, tSpread / cSpread));
    // If the candidate already has more slope energy than the target (e.g., target is
    // smooth except for a white band), do not allow tone adaptation to boost contrast.
    if (
      candFeatures.slopeEnergy != null &&
      targetFeatures.slopeEnergy != null &&
      candFeatures.slopeEnergy > targetFeatures.slopeEnergy * 1.12
    ) {
      const roughExcess = targetFeatures.slopeEnergy / Math.max(candFeatures.slopeEnergy, 1e-5);
      ratio = Math.min(ratio, Math.max(0.60, roughExcess));
    }
    const cTarget = cOld * (0.35 + 0.65 * ratio);
    genes.contrast = Math.min(GENES.contrast.max, Math.max(GENES.contrast.min, cTarget));
  }

  if (!locked.has('bias')) {
    const rawBias = tMean - 0.5 - h0Offset * genes.contrast;
    const blendedBias = 0.30 * bOld + 0.70 * rawBias;
    genes.bias = Math.min(GENES.bias.max, Math.max(GENES.bias.min, blendedBias));
  }

  return new Genotype(genes, locked);
}

// Specialist domain crossover: combines core+warp spectral structure from
// `specParent` with erosion+curvature+tone shaping from `curveParent`.
export function specialistCrossover(specParent, curveParent, {
  locked = new Set(),
  alpha = 0.15,
  rng = Math.random,
} = {}) {
  const a = specParent.genes;
  const b = curveParent.genes;
  const genes = {};

  for (const def of SCHEMA) {
    const key = def.key;
    const fromSpec = def.group === 'core' || def.group === 'warp' || def.group === 'display';
    const primary = fromSpec ? a[key] : b[key];
    const secondary = fromSpec ? b[key] : a[key];

    if (def.type === 'float' && key !== 'seed') {
      const span = Math.abs(primary - secondary) * alpha;
      genes[key] = primary + (rng() * 2 - 1) * span;
    } else {
      genes[key] = primary;
    }
    if (locked.has(key)) genes[key] = a[key];
  }

  return new Genotype(genes, locked);
}

// Generates a candidate that specifically explores natural branching fractal/erosion
// structure (and plateau/canyon incision or high-octave micro-bumps when target
// features indicate them) while damping excessive domain-warp swirl ("deSwirl").
export function branchingErosionCandidate(parent, {
  locked = new Set(),
  mode = 1,
  deSwirl = true,
  intensity = 0.35,
  subScores = null,
  targetFeatures = null,
  rng = Math.random,
} = {}) {
  const mutated = mutateGenotype(parent, {
    intensity: Math.max(0.22, intensity),
    distanceScale: 0.75,
    locked,
    metricGuided: Boolean(subScores),
    subScores,
    allowDisplay: false,
    rng,
  });
  const g = { ...mutated.genes };

  if (!locked.has('erosionMode')) {
    g.erosionMode = mode;
  }
  if (!locked.has('erosionStrength')) {
    if (parent.genes.erosionMode === mode && parent.genes.erosionStrength > 0.05) {
      g.erosionStrength = Math.max(0.06, g.erosionStrength);
    } else {
      g.erosionStrength = 0.12 + rng() * 0.18;
    }
  }
  if (!locked.has('erosionScale') && parent.genes.erosionMode === 0) {
    g.erosionScale = 0.10 + rng() * 0.14;
  }
  if (!locked.has('erosionOctaves') && g.erosionOctaves < 3) {
    g.erosionOctaves = 4 + (rng() < 0.5 ? 1 : 0);
  }
  if (deSwirl && !locked.has('warpIntensity') && g.warpIntensity > 0.25) {
    // Trade heavy coordinate swirling for cleaner multi-octave fractal + dendritic branching.
    g.warpIntensity = g.warpIntensity * (0.20 + 0.45 * rng());
  }
  if (deSwirl && !locked.has('octaves') && g.octaves < 5) {
    g.octaves = 5 + Math.floor(rng() * 3);
  }

  // If the target has plateau/basin sparsity (smooth plateau + incised canyon),
  // actively explore plateauRim and canyon inversion.
  if (targetFeatures) {
    if (!locked.has('plateauRim') && (targetFeatures.flatFraction > 0.15 || targetFeatures.gullyShare > 0.51)) {
      if (rng() < 0.65) {
        g.plateauRim = 0.40 + rng() * 0.50;
      }
    }
    if (!locked.has('invert') && targetFeatures.gullyShare > 0.515 && rng() < 0.45) {
      g.invert = 1 - g.invert;
    }
    // If the target has high 2D micro-bump density (like target1.png), explore
    // high octaves + stronger persistence on a lower macro frequency.
    if (targetFeatures.extremaDensity > 0.012 && rng() < 0.55) {
      if (!locked.has('octaves')) g.octaves = 6 + Math.floor(rng() * 3);
      if (!locked.has('persistence')) g.persistence = Math.max(g.persistence, 0.48 + rng() * 0.20);
      if (!locked.has('lacunarity')) g.lacunarity = Math.max(g.lacunarity, 2.05 + rng() * 0.45);
    }
  }

  return new Genotype(g, locked);
}

// Normalized [0, 1] Euclidean distance between two genotypes across non-display genes.
export function genotypeDistance(genoA, genoB) {
  const a = genoA.genes;
  const b = genoB.genes;
  let sumSq = 0;
  let count = 0;
  for (const def of SCHEMA) {
    if (DISPLAY_GENES.includes(def.key) || def.key === 'seed') continue;
    const d = (a[def.key] - b[def.key]) / (def.max - def.min || 1);
    sumSq += d * d;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

// BLX-alpha blend crossover for continuous genes, uniform pick for discrete.
export function crossoverGenotypes(parentA, parentB, {
  alpha = 0.35,
  locked = new Set(),
  rng = Math.random,
} = {}) {
  const a = parentA.genes;
  const b = parentB.genes;
  const genes = {};

  for (const def of SCHEMA) {
    const key = def.key;
    const va = a[key];
    const vb = b[key];
    if (def.type === 'float') {
      const lo = Math.min(va, vb);
      const hi = Math.max(va, vb);
      const span = (hi - lo) * alpha;
      genes[key] = lo - span + rng() * (hi - lo + 2 * span);
    } else {
      genes[key] = rng() < 0.5 ? va : vb;
    }
    if (locked.has(key)) genes[key] = va;
  }

  return new Genotype(genes, locked);
}

// Center index for an NxN grid (exact center for odd N).
export function centerIndexFor(gridSize) {
  const half = Math.floor(gridSize / 2);
  return half * gridSize + half;
}

// Normalized [0,1] radial distance of a cell from the grid center.
export function radialDistance(index, gridSize) {
  const c = (gridSize - 1) / 2;
  const x = index % gridSize;
  const y = Math.floor(index / gridSize);
  const d = Math.hypot(x - c, y - c);
  const maxD = Math.hypot(c, c) || 1;
  return d / maxD;
}

// Builds a full grid of mutation offspring around the center parent.
// Returns an array of Genotypes; the center slot holds the parent clone.
export function populateGrid(parent, gridSize, {
  intensity = 0.35,
  spatialScaling = true,
  mutationRate = 1.0,
  locked = new Set(),
  metricGuided = false,
  subScores = null,
  rng = Math.random,
} = {}) {
  const total = gridSize * gridSize;
  const center = centerIndexFor(gridSize);
  const cells = new Array(total);

  for (let i = 0; i < total; i++) {
    if (i === center) {
      cells[i] = parent.clone();
      continue;
    }
    // Inner rings = subtle refinement, outer rings = bolder exploration.
    const distanceScale = spatialScaling
      ? 0.35 + 0.9 * radialDistance(i, gridSize)
      : 1.0;
    cells[i] = mutateGenotype(parent, {
      intensity, distanceScale, mutationRate, locked, metricGuided, subScores, rng,
      allowDisplay: false, // children keep the parent's display settings
    });
  }
  return cells;
}

// Uniform random sample for a single gene within its schema bounds.
function randomGeneValue(def, rng) {
  if (def.type === 'float') return def.min + rng() * (def.max - def.min);
  return def.min + Math.floor(rng() * (def.max - def.min + 1));
}

// Fully random genotype (Randomize grid, synthetic target).
export function randomGenotype(rng = Math.random) {
  const genes = {};
  for (const def of SCHEMA) genes[def.key] = randomGeneValue(def, rng);

  // Sample domain warp with a natural power-law distribution instead of uniform
  // [0..2.5] x [0.5..8.0], which otherwise biases random genotypes into chaotic swirls.
  genes.warpIntensity = rng() < 0.35 ? 0.0 : Math.pow(rng(), 1.8) * 0.85;
  genes.warpFrequency = 0.6 + Math.pow(rng(), 1.6) * 1.8;
  genes.warpOctaves = rng() < 0.65 ? 2 : (rng() < 0.5 ? 1 : 3);
  genes.contrast = 0.75 + rng() * 0.70;
  genes.ridgeSharpness = 0.75 + rng() * 1.35;
  genes.plateauRim = rng() < 0.55 ? 0.0 : (0.25 + rng() * 0.65);
  genes.peakRounding = rng() < 0.6 ? 0.0 : rng() * 0.8;

  // Balance erosion modes so ~45% of random terrains are pure noise/warped,
  // ~35% use Runevision Phacelle erosion, and ~20% use Classic Gavoronoise.
  const rMode = rng();
  if (rMode < 0.45) {
    genes.erosionMode = 0;
    genes.erosionStrength = 0.0;
  } else if (rMode < 0.80) {
    genes.erosionMode = 1;
    genes.erosionStrength = 0.10 + rng() * 0.22;
  } else {
    genes.erosionMode = 2;
    genes.erosionStrength = 0.10 + rng() * 0.20;
  }
  return new Genotype(genes);
}

// An "immigrant" genotype that inherits the parent's locked and display-only
// genes. When `chimera` is true, it preserves the parent's adapted tone
// (contrast, bias, invert) and cross-noise-normalized frequency while
// randomizing structural/warp/curvature genes so new noise families enter
// competition at the right scale and brightness.
export function immigrantGenotype(parent, locked = new Set(), rng = Math.random, { chimera = false } = {}) {
  const child = randomGenotype(rng);
  if (chimera && parent) {
    const newType = locked.has('noiseType') ? parent.genes.noiseType : child.genes.noiseType;
    const normFreq = normalizeFrequencyForNoise(parent.genes.frequency, parent.genes.noiseType, newType);
    child.genes.frequency = normFreq * (0.75 + 0.5 * rng());
    child.genes.contrast = parent.genes.contrast;
    child.genes.bias = parent.genes.bias;
    child.genes.invert = parent.genes.invert;
  }
  for (const def of SCHEMA) {
    if (locked.has(def.key) || DISPLAY_GENES.includes(def.key)) {
      child.genes[def.key] = parent.genes[def.key];
    }
  }
  child.validate(locked);
  return child;
}

// Builds a grid of fully random genotypes for fresh exploration. The center
// slot still holds the parent clone so Randomize never discards the current
// selection; locked and display-only genes inherit the parent's values.
export function populateRandomGrid(parent, gridSize, {
  locked = new Set(),
  rng = Math.random,
} = {}) {
  const total = gridSize * gridSize;
  const center = centerIndexFor(gridSize);
  const cells = new Array(total);

  for (let i = 0; i < total; i++) {
    cells[i] = i === center ? parent.clone() : immigrantGenotype(parent, locked, rng);
  }
  return cells;
}

// Builds a grid of crossover offspring between two parents.
export function populateCrossoverGrid(parentA, parentB, gridSize, {
  intensity = 0.25,
  spatialScaling = true,
  locked = new Set(),
  rng = Math.random,
} = {}) {
  const total = gridSize * gridSize;
  const center = centerIndexFor(gridSize);
  const cells = new Array(total);

  for (let i = 0; i < total; i++) {
    if (i === center) {
      cells[i] = parentA.clone();
      continue;
    }
    // Hybrid offspring get a light mutation dusting so children vary.
    const child = crossoverGenotypes(parentA, parentB, { locked, rng });
    const distanceScale = spatialScaling
      ? 0.35 + 0.9 * radialDistance(i, gridSize)
      : 1.0;
    cells[i] = mutateGenotype(child, {
      intensity: intensity * 0.5, distanceScale, locked, rng,
      allowDisplay: false,
    });
  }
  return cells;
}
