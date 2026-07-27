/**
 * Natural mountain heightmap generation using FastNoiseLite.
 *
 * Every stage operates on Float64Array elevation data. Only the final
 * renderGrayscale step converts elevation into pixels. Landscape features
 * (edge falloff, asymmetric ranges, thermal shaping, drainage, surface
 * relief) all modify or derive from the same height field — there is no
 * transparency-style compositing onto the heightmap.
 */

import FastNoiseLite from 'fastnoise-lite';

/**
 * Default settings for the full pipeline. UI sliders map onto these keys.
 */
export const DEFAULT_SETTINGS = {
    seed: 1337,
    zoom: 1.0,

    // Layer weights for base elevation composition
    broadWeight: 1.0,
    structureWeight: 0.6,
    ridgeWeight: 0.8,
    detailWeight: 0.25,
    ridgeSharpness: 2.0,
    heightCurve: 1.3, // >1 biases toward lowlands, fewer high summits

    // Edge falloff
    enableEdgeFalloff: true,
    edgeStrength: 1.0,
    edgeInnerRadius: 0.55, // fraction of half-diagonal before lowering starts
    edgeFloor: 0.0, // target normalized height at the boundary (0 = sea level)
    edgeShape: 0.5, // 0 = rectangular mainland, 1 = radial island
    edgeIrregularity: 0.25, // warp amount for the mask boundary

    // Asymmetric folded ranges
    enableAsymmetric: true,
    asymElevMin: 0.45, // normalized elevation band (0..1)
    asymElevMax: 0.8,
    asymFadeLower: 0.12,
    asymFadeUpper: 0.12,
    asymStrength: 0.8,
    asymDirection: 0.785, // radians, scarp-facing direction
    asymCoverage: 0.5, // 0..1, gates the band with low-freq noise

    // Thermal shaping
    enableThermal: true,
    thermalIterations: 8,
    thermalTalus: 0.006, // slope (height/px) above which material moves
    thermalStrength: 0.5,

    // Rivers / drainage
    enableRivers: true,
    riverAreaThreshold: 120, // min upstream cells before a channel appears
    riverSourceElevation: 0.25, // min normalized elevation for gullies
    riverCarveDepth: 0.05, // max carve as fraction of full height range
    riverWidth: 2.0,
    preserveLakes: true,

    // Surface relief
    enableRocks: false,
    rockDensity: 0.35,
    rockElevMin: 0.2,
    rockElevMax: 0.75,
    rockSlopeMin: 0.1,
    rockSlopeMax: 0.6,
    rockMaxRadius: 3,

    enableBoulders: false,
    boulderDensity: 0.15,
    boulderMaxRadius: 8,
    boulderSlopeMin: 0.45,

    // Post-processing: Ridge Noise Enhancement
    enableRidgeEnhance: false,
    ridgeEnhanceStrength: 0.5,
    ridgeEnhanceFrequency: 0.008,
    ridgeEnhanceElevMin: 0.3,

    // Post-processing: Ridge Mask / Crest Sharpening
    enableRidgeMask: false,
    ridgeMaskStrength: 0.5,
    ridgeMaskThreshold: 0.5,
    ridgeMaskErosionResistance: 0.7,
    showRidgeMask: false,

    // Post-processing: Slope-Based Channeling
    enableSlopeChanneling: false,
    slopeChannelStrength: 0.6,
    slopeChannelSteepThresh: 0.45,
    showSlopeChannelMask: false,

    // Post-processing: Basin / Deposition
    enableBasinDeposition: false,
    basinDepositionAmount: 0.4,
    basinDepoSlopeMax: 0.25,
    basinDepoConcaveThresh: 0.2,
    showBasinDepositionMask: false,

    // Post-processing: Flow Map / Directional Blur
    enableFlowBlur: false,
    flowBlurStrength: 0.5,
    flowBlurRadius: 3,
    flowBlurPasses: 2,

    // Post-processing: Curvature Enhancement
    enableCurvature: false,
    curvatureStrength: 0.5,
    curvatureRidgeBoost: 0.5,
    curvatureValleyDeepen: 0.3,

    // Output
    colorMode: 'grayscale',
    fixedRange: false,
    displayZoom: 1.0,
};

// Elevation is tracked in an internal unit space of roughly [0, 1000].
const HEIGHT_SCALE = 1000;

/* ---------------------------------------------------------------------- */
/* Math helpers                                                            */
/* ---------------------------------------------------------------------- */

export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function ridgeTransform(n, sharpness) {
    // n in [-1, 1] -> ridged crest in [0, 1]
    const r = 1 - Math.abs(n);
    return Math.pow(clamp(r, 0, 1), sharpness);
}

/**
 * Apply domain warp to a {x, y} coordinate in place. The fastnoise-lite JS
 * port ships with a typo — the public method is `DomainWrap` rather than
 * `DomainWarp` — so we call whichever exists.
 */
export function domainWarp(noise, coord) {
    if (typeof noise.DomainWarp === 'function') {
        noise.DomainWarp(coord);
    } else if (typeof noise.DomainWrap === 'function') {
        noise.DomainWrap(coord);
    }
    return coord;
}

/* ---------------------------------------------------------------------- */
/* Shared kernel computations (Sobel + Laplacian)                          */
/* ---------------------------------------------------------------------- */

/**
 * Compute per-pixel gradient vectors and magnitude using a 3×3 Sobel operator.
 * Returns { gx, gy, magnitude } as Float64Arrays. Edge pixels are zeroed.
 */
export function computeSobelGradients(heightmap, width, height) {
    const size = width * height;
    const gx = new Float64Array(size);
    const gy = new Float64Array(size);
    const magnitude = new Float64Array(size);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const tl = heightmap[idx - width - 1];
            const tc = heightmap[idx - width];
            const tr = heightmap[idx - width + 1];
            const ml = heightmap[idx - 1];
            const mr = heightmap[idx + 1];
            const bl = heightmap[idx + width - 1];
            const bc = heightmap[idx + width];
            const br = heightmap[idx + width + 1];

            const sx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
            const sy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);

            gx[idx] = sx;
            gy[idx] = sy;
            magnitude[idx] = Math.sqrt(sx * sx + sy * sy);
        }
    }

    return { gx, gy, magnitude };
}

/**
 * Compute discrete curvature via an 8-neighbor Laplacian kernel.
 * Positive = concave (basins/valleys), negative = convex (ridges/peaks).
 * Edge pixels are zeroed.
 */
