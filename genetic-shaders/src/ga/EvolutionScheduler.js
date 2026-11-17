import { scoreCandidate } from '../matcher/FitnessEvaluator.js';
import {
  mutateGenotype,
  immigrantGenotype,
  adaptToneToTarget,
  specialistCrossover,
  branchingErosionCandidate,
  computeGroupMultipliers,
  genotypeDistance,
  radialDistance,
  centerIndexFor,
  NOISE_FREQ_SCALE,
} from './GeneticEngine.js';
import { Genotype } from './Genotype.js';
import { PRESETS } from '../config/presets.js';
import { DISPLAY_GENES } from '../config/parameterSchema.js';
import { ANALYSIS_SIZE, ANALYSIS_SIZE_HI, ANALYSIS_SIZE_ULTRA } from '../matcher/FeatureExtractor.js';

const POOL_SIZE = 80;            // Fixed internal candidate pool regardless of visible grid size
const CELLS_PER_FRAME = 16;      // Candidates sampled per tick
const MAX_GENERATIONS = 300;
const TARGET_FITNESS = 99.0;
const STALE_LIMIT = 8;           // Generations without improvement before re-heat
const REHEAT_DURATION = 5;       // Multi-step cooldown window after a re-heat spike
const IMPROVE_EPS = 0.05;        // Fitness gain (0-100) that counts as improvement
const IMMIGRANT_FRACTION = 0.18; // Share of pool replaced by chimeras/immigrants on re-heat

// Automated memetic (1 + lambda) & Multiple-Try Metropolis MCMC evolutionary
// scheduler for Target Matching. Always evaluates a full 80-candidate pool
// offscreen and projects the best runners-up onto the visible NxN grid.
export class EvolutionScheduler {
  constructor({ store, tileRenderer }) {
    this.store = store;
    this.tileRenderer = tileRenderer;
    this.phase = 'idle'; // 'idle' | 'sampling'
    this.rafId = null;
    this.sampleIndex = 0;
    this.pool = [];
    this.poolResults = [];
    this.baseIntensity = 0.4;
    this.activeIntensity = 0.4;
    this.stepsInRun = 0;
    this.runTargetFitness = TARGET_FITNESS;
    this.staleGens = 0;
    this.reheatRemaining = 0;
    this.parentFitness = 0;
    this.parentSubScores = null;
    this.onGeneration = null;
  }

  get running() {
    return this.rafId !== null;
  }

  start() {
    const st = this.store.state;
    if (this.running || !st.target) return;

    const wasStale = Boolean(st.auto.bestStale);
    this._reconcileStaleBaseline();

    this.baseIntensity = Math.max(0.22, st.variationIntensity || 0.4);
    this.activeIntensity = this.baseIntensity;
    this.stepsInRun = 0;
    this.phase = 'sampling';
    this.sampleIndex = 0;
    this.staleGens = 0;
    this.reheatRemaining = 0;
    this.runTargetFitness = st.auto.bestFitness >= TARGET_FITNESS - 0.1
      ? Math.min(99.9, st.auto.bestFitness + 0.8)
      : TARGET_FITNESS;

    this._buildCandidatePool({ isWarmStart: st.auto.generation === 0 || wasStale });
    st.auto.running = true;
    st.auto.activeIntensity = this.activeIntensity;
    st.auto.reheatRemaining = 0;
    st.auto.groupMultipliers = st.matcher?.metricGuided !== false
      ? computeGroupMultipliers(this.parentSubScores)
      : null;
    this.store.emit('auto');
    this.rafId = setTimeout(() => this._tick(), 0);
  }

  stop() {
    const wasRunning = this.running;
    if (this.rafId !== null) clearTimeout(this.rafId);
    this.rafId = null;
    this.phase = 'idle';
    const st = this.store.state;
    st.auto.running = false;
    st.auto.reheatRemaining = 0;

    // In MCMC mode or when tiles were hidden during search, ensure the all-time
    // best genotype is promoted to the center parent (while honoring user locks)
    // and the grid is rendered.
    if (wasRunning && st.target) {
      if (st.auto.bestGenotype && st.auto.bestFitness > this.parentFitness) {
        st.parent = this._applyLocksAndDisplay(
          st.auto.bestGenotype.clone(),
          st.parent,
          st.lockedGenes
        );
        this.parentFitness = st.auto.bestFitness;
        if (st.cells[st.centerIndex]) {
          st.cells[st.centerIndex] = st.parent.clone();
        }
        if (st.fitness) {
          st.fitness[st.centerIndex] = st.auto.bestFitness;
        }
        st.auto.bestIndex = st.centerIndex;
      }
      this.store.emit('parent');
      this.store.emit('grid');
      this.store.emit('fitness');
    }
    this.store.emit('auto');
  }

