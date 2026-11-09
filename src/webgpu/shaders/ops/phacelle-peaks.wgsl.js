// WGSL compute shader: gen.phacellePeaks — single-pass eroded mountains via
// stacked faded gullies (Phacelle Noise). Direct port of the standalone
// erodemountains.html pipeline (src/webgpu/erosion/shaders/erosion.wgsl.js),
// which implements Rune Skovbo Johansen's "Advanced Terrain Erosion Filter":
//   https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html
//
// Unlike the multi-pass compositor stack, this keeps the whole landform in
// registers per pixel: near-flat analytic-gradient base -> fadeTarget ->
// phacelle gully erosion -> extrema-preserving offset -> relief normalization.
// The erosion IS the terrain, so gully branching stays coherent.

import { N, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT } from "../../constants.js";

export const GEN_PHACELLE_PEAKS_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const TAU : f32 = 6.28318530717959;

struct PhacellePeaksParams {
    baseHeight: f32,          // metres of relief mapped from the normalized eroded field
    heightFrequency: f32,     // mountain size (inverse horizontal scale)
    heightAmp: f32,           // base fBm amplitude (kept small: base only steers gullies)
    heightOctaves: f32,
    heightLacunarity: f32,
    heightGain: f32,
    cellScale: f32,           // phacelle cell size relative to erosion scale
    normalization: f32,       // phasor normalization degree
    erosionOctaves: f32,
    lacunarity: f32,
    gain: f32,
    erosionStrength: f32,
    gullyWeight: f32,
    detail: f32,
    assumedSlope: f32,        // constant slope magnitude gully directions blend toward
    assumedSlopeAmount: f32,  // 1.0 = fully assumed (avoids chaotic gullies)
    ridgeRounding: f32,
    creaseRounding: f32,
    erosionScale: f32,        // gully spacing
    heightOffset: f32,        // raise/lower eroded field (negative = deeper incision)
    heightOffsetFadeAmount: f32, // blend offset toward -fadeTarget to preserve extrema
    seed: f32,
    clearAux: u32,
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: PhacellePeaksParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

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
    let v = 1.0 - clamp01(t);
    return 1.0 - v * v;
}

fn smooth_start(t: f32, smoothing: f32) -> f32 {
    if (smoothing <= 1e-10) { return t; }
    if (t >= smoothing) { return t - 0.5 * smoothing; }
    return 0.5 * t * t / smoothing;
}

fn safe_normalize(n: vec2f) -> vec2f {
    let l = length(n);
    if (abs(l) > 1e-10) { return n / l; }
    return n;
}

// Phacelle Noise — 4x4 cell-blended stripe pattern aligned with normDir.
// Returns normalized (cos, sin) in xy and the side direction vector in zw.
fn phacelleNoise(p: vec2f, normDir: vec2f, freq: f32, offsetCycles: f32, normalization: f32) -> vec4f {
    let sideDir = normDir.yx * vec2f(-1.0, 1.0) * freq * TAU;
    let offset = offsetCycles * TAU;
    let pInt = floor(p);
    let pFrac = fract(p);

    var phaseDir = vec2f(0.0, 0.0);
    var weightSum = 0.0;

    for (var i: i32 = -1; i <= 2; i = i + 1) {
        for (var j: i32 = -1; j <= 2; j = j + 1) {
            let gridOffset = vec2f(f32(i), f32(j));
            let gridPoint = pInt + gridOffset;
            let randomOffset = hash22(gridPoint) * 0.5;
            let vectorFromCellPoint = pFrac - gridOffset - randomOffset;
            let sqrDist = dot(vectorFromCellPoint, vectorFromCellPoint);
            let weight = max(exp(-sqrDist * 2.0) - 0.01111, 0.0);
            weightSum = weightSum + weight;
            let waveInput = dot(vectorFromCellPoint, sideDir) + offset;
            phaseDir = phaseDir + vec2f(cos(waveInput), sin(waveInput)) * weight;
        }
    }

    if (weightSum <= 1e-10) {
        return vec4f(0.0, 0.0, sideDir.x, sideDir.y);
    }

    let interpolated = phaseDir / weightSum;
    let magnitude = max(1.0 - normalization, sqrt(dot(interpolated, interpolated)));
    let normalized = interpolated / magnitude;
    return vec4f(normalized.x, normalized.y, sideDir.x, sideDir.y);
}