export function computeLaplacian(heightmap, width, height) {
    const size = width * height;
    const lap = new Float64Array(size);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const center = heightmap[idx];
            const sum = heightmap[idx - width - 1] + heightmap[idx - width] + heightmap[idx - width + 1] +
                heightmap[idx - 1] + heightmap[idx + 1] +
                heightmap[idx + width - 1] + heightmap[idx + width] + heightmap[idx + width + 1];
            lap[idx] = sum - 8 * center;
        }
    }

    return lap;
}

/**
 * Estimate the p-th percentile (0-1) of the positive values in `arr` using a
 * bucketed histogram, avoiding a full O(n log n) sort. Values <= 0 are
 * ignored (useful for one-sided distributions like gradient magnitude or
 * positive Laplacian). Returns a small epsilon if no positive values exist.
 */
export function computePercentile(arr, p, bucketCount = 256) {
    let max = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    if (max <= 0) return 1e-6;

    const buckets = new Uint32Array(bucketCount);
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v <= 0) continue;
        let b = Math.floor((v / max) * (bucketCount - 1));
        if (b < 0) b = 0;
        if (b >= bucketCount) b = bucketCount - 1;
        buckets[b]++;
        total++;
    }
    if (total === 0) return 1e-6;

    const target = p * total;
    let cumulative = 0;
    for (let b = 0; b < bucketCount; b++) {
        cumulative += buckets[b];
        if (cumulative >= target) {
            return ((b + 1) / bucketCount) * max;
        }
    }
    return max;
}

/* ---------------------------------------------------------------------- */
/* Noise factory                                                          */
/* ---------------------------------------------------------------------- */

function makeNoise(config) {
    const n = new FastNoiseLite(config.seed);
    n.SetSeed(config.seed);
    n.SetFrequency(config.frequency);
    n.SetNoiseType(config.noiseType);
    if (config.fractalType) {
        n.SetFractalType(config.fractalType);
        if (config.octaves !== undefined) n.SetFractalOctaves(config.octaves);
        if (config.lacunarity !== undefined) n.SetFractalLacunarity(config.lacunarity);
        if (config.gain !== undefined) n.SetFractalGain(config.gain);
    }
    if (config.cellularDistance) n.SetCellularDistanceFunction(config.cellularDistance);
    if (config.cellularReturn) n.SetCellularReturnType(config.cellularReturn);
    if (config.cellularJitter !== undefined) n.SetCellularJitter(config.cellularJitter);
    if (config.domainWarpType) n.SetDomainWarpType(config.domainWarpType);
    if (config.domainWarpAmp !== undefined) n.SetDomainWarpAmp(config.domainWarpAmp);
    return n;
}

/**
 * Build the set of noise generators used by the pipeline for a given seed.
 */
export function createNoiseSet(seed) {
    const T = FastNoiseLite;
    return {
        // The user-supplied geological structure: warped cellular distance
        structure: makeNoise({
            seed,
            frequency: 0.01,
            noiseType: T.NoiseType.Cellular,
            cellularDistance: T.CellularDistanceFunction.EuclideanSq,
            cellularReturn: T.CellularReturnType.Distance,
            cellularJitter: 1.0,
        }),
        // Domain warp applied to structure sampling coordinates
        warp: makeNoise({
            seed,
            frequency: 0.013,
            noiseType: T.NoiseType.OpenSimplex2,
            domainWarpType: T.DomainWarpType.OpenSimplex2,
            domainWarpAmp: 57.0,
            fractalType: T.FractalType.DomainWarpProgressive,
            octaves: 3,
            lacunarity: 2.0,
            gain: 0.41,
        }),
        // Broad continental elevation
        broad: makeNoise({
            seed: seed + 1,
            frequency: 0.0016,
            noiseType: T.NoiseType.OpenSimplex2,
            fractalType: T.FractalType.FBm,
            octaves: 4,
            lacunarity: 2.0,
            gain: 0.5,
        }),
        // Ridged crests
        ridge: makeNoise({
            seed: seed + 2,
            frequency: 0.006,
            noiseType: T.NoiseType.OpenSimplex2,
            fractalType: T.FractalType.FBm,
            octaves: 4,
            lacunarity: 2.0,
            gain: 0.5,
        }),
        // Fine detail
        detail: makeNoise({
            seed: seed + 3,
            frequency: 0.03,
            noiseType: T.NoiseType.OpenSimplex2,
            fractalType: T.FractalType.FBm,
            octaves: 3,
            lacunarity: 2.0,
            gain: 0.5,
        }),
        // Low-frequency coverage mask for asymmetric ranges
        coverage: makeNoise({
            seed: seed + 4,
            frequency: 0.0025,
            noiseType: T.NoiseType.OpenSimplex2,
        }),
        // Boundary irregularity for edge falloff
        edge: makeNoise({
            seed: seed + 5,
            frequency: 0.004,
            noiseType: T.NoiseType.OpenSimplex2,
        }),
        // Surface relief placement
        relief: makeNoise({
            seed: seed + 6,
            frequency: 0.08,
            noiseType: T.NoiseType.Cellular,
            cellularDistance: T.CellularDistanceFunction.EuclideanSq,
            cellularReturn: T.CellularReturnType.CellValue,
            cellularJitter: 1.0,
        }),
        // Ridge enhancement post-processing
        ridgeEnhance: makeNoise({
            seed: seed + 7,
            frequency: 0.008,
            noiseType: T.NoiseType.Cellular,
            cellularDistance: T.CellularDistanceFunction.EuclideanSq,
            cellularReturn: T.CellularReturnType.Distance,
            cellularJitter: 1.0,
        }),
    };
}

/* ---------------------------------------------------------------------- */
/* Stage 1: base heightmap                                                */
/* ---------------------------------------------------------------------- */

/**
 * Generate the base elevation field by layering warped cellular structure,
 * broad elevation, ridged crests, and fine detail, then remapping.
 */