  toggle() {
    if (this.running) this.stop();
    else this.start();
  }

  // Advances exactly one generation (used by the Step button).
  step() {
    const st = this.store.state;
    if (this.running || !st.target) return;
    const wasStale = Boolean(st.auto.bestStale);
    this._reconcileStaleBaseline();
    this.baseIntensity = Math.max(0.20, st.variationIntensity || 0.4);
    this.activeIntensity = this.baseIntensity;
    this._buildCandidatePool({ isWarmStart: st.auto.generation === 0 || wasStale });
    this._sampleAllSync();
    this._finishGeneration(true);
  }

  _analysisSize() {
    const m = this.store.state.matcher || {};
    if (m.analysisSize === ANALYSIS_SIZE_ULTRA || m.analysisSize === ANALYSIS_SIZE_HI || m.analysisSize === ANALYSIS_SIZE) {
      return m.analysisSize;
    }
    return m.hiDetail ? ANALYSIS_SIZE_HI : ANALYSIS_SIZE;
  }

  _matcherOpts() {
    const m = this.store.state.matcher || {};
    return { layout: m.layout, crisp: m.crisp };
  }

  // Applies locked and display-only genes from `parent` onto `candidate`.
  _applyLocksAndDisplay(candidate, parent, locked) {
    for (const key of DISPLAY_GENES) {
      candidate.genes[key] = parent.genes[key];
    }
    for (const key of locked) {
      candidate.genes[key] = parent.genes[key];
    }
    candidate.validate(locked);
    return candidate;
  }

