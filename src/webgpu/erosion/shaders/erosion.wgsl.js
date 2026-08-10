// WGSL compute shader: eroded mountains via stacked faded gullies (Phacelle Noise).
//
// Port of Rune Skovbo Johansen's "Advanced Terrain Erosion Filter" technique:
//   https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html
// Reference GLSL kept in docs/shadercode-*.txt.
//
// Critical details that make this look like mountains rather than swirls:
//  - Phacelle Noise blends cos/sin phasors across a 4x4 cell neighbourhood with
//    bell-shaped weights. A single cell (no blending) produces chaotic gullies.
//  - Gully directions come from an *assumed* slope magnitude, not the raw terrain
//    gradient. Using the raw gradient produces gullies unaligned with the slopes.
//  - Derivatives are chain-rule correct: sideDir carries the freq*TAU factor, and
//    phacelle.zw is multiplied by -freq because p was pre-multiplied by freq.

import { N, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT } from "../constants.js";

export const EROSION_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const TAU : f32 = 6.28318530717959;

// Stage toggle flags
const STAGE_BASE_HEIGHT : u32 = 1u;
const STAGE_CELL_STRIPES : u32 = 2u;
const STAGE_MULTI_OCTAVE : u32 = 4u;
const STAGE_FADE_TARGET : u32 = 8u;
const STAGE_ADVANCED_NOISE : u32 = 16u;
const STAGE_SECONDARY_FEATURES : u32 = 32u;

struct ErosionParams {
    // Stage 1: base height function
    heightFrequency: f32,
    heightAmp: f32,
    heightOctaves: f32,
    heightLacunarity: f32,
    heightGain: f32,

    // Stage 2: Phacelle cell settings
    cellScale: f32,
    normalization: f32,

    // Stage 3: erosion octaves
    erosionOctaves: f32,
    lacunarity: f32,
    gain: f32,

    // Stage 4: strength / fade masking
    erosionStrength: f32,
    gullyWeight: f32,
    detail: f32,

    // Stage 5: onset + assumed slope
    onsetInitial: f32,
    onsetOctave: f32,
    onsetRidgeInitial: f32,
    onsetRidgeOctave: f32,
    assumedSlope: f32,
    assumedSlopeAmount: f32,

    // Stage 6: rounding
    ridgeRounding: f32,
    creaseRounding: f32,
    roundingInputMult: f32,
    roundingOctaveMult: f32,

    // Global
    erosionScale: f32,
    heightOffset: f32,
    heightOffsetFadeAmount: f32,
    seed: f32,

    passFlags: u32,
    renderMode: u32,

    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: ErosionParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> ridgeMaps: array<f32>;

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

fn clamp01(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn hash22(x: vec2f) -> vec2f {
    let k = vec2f(0.3183099, 0.3678794);
    let p = x * k + k.yx;
    return -1.0 + 2.0 * fract(16.0 * k * fract(p.x * p.y * (p.x + p.y)));
}

// Gradient noise returning value in x and analytical derivatives in yz.
fn noised(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = fract(p);

    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    let ga = hash22(i + vec2f(0.0, 0.0));
    let gb = hash22(i + vec2f(1.0, 0.0));
    let gc = hash22(i + vec2f(0.0, 1.0));
    let gd = hash22(i + vec2f(1.0, 1.0));

    let va = dot(ga, f - vec2f(0.0, 0.0));
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));

    let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
    let deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);

    return vec3f(value, deriv.x, deriv.y);
}

fn pow_inv(t: f32, power: f32) -> f32 {
    return 1.0 - pow(1.0 - clamp01(t), power);
}

fn ease_out(t: f32) -> f32 {
    // Inverted quadratic: finite derivative at t = 0, unlike sqrt.
    let v = 1.0 - clamp01(t);
    return 1.0 - v * v;
}

fn smooth_start(t: f32, smoothing: f32) -> f32 {
    if (smoothing <= 1e-10) {
        return t;
    }
    if (t >= smoothing) {
        return t - 0.5 * smoothing;
    }
    return 0.5 * t * t / smoothing;
}

fn safe_normalize(n: vec2f) -> vec2f {
    let l = length(n);
    if (abs(l) > 1e-10) {
        return n / l;
    }
    return n;
}

// -----------------------------------------------------------------------------
// Phacelle Noise — stripe pattern aligned with the input direction.
// Returns normalized (cos, sin) in xy and the side direction vector in zw.
// The side direction, multiplied onto the sine, gives the cosine's derivatives.
// -----------------------------------------------------------------------------