export function generateBaseHeightmap(width, height, settings = {}, noiseSet) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const ns = noiseSet || createNoiseSet(s.seed);
    const size = width * height;
    const heightmap = new Float64Array(size);
    const zoom = s.zoom || 1.0;

    let min = Infinity;
    let max = -Infinity;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const sx = x / zoom;
            const sy = y / zoom;

            // Domain-warp the structure sampling coordinates.
            // Note: the fastnoise-lite JS port exposes this method as
            // `DomainWrap` (a typo in the library); guard for both.
            const warped = { x: sx, y: sy };
            domainWarp(ns.warp, warped);
            const structure = ns.structure.GetNoise(warped.x, warped.y); // ~[0,1]

            const broad = (ns.broad.GetNoise(sx, sy) + 1) * 0.5; // [0,1]
            const ridge = ridgeTransform(ns.ridge.GetNoise(sx, sy), s.ridgeSharpness);
            const detail = ns.detail.GetNoise(sx, sy); // [-1,1]

            // Broad elevation gates where relief can be strong
            const relief =
                s.structureWeight * structure +
                s.ridgeWeight * ridge +
                s.detailWeight * detail * 0.5;

            let value = s.broadWeight * broad * (0.4 + 0.6 * broad) + relief * (0.3 + 0.7 * broad);

            heightmap[idx] = value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
    }

    // Normalize to [0,1], apply height curve, then scale to unit space
    const range = max - min || 1;
    const curve = s.heightCurve || 1.0;
    for (let i = 0; i < size; i++) {
        let v = (heightmap[i] - min) / range;
        v = Math.pow(v, curve);
        heightmap[i] = v * HEIGHT_SCALE;
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 2: edge falloff (elevation lowering toward the boundary)          */
/* ---------------------------------------------------------------------- */

/**
 * Lower elevation toward the edges of the map. The mask blends a
 * rectangular (mainland) falloff with a radial (island) falloff and warps
 * its boundary with low-frequency noise. Modifies heightmap in place.
 */
export function applyEdgeFalloff(heightmap, width, height, settings = {}, noiseSet) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableEdgeFalloff) return heightmap;
    const ns = noiseSet || createNoiseSet(s.seed);

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const floor = s.edgeFloor * HEIGHT_SCALE;
    const inner = clamp(s.edgeInnerRadius, 0, 0.99);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;

            // Radial distance term (island)
            const dx = (x - cx) / cx;
            const dy = (y - cy) / cy;
            const radial = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;

            // Rectangular distance term (mainland): distance to nearest edge
            const edgeDist = Math.min(x, width - 1 - x, y, height - 1 - y);
            const rect = 1 - edgeDist / Math.min(cx, cy);

            let d = radial * s.edgeShape + rect * (1 - s.edgeShape);

            // Warp the boundary so it is not a perfect circle/frame
            const warpN = ns.edge.GetNoise(x, y); // [-1,1]
            d += warpN * s.edgeIrregularity * 0.3;
            d = clamp(d, 0, 1);

            // Only lower beyond the inner radius, smoothly ramping to edge
            const t = smoothstep(inner, 1.0, d);
            const factor = 1 - t * s.edgeStrength;

            heightmap[idx] = floor + (heightmap[idx] - floor) * clamp(factor, 0, 1);
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 3: asymmetric folded ranges                                      */
/* ---------------------------------------------------------------------- */

/**
 * Steepen one aspect of ranges within a height band and gentle the other,
 * emulating overturned/folded strata. The band uses independent smooth
 * fades and a low-frequency coverage mask so only some ranges fold.
 */
export function applyAsymmetricSlopes(heightmap, width, height, settings = {}, noiseSet) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableAsymmetric || s.asymStrength <= 0) return heightmap;
    const ns = noiseSet || createNoiseSet(s.seed);

    const src = new Float64Array(heightmap);
    const elevMin = s.asymElevMin * HEIGHT_SCALE;
    const elevMax = s.asymElevMax * HEIGHT_SCALE;
    const fadeLo = s.asymFadeLower * HEIGHT_SCALE;
    const fadeHi = s.asymFadeUpper * HEIGHT_SCALE;
    const dirX = Math.cos(s.asymDirection);
    const dirY = Math.sin(s.asymDirection);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const h = src[idx];

            // Biome weight: fade in above elevMin, fade out below elevMax
            const wLow = smoothstep(elevMin - fadeLo, elevMin + fadeLo, h);
            const wHigh = 1 - smoothstep(elevMax - fadeHi, elevMax + fadeHi, h);
            let weight = wLow * wHigh;
            if (weight <= 0) continue;

            // Coverage gate: only some regions fold strongly
            const cov = (ns.coverage.GetNoise(x, y) + 1) * 0.5;
            weight *= smoothstep(1 - s.asymCoverage, 1, cov + (1 - s.asymCoverage));
            if (weight <= 0) continue;

            // Aspect from gradient
            const gx = src[idx + 1] - src[idx - 1];
            const gy = src[idx + width] - src[idx - width];
            const grad = Math.sqrt(gx * gx + gy * gy);
            if (grad < 1e-6) continue;

            // Alignment of downhill direction with scarp direction
            const align = (-gx * dirX - gy * dirY) / grad; // [-1,1]

            // Scarp side (align>0): steepen (raise upper part relative to slope)
            // Dip side (align<0): gentle (lower/smooth)
            const delta = align * grad * 0.5 * s.asymStrength * weight;
            heightmap[idx] = h + delta;
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 4: thermal shaping                                               */
/* ---------------------------------------------------------------------- */

/**
 * Talus/thermal erosion: move material from steep slopes to lower
 * neighbors, softening spikes and forming scree-like lower slopes.
 */
export function applyThermalErosion(heightmap, width, height, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableThermal || s.thermalIterations <= 0) return heightmap;

    const talus = s.thermalTalus * HEIGHT_SCALE;
    const strength = clamp(s.thermalStrength, 0, 1);
    const neighbors = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];

    for (let pass = 0; pass < s.thermalIterations; pass++) {
        const delta = new Float64Array(width * height);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const h = heightmap[idx];

                let totalExcess = 0;
                const diffs = [];
                for (const [ox, oy] of neighbors) {
                    const nIdx = (y + oy) * width + (x + ox);
                    const diff = h - heightmap[nIdx];
                    if (diff > talus) {
                        diffs.push([nIdx, diff]);
                        totalExcess += diff;
                    } else {
                        diffs.push(null);
                    }
                }
                if (totalExcess <= 0) continue;

                // Move a fraction of the maximum excess, distributed by slope
                const move = strength * 0.5 * (totalExcess / diffs.length);
                for (const d of diffs) {
                    if (!d) continue;
                    const [nIdx, diff] = d;
                    const share = (diff / totalExcess) * move;
                    delta[idx] -= share;
                    delta[nIdx] += share;
                }
            }
        }
        for (let i = 0; i < heightmap.length; i++) heightmap[i] += delta[i];
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 5: drainage and rivers                                           */
/* ---------------------------------------------------------------------- */

/**
 * Fill small pits so water has a continuous downhill path. A simple
 * priority-flood-lite: iterative neighbor-max clamping. Large basins may be
 * preserved when preserveLakes is set (they are only partially filled).
 * Returns a filled copy; the original heightmap is not modified.
 */