  // Builds the 80-candidate internal evaluation pool for the upcoming generation.
  _buildCandidatePool({
    isWarmStart = false,
    injectImmigrants = false,
    specParent = null,
    curveParent = null,
    erosionParent = null,
  } = {}) {
    const st = this.store.state;
    const parent = st.parent;
    const locked = st.lockedGenes;
    const metricGuided = st.matcher?.metricGuided !== false;
    const effIntensity = this.activeIntensity || st.variationIntensity || 0.35;
    const pool = [];

    // Slot 0 is always the current parent.
    pool.push(parent.clone(locked));

    // Include visible grid cells on initial step if they already hold user-bred variations.
    if (isWarmStart) {
      // 1. All named presets (filtered through user locks)
      for (const presetGenes of Object.values(PRESETS)) {
        const g = this._applyLocksAndDisplay(new Genotype(presetGenes, locked), parent, locked);
        pool.push(g);
      }

      // 2. Multi-family stratified tournament across noise types, normalized scales,
      // and erosion modes (0: Off, 1: Runevision Phacelle, 2: Classic Gavoronoise).
      // If noiseType is user-locked, focus all tournament slots on the locked noiseType.
      const noiseTypes = locked.has('noiseType')
        ? [parent.genes.noiseType]
        : [0, 1, 2, 3, 4, 5];
      const baseFreqs = locked.has('noiseType')
        ? [2.2, 3.4, 5.0, 7.2]
        : [2.4, 4.2, 6.8];
      const erosionModes = [0, 1, 2];

      for (const nt of noiseTypes) {
        const scale = NOISE_FREQ_SCALE[nt] || 1.0;
        for (let fi = 0; fi < baseFreqs.length; fi++) {
          const modesToTest = locked.has('noiseType')
            ? erosionModes
            : [erosionModes[fi % erosionModes.length]];
          for (const eMode of modesToTest) {
            const g = new Genotype({
              ...parent.genes,
              noiseType: nt,
              frequency: baseFreqs[fi] / scale,
              octaves: 4 + (fi % 3),
              persistence: 0.40 + fi * 0.05,
              lacunarity: 1.95 + (nt % 3) * 0.12,
              // Keep initial domain warp modest so natural fractal/branching shapes compete fairly.
              warpIntensity: eMode > 0 ? 0.12 : ((nt + fi) % 2 === 0 ? 0.06 : 0.26),
              warpFrequency: 0.9 + (fi % 2) * 0.4,
              erosionMode: eMode,
              erosionStrength: eMode > 0 ? (0.18 + (fi % 2) * 0.06) : 0.0,
              erosionScale: 0.14 + (nt % 2) * 0.04,
              erosionOctaves: 4 + (fi % 2),
              erosionDetail: eMode === 1 ? 1.55 : 1.75,
              erosionGullyWeight: 0.50 + (fi % 2) * 0.12,
              plateauRim: (eMode === 1 && fi === 0) ? 0.68 : 0.0,
              ridgeSharpness: nt === 4 ? 1.45 : 1.05,
              invert: (nt === 4 && fi === 1) ? 1 : parent.genes.invert,
              seed: Math.random() * 1000,
            }, locked);
            pool.push(this._applyLocksAndDisplay(g, parent, locked));
          }
        }
      }

      // 3. Include existing non-center grid cells (strictly honoring user locks)
      for (let i = 0; i < st.cells.length && pool.length < POOL_SIZE - 16; i++) {
        if (i !== st.centerIndex && st.cells[i]) {
          pool.push(this._applyLocksAndDisplay(st.cells[i].clone(locked), parent, locked));
        }
      }

      // 4. Fill remaining warm-start slots with branching erosion explorers, mutations, and immigrants
      while (pool.length < POOL_SIZE) {
        const rem = pool.length % 4;
        if (rem === 0) {
          pool.push(immigrantGenotype(parent, locked, Math.random, { chimera: false }));
        } else if (rem === 1 && (!locked.has('erosionMode') || parent.genes.erosionMode > 0)) {
          pool.push(branchingErosionCandidate(parent, {
            locked,
            mode: pool.length % 2 === 0 ? 1 : 2,
            deSwirl: true,
            intensity: Math.max(0.35, effIntensity),
            targetFeatures: st.target?.features,
          }));
        } else {
          const distScale = 0.35 + 0.95 * (pool.length / POOL_SIZE);
          pool.push(mutateGenotype(parent, {
            intensity: Math.max(0.35, effIntensity),
            distanceScale: distScale,
            mutationRate: st.mutationRate,
            locked,
            allowDisplay: false,
          }));
        }
      }
    } else {
      // 1. Specialist domain crossovers when metric-guided mode has distinct specialists.
      if (metricGuided && specParent && curveParent) {
        const nCross = Math.max(4, Math.floor(POOL_SIZE * 0.10));
        for (let k = 0; k < nCross && pool.length < POOL_SIZE; k++) {
          const partner = (k % 2 === 1 && erosionParent) ? erosionParent : curveParent;
          const hybrid = specialistCrossover(specParent, partner, { locked });
          pool.push(mutateGenotype(hybrid, {
            intensity: effIntensity * 0.45,
            distanceScale: 0.5 + 0.5 * (k / nCross),
            mutationRate: st.mutationRate,
            locked,
            metricGuided: true,
            subScores: this.parentSubScores,
            allowDisplay: false,
          }));
        }
      }

      // 2. Dedicated Branching / Erosion Explorer slice (12 candidates/gen):
      // Actively explores Runevision Phacelle (Mode 1) & Classic Gavoronoise (Mode 2)
      // erosion parameters while damping excessive domain-warp swirl ("deSwirl").
      if (!locked.has('erosionMode') || parent.genes.erosionMode > 0) {
        const nErosion = 12;
        for (let k = 0; k < nErosion && pool.length < POOL_SIZE; k++) {
          const mode = locked.has('erosionMode')
            ? parent.genes.erosionMode
            : (k % 3 === 2 ? 2 : 1);
          const baseForErosion = (k < 4 && erosionParent) ? erosionParent : parent;
          pool.push(branchingErosionCandidate(baseForErosion, {
            locked,
            mode,
            deSwirl: k % 3 !== 0,
            intensity: effIntensity,
            subScores: this.parentSubScores,
            targetFeatures: st.target?.features,
          }));
        }
      }

      // 3. Smooth / Low-Warp Relief Explorers (6 candidates/gen):
      // Actively tests shedding excess domain-warp swirl, warp frequency, and contrast
      // when matching smooth targets (or targets with localized bands on a smooth field).
      const nCalm = 6;
      for (let k = 0; k < nCalm && pool.length < POOL_SIZE; k++) {
        const calm = mutateGenotype(parent, {
          intensity: effIntensity * 0.65,
          distanceScale: 0.5,
          mutationRate: st.mutationRate,
          locked,
          metricGuided,
          subScores: this.parentSubScores,
          allowDisplay: false,
        });
        const cg = { ...calm.genes };
        if (!locked.has('warpIntensity')) cg.warpIntensity *= 0.25 + 0.35 * (k / nCalm);
        if (!locked.has('warpFrequency')) cg.warpFrequency = Math.min(cg.warpFrequency, 0.8 + 0.3 * k);
        if (!locked.has('contrast') && cg.contrast > 1.05) cg.contrast = 0.75 + 0.35 * Math.random();
        if (!locked.has('persistence') && k % 2 === 0) cg.persistence = Math.min(cg.persistence, 0.38);
        if (!locked.has('erosionMode') && k < 3) {
          cg.erosionMode = 0;
          if (!locked.has('erosionStrength')) cg.erosionStrength = 0;
        }
        pool.push(new Genotype(cg, locked));
      }

      // 4. On re-heat trigger, inject structural chimeras & fresh random immigrants.
      if (injectImmigrants) {
        const nImm = Math.max(2, Math.floor(POOL_SIZE * IMMIGRANT_FRACTION));
        for (let k = 0; k < nImm && pool.length < POOL_SIZE; k++) {
          const chimera = k % 3 !== 0;
          pool.push(immigrantGenotype(parent, locked, Math.random, { chimera }));
        }
      }

      // 4. Fill the rest of the 80-candidate pool with radially scaled mutations.
      while (pool.length < POOL_SIZE) {
        const frac = pool.length / POOL_SIZE;
        const distanceScale = st.spatialScaling ? 0.30 + 1.0 * frac : 1.0;
        pool.push(mutateGenotype(parent, {
          intensity: effIntensity,
          distanceScale,
          mutationRate: st.mutationRate,
          locked,
          metricGuided,
          subScores: this.parentSubScores,
          allowDisplay: false,
        }));
      }
    }

    this.pool = pool;
    this.poolResults = new Array(pool.length).fill(null);
  }

