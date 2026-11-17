import { GENES, defaults } from '../config/parameterSchema.js';

// A genotype wraps the flat `genes` object that drives shader uniforms.
export class Genotype {
  constructor(genes, locked = null) {
    this.genes = { ...defaults(), ...genes };
    this.validate(locked);
  }

  clone(locked = null) {
    return new Genotype({ ...this.genes }, locked);
  }

  serialize() {
    return { version: 1, genes: { ...this.genes } };
  }

  static deserialize(obj) {
    if (!obj || typeof obj !== 'object' || !obj.genes) {
      throw new Error('Invalid genotype payload');
    }
    return new Genotype(obj.genes);
  }

  // Clamps every gene to schema bounds and enforces anti-fragmentation
  // guardrails so mutations can never produce catastrophic visuals.
  // When `locked` (Set of gene keys) is provided, guardrails adjust unlocked
  // partner genes first and never overwrite user-locked values.
  validate(locked = null) {
    const g = this.genes;
    const isLocked = (key) => Boolean(locked && typeof locked.has === 'function' && locked.has(key));

    for (const key of Object.keys(GENES)) {
      const def = GENES[key];
      let v = Number(g[key]);
      if (!Number.isFinite(v)) v = def.def;
      v = Math.min(def.max, Math.max(def.min, v));
      g[key] = def.type === 'int' || def.type === 'enum' || def.type === 'bool'
        ? Math.round(v)
        : v;
    }

    const lockedSnapshot = {};
    if (locked && typeof locked.forEach === 'function') {
      locked.forEach((k) => {
        if (k in g) lockedSnapshot[k] = g[k];
      });
    }

    // Guardrail 1 — Nyquist frequency cap: max octave frequency stays below
    // the sub-pixel aliasing threshold. Adjusts unlocked genes first.
    const NYQUIST = 96.0;
    const topFreq = () => g.frequency * Math.pow(g.lacunarity, g.octaves - 1);
    let guard = 0;
    while (topFreq() > NYQUIST && guard++ < 32) {
      if (!isLocked('lacunarity') && g.lacunarity > GENES.lacunarity.min) {
        g.lacunarity = Math.max(GENES.lacunarity.min, g.lacunarity * 0.94);
      } else if (!isLocked('frequency') && g.frequency > GENES.frequency.min) {
        g.frequency = Math.max(GENES.frequency.min, g.frequency * 0.9);
      } else if (!isLocked('octaves') && g.octaves > GENES.octaves.min) {
        g.octaves = Math.max(GENES.octaves.min, g.octaves - 1);
      } else {
        break;
      }
    }

    // Guardrail 2 — warp stability & anti-swirl envelope: keeps domain-warp
    // coordinate folding (warpIntensity * warpFrequency) bounded so mutations
    // don't degenerate into high-frequency swirly marble soup.
    const MAX_WARP_PRODUCT = 2.2;
    let wGuard = 0;
    while (g.warpIntensity * g.warpFrequency > MAX_WARP_PRODUCT && wGuard++ < 24) {
      if (!isLocked('warpFrequency') && g.warpFrequency > GENES.warpFrequency.min) {
        g.warpFrequency = Math.max(GENES.warpFrequency.min, g.warpFrequency * 0.90);
      } else if (!isLocked('warpIntensity') && g.warpIntensity > GENES.warpIntensity.min) {
        g.warpIntensity = Math.max(GENES.warpIntensity.min, g.warpIntensity * 0.90);
      } else {
        break;
      }
    }
    if (g.warpIntensity > 0.85) {
      if (!isLocked('warpFrequency')) {
        g.warpFrequency = Math.min(g.warpFrequency, 2.6);
      }
      if (!isLocked('laplacianWeight')) {
        g.laplacianWeight = Math.min(0.85, Math.max(-0.85, g.laplacianWeight));
      }
    }

    // Guardrail 3 — persistence envelope: keeps total fBm amplitude bounded.
    if (g.persistence * g.lacunarity > 1.6) {
      if (!isLocked('persistence')) {
        g.persistence = Math.min(g.persistence, 1.6 / g.lacunarity);
      } else if (!isLocked('lacunarity')) {
        g.lacunarity = Math.max(GENES.lacunarity.min, Math.min(g.lacunarity, 1.6 / g.persistence));
      }
    }

    // Guardrail 4 — erosion Nyquist cap & amplitude envelope: prevents finest
    // Phacelle / Gavoronoise gullies from aliasing into sub-pixel noise.
    if (g.erosionMode > 0 && g.erosionStrength > 0.001) {
      const topErosionFreq = () =>
        (g.frequency / 3.0) *
        (1.0 / Math.max(0.02, g.erosionScale * g.erosionCellScale)) *
        Math.pow(g.erosionLacunarity, g.erosionOctaves - 1);
      let eGuard = 0;
      while (topErosionFreq() > NYQUIST && eGuard++ < 32) {
        if (!isLocked('erosionLacunarity') && g.erosionLacunarity > GENES.erosionLacunarity.min) {
          g.erosionLacunarity = Math.max(GENES.erosionLacunarity.min, g.erosionLacunarity * 0.94);
        } else if (!isLocked('erosionScale') && g.erosionScale < GENES.erosionScale.max) {
          g.erosionScale = Math.min(GENES.erosionScale.max, g.erosionScale * 1.08);
        } else if (!isLocked('erosionOctaves') && g.erosionOctaves > GENES.erosionOctaves.min) {
          g.erosionOctaves = Math.max(GENES.erosionOctaves.min, g.erosionOctaves - 1);
        } else {
          break;
        }
      }

      if (g.erosionGain * g.erosionLacunarity > 1.55) {
        if (!isLocked('erosionGain')) {
          g.erosionGain = Math.min(g.erosionGain, 1.55 / g.erosionLacunarity);
        } else if (!isLocked('erosionLacunarity')) {
          g.erosionLacunarity = Math.max(GENES.erosionLacunarity.min, Math.min(g.erosionLacunarity, 1.55 / g.erosionGain));
        }
      }

      // Guardrail 5 — prevent extreme double-sharpening when heavy erosion
      // is combined with strong Laplacian feedback or high ridge exponents.
      if (g.erosionStrength > 0.18) {
        if (!isLocked('laplacianWeight')) {
          g.laplacianWeight = Math.min(0.85, Math.max(-0.85, g.laplacianWeight));
        }
        if (!isLocked('ridgeSharpness')) {
          g.ridgeSharpness = Math.min(2.8, Math.max(0.6, g.ridgeSharpness));
        }
      }
    }

    // Re-assert user-locked gene values as an absolute invariant.
    for (const [k, v] of Object.entries(lockedSnapshot)) {
      g[k] = v;
    }
  }
}