export function conditionDrainage(heightmap, width, height, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const filled = new Float64Array(heightmap);
    const passes = 6;
    const epsilon = 1e-3;

    for (let pass = 0; pass < passes; pass++) {
        let changed = false;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                // Lowest neighbor
                let minN = Infinity;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        if (ox === 0 && oy === 0) continue;
                        const v = filled[(y + oy) * width + (x + ox)];
                        if (v < minN) minN = v;
                    }
                }
                // If this cell is a pit (below all neighbors), raise to spill
                if (filled[idx] < minN) {
                    const target = minN + epsilon;
                    if (s.preserveLakes) {
                        // Only partially fill deep basins to keep lakes
                        filled[idx] += (target - filled[idx]) * 0.5;
                    } else {
                        filled[idx] = target;
                    }
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }

    return filled;
}

/**
 * Compute D8 flow accumulation over a (drainage-conditioned) heightmap.
 * Returns Float64Array of upstream contributing cell counts.
 */
export function calculateFlow(filled, width, height) {
    const size = width * height;
    const flow = new Float64Array(size).fill(1);
    const receiver = new Int32Array(size).fill(-1);
    const order = new Array(size);

    // Determine steepest-descent receiver for each cell
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            let best = filled[idx];
            let bestIdx = -1;
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (ox === 0 && oy === 0) continue;
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const nIdx = ny * width + nx;
                    const dist = ox !== 0 && oy !== 0 ? Math.SQRT2 : 1;
                    const drop = (filled[idx] - filled[nIdx]) / dist;
                    if (drop > 0 && filled[nIdx] < best) {
                        best = filled[nIdx];
                        bestIdx = nIdx;
                    }
                }
            }
            receiver[idx] = bestIdx;
            order[idx] = idx;
        }
    }

    // Process cells from high to low so accumulation flows downhill
    order.sort((a, b) => filled[b] - filled[a]);
    for (const idx of order) {
        const r = receiver[idx];
        if (r >= 0) flow[r] += flow[idx];
    }

    return flow;
}

/**
 * Carve river channels into the heightmap based on flow accumulation.
 * Depth and width grow with contributing area; channels only appear above
 * a source elevation. Modifies heightmap in place.
 */
export function carveChannels(heightmap, flow, width, height, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableRivers) return heightmap;

    const sourceElev = s.riverSourceElevation * HEIGHT_SCALE;
    const maxCarve = s.riverCarveDepth * HEIGHT_SCALE;
    const areaThresh = s.riverAreaThreshold;
    const maxArea = width * height * 0.25;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (flow[idx] < areaThresh) continue;

            const elev = heightmap[idx];
            // Elevation gate with a soft ramp above the source elevation
            const elevGate = smoothstep(sourceElev, sourceElev + 0.1 * HEIGHT_SCALE, elev);
            if (elevGate <= 0) continue;

            // Channel intensity grows with log of contributing area
            const areaT = clamp(
                (Math.log(flow[idx]) - Math.log(areaThresh)) /
                (Math.log(maxArea) - Math.log(areaThresh)),
                0,
                1,
            );

            const depth = maxCarve * areaT;
            const width2 = s.riverWidth * (0.4 + 0.6 * areaT);
            const rad = Math.max(0, Math.round(width2));

            // Carve a smooth cross-section
            for (let oy = -rad; oy <= rad; oy++) {
                for (let ox = -rad; ox <= rad; ox++) {
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const dist = Math.sqrt(ox * ox + oy * oy);
                    if (dist > width2) continue;
                    const profile = 1 - dist / (width2 + 0.001);
                    const carve = depth * profile * profile;
                    const nIdx = ny * width + nx;
                    heightmap[nIdx] -= carve;
                }
            }
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 6: slope / aspect / curvature                                    */
/* ---------------------------------------------------------------------- */

/**
 * Slope as normalized gradient magnitude in [0, 1].
 */
export function calculateSlopes(heightmap, width, height) {
    const size = width * height;
    const slope = new Float64Array(size);
    let maxG = 1e-6;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const gx = heightmap[idx + 1] - heightmap[idx - 1];
            const gy = heightmap[idx + width] - heightmap[idx - width];
            const g = Math.sqrt(gx * gx + gy * gy);
            slope[idx] = g;
            if (g > maxG) maxG = g;
        }
    }
    for (let i = 0; i < size; i++) slope[i] /= maxG;
    return slope;
}

/* ---------------------------------------------------------------------- */
/* Stage 7: surface relief (rocks + boulders)                             */
/* ---------------------------------------------------------------------- */

/**
 * Add small rock mounds and larger boulder mounds as genuine elevation.
 * Placement is masked by elevation, slope and a sparse cellular field so
 * features are not uniformly scattered. Modifies heightmap in place.
 */
export function addSurfaceRelief(heightmap, slopeMap, width, height, settings = {}, noiseSet) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableRocks && !s.enableBoulders) return heightmap;
    const ns = noiseSet || createNoiseSet(s.seed);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const elevN = heightmap[idx] / HEIGHT_SCALE;
            const slope = slopeMap[idx];
            const cell = (ns.relief.GetNoise(x, y) + 1) * 0.5; // [0,1]

            // Boulders: larger, favor steeper areas
            if (
                s.enableBoulders &&
                cell > 1 - s.boulderDensity &&
                slope > s.boulderSlopeMin
            ) {
                const r = Math.max(1, Math.round(s.boulderMaxRadius * (0.5 + 0.5 * cell)));
                const mag = HEIGHT_SCALE * 0.02 * (0.5 + 0.5 * cell);
                stampMound(heightmap, width, height, x, y, r, mag);
                continue;
            }

            // Rocks: small, within elevation + slope range
            if (
                s.enableRocks &&
                cell > 1 - s.rockDensity &&
                elevN >= s.rockElevMin &&
                elevN <= s.rockElevMax &&
                slope >= s.rockSlopeMin &&
                slope <= s.rockSlopeMax
            ) {
                const r = Math.max(1, Math.round(s.rockMaxRadius * (0.4 + 0.6 * cell)));
                const mag = HEIGHT_SCALE * 0.006 * (0.4 + 0.6 * cell);
                stampMound(heightmap, width, height, x, y, r, mag);
            }
        }
    }

    return heightmap;
}

function stampMound(heightmap, width, height, cx, cy, radius, magnitude) {
    for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const dist = Math.sqrt(ox * ox + oy * oy);
            if (dist > radius) continue;
            const profile = Math.cos((dist / (radius + 0.001)) * (Math.PI / 2));
            heightmap[ny * width + nx] += magnitude * profile;
        }
    }
}

/* ---------------------------------------------------------------------- */
/* Stage 9: Ridge Noise Enhancement                                        */
/* ---------------------------------------------------------------------- */