  // Fast 2-3 step analytical + empirical tone hill-climb on a candidate.
  _microClimbTone(genotype, initialResult, steps = 3) {
    const st = this.store.state;
    if (!st.target) return { genotype, result: initialResult };
    const size = this._analysisSize();
    const opts = this._matcherOpts();
    let bestG = genotype;
    let bestRes = initialResult;
    if (!bestRes) {
      const lum = this.tileRenderer.sampleLuminance(bestG, size);
      bestRes = scoreCandidate(lum, st.target.features, opts);
    }

    for (let s = 0; s < steps; s++) {
      const adapted = adaptToneToTarget(bestG, bestRes.features, st.target.features, st.lockedGenes, opts);
      const lum = this.tileRenderer.sampleLuminance(adapted, size);
      const res = scoreCandidate(lum, st.target.features, opts);
      if (res.total > bestRes.total + 1e-4) {
        bestG = adapted;
        bestRes = res;
      } else {
        break;
      }
    }
    return { genotype: bestG, result: bestRes };
  }

  // If matcher toggles or locked genes changed since the last run/step, re-score
  // the stored best genotype and parent under the active options and locks.
  _reconcileStaleBaseline() {
    const st = this.store.state;
    if (!st.target) return;
    const size = this._analysisSize();
    const opts = this._matcherOpts();
    if (st.auto.bestGenotype && st.parent) {
      st.auto.bestGenotype = this._applyLocksAndDisplay(
        st.auto.bestGenotype.clone(),
        st.parent,
        st.lockedGenes
      );
    }
    if (st.auto.bestStale || !this.parentSubScores) {
      if (st.auto.bestGenotype) {
        const lum = this.tileRenderer.sampleLuminance(st.auto.bestGenotype, size);
        st.auto.bestFitness = scoreCandidate(lum, st.target.features, opts).total * 100;
      } else {
        st.auto.bestFitness = 0;
      }
      if (st.parent) {
        const pLum = this.tileRenderer.sampleLuminance(st.parent, size);
        const pRes = scoreCandidate(pLum, st.target.features, opts);
        this.parentFitness = pRes.total * 100;
        this.parentSubScores = pRes;
      }
      st.auto.bestStale = false;
      st.auto.matcherSig = JSON.stringify(st.matcher || {});
    }
  }