fn phacelleNoise(p: vec2f, normDir: vec2f, freq: f32, offsetCycles: f32, normalization: f32, blendCells: bool) -> vec4f {
    // Orthogonal to the stripe direction, scaled by the stripe frequency.
    let sideDir = normDir.yx * vec2f(-1.0, 1.0) * freq * TAU;
    let offset = offsetCycles * TAU;

    let pInt = floor(p);
    let pFrac = fract(p);

    var phaseDir = vec2f(0.0, 0.0);
    var weightSum = 0.0;

    // 4x4 cell neighbourhood. Blending cos/sin waves from unaligned cells yields
    // another wave with a modulated amplitude, so cell borders stay seamless.
    var iLo = -1;
    var iHi = 2;
    if (!blendCells) {
        // Single cell — demonstrates the chaotic/seamed result without blending.
        iLo = 0;
        iHi = 0;
    }

    for (var i: i32 = iLo; i <= iHi; i = i + 1) {
        for (var j: i32 = iLo; j <= iHi; j = j + 1) {
            let gridOffset = vec2f(f32(i), f32(j));
            let gridPoint = pInt + gridOffset;

            // Random cell pivot offset in [-0.5, 0.5].
            let randomOffset = hash22(gridPoint) * 0.5;

            // p relative to this cell's pivot point.
            let vectorFromCellPoint = pFrac - gridOffset - randomOffset;

            // Bell-shaped weight: 1 at distance 0, 0 at distance 1.5.
            let sqrDist = dot(vectorFromCellPoint, vectorFromCellPoint);
            var weight = exp(-sqrDist * 2.0);
            weight = max(0.0, weight - 0.01111);

            weightSum = weightSum + weight;

            // Gradient increasing along sideDir; rate of change is freq * TAU.
            let waveInput = dot(vectorFromCellPoint, sideDir) + offset;

            phaseDir = phaseDir + vec2f(cos(waveInput), sin(waveInput)) * weight;
        }
    }

    if (weightSum <= 1e-10) {
        return vec4f(0.0, 0.0, sideDir.x, sideDir.y);
    }

    let interpolated = phaseDir / weightSum;

    // Treat (cos, sin) as a phasor and soft-normalize it back toward unit length.
    var magnitude = sqrt(dot(interpolated, interpolated));
    magnitude = max(1.0 - normalization, magnitude);

    let normalized = interpolated / magnitude;
    return vec4f(normalized.x, normalized.y, sideDir.x, sideDir.y);
}

// -----------------------------------------------------------------------------
// Erosion filter
// -----------------------------------------------------------------------------

struct ErosionResult {
    heightDelta: f32,
    slopeDelta: vec2f,
    magnitude: f32,
    ridgeMap: f32,
    fadeTarget: f32,
};