/**
 * Blend inverted cellular (Voronoi) noise into the heightmap to create
 * natural ridge lines. Only affects mid-to-high elevations.
 */
export function applyRidgeEnhancement(heightmap, width, height, settings = {}, noiseSet, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableRidgeEnhance || s.ridgeEnhanceStrength <= 0) return heightmap;
    const ns = noiseSet || createNoiseSet(s.seed);
    const ridgeNoise = ns.ridgeEnhance;
    ridgeNoise.SetFrequency(s.ridgeEnhanceFrequency);

    const elevMin = s.ridgeEnhanceElevMin * HEIGHT_SCALE;
    const strength = s.ridgeEnhanceStrength * HEIGHT_SCALE * 0.15;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const h = heightmap[idx];
            if (h < elevMin) continue;

            // Cellular distance ~[0,1]; invert for ridge crests at cell boundaries
            const cellDist = ridgeNoise.GetNoise(x, y);
            const ridge = 1 - clamp(cellDist, 0, 1);

            // Height-band gate: smooth fade in above elevMin
            const gate = smoothstep(elevMin, elevMin + 0.15 * HEIGHT_SCALE, h);
            heightmap[idx] = h + ridge * strength * gate;
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 10: Ridge Mask / Crest Sharpening                                 */
/* ---------------------------------------------------------------------- */

/**
 * Sharpen ridge crests using positive curvature (convex Laplacian) and
 * produce an erosion-resistance mask for downstream stages. The mask is
 * stored in pipelineCtx.ridgeMask.
 */
export function applyRidgeMask(heightmap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableRidgeMask) {
        if (pipelineCtx) pipelineCtx.ridgeMask = null;
        return heightmap;
    }

    const ctx = pipelineCtx || {};
    let lap = ctx.laplacian;
    if (!lap) {
        lap = computeLaplacian(heightmap, width, height);
        ctx.laplacian = lap;
    }

    const size = width * height;
    const mask = new Float64Array(size);
    const threshold = s.ridgeMaskThreshold;
    const strength = s.ridgeMaskStrength * HEIGHT_SCALE * 0.1;

    // Find max negative Laplacian for normalization
    let maxNeg = 1e-6;
    for (let i = 0; i < size; i++) {
        if (lap[i] < 0 && -lap[i] > maxNeg) maxNeg = -lap[i];
    }

    for (let i = 0; i < size; i++) {
        // Negative Laplacian = convex = ridge crest
        const convex = clamp(-lap[i] / maxNeg, 0, 1);
        if (convex < threshold) {
            mask[i] = 0;
            continue;
        }
        const ridgeWeight = smoothstep(threshold, 1.0, convex);
        mask[i] = ridgeWeight;
        // Sharpen crests
        heightmap[i] += strength * ridgeWeight;
    }

    if (pipelineCtx) pipelineCtx.ridgeMask = mask;
    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 11: Slope-Based Channeling                                        */
/* ---------------------------------------------------------------------- */

/**
 * Carve channels on steep slopes using Sobel gradient magnitude. Respects
 * the ridge mask (if available) to avoid carving through erosion-resistant
 * ridges.
 */
