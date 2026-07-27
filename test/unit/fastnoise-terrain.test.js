/**
 * Tests for the FastNoiseLite natural mountain heightmap pipeline.
 *
 * FastNoiseLite is deterministic for a given seed (unlike simplex-noise's
 * random construction), so these tests can assert reproducibility as well as
 * range/finiteness properties.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SETTINGS,
    HEIGHT_SCALE,
    clamp,
    smoothstep,
    createNoiseSet,
    generateBaseHeightmap,
    applyEdgeFalloff,
    applyAsymmetricSlopes,
    applyThermalErosion,
    conditionDrainage,
    calculateFlow,
    carveChannels,
    calculateSlopes,
    addSurfaceRelief,
    renderGrayscale,
    renderTerrain,
    renderTerrainRamp,
    renderSlopeAware,
    renderGeogenStyle,
    generateTerrain,
    computeSobelGradients,
    computeLaplacian,
    computePercentile,
    applyRidgeEnhancement,
    applyRidgeMask,
    applySlopeChanneling,
    applyBasinDeposition,
    applyFlowBlur,
    applyCurvature,
    renderRidgeMaskOverlay,
    renderSlopeChannelOverlay,
    renderBasinDepositionOverlay,
} from '../../src/fastnoise-terrain.js';

const W = 48;
const H = 48;

function allFinite(arr) {
    for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) return false;
    }
    return true;
}

describe('math helpers', () => {
    it('clamp bounds values', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(0.5, 0, 1)).toBe(0.5);
    });

    it('smoothstep returns 0 below, 1 above, monotonic between', () => {
        expect(smoothstep(0, 1, -1)).toBe(0);
        expect(smoothstep(0, 1, 2)).toBe(1);
        const a = smoothstep(0, 1, 0.25);
        const b = smoothstep(0, 1, 0.75);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeLessThan(1);
        expect(b).toBeGreaterThan(a);
    });

    it('smoothstep handles equal edges', () => {
        expect(smoothstep(0.5, 0.5, 0.4)).toBe(0);
        expect(smoothstep(0.5, 0.5, 0.6)).toBe(1);
    });
});

describe('createNoiseSet', () => {
    it('produces the expected generators', () => {
        const ns = createNoiseSet(1337);
        for (const key of ['structure', 'warp', 'broad', 'ridge', 'detail', 'coverage', 'edge', 'relief']) {
            expect(ns[key]).toBeDefined();
            expect(typeof ns[key].GetNoise).toBe('function');
        }
    });
});

describe('generateBaseHeightmap', () => {
    it('returns a finite Float64Array of the right size in [0, HEIGHT_SCALE]', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS);
        expect(hm).toBeInstanceOf(Float64Array);
        expect(hm.length).toBe(W * H);
        expect(allFinite(hm)).toBe(true);
        let min = Infinity;
        let max = -Infinity;
        for (const v of hm) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeLessThanOrEqual(HEIGHT_SCALE + 1e-6);
    });

    it('is deterministic for the same seed', () => {
        const a = generateBaseHeightmap(W, H, { ...DEFAULT_SETTINGS, seed: 42 });
        const b = generateBaseHeightmap(W, H, { ...DEFAULT_SETTINGS, seed: 42 });
        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('differs for different seeds', () => {
        const a = generateBaseHeightmap(W, H, { ...DEFAULT_SETTINGS, seed: 1 });
        const b = generateBaseHeightmap(W, H, { ...DEFAULT_SETTINGS, seed: 2 });
        expect(Array.from(a)).not.toEqual(Array.from(b));
    });
});

describe('applyEdgeFalloff', () => {
    it('lowers edges more than the center', () => {
        const flat = new Float64Array(W * H).fill(HEIGHT_SCALE);
        const settings = {
            ...DEFAULT_SETTINGS,
            enableEdgeFalloff: true,
            edgeStrength: 1,
            edgeFloor: 0,
            edgeIrregularity: 0, // deterministic for the assertion
            edgeInnerRadius: 0.3,
        };
        applyEdgeFalloff(flat, W, H, settings);

        const center = flat[(H / 2) * W + W / 2];
        const corner = flat[0];
        expect(center).toBeGreaterThan(corner);
        expect(corner).toBeLessThan(HEIGHT_SCALE);
        expect(allFinite(flat)).toBe(true);
    });

    it('is a no-op when disabled', () => {
        const flat = new Float64Array(W * H).fill(500);
        applyEdgeFalloff(flat, W, H, { ...DEFAULT_SETTINGS, enableEdgeFalloff: false });
        for (const v of flat) expect(v).toBe(500);
    });
});

describe('applyAsymmetricSlopes', () => {
    it('only modifies cells within the elevation band and stays finite', () => {
        // Gradient ramp so some cells fall inside the band
        const hm = new Float64Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                hm[y * W + x] = (x / (W - 1)) * HEIGHT_SCALE;
            }
        }
        const before = new Float64Array(hm);
        applyAsymmetricSlopes(hm, W, H, {
            ...DEFAULT_SETTINGS,
            enableAsymmetric: true,
            asymElevMin: 0.4,
            asymElevMax: 0.6,
            asymCoverage: 1,
            asymStrength: 1,
        });
        expect(allFinite(hm)).toBe(true);

        // Cells well below the band (x near 0) should be unchanged
        let lowUnchanged = true;
        for (let y = 1; y < H - 1; y++) {
            if (hm[y * W + 1] !== before[y * W + 1]) lowUnchanged = false;
        }
        expect(lowUnchanged).toBe(true);
    });

    it('is a no-op when disabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS);
        const before = new Float64Array(hm);
        applyAsymmetricSlopes(hm, W, H, { ...DEFAULT_SETTINGS, enableAsymmetric: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });
});

describe('applyThermalErosion', () => {
    it('reduces a sharp spike and conserves finiteness', () => {
        const hm = new Float64Array(W * H).fill(0);
        const c = (H / 2) * W + W / 2;
        hm[c] = HEIGHT_SCALE; // single spike
        applyThermalErosion(hm, W, H, {
            ...DEFAULT_SETTINGS,
            enableThermal: true,
            thermalIterations: 5,
            thermalStrength: 1,
            thermalTalus: 0.001,
        });
        expect(hm[c]).toBeLessThan(HEIGHT_SCALE);
        expect(allFinite(hm)).toBe(true);
    });
});

describe('drainage and rivers', () => {
    it('conditionDrainage removes single-cell pits', () => {
        const hm = new Float64Array(W * H).fill(500);
        const pit = (H / 2) * W + W / 2;
        hm[pit] = 0; // deep pit surrounded by higher terrain
        const filled = conditionDrainage(hm, W, H, { ...DEFAULT_SETTINGS, preserveLakes: false });
        expect(filled[pit]).toBeGreaterThan(hm[pit]);
        expect(allFinite(filled)).toBe(true);
    });

    it('calculateFlow accumulates area downhill on a ramp', () => {
        // Ramp descending along +x: flow should accumulate toward high x
        const hm = new Float64Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                hm[y * W + x] = (W - x) * 10;
            }
        }
        const flow = calculateFlow(hm, W, H);
        expect(allFinite(flow)).toBe(true);
        // Downstream (high x) should accumulate more than upstream (low x)
        const upstream = flow[(H / 2) * W + 2];
        const downstream = flow[(H / 2) * W + (W - 3)];
        expect(downstream).toBeGreaterThan(upstream);
    });

    it('carveChannels lowers high-flow cells and respects disable flag', () => {
        const hm = new Float64Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                hm[y * W + x] = (W - x) * 10 + 400;
            }
        }
        const flow = calculateFlow(hm, W, H);
        const before = new Float64Array(hm);
        carveChannels(hm, flow, W, H, {
            ...DEFAULT_SETTINGS,
            enableRivers: true,
            riverAreaThreshold: 20,
            riverSourceElevation: 0,
            riverCarveDepth: 0.1,
        });
        let anyLowered = false;
        for (let i = 0; i < hm.length; i++) {
            if (hm[i] < before[i] - 1e-9) anyLowered = true;
        }
        expect(anyLowered).toBe(true);

        const hm2 = new Float64Array(before);
        carveChannels(hm2, flow, W, H, { ...DEFAULT_SETTINGS, enableRivers: false });
        expect(Array.from(hm2)).toEqual(Array.from(before));
    });
});

describe('calculateSlopes', () => {
    it('returns values normalized to [0, 1]', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS);
        const slope = calculateSlopes(hm, W, H);
        expect(slope.length).toBe(W * H);
        for (const v of slope) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});

describe('addSurfaceRelief', () => {
    it('raises elevation where rocks/boulders are placed', () => {
        const hm = new Float64Array(W * H).fill(400);
        const slope = new Float64Array(W * H).fill(0.5);
        const before = new Float64Array(hm);
        addSurfaceRelief(hm, slope, W, H, {
            ...DEFAULT_SETTINGS,
            enableRocks: true,
            rockDensity: 1, // force placement everywhere eligible
            rockElevMin: 0,
            rockElevMax: 1,
            rockSlopeMin: 0,
            rockSlopeMax: 1,
        });
        let anyRaised = false;
        for (let i = 0; i < hm.length; i++) {
            if (hm[i] > before[i] + 1e-9) anyRaised = true;
        }
        expect(anyRaised).toBe(true);
        expect(allFinite(hm)).toBe(true);
    });

    it('is a no-op when both rocks and boulders are disabled', () => {
        const hm = new Float64Array(W * H).fill(400);
        const slope = new Float64Array(W * H).fill(0.5);
        addSurfaceRelief(hm, slope, W, H, {
            ...DEFAULT_SETTINGS,
            enableRocks: false,
            enableBoulders: false,
        });
        for (const v of hm) expect(v).toBe(400);
    });
});

describe('renderGrayscale', () => {
    it('packs ABGR grayscale with full alpha', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS);
        const px = renderGrayscale(hm, W, H, DEFAULT_SETTINGS);
        expect(px).toBeInstanceOf(Uint32Array);
        expect(px.length).toBe(W * H);
        for (const p of px) {
            const a = (p >>> 24) & 0xff;
            const b = (p >>> 16) & 0xff;
            const g = (p >>> 8) & 0xff;
            const r = p & 0xff;
            expect(a).toBe(255);
            expect(r).toBe(g); // grayscale: channels equal
            expect(g).toBe(b);
        }
    });

    it('fixedRange maps 0..HEIGHT_SCALE consistently', () => {
        const hm = new Float64Array(W * H);
        hm[0] = 0;
        hm[1] = HEIGHT_SCALE;
        const px = renderGrayscale(hm, W, H, { ...DEFAULT_SETTINGS, fixedRange: true });
        expect(px[0] & 0xff).toBe(0);
        expect(px[1] & 0xff).toBe(255);
    });
});

describe('generateTerrain full pipeline', () => {
    it('produces a finite heightmap and slope map deterministically', () => {
        const a = generateTerrain(W, H, { ...DEFAULT_SETTINGS, seed: 7 });
        const b = generateTerrain(W, H, { ...DEFAULT_SETTINGS, seed: 7 });
        expect(a.heightmap.length).toBe(W * H);
        expect(a.slopeMap.length).toBe(W * H);
        expect(allFinite(a.heightmap)).toBe(true);
        expect(allFinite(a.slopeMap)).toBe(true);
        expect(Array.from(a.heightmap)).toEqual(Array.from(b.heightmap));
    });

    it('runs with all effects disabled', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, {
            ...DEFAULT_SETTINGS,
            enableEdgeFalloff: false,
            enableAsymmetric: false,
            enableThermal: false,
            enableRivers: false,
            enableRocks: false,
            enableBoulders: false,
        });
        expect(allFinite(heightmap)).toBe(true);
        expect(allFinite(slopeMap)).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* Shared kernel computations                                         */