  _tick() {
    const st = this.store.state;
    if (!st.target) { this.stop(); return; }

    if (this.phase === 'sampling') {
      const size = this._analysisSize();
      const opts = this._matcherOpts();
      const erosionActive = st.parent?.genes?.erosionMode > 0 && st.parent?.genes?.erosionStrength > 0.001;
      const batchSize = (erosionActive && size >= ANALYSIS_SIZE_HI)
        ? (size >= ANALYSIS_SIZE_ULTRA ? 6 : 10)
        : CELLS_PER_FRAME;
      const end = Math.min(this.sampleIndex + batchSize, this.pool.length);
      for (let i = this.sampleIndex; i < end; i++) {
        const lum = this.tileRenderer.sampleLuminance(this.pool[i], size);
        this.poolResults[i] = scoreCandidate(lum, st.target.features, opts);
      }
      this.sampleIndex = end;

      if (this.sampleIndex >= this.pool.length) {
        this._finishGeneration(false);
      }
      // setTimeout keeps evolving in background tabs (RAF pauses when hidden).
      if (this.running) this.rafId = setTimeout(() => this._tick(), 0);
    }
  }

  _sampleAllSync() {
    const st = this.store.state;
    const size = this._analysisSize();
    const opts = this._matcherOpts();
    for (let i = 0; i < this.pool.length; i++) {
      const lum = this.tileRenderer.sampleLuminance(this.pool[i], size);
      this.poolResults[i] = scoreCandidate(lum, st.target.features, opts);
    }
  }