export function applySlopeChanneling(heightmap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const ctx = pipelineCtx || {};
    if (!s.enableSlopeChanneling || s.slopeChannelStrength <= 0) {
        if (pipelineCtx) {
            pipelineCtx.slopeChannelMask = null;
            pipelineCtx.stats = pipelineCtx.stats || {};
            pipelineCtx.stats.slopeChanneling = { pctAffected: 0, avgDelta: 0 };
        }
        return heightmap;
    }

    let grad = ctx.sobelGradients;
    if (!grad) {
        grad = computeSobelGradients(heightmap, width, height);
        ctx.sobelGradients = grad;
    }

    const size = width * height;
    const steepThresh = s.slopeChannelSteepThresh;
    const strength = s.slopeChannelStrength * HEIGHT_SCALE * 0.1;
    const ridgeMask = ctx.ridgeMask;
    const mask = new Float64Array(size);

    // Normalize magnitude against the 95th percentile (robust to outlier
    // spikes) instead of the single global max, so threshold sliders behave
    // predictably relative to "typical" steep terrain.
    const p95Mag = computePercentile(grad.magnitude, 0.95);

    let affectedCount = 0;
    let totalDelta = 0;

    for (let i = 0; i < size; i++) {
        const slopeN = clamp(grad.magnitude[i] / p95Mag, 0, 1);
        if (slopeN < steepThresh) continue;

        const channelWeight = smoothstep(steepThresh, 1.0, slopeN);
        // Reduce channeling where ridge mask protects
        const protection = ridgeMask ? ridgeMask[i] * s.ridgeMaskErosionResistance : 0;
        const effective = channelWeight * (1 - protection);
        const delta = strength * effective;
        heightmap[i] -= delta;
        mask[i] = effective;

        if (effective > 0.01) {
            affectedCount++;
            totalDelta += delta;
        }
    }

    if (pipelineCtx) {
        pipelineCtx.slopeChannelMask = mask;
        pipelineCtx.stats = pipelineCtx.stats || {};
        pipelineCtx.stats.slopeChanneling = {
            pctAffected: (affectedCount / size) * 100,
            avgDelta: affectedCount > 0 ? totalDelta / affectedCount : 0,
        };
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 12: Basin / Deposition                                            */
/* ---------------------------------------------------------------------- */

/**
 * Identify basins (concave + low slope) and pool sediment there. Combines
 * Laplacian concavity with Sobel slope magnitude.
 */
export function applyBasinDeposition(heightmap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const ctx = pipelineCtx || {};
    if (!s.enableBasinDeposition || s.basinDepositionAmount <= 0) {
        if (pipelineCtx) {
            pipelineCtx.basinDepositionMask = null;
            pipelineCtx.stats = pipelineCtx.stats || {};
            pipelineCtx.stats.basinDeposition = { pctAffected: 0, avgDelta: 0 };
        }
        return heightmap;
    }

    let lap = ctx.laplacian;
    if (!lap) {
        lap = computeLaplacian(heightmap, width, height);
        ctx.laplacian = lap;
    }
    let grad = ctx.sobelGradients;
    if (!grad) {
        grad = computeSobelGradients(heightmap, width, height);
        ctx.sobelGradients = grad;
    }

    const size = width * height;
    const slopeMax = s.basinDepoSlopeMax;
    const concaveThresh = s.basinDepoConcaveThresh;
    const amount = s.basinDepositionAmount * HEIGHT_SCALE * 0.1;
    const mask = new Float64Array(size);

    // Normalize both concavity and slope magnitude against their 95th
    // percentiles (robust to outlier spikes) instead of the single global
    // max/min, so threshold sliders behave predictably.
    const p95Pos = computePercentile(lap, 0.95);
    const p95Mag = computePercentile(grad.magnitude, 0.95);

    let affectedCount = 0;
    let totalDelta = 0;

    for (let i = 0; i < size; i++) {
        const concaveN = clamp(lap[i] / p95Pos, 0, 1);
        const slopeN = clamp(grad.magnitude[i] / p95Mag, 0, 1);
        if (concaveN < concaveThresh || slopeN > slopeMax) continue;

        const basinWeight = smoothstep(concaveThresh, 1.0, concaveN) * (1 - smoothstep(0, slopeMax, slopeN));
        const delta = amount * basinWeight;
        heightmap[i] += delta;
        mask[i] = basinWeight;

        if (basinWeight > 0.01) {
            affectedCount++;
            totalDelta += delta;
        }
    }

    if (pipelineCtx) {
        pipelineCtx.basinDepositionMask = mask;
        pipelineCtx.stats = pipelineCtx.stats || {};
        pipelineCtx.stats.basinDeposition = {
            pctAffected: (affectedCount / size) * 100,
            avgDelta: affectedCount > 0 ? totalDelta / affectedCount : 0,
        };
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 13: Flow Map / Directional Blur                                   */
/* ---------------------------------------------------------------------- */

/**
 * Anisotropic smoothing along downhill flow directions using Sobel gradient
 * vectors. Multi-pass. Respects ridge mask to avoid blurring sharp ridges.
 */
export function applyFlowBlur(heightmap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableFlowBlur || s.flowBlurStrength <= 0) return heightmap;

    const ctx = pipelineCtx || {};
    const radius = Math.max(1, Math.round(s.flowBlurRadius));
    const passes = Math.max(1, Math.round(s.flowBlurPasses));
    const strength = clamp(s.flowBlurStrength, 0, 1);
    const ridgeMask = ctx.ridgeMask;

    for (let pass = 0; pass < passes; pass++) {
        const grad = computeSobelGradients(heightmap, width, height);
        const src = new Float64Array(heightmap);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const gx = grad.gx[idx];
                const gy = grad.gy[idx];
                const mag = Math.sqrt(gx * gx + gy * gy);
                if (mag < 1e-6) continue;

                // Downhill direction (negative gradient)
                const dx = -gx / mag;
                const dy = -gy / mag;

                // Sample along flow direction
                let sum = 0;
                let count = 0;
                for (let r = 1; r <= radius; r++) {
                    const sx = Math.round(x + dx * r);
                    const sy = Math.round(y + dy * r);
                    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
                    sum += src[sy * width + sx];
                    count++;
                }
                if (count === 0) continue;

                const avg = sum / count;
                // Reduce blur where ridge mask protects
                const protection = ridgeMask ? ridgeMask[idx] * s.ridgeMaskErosionResistance : 0;
                const blend = strength * (1 - protection);
                heightmap[idx] = src[idx] * (1 - blend) + avg * blend;
            }
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 14: Curvature Enhancement                                         */
/* ---------------------------------------------------------------------- */

/**
 * Enhance ridge lines and valley edges using Laplacian curvature. Amplify
 * convex areas (raise ridges) and deepen concave areas (deepen valleys).
 */
export function applyCurvature(heightmap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (!s.enableCurvature || s.curvatureStrength <= 0) return heightmap;

    const ctx = pipelineCtx || {};
    let lap = ctx.laplacian;
    if (!lap) {
        lap = computeLaplacian(heightmap, width, height);
        ctx.laplacian = lap;
    }

    const size = width * height;
    const strength = s.curvatureStrength * HEIGHT_SCALE * 0.05;
    const ridgeBoost = s.curvatureRidgeBoost;
    const valleyDeepen = s.curvatureValleyDeepen;

    // Normalize Laplacian
    let maxAbs = 1e-6;
    for (let i = 0; i < size; i++) {
        if (Math.abs(lap[i]) > maxAbs) maxAbs = Math.abs(lap[i]);
    }

    for (let i = 0; i < size; i++) {
        const curvature = lap[i] / maxAbs; // [-1, 1]
        if (curvature < 0) {
            // Convex = ridge: raise
            heightmap[i] += strength * ridgeBoost * (-curvature);
        } else {
            // Concave = valley: deepen
            heightmap[i] -= strength * valleyDeepen * curvature;
        }
    }

    return heightmap;
}

/* ---------------------------------------------------------------------- */
/* Stage 15: output rendering                                              */
/* ---------------------------------------------------------------------- */

/**
 * Convert the elevation field to a packed ABGR Uint32Array. White = high,
 * black = low. When settings.fixedRange is set, [0, HEIGHT_SCALE] is used
 * so subtle slider changes are not renormalized away.
 */
export function renderGrayscale(heightmap, width, height, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const size = width * height;
    const pixels = new Uint32Array(size);

    let min = 0;
    let max = HEIGHT_SCALE;
    if (!s.fixedRange) {
        min = Infinity;
        max = -Infinity;
        for (let i = 0; i < size; i++) {
            if (heightmap[i] < min) min = heightmap[i];
            if (heightmap[i] > max) max = heightmap[i];
        }
    }
    const range = max - min || 1;

    for (let i = 0; i < size; i++) {
        const v = clamp(Math.round(((heightmap[i] - min) / range) * 255), 0, 255);
        pixels[i] = (255 << 24) | (v << 16) | (v << 8) | v;
    }
    return pixels;
}

/* ---------------------------------------------------------------------- */
/* Color gradient renderers                                                */
/* ---------------------------------------------------------------------- */

function packABGR(r, g, b) {
    return (255 << 24) | (clamp(Math.round(b), 0, 255) << 16) |
        (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(r), 0, 255);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
    return {
        r: lerp(c1.r, c2.r, t),
        g: lerp(c1.g, c2.g, t),
        b: lerp(c1.b, c2.b, t),
    };
}

function getElevationRange(heightmap, size, settings) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    let min = 0;
    let max = HEIGHT_SCALE;
    if (!s.fixedRange) {
        min = Infinity;
        max = -Infinity;
        for (let i = 0; i < size; i++) {
            if (heightmap[i] < min) min = heightmap[i];
            if (heightmap[i] > max) max = heightmap[i];
        }
    }
    return { min, max, range: max - min || 1 };
}

/**
 * Hypsometric terrain ramp: deep blue → blue → green → yellow-green → brown → white.
 */
export function renderTerrainRamp(heightmap, width, height, settings = {}) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    const { min, range } = getElevationRange(heightmap, size, settings);

    const stops = [
        { t: 0.00, c: { r: 10, g: 20, b: 60 } },
        { t: 0.15, c: { r: 30, g: 60, b: 120 } },
        { t: 0.30, c: { r: 40, g: 100, b: 70 } },
        { t: 0.45, c: { r: 80, g: 130, b: 60 } },
        { t: 0.60, c: { r: 140, g: 120, b: 70 } },
        { t: 0.75, c: { r: 160, g: 140, b: 100 } },
        { t: 0.90, c: { r: 220, g: 220, b: 220 } },
        { t: 1.00, c: { r: 255, g: 255, b: 255 } },
    ];

    for (let i = 0; i < size; i++) {
        const t = clamp((heightmap[i] - min) / range, 0, 1);
        let color = stops[0].c;
        for (let j = 0; j < stops.length - 1; j++) {
            if (t >= stops[j].t && t <= stops[j + 1].t) {
                const localT = (t - stops[j].t) / (stops[j + 1].t - stops[j].t || 1);
                color = lerpColor(stops[j].c, stops[j + 1].c, localT);
                break;
            }
        }
        pixels[i] = packABGR(color.r, color.g, color.b);
    }
    return pixels;
}

/**
 * Slope-aware coloring: elevation + slope determine biome-like colors.
 */
export function renderSlopeAware(heightmap, slopeMap, width, height, settings = {}) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    const { min, range } = getElevationRange(heightmap, size, settings);

    for (let i = 0; i < size; i++) {
        const elev = clamp((heightmap[i] - min) / range, 0, 1);
        const slope = slopeMap ? slopeMap[i] : 0;

        let r, g, b;
        if (elev < 0.12) {
            // Water / valley
            const t = elev / 0.12;
            r = lerp(10, 30, t);
            g = lerp(30, 80, t);
            b = lerp(80, 140, t);
        } else if (elev < 0.5) {
            // Lowland / forest
            const t = (elev - 0.12) / 0.38;
            if (slope > 0.4) {
                // Steep = rocky
                r = lerp(100, 140, t);
                g = lerp(90, 120, t);
                b = lerp(70, 90, t);
            } else {
                // Flat = green
                r = lerp(40, 80, t);
                g = lerp(100, 130, t);
                b = lerp(50, 60, t);
            }
        } else if (elev < 0.8) {
            // Highland / rock
            const t = (elev - 0.5) / 0.3;
            r = lerp(140, 180, t);
            g = lerp(120, 160, t);
            b = lerp(90, 150, t);
        } else {
            // Peaks / snow
            const t = (elev - 0.8) / 0.2;
            r = lerp(200, 255, t);
            g = lerp(200, 255, t);
            b = lerp(210, 255, t);
        }

        pixels[i] = packABGR(r, g, b);
    }
    return pixels;
}

/**
 * Geogen-style contour bands with sharp color transitions at elevation thresholds.
 */
export function renderGeogenStyle(heightmap, width, height, settings = {}) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    const { min, range } = getElevationRange(heightmap, size, settings);

    const bands = [
        { t: 0.00, c: { r: 20, g: 40, b: 30 } },
        { t: 0.15, c: { r: 30, g: 80, b: 40 } },
        { t: 0.30, c: { r: 60, g: 120, b: 40 } },
        { t: 0.45, c: { r: 180, g: 180, b: 40 } },
        { t: 0.60, c: { r: 200, g: 120, b: 40 } },
        { t: 0.75, c: { r: 180, g: 60, b: 40 } },
        { t: 0.88, c: { r: 120, g: 40, b: 40 } },
        { t: 1.00, c: { r: 255, g: 255, b: 255 } },
    ];
    const blendWidth = 0.03;

    for (let i = 0; i < size; i++) {
        const t = clamp((heightmap[i] - min) / range, 0, 1);
        let color = bands[0].c;
        for (let j = 0; j < bands.length - 1; j++) {
            if (t >= bands[j].t && t <= bands[j + 1].t) {
                const bandStart = bands[j].t;
                const bandEnd = bands[j + 1].t;
                // Sharp transition with small blend zone at boundaries
                const blendStart = bandEnd - blendWidth;
                if (t < blendStart) {
                    color = bands[j].c;
                } else {
                    const localT = clamp((t - blendStart) / blendWidth, 0, 1);
                    color = lerpColor(bands[j].c, bands[j + 1].c, localT);
                }
                break;
            }
        }
        pixels[i] = packABGR(color.r, color.g, color.b);
    }
    return pixels;
}