/* ------------------------------------------------------------------ */

describe('computeSobelGradients', () => {
    it('returns Float64Arrays of correct size', () => {
        const hm = new Float64Array(W * H);
        const { gx, gy, magnitude } = computeSobelGradients(hm, W, H);
        expect(gx).toBeInstanceOf(Float64Array);
        expect(gy).toBeInstanceOf(Float64Array);
        expect(magnitude).toBeInstanceOf(Float64Array);
        expect(gx.length).toBe(W * H);
    });

    it('produces zero gradients on a flat heightmap', () => {
        const hm = new Float64Array(W * H).fill(500);
        const { gx, gy, magnitude } = computeSobelGradients(hm, W, H);
        let maxMag = 0;
        for (let i = 0; i < magnitude.length; i++) {
            if (magnitude[i] > maxMag) maxMag = magnitude[i];
        }
        expect(maxMag).toBe(0);
    });

    it('detects gradients on a sloped heightmap', () => {
        const hm = new Float64Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                hm[y * W + x] = x * 10;
            }
        }
        const { gx, magnitude } = computeSobelGradients(hm, W, H);
        // Interior pixels should have positive x-gradient
        const midIdx = Math.floor(H / 2) * W + Math.floor(W / 2);
        expect(gx[midIdx]).toBeGreaterThan(0);
        expect(magnitude[midIdx]).toBeGreaterThan(0);
    });

    it('zeroes edge pixels', () => {
        const hm = new Float64Array(W * H);
        for (let i = 0; i < W * H; i++) hm[i] = Math.random() * 1000;
        const { gx, gy } = computeSobelGradients(hm, W, H);
        expect(gx[0]).toBe(0);
        expect(gy[0]).toBe(0);
        expect(gx[W * H - 1]).toBe(0);
        expect(gy[W * H - 1]).toBe(0);
    });
});