  // Projects the top (N^2 - 1) candidates from `this.pool` onto `st.cells`
  // ordered by genetic distance so inner rings hold close refinements and
  // outer rings hold bolder runners-up.
  _projectPoolToGrid(parentScore) {
    const st = this.store.state;
    const totalCells = st.gridSize * st.gridSize;
    const center = centerIndexFor(st.gridSize);
    st.centerIndex = center;

    // Collect non-parent candidates from the 80-candidate pool and sort by score desc.
    const ranked = [];
    for (let i = 1; i < this.pool.length; i++) {
      const res = this.poolResults[i];
      if (!res) continue;
      ranked.push({
        genotype: this.pool[i],
        score: res.total * 100,
        dist: genotypeDistance(this.pool[i], st.parent),
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    const topOffspring = ranked.slice(0, Math.max(0, totalCells - 1));

    if (st.spatialScaling) {
      topOffspring.sort((a, b) => a.dist - b.dist);
    }

    // Order non-center grid slot indices by radial distance from center.
    const slotIndices = [];
    for (let i = 0; i < totalCells; i++) {
      if (i !== center) slotIndices.push(i);
    }
    if (st.spatialScaling) {
      slotIndices.sort((a, b) => radialDistance(a, st.gridSize) - radialDistance(b, st.gridSize));
    }

    const newCells = new Array(totalCells);
    const newFitness = new Float64Array(totalCells).fill(-1);
    newCells[center] = st.parent.clone();
    newFitness[center] = parentScore;

    for (let k = 0; k < slotIndices.length; k++) {
      const slot = slotIndices[k];
      const item = topOffspring[k];
      if (item) {
        newCells[slot] = item.genotype.clone();
        newFitness[slot] = item.score;
      } else {
        newCells[slot] = st.parent.clone();
        newFitness[slot] = parentScore;
      }
    }

    let bestGridIdx = center;
    let bestGridScore = newFitness[center];
    for (let i = 0; i < totalCells; i++) {
      if (newFitness[i] > bestGridScore) {
        bestGridScore = newFitness[i];
        bestGridIdx = i;
      }
    }

    st.cells = newCells;
    st.fitness = newFitness;
    st.auto.bestIndex = bestGridIdx;
  }

  _finishGeneration(forceRenderGrid = false) {
    const st = this.store.state;
    this._reconcileStaleBaseline();
    const wasGenZero = st.auto.generation === 0;

    // On Gen 0, run a 3-step tone micro-climb on the top 6 distinct candidates
    // so every noise family is fairly evaluated with matched contrast and bias.
    if (wasGenZero) {
      const indices = this.poolResults
        .map((r, idx) => ({ idx, score: r ? r.total : -1 }))
        .sort((a, b) => b.score - a.score);
      const seenTypes = new Set();
      let climbed = 0;
      for (const { idx } of indices) {
        if (climbed >= 6) break;
        const g = this.pool[idx];
        const nt = g.genes.noiseType;
        if (climbed < 3 || !seenTypes.has(nt)) {
          seenTypes.add(nt);
          const { genotype: tunedG, result: tunedRes } = this._microClimbTone(g, this.poolResults[idx], 3);
          this.pool[idx] = tunedG;
          this.poolResults[idx] = tunedRes;
          climbed++;
        }
      }
    }

    // Identify best overall candidate, best offspring (index >= 1), and domain specialists.
    let bestIdx = 0;
    let bestScore = -1;
    let bestOffspringIdx = -1;
    let bestOffspringScore = -1;
    let bestSpecIdx = 0;
    let bestSpecMetric = -1;
    let bestCurveIdx = 0;
    let bestCurveMetric = -1;
    let bestErosionIdx = -1;
    let bestErosionScore = -1;

    for (let i = 0; i < this.pool.length; i++) {
      const res = this.poolResults[i];
      if (!res) continue;
      const sc = res.total * 100;
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
      }
      if (i >= 1 && sc > bestOffspringScore) {
        bestOffspringScore = sc;
        bestOffspringIdx = i;
      }
      const specMetric = 0.65 * res.fft + 0.35 * res.slope;
      if (specMetric > bestSpecMetric) {
        bestSpecMetric = specMetric;
        bestSpecIdx = i;
      }
      const curveMetric = 0.60 * res.lap + 0.40 * res.hist;
      if (curveMetric > bestCurveMetric) {
        bestCurveMetric = curveMetric;
        bestCurveIdx = i;
      }
      const candG = this.pool[i]?.genes;
      if (candG && candG.erosionMode > 0 && candG.erosionStrength > 0.04 && sc > bestErosionScore) {
        bestErosionScore = sc;
        bestErosionIdx = i;
      }
    }

    // Perform a fast 2-step tone micro-climb on the generation winner.
    if (bestIdx >= 0 && this.pool[bestIdx]) {
      const { genotype: tunedWinner, result: tunedRes } = this._microClimbTone(
        this.pool[bestIdx],
        this.poolResults[bestIdx],
        2
      );
      this.pool[bestIdx] = this._applyLocksAndDisplay(tunedWinner, st.parent, st.lockedGenes);
      this.poolResults[bestIdx] = tunedRes;
      bestScore = tunedRes.total * 100;
      if (bestIdx === bestOffspringIdx) {
        bestOffspringScore = bestScore;
      }
    }

    st.auto.generation++;
    this.stepsInRun++;
    const prevBest = st.auto.bestFitness;

    // Always preserve the all-time highest scoring genotype in st.auto.bestGenotype
    // (filtered through user locks).
    if (bestIdx >= 0 && this.pool[bestIdx] && (bestScore >= st.auto.bestFitness || !st.auto.bestGenotype)) {
      st.auto.bestFitness = bestScore;
      st.auto.bestGenotype = this._applyLocksAndDisplay(
        this.pool[bestIdx].clone(),
        st.parent,
        st.lockedGenes
      );
    }

    // Parent selection: Elitist (1 + lambda) vs. Multiple-Try Metropolis MCMC.
    const parentRes0 = this.poolResults[0];
    this.parentFitness = parentRes0 ? parentRes0.total * 100 : this.parentFitness;
    this.parentSubScores = parentRes0 || this.parentSubScores;

    if (st.matcher?.mcmc && bestOffspringIdx >= 1) {
      const delta = this.parentFitness - bestOffspringScore;
      const temp = Math.max(0.35, this.activeIntensity * 4.5);
      const acceptProb = delta <= 0 ? 1.0 : Math.exp(-delta / temp);
      if (Math.random() < acceptProb) {
        st.parent = this._applyLocksAndDisplay(
          this.pool[bestOffspringIdx].clone(),
          st.parent,
          st.lockedGenes
        );
        this.parentFitness = bestOffspringScore;
        this.parentSubScores = this.poolResults[bestOffspringIdx];
      }
    } else if (bestIdx >= 0 && bestScore >= this.parentFitness) {
      st.parent = this._applyLocksAndDisplay(
        this.pool[bestIdx].clone(),
        st.parent,
        st.lockedGenes
      );
      this.parentFitness = bestScore;
      this.parentSubScores = this.poolResults[bestIdx];
    }

    st.auto.bestStale = false;
    st.auto.matcherSig = JSON.stringify(st.matcher || {});

    // Project the current generation's scored pool onto st.cells & st.fitness.
    this._projectPoolToGrid(this.parentFitness);

    // Stagnation tracking & multi-step re-heat cooldown (REHEAT_DURATION = 5).
    const improved = bestScore > prevBest + IMPROVE_EPS;
    if (improved) {
      this.staleGens = 0;
    } else {
      this.staleGens++;
    }

    // Anneal relative to stepsInRun (not cumulative st.auto.generation) so subsequent
    // Auto-Evolve runs start with full exploration energy, without clobbering the
    // user's toolbar variationIntensity slider.
    const decayed = this.baseIntensity * Math.pow(0.975, this.stepsInRun);
    const baseAnnealed = Math.max(0.10, decayed * (1 - st.auto.bestFitness / 250));
    let triggerImmigrants = false;

    if (this.staleGens >= STALE_LIMIT) {
      this.staleGens = 0;
      this.reheatRemaining = REHEAT_DURATION;
      triggerImmigrants = true;
    }

    let genIntensity = baseAnnealed;
    if (this.reheatRemaining > 0) {
      const alpha = this.reheatRemaining / REHEAT_DURATION;
      const peak = Math.min(1.0, Math.max(this.baseIntensity, baseAnnealed * 3.0));
      genIntensity = baseAnnealed + alpha * (peak - baseAnnealed);
      this.reheatRemaining--;
    }

    this.activeIntensity = genIntensity;
    st.auto.activeIntensity = genIntensity;
    st.auto.reheatRemaining = this.reheatRemaining;
    st.auto.groupMultipliers = st.matcher?.metricGuided !== false
      ? computeGroupMultipliers(this.parentSubScores)
      : null;
    st.auto.running = this.running;

    const specParent = this.pool[bestSpecIdx]?.clone() || null;
    const curveParent = this.pool[bestCurveIdx]?.clone() || null;
    const erosionParent = bestErosionIdx >= 0 ? (this.pool[bestErosionIdx]?.clone() || null) : null;

    // Check termination against stepsInRun (so re-running Auto-Evolve always gets a
    // fresh 300-generation budget) and runTargetFitness.
    const shouldStop =
      this.running &&
      (this.stepsInRun >= MAX_GENERATIONS || st.auto.bestFitness >= this.runTargetFitness);

    const hideTiles = Boolean(st.matcher?.hideTiles && this.running && !shouldStop && !forceRenderGrid);
    this.store.emit('auto');
    this.store.emit('parent');
    this.store.emit('fitness');
    if (!hideTiles) {
      this.store.emit('grid');
    }

    if (this.onGeneration) this.onGeneration(st.auto, this.parentSubScores);

    if (shouldStop) {
      this.stop();
      return;
    }

    if (this.running) {
      // Build the next generation's 80-candidate pool around the active parent.
      this._buildCandidatePool({
        isWarmStart: false,
        injectImmigrants: triggerImmigrants,
        specParent,
        curveParent,
        erosionParent,
      });
      this.phase = 'sampling';
      this.sampleIndex = 0;
    }
  }
}