fn erosionFilter(p: vec2f, heightAndSlopeIn: vec3f, fadeTargetIn: f32) -> ErosionResult {
    let flags = params.passFlags;
    let blendCells = (flags & STAGE_CELL_STRIPES) != 0u;
    let useFadeMask = (flags & STAGE_FADE_TARGET) != 0u;
    let useAdvanced = (flags & STAGE_ADVANCED_NOISE) != 0u;
    let useRounding = (flags & STAGE_SECONDARY_FEATURES) != 0u;

    var octaves = i32(params.erosionOctaves);
    if ((flags & STAGE_MULTI_OCTAVE) == 0u) {
        octaves = 1;
    }

    // Stage 5 controls: without it, drop normalization and the assumed slope so the
    // raw terrain gradient drives the gullies (the "chaotic mess" failure mode).
    var normalization = params.normalization;
    var assumedSlopeAmount = params.assumedSlopeAmount;
    if (!useAdvanced) {
        normalization = 0.0;
        assumedSlopeAmount = 0.0;
    }

    // Stage 6 controls the rounding curves.
    var ridgeRounding = params.ridgeRounding;
    var creaseRounding = params.creaseRounding;
    if (!useRounding) {
        ridgeRounding = 0.0;
        creaseRounding = 0.0;
    }

    var strength = params.erosionStrength * params.erosionScale;
    var fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);

    var heightAndSlope = heightAndSlopeIn;
    var freq = 1.0 / (params.erosionScale * params.cellScale);
    let slopeLength = max(length(heightAndSlopeIn.yz), 1e-10);

    var magnitude = 0.0;
    var roundingMult = 1.0;

    let roundingForInput = mix(creaseRounding, ridgeRounding, clamp01(fadeTarget + 0.5)) * params.roundingInputMult;

    // Accumulating mask: starts from the input slope, then each octave's own slope.
    var combiMask = ease_out(smooth_start(slopeLength * params.onsetInitial, roundingForInput * params.onsetInitial));
    if (!useFadeMask) {
        combiMask = 1.0;
    }

    var ridgeMapCombiMask = ease_out(slopeLength * params.onsetRidgeInitial);
    var ridgeMapFadeTarget = fadeTarget;

    // Gully directions: blend the real slope with an assumed constant magnitude.
    var gullySlope = mix(
        heightAndSlopeIn.yz,
        heightAndSlopeIn.yz / slopeLength * params.assumedSlope,
        assumedSlopeAmount
    );

    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let phacelle = phacelleNoise(p * freq, safe_normalize(gullySlope), params.cellScale, 0.25, normalization, blendCells);

        // Multiply by freq because p was pre-multiplied by freq.
        // Negate because slope directions point downhill.
        let sideDeriv = phacelle.zw * -freq;

        let sloping = abs(phacelle.y);

        // Feed the normalized slope forward so the next octave branches off this one.
        gullySlope = gullySlope + sign(phacelle.y) * sideDeriv * strength * params.gullyWeight;

        // Height offset in x, derivative in yz.
        let gullies = vec3f(phacelle.x, phacelle.y * sideDeriv.x, phacelle.y * sideDeriv.y);

        // Fade the gullies toward fadeTarget where the mask is low (flat ground).
        let fadedGullies = mix(vec3f(fadeTarget, 0.0, 0.0), gullies * params.gullyWeight, combiMask);

        heightAndSlope = heightAndSlope + fadedGullies * strength;
        magnitude = magnitude + strength;

        // Stacked fading: this octave's ridges/creases restrict the next one.
        fadeTarget = fadedGullies.x;

        let roundingForOctave = mix(creaseRounding, ridgeRounding, clamp01(phacelle.x + 0.5)) * roundingMult;
        let newMask = ease_out(smooth_start(sloping * params.onsetOctave, roundingForOctave * params.onsetOctave));
        if (useFadeMask) {
            combiMask = pow_inv(combiMask, params.detail) * newMask;
        }

        ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
        ridgeMapCombiMask = ridgeMapCombiMask * ease_out(sloping * params.onsetRidgeOctave);

        strength = strength * params.gain;
        freq = freq * params.lacunarity;
        roundingMult = roundingMult * params.roundingOctaveMult;
    }

    let delta = heightAndSlope - heightAndSlopeIn;

    var result: ErosionResult;
    result.heightDelta = delta.x;
    result.slopeDelta = delta.yz;
    result.magnitude = magnitude;
    result.ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
    result.fadeTarget = fadeTarget;
    return result;
}

// -----------------------------------------------------------------------------
// Base height function
// -----------------------------------------------------------------------------

fn fractalNoise(p: vec2f, freq: f32, octaves: i32, lacunarity: f32, gain: f32) -> vec3f {
    var n = vec3f(0.0, 0.0, 0.0);
    var nf = freq;
    var na = 1.0;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        n = n + noised(p * nf) * na * vec3f(1.0, nf, nf);
        na = na * gain;
        nf = nf * lacunarity;
    }
    return n;
}

@compute @workgroup_size(8, 8)
fn generateErosion(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;

    // Seed acts as a domain offset so each seed samples a different landscape.
    let seedOffset = vec2f(
        fract(params.seed * 0.1031) * 512.0,
        fract(params.seed * 0.0973) * 512.0
    );
    let p = vec2f(f32(x) / f32(N), f32(y) / f32(N)) + seedOffset;

    // Stage 1: base height and analytical gradient, in the [-1, 1] range.
    var n = vec3f(0.0, 0.0, 0.0);
    if ((params.passFlags & STAGE_BASE_HEIGHT) != 0u) {
        n = fractalNoise(p, params.heightFrequency, i32(params.heightOctaves), params.heightLacunarity, params.heightGain)
            * params.heightAmp;
    }

    // Fade target: -1 at valleys, +1 at peaks. Overshooting is fine.
    let fadeTarget = clamp(n.x / (params.heightAmp * 0.6), -1.0, 1.0);

    // Shift base height into the [0, 1] range.
    n = n * 0.5 + vec3f(0.5, 0.0, 0.0);

    let erosion = erosionFilter(p, n, fadeTarget);

    // Raising/lowering control. Blending toward -fadeTarget preserves extrema.
    let offset = mix(params.heightOffset, -fadeTarget, params.heightOffsetFadeAmount) * erosion.magnitude;
    let eroded = n.x + erosion.heightDelta + offset;

    // Map the [~0.35, ~0.65] working range onto the metre height range.
    let normalizedHeight = clamp01((eroded - 0.35) / 0.3);
    let heightMeters = normalizedHeight * MAX_HEIGHT;

    heights[idx] = clamp(i32(heightMeters * FIXED_SCALE), 0, MAX_FIXED);
    ridgeMaps[idx] = erosion.ridgeMap;
}
`;