describe('computeLaplacian', () => {
    it('returns Float64Array of correct size', () => {
        const hm = new Float64Array(W * H);
        const lap = computeLaplacian(hm, W, H);
        expect(lap).toBeInstanceOf(Float64Array);
        expect(lap.length).toBe(W * H);
    });

    it('produces zero on a flat heightmap', () => {
        const hm = new Float64Array(W * H).fill(500);
        const lap = computeLaplacian(hm, W, H);
        let maxAbs = 0;
        for (let i = 0; i < lap.length; i++) {
            if (Math.abs(lap[i]) > maxAbs) maxAbs = Math.abs(lap[i]);
        }
        expect(maxAbs).toBe(0);
    });

    it('produces negative (convex) at a peak', () => {
        const hm = new Float64Array(W * H).fill(500);
        const cx = Math.floor(W / 2);
        const cy = Math.floor(H / 2);
        hm[cy * W + cx] = 1000; // spike
        const lap = computeLaplacian(hm, W, H);
        expect(lap[cy * W + cx]).toBeLessThan(0);
    });

    it('produces positive (concave) at a pit', () => {
        const hm = new Float64Array(W * H).fill(500);
        const cx = Math.floor(W / 2);
        const cy = Math.floor(H / 2);
        hm[cy * W + cx] = 0; // pit
        const lap = computeLaplacian(hm, W, H);
        expect(lap[cy * W + cx]).toBeGreaterThan(0);
    });

    it('zeroes edge pixels', () => {
        const hm = new Float64Array(W * H);
        for (let i = 0; i < W * H; i++) hm[i] = Math.random() * 1000;
        const lap = computeLaplacian(hm, W, H);
        expect(lap[0]).toBe(0);
        expect(lap[W * H - 1]).toBe(0);
    });
});