/**
 * Dolomites natural palette: earthy greens, browns, and teal derived from
 * real landscape colour samples in OKLch space (converted back to sRGB).
 */
export function renderDolomitesNatural(heightmap, width, height, settings = {}) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    const { min, range } = getElevationRange(heightmap, size, settings);

    const stops = [
        { t: 0.00, c: { r: 82, g: 79, b: 57 } },
        { t: 0.077, c: { r: 113, g: 115, b: 87 } },
        { t: 0.154, c: { r: 83, g: 95, b: 85 } },
        { t: 0.231, c: { r: 151, g: 139, b: 96 } },
        { t: 0.308, c: { r: 134, g: 130, b: 88 } },
        { t: 0.385, c: { r: 35, g: 45, b: 38 } },
        { t: 0.462, c: { r: 142, g: 134, b: 92 } },
        { t: 0.538, c: { r: 165, g: 147, b: 104 } },
        { t: 0.615, c: { r: 132, g: 143, b: 108 } },
        { t: 0.692, c: { r: 134, g: 130, b: 88 } },
        { t: 0.769, c: { r: 113, g: 115, b: 87 } },
        { t: 0.846, c: { r: 108, g: 112, b: 87 } },
        { t: 0.923, c: { r: 151, g: 139, b: 96 } },
        { t: 1.00, c: { r: 125, g: 189, b: 181 } },
    ];

    for (let i = 0; i < size; i++) {
        const t = clamp((heightmap[i] - min) / range, 0, 1);
        let color = stops[0].c;
        for (let j = 0; j < stops.length - 1; j++) {
            if (t >= stops[j].t && t <= stops[j + 1].t) {
                const localT = (t - stops[j].t) / (stops[j + 1].t - stops[j].t || 1);
                color = lerpColor(stops[j].c, stops[j + 1].c, localT);
                break;
            }
        }
        pixels[i] = packABGR(color.r, color.g, color.b);
    }
    return pixels;
}

/**
 * Extended Dolomites palette: 18-stop gradient with richer earthy tones
 * and a bright teal-to-white highlight at high elevations.
 */