// Runevision 2026 stacked-gully erosion filter (all stages always enabled).
// Onset constants from the reference genotype: (1.25, 1.25, 2.8, 1.5),
// rounding input/octave multipliers (0.1, 2.0).
struct ErosionResult {
    heightDelta: f32,
    magnitude: f32,
    ridgeMap: f32,
};

fn erosionFilter(p: vec2f, heightAndSlopeIn: vec3f, fadeTargetIn: f32) -> ErosionResult {
    let octaves = clamp(i32(params.erosionOctaves), 1, 7);
    let normalization = params.normalization * step(0.001, params.assumedSlopeAmount);

    var strength = params.erosionStrength * params.erosionScale;
    var fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);
    var heightAndSlope = heightAndSlopeIn;
    var freq = 1.0 / (params.erosionScale * params.cellScale);
    let slopeLength = max(length(heightAndSlopeIn.yz), 1e-10);

    var magnitude = 0.0;
    var roundingMult = 1.0;

    let roundingForInput = mix(params.creaseRounding, params.ridgeRounding, clamp01(fadeTarget + 0.5)) * 0.1;
    var combiMask = ease_out(smooth_start(slopeLength * 1.25, roundingForInput * 1.25));
    var ridgeMapCombiMask = ease_out(slopeLength * 2.8);
    var ridgeMapFadeTarget = fadeTarget;

    // Gully directions blend the real slope with an assumed constant magnitude.
    var gullySlope = mix(
        heightAndSlopeIn.yz,
        heightAndSlopeIn.yz / slopeLength * params.assumedSlope,
        params.assumedSlopeAmount
    );

    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let phacelle = phacelleNoise(p * freq, safe_normalize(gullySlope), params.cellScale, 0.25, normalization);
        let sideDeriv = phacelle.zw * -freq;
        let sloping = abs(phacelle.y);

        gullySlope = gullySlope + sign(phacelle.y) * sideDeriv * strength * params.gullyWeight;
        let gullies = vec3f(phacelle.x, phacelle.y * sideDeriv.x, phacelle.y * sideDeriv.y);
        let fadedGullies = mix(vec3f(fadeTarget, 0.0, 0.0), gullies * params.gullyWeight, combiMask);

        heightAndSlope = heightAndSlope + fadedGullies * strength;
        magnitude = magnitude + strength;
        fadeTarget = fadedGullies.x;

        let roundingForOctave = mix(params.creaseRounding, params.ridgeRounding, clamp01(phacelle.x + 0.5)) * roundingMult;
        let newMask = ease_out(smooth_start(sloping * 1.25, roundingForOctave * 1.25));
        combiMask = pow_inv(combiMask, params.detail) * newMask;

        ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
        ridgeMapCombiMask = ridgeMapCombiMask * ease_out(sloping * 1.5);

        strength = strength * params.gain;
        freq = freq * params.lacunarity;
        roundingMult = roundingMult * 2.0;
    }

    var result: ErosionResult;
    result.heightDelta = heightAndSlope.x - heightAndSlopeIn.x;
    result.magnitude = magnitude;
    result.ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
    return result;
}

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
fn generateErodedPeaks(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let seedOffset = vec2f(
        fract(params.seed * 0.1031) * 512.0,
        fract(params.seed * 0.0973) * 512.0
    );
    let p = vec2f(f32(x) / f32(N), f32(y) / f32(N)) + seedOffset;

    // Near-flat base: analytical value + gradient only steers the gully field.
    var n = fractalNoise(p, params.heightFrequency, i32(params.heightOctaves), params.heightLacunarity, params.heightGain)
        * params.heightAmp;

    let fadeTarget = clamp(n.x / (params.heightAmp * 0.6), -1.0, 1.0);
    n = n * 0.5 + vec3f(0.5, 0.0, 0.0);

    let erosion = erosionFilter(p, n, fadeTarget);
    let offset = mix(params.heightOffset, -fadeTarget, params.heightOffsetFadeAmount) * erosion.magnitude;
    let eroded = n.x + erosion.heightDelta + offset;

    let normalizedHeight = clamp01((eroded - 0.35) / 0.3);
    let heightMeters = normalizedHeight * params.baseHeight;

    heights[idx] = clamp(i32(heightMeters * FIXED_SCALE), 0, MAX_FIXED);

    if (params.clearAux != 0u) {
        // aux.y = loose sediment, aux.z = mask (1 = fully editable), aux.w = ridge map 0..1
        let sediment = max(0.0, -erosion.heightDelta) * params.baseHeight * 0.5;
        aux[idx] = vec4f(0.0, sediment, 1.0, clamp01(erosion.ridgeMap * 0.5 + 0.5));
    }
}
`;