describe('computePercentile', () => {
    it('returns epsilon for all-zero/negative arrays', () => {
        const arr = new Float64Array(100).fill(0);
        expect(computePercentile(arr, 0.95)).toBeCloseTo(1e-6, 9);
    });

    it('returns the max for p=1.0', () => {
        const arr = new Float64Array([1, 2, 3, 4, 5, 100]);
        const p100 = computePercentile(arr, 1.0);
        expect(p100).toBeCloseTo(100, 0);
    });

    it('is robust to a single outlier spike (regression: visibility bug root cause)', () => {
        // 999 "typical" values around 10, plus one massive outlier spike.
        const arr = new Float64Array(1000).fill(10);
        arr[500] = 10000;
        const p95 = computePercentile(arr, 0.95);
        // The 95th percentile should reflect the typical value (~10), not be
        // dragged up toward the single outlier (10000), unlike a naive max.
        expect(p95).toBeLessThan(100);
        expect(p95).toBeGreaterThan(0);
    });

    it('increases monotonically with p', () => {
        const arr = new Float64Array(500);
        for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
        const p50 = computePercentile(arr, 0.5);
        const p90 = computePercentile(arr, 0.9);
        expect(p90).toBeGreaterThanOrEqual(p50);
    });
});

/* ------------------------------------------------------------------ */
/* Post-processing stages                                             */
/* ------------------------------------------------------------------ */