export function renderDolomitesExtended(heightmap, width, height, settings = {}) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    const { min, range } = getElevationRange(heightmap, size, settings);

    const stops = [
        { t: 0.00, c: { r: 82, g: 79, b: 57 } },
        { t: 0.03, c: { r: 84, g: 78, b: 62 } },
        { t: 0.07, c: { r: 113, g: 115, b: 87 } },
        { t: 0.14, c: { r: 83, g: 95, b: 85 } },
        { t: 0.20, c: { r: 151, g: 139, b: 96 } },
        { t: 0.26, c: { r: 132, g: 119, b: 69 } },
        { t: 0.32, c: { r: 142, g: 134, b: 92 } },
        { t: 0.39, c: { r: 134, g: 130, b: 88 } },
        { t: 0.44, c: { r: 156, g: 134, b: 90 } },
        { t: 0.51, c: { r: 165, g: 147, b: 104 } },
        { t: 0.57, c: { r: 147, g: 119, b: 93 } },
        { t: 0.60, c: { r: 113, g: 115, b: 87 } },
        { t: 0.64, c: { r: 132, g: 143, b: 108 } },
        { t: 0.72, c: { r: 134, g: 130, b: 88 } },
        { t: 0.82, c: { r: 108, g: 112, b: 87 } },
        { t: 0.89, c: { r: 151, g: 139, b: 96 } },
        { t: 0.94, c: { r: 125, g: 189, b: 181 } },
        { t: 1.00, c: { r: 200, g: 248, b: 243 } },
    ];

    for (let i = 0; i < size; i++) {
        const t = clamp((heightmap[i] - min) / range, 0, 1);
        let color = stops[0].c;
        for (let j = 0; j < stops.length - 1; j++) {
            if (t >= stops[j].t && t <= stops[j + 1].t) {
                const localT = (t - stops[j].t) / (stops[j + 1].t - stops[j].t || 1);
                color = lerpColor(stops[j].c, stops[j + 1].c, localT);
                break;
            }
        }
        pixels[i] = packABGR(color.r, color.g, color.b);
    }
    return pixels;
}

/**
 * Shared mask-overlay renderer: tints pixels by mask intensity [0-1] using
 * the given RGB channel weights (0-255 max per channel). Used to visualize
 * which pixels a post-processing stage is affecting and by how much.
 */
function renderMaskOverlay(mask, width, height, rMax, gMax, bMax) {
    const size = width * height;
    const pixels = new Uint32Array(size);
    if (!mask) {
        pixels.fill(0xff000000);
        return pixels;
    }
    for (let i = 0; i < size; i++) {
        const m = clamp(mask[i], 0, 1);
        const r = Math.round(rMax * m);
        const g = Math.round(gMax * m);
        const b = Math.round(bMax * m);
        pixels[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return pixels;
}

/**
 * Ridge Mask overlay: red glow = erosion-protected ridge crests.
 */
export function renderRidgeMaskOverlay(heightmap, pipelineCtx, width, height, settings = {}) {
    return renderMaskOverlay(pipelineCtx?.ridgeMask, width, height, 255, 60, 40);
}

/**
 * Slope Channeling overlay: cyan glow = carved/channeled steep areas.
 */
export function renderSlopeChannelOverlay(heightmap, pipelineCtx, width, height, settings = {}) {
    return renderMaskOverlay(pipelineCtx?.slopeChannelMask, width, height, 30, 200, 255);
}

/**
 * Basin Deposition overlay: amber/gold glow = deposited sediment areas.
 */
export function renderBasinDepositionOverlay(heightmap, pipelineCtx, width, height, settings = {}) {
    return renderMaskOverlay(pipelineCtx?.basinDepositionMask, width, height, 255, 190, 40);
}

/**
 * Generalized terrain renderer that dispatches to the selected color mode.
 */
export function renderTerrain(heightmap, slopeMap, width, height, settings = {}, pipelineCtx) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (s.showRidgeMask && pipelineCtx?.ridgeMask) {
        return renderRidgeMaskOverlay(heightmap, pipelineCtx, width, height, s);
    }
    if (s.showSlopeChannelMask && pipelineCtx?.slopeChannelMask) {
        return renderSlopeChannelOverlay(heightmap, pipelineCtx, width, height, s);
    }
    if (s.showBasinDepositionMask && pipelineCtx?.basinDepositionMask) {
        return renderBasinDepositionOverlay(heightmap, pipelineCtx, width, height, s);
    }
    switch (s.colorMode) {
        case 'terrainRamp':
            return renderTerrainRamp(heightmap, width, height, s);
        case 'slopeAware':
            return renderSlopeAware(heightmap, slopeMap, width, height, s);
        case 'geogenStyle':
            return renderGeogenStyle(heightmap, width, height, s);
        case 'dolomitesNatural':
            return renderDolomitesNatural(heightmap, width, height, s);
        case 'dolomitesExtended':
            return renderDolomitesExtended(heightmap, width, height, s);
        case 'grayscale':
        default:
            return renderGrayscale(heightmap, width, height, s);
    }
}

/* ---------------------------------------------------------------------- */
/* Full pipeline                                                          */
/* ---------------------------------------------------------------------- */

/**
 * Run the full generation pipeline and return { heightmap, slopeMap }.
 */
export function generateTerrain(width, height, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const ns = createNoiseSet(s.seed);

    const heightmap = generateBaseHeightmap(width, height, s, ns);
    applyEdgeFalloff(heightmap, width, height, s, ns);
    applyAsymmetricSlopes(heightmap, width, height, s, ns);
    applyThermalErosion(heightmap, width, height, s);

    if (s.enableRivers) {
        const filled = conditionDrainage(heightmap, width, height, s);
        const flow = calculateFlow(filled, width, height);
        carveChannels(heightmap, flow, width, height, s);
    }

    const slopeMap = calculateSlopes(heightmap, width, height);
    addSurfaceRelief(heightmap, slopeMap, width, height, s, ns);

    // Post-processing stages with shared pipeline context
    const pipelineCtx = {
        ridgeMask: null,
        sobelGradients: null,
        laplacian: null,
        slopeChannelMask: null,
        basinDepositionMask: null,
        stats: {},
    };
    applyRidgeEnhancement(heightmap, width, height, s, ns, pipelineCtx);
    applyRidgeMask(heightmap, width, height, s, pipelineCtx);
    applySlopeChanneling(heightmap, width, height, s, pipelineCtx);
    applyBasinDeposition(heightmap, width, height, s, pipelineCtx);
    applyFlowBlur(heightmap, width, height, s, pipelineCtx);
    applyCurvature(heightmap, width, height, s, pipelineCtx);

    return { heightmap, slopeMap, pipelineCtx };
}

export { HEIGHT_SCALE };