describe('applyRidgeEnhancement', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        applyRidgeEnhancement(hm, W, H, { ...DEFAULT_SETTINGS, enableRidgeEnhance: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });

    it('produces finite values when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applyRidgeEnhancement(hm, W, H, { ...DEFAULT_SETTINGS, enableRidgeEnhance: true, ridgeEnhanceStrength: 0.5 }, createNoiseSet(42));
        expect(allFinite(hm)).toBe(true);
    });

    it('is deterministic per seed', () => {
        const s = { ...DEFAULT_SETTINGS, enableRidgeEnhance: true };
        const hm1 = generateBaseHeightmap(W, H, s, createNoiseSet(99));
        applyRidgeEnhancement(hm1, W, H, s, createNoiseSet(99));
        const hm2 = generateBaseHeightmap(W, H, s, createNoiseSet(99));
        applyRidgeEnhancement(hm2, W, H, s, createNoiseSet(99));
        expect(Array.from(hm1)).toEqual(Array.from(hm2));
    });
});

describe('applyRidgeMask', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        const ctx = {};
        applyRidgeMask(hm, W, H, { ...DEFAULT_SETTINGS, enableRidgeMask: false }, ctx);
        expect(Array.from(hm)).toEqual(Array.from(before));
        expect(ctx.ridgeMask).toBeNull();
    });

    it('produces a ridge mask in pipeline context', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        applyRidgeMask(hm, W, H, { ...DEFAULT_SETTINGS, enableRidgeMask: true }, ctx);
        expect(ctx.ridgeMask).not.toBeNull();
        expect(ctx.ridgeMask).toBeInstanceOf(Float64Array);
        expect(ctx.ridgeMask.length).toBe(W * H);
    });

    it('produces finite values', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applyRidgeMask(hm, W, H, { ...DEFAULT_SETTINGS, enableRidgeMask: true });
        expect(allFinite(hm)).toBe(true);
    });
});

describe('applySlopeChanneling', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });

    it('lowers steep areas when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const before = new Float64Array(hm);
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true, slopeChannelStrength: 1.0 });
        let anyLowered = false;
        for (let i = 0; i < hm.length; i++) {
            if (hm[i] < before[i] - 0.001) { anyLowered = true; break; }
        }
        expect(anyLowered).toBe(true);
    });

    it('produces finite values', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true });
        expect(allFinite(hm)).toBe(true);
    });

    it('affects a measurable percentage of pixels at tuned default settings (regression: outlier-max normalization bug)', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true }, ctx);
        expect(ctx.stats.slopeChanneling.pctAffected).toBeGreaterThan(0.5);
    });

    it('stores a mask and zeroed stats in pipelineCtx when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const ctx = {};
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: false }, ctx);
        expect(ctx.slopeChannelMask).toBeNull();
        expect(ctx.stats.slopeChanneling).toEqual({ pctAffected: 0, avgDelta: 0 });
    });

    it('stores a mask array and non-zero stats in pipelineCtx when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        applySlopeChanneling(hm, W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true }, ctx);
        expect(ctx.slopeChannelMask).toBeInstanceOf(Float64Array);
        expect(ctx.slopeChannelMask.length).toBe(W * H);
        expect(ctx.stats.slopeChanneling.pctAffected).toBeGreaterThan(0);
        expect(ctx.stats.slopeChanneling.avgDelta).toBeGreaterThan(0);
    });
});

describe('applyBasinDeposition', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });

    it('raises basin areas when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const before = new Float64Array(hm);
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true, basinDepositionAmount: 1.0 });
        let anyRaised = false;
        for (let i = 0; i < hm.length; i++) {
            if (hm[i] > before[i] + 0.001) { anyRaised = true; break; }
        }
        expect(anyRaised).toBe(true);
    });

    it('produces finite values', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true });
        expect(allFinite(hm)).toBe(true);
    });

    it('affects a measurable percentage of pixels at tuned default settings (regression: outlier-max normalization bug)', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true }, ctx);
        expect(ctx.stats.basinDeposition.pctAffected).toBeGreaterThan(0.5);
    });

    it('stores a mask and zeroed stats in pipelineCtx when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const ctx = {};
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: false }, ctx);
        expect(ctx.basinDepositionMask).toBeNull();
        expect(ctx.stats.basinDeposition).toEqual({ pctAffected: 0, avgDelta: 0 });
    });

    it('stores a mask array and non-zero stats in pipelineCtx when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        applyBasinDeposition(hm, W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true }, ctx);
        expect(ctx.basinDepositionMask).toBeInstanceOf(Float64Array);
        expect(ctx.basinDepositionMask.length).toBe(W * H);
        expect(ctx.stats.basinDeposition.pctAffected).toBeGreaterThan(0);
        expect(ctx.stats.basinDeposition.avgDelta).toBeGreaterThan(0);
    });
});

describe('applyFlowBlur', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        applyFlowBlur(hm, W, H, { ...DEFAULT_SETTINGS, enableFlowBlur: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });

    it('reduces variance (smoothing) when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const before = new Float64Array(hm);
        applyFlowBlur(hm, W, H, { ...DEFAULT_SETTINGS, enableFlowBlur: true, flowBlurStrength: 1.0, flowBlurRadius: 3, flowBlurPasses: 2 });
        // Compute variance of interior pixels
        function variance(arr) {
            let sum = 0, sumSq = 0, n = 0;
            for (let y = 2; y < H - 2; y++) {
                for (let x = 2; x < W - 2; x++) {
                    const v = arr[y * W + x];
                    sum += v; sumSq += v * v; n++;
                }
            }
            const mean = sum / n;
            return sumSq / n - mean * mean;
        }
        expect(variance(hm)).toBeLessThan(variance(before));
    });

    it('produces finite values', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applyFlowBlur(hm, W, H, { ...DEFAULT_SETTINGS, enableFlowBlur: true });
        expect(allFinite(hm)).toBe(true);
    });
});

describe('applyCurvature', () => {
    it('is a no-op when disabled', () => {
        const hm = new Float64Array(W * H).fill(500);
        const before = new Float64Array(hm);
        applyCurvature(hm, W, H, { ...DEFAULT_SETTINGS, enableCurvature: false });
        expect(Array.from(hm)).toEqual(Array.from(before));
    });

    it('produces finite values when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        applyCurvature(hm, W, H, { ...DEFAULT_SETTINGS, enableCurvature: true, curvatureStrength: 0.5 });
        expect(allFinite(hm)).toBe(true);
    });

    it('changes heightmap when enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const before = new Float64Array(hm);
        applyCurvature(hm, W, H, { ...DEFAULT_SETTINGS, enableCurvature: true, curvatureStrength: 1.0 });
        let anyChanged = false;
        for (let i = 0; i < hm.length; i++) {
            if (Math.abs(hm[i] - before[i]) > 0.001) { anyChanged = true; break; }
        }
        expect(anyChanged).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* Color gradient renderers                                           */
/* ------------------------------------------------------------------ */

describe('renderTerrain dispatcher', () => {
    it('dispatches to grayscale by default', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, colorMode: 'grayscale' });
        const pixels = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, colorMode: 'grayscale' });
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
    });

    it('dispatches to terrainRamp', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, DEFAULT_SETTINGS);
        const pixels = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, colorMode: 'terrainRamp' });
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
    });

    it('dispatches to slopeAware', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, DEFAULT_SETTINGS);
        const pixels = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, colorMode: 'slopeAware' });
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
    });

    it('dispatches to geogenStyle', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, DEFAULT_SETTINGS);
        const pixels = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, colorMode: 'geogenStyle' });
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
    });
});

describe('renderTerrainRamp', () => {
    it('produces valid ABGR pixels', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const pixels = renderTerrainRamp(hm, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        for (let i = 0; i < pixels.length; i++) {
            const a = (pixels[i] >>> 24) & 0xff;
            expect(a).toBe(255); // alpha always 255
        }
    });
});

describe('renderSlopeAware', () => {
    it('produces valid ABGR pixels', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const slopeMap = calculateSlopes(hm, W, H);
        const pixels = renderSlopeAware(hm, slopeMap, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        for (let i = 0; i < pixels.length; i++) {
            const a = (pixels[i] >>> 24) & 0xff;
            expect(a).toBe(255);
        }
    });
});

describe('renderGeogenStyle', () => {
    it('produces valid ABGR pixels', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const pixels = renderGeogenStyle(hm, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        for (let i = 0; i < pixels.length; i++) {
            const a = (pixels[i] >>> 24) & 0xff;
            expect(a).toBe(255);
        }
    });
});

describe('mask overlay renderers', () => {
    it('renderRidgeMaskOverlay produces valid ABGR pixels reflecting mask intensity', () => {
        const { heightmap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableRidgeMask: true });
        const pixels = renderRidgeMaskOverlay(heightmap, pipelineCtx, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
        for (let i = 0; i < pixels.length; i++) {
            expect((pixels[i] >>> 24) & 0xff).toBe(255);
        }
    });

    it('renderSlopeChannelOverlay produces valid ABGR pixels reflecting mask intensity', () => {
        const { heightmap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true });
        const pixels = renderSlopeChannelOverlay(heightmap, pipelineCtx, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
        for (let i = 0; i < pixels.length; i++) {
            expect((pixels[i] >>> 24) & 0xff).toBe(255);
        }
    });

    it('renderBasinDepositionOverlay produces valid ABGR pixels reflecting mask intensity', () => {
        const { heightmap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true });
        const pixels = renderBasinDepositionOverlay(heightmap, pipelineCtx, W, H, DEFAULT_SETTINGS);
        expect(pixels).toBeInstanceOf(Uint32Array);
        expect(pixels.length).toBe(W * H);
        for (let i = 0; i < pixels.length; i++) {
            expect((pixels[i] >>> 24) & 0xff).toBe(255);
        }
    });

    it('falls back to solid black when the requested mask is unavailable', () => {
        const { heightmap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: false });
        const pixels = renderSlopeChannelOverlay(heightmap, pipelineCtx, W, H, DEFAULT_SETTINGS);
        for (let i = 0; i < pixels.length; i++) {
            expect(pixels[i]).toBe(0xff000000);
        }
    });

    it('renderTerrain dispatches to the slope channel overlay when showSlopeChannelMask is set', () => {
        const { heightmap, slopeMap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableSlopeChanneling: true });
        const withOverlay = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, showSlopeChannelMask: true }, pipelineCtx);
        const without = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, showSlopeChannelMask: false }, pipelineCtx);
        expect(Array.from(withOverlay)).not.toEqual(Array.from(without));
    });

    it('renderTerrain dispatches to the basin deposition overlay when showBasinDepositionMask is set', () => {
        const { heightmap, slopeMap, pipelineCtx } = generateTerrain(W, H, { ...DEFAULT_SETTINGS, enableBasinDeposition: true });
        const withOverlay = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, showBasinDepositionMask: true }, pipelineCtx);
        const without = renderTerrain(heightmap, slopeMap, W, H, { ...DEFAULT_SETTINGS, showBasinDepositionMask: false }, pipelineCtx);
        expect(Array.from(withOverlay)).not.toEqual(Array.from(without));
    });
});

/* ------------------------------------------------------------------ */
/* Pipeline context caching                                           */
/* ------------------------------------------------------------------ */

describe('pipeline context caching', () => {
    it('caches Laplacian when ridge mask and curvature are both enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        const s = { ...DEFAULT_SETTINGS, enableRidgeMask: true, enableCurvature: true };
        applyRidgeMask(hm, W, H, s, ctx);
        const lapAfterRidgeMask = ctx.laplacian;
        expect(lapAfterRidgeMask).not.toBeNull();
        applyCurvature(hm, W, H, s, ctx);
        // Should reuse the same cached Laplacian
        expect(ctx.laplacian).toBe(lapAfterRidgeMask);
    });

    it('caches Sobel gradients when slope channeling and basin deposition are both enabled', () => {
        const hm = generateBaseHeightmap(W, H, DEFAULT_SETTINGS, createNoiseSet(42));
        const ctx = { ridgeMask: null, sobelGradients: null, laplacian: null };
        const s = { ...DEFAULT_SETTINGS, enableSlopeChanneling: true, enableBasinDeposition: true };
        applySlopeChanneling(hm, W, H, s, ctx);
        const gradAfterChanneling = ctx.sobelGradients;
        expect(gradAfterChanneling).not.toBeNull();
        applyBasinDeposition(hm, W, H, s, ctx);
        expect(ctx.sobelGradients).toBe(gradAfterChanneling);
    });
});

/* ------------------------------------------------------------------ */
/* Full pipeline with post-processing                                 */
/* ------------------------------------------------------------------ */

describe('full pipeline with post-processing', () => {
    it('runs with all post-processing enabled', () => {
        const { heightmap, slopeMap } = generateTerrain(W, H, {
            ...DEFAULT_SETTINGS,
            enableRidgeEnhance: true,
            enableRidgeMask: true,
            enableSlopeChanneling: true,
            enableBasinDeposition: true,
            enableFlowBlur: true,
            enableCurvature: true,
        });
        expect(allFinite(heightmap)).toBe(true);
        expect(allFinite(slopeMap)).toBe(true);
    });

    it('is deterministic with post-processing', () => {
        const s = {
            ...DEFAULT_SETTINGS,
            enableRidgeEnhance: true,
            enableRidgeMask: true,
            enableSlopeChanneling: true,
            enableBasinDeposition: true,
            enableFlowBlur: true,
            enableCurvature: true,
        };
        const a = generateTerrain(W, H, s);
        const b = generateTerrain(W, H, s);
        expect(Array.from(a.heightmap)).toEqual(Array.from(b.heightmap));
    });
});
