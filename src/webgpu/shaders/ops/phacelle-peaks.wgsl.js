// WGSL compute shader: gen.phacellePeaks — single-pass eroded mountains via
// stacked faded gullies (Phacelle Noise) with multi-scale analytical base shaping
// and scale-consistent parameter coupling.
//
// Combines Rune Skovbo Johansen's "Advanced Terrain Erosion Filter" (2026) and
// "Clean Terrain Erosion Filter" (2025) principles:
//  1. Exact analytical derivatives (value + d/dx, d/dy) through octave rotation,
//     anisotropic range stretching, Jacobian domain warp, and ridge/plateau curves.
//  2. Scale-consistent coupling between Mountain size (heightFrequency), base
//     amplitude, gully spacing (erosionScale), and rounding multipliers (.zw).
//  3. Per-pixel valley-floor erosion damping (Clean Terrain Erosion Filter line 282)
//     and macro elevation envelope so mountains vary naturally in height, width,
//     orientation, and valley breadth instead of forming an even grid.
//  4. Unclipped analytical MagnitudeSum normalization window so sliders never
//     hard-clip summits or valley floors.

import { N, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT } from "../../constants.js";

export const GEN_PHACELLE_PEAKS_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const PI : f32 = 3.141592653589793;
const TAU : f32 = 6.28318530717959;

struct PhacellePeaksParams {
    landformMode: u32,           // 0 = Tectonic Range Chains (Himalayas), 1 = Tabular Massifs (Dolomites), 2 = Classic Isotropic
    baseHeight: f32,             // metres of relief mapped from the normalized eroded field
    heightFrequency: f32,        // mountain size (inverse horizontal scale)
    orientationDeg: f32,         // primary range / massif strike angle in degrees
    scaleVariation: f32,         // [0..1] macro elevation envelope, range anisotropy & warp variety
    valleyFloor: f32,            // [0..1] valley floor broadening & basin erosion damping
    erosionScale: f32,           // gully spacing
    erosionStrength: f32,        // gully depth
    erosionOctaves: f32,         // hierarchical branching passes
    heightOffset: f32,           // raise/lower eroded field (negative = deeper valley incision)
    heightAmp: f32,              // base fBm slope amplitude
    heightOctaves: f32,
    heightLacunarity: f32,
    heightGain: f32,
    cellScale: f32,              // phacelle cell size relative to erosion scale
    normalization: f32,          // phasor normalization degree
    lacunarity: f32,
    gain: f32,
    gullyWeight: f32,
    detail: f32,
    assumedSlope: f32,           // constant slope magnitude gully directions blend toward
    assumedSlopeAmount: f32,     // 1.0 = fully assumed (avoids chaotic gullies)
    ridgeRounding: f32,
    creaseRounding: f32,
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

// Fract-first 2D -> 2D hash in [-1, 1]: folds coordinates into [0, 1] before
// multiplying so it never overflows 32-bit float mantissa precision at large
// frequencies, octaves, or seed offsets.
fn hash22(x: vec2f) -> vec2f {
    var p3 = fract(vec3f(x.x, x.y, x.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return -1.0 + 2.0 * fract((p3.xx + p3.yz) * p3.zy);
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
    return 1.0 - pow(1.0 - clamp01(t), max(power, 0.001));
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

// Geometric series sum of octave amplitudes (from Clean Terrain Erosion Filter):
// 1 + g + g^2 + ... + g^(octaves-1)
fn magnitudeSum(octaves: i32, gain: f32) -> f32 {
    let g = clamp(gain, 0.05, 0.95);
    return (1.0 - pow(g, f32(octaves))) / max(1.0 - g, 1e-4);
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

// Octave-rotated analytical fBm returning vec3f(value, d/dx, d/dy).
// Rotates coordinates by ~36.87 deg per octave and applies the exact transpose
// rotation matrix to the gradient vector so derivatives remain 100% consistent.
fn fractalNoiseRotated(p: vec2f, freq: f32, octaves: i32, lacunarity: f32, gain: f32) -> vec3f {
    var n = vec3f(0.0, 0.0, 0.0);
    var nf = freq;
    var na = 1.0;
    // Cumulative rotation matrix rows (starts at identity)
    var r0 = vec2f(1.0, 0.0);
    var r1 = vec2f(0.0, 1.0);
    var seedShift = vec2f(0.0, 0.0);

    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let rp = vec2f(dot(r0, p), dot(r1, p)) * nf + seedShift;
        let s = noised(rp);
        // Chain rule: grad_p = nf * R^T * grad_rp
        let gx = (r0.x * s.y + r1.x * s.z) * nf;
        let gy = (r0.y * s.y + r1.y * s.z) * nf;
        n = n + vec3f(s.x, gx, gy) * na;

        na = na * gain;
        nf = nf * lacunarity;
        // Multiply cumulative rotation by OCT_ROT = [[0.8, -0.6], [0.6, 0.8]]
        let nr0 = vec2f(0.8 * r0.x - 0.6 * r1.x, 0.8 * r0.y - 0.6 * r1.y);
        let nr1 = vec2f(0.6 * r0.x + 0.8 * r1.x, 0.6 * r0.y + 0.8 * r1.y);
        r0 = nr0;
        r1 = nr1;
        seedShift = seedShift + vec2f(17.3, 31.7);
    }
    return n;
}

// Evaluates an anisotropic, rotated fractalNoise field at p with exact chain-rule derivatives.
// angleRad rotates the strike axis; scaleXY stretches (x, y) before sampling.
fn anisotropicRangeNoise(
    p: vec2f,
    freq: f32,
    octaves: i32,
    lacunarity: f32,
    gain: f32,
    angleRad: f32,
    scaleXY: vec2f,
    offset: vec2f
) -> vec3f {
    let c = cos(angleRad);
    let s = sin(angleRad);
    // q = S * R * p + offset
    let rx = c * p.x - s * p.y;
    let ry = s * p.x + c * p.y;
    let q = vec2f(rx * scaleXY.x, ry * scaleXY.y) + offset;

    let fnVal = fractalNoiseRotated(q, freq, octaves, lacunarity, gain);
    // Chain rule: d/dp = R^T * S * d/dq
    let dqx = fnVal.y * scaleXY.x;
    let dqy = fnVal.z * scaleXY.y;
    let dpx = c * dqx + s * dqy;
    let dpy = -s * dqx + c * dqy;
    return vec3f(fnVal.x, dpx, dpy);
}

// Smooth analytical ridge fold: maps v in [-1, 1] into a soft ridge crest in [-0.7, 0.9]
// using sqrt(v^2 + k) so the first derivative is continuous and bounded everywhere.
fn smoothRidgeFold(vAndDeriv: vec3f, k: f32, foldMix: f32) -> vec3f {
    let v = vAndDeriv.x;
    let denom = sqrt(v * v + k);
    let ridgeVal = (sqrt(0.35 + k) - denom) * 1.45;
    let dRidgeDv = (-v / denom) * 1.45;
    let val = mix(v, ridgeVal, foldMix);
    let dValDv = mix(1.0, dRidgeDv, foldMix);
    return vec3f(val, vAndDeriv.yz * dValDv);
}

// Smooth analytical domain warp: q = p + warpAmp * W(p * warpFreq)
// Returns warped position in .xy and the 2x2 Jacobian rows in (j0, j1) via out-style helper.
struct WarpedDomain {
    q: vec2f,
    j0: vec2f, // (dqx/dpx, dqy/dpx)
    j1: vec2f, // (dqx/dpy, dqy/dpy)
};

fn evaluateAnalyticalWarp(p: vec2f, warpFreq: f32, warpAmp: f32, seedOffset: vec2f) -> WarpedDomain {
    var res: WarpedDomain;
    if (warpAmp <= 1e-4) {
        res.q = p;
        res.j0 = vec2f(1.0, 0.0);
        res.j1 = vec2f(0.0, 1.0);
        return res;
    }
    let wx = noised(p * warpFreq + seedOffset + vec2f(5.2, 1.3));
    let wy = noised(p * warpFreq + seedOffset + vec2f(19.7, 9.4));
    res.q = p + vec2f(wx.x, wy.x) * warpAmp;
    let wf = warpAmp * warpFreq;
    res.j0 = vec2f(1.0 + wx.y * wf, wy.y * wf);
    res.j1 = vec2f(wx.z * wf, 1.0 + wy.z * wf);
    return res;
}

fn applyWarpJacobian(vAndGradQ: vec3f, w: WarpedDomain) -> vec3f {
    let gx = dot(vAndGradQ.yz, w.j0);
    let gy = dot(vAndGradQ.yz, w.j1);
    return vec3f(vAndGradQ.x, gx, gy);
}

// Multi-scale analytical base surface with exact chain-rule derivatives.
// Returns vec4f(heightInMinus1To1, dh/dx, dh/dy, localMassifEnvelope01).
fn evaluateMacroBase(p: vec2f, freq: f32, octaves: i32, lac: f32, gain: f32, seedOffset: vec2f) -> vec4f {
    let scaleVar = clamp01(params.scaleVariation);
    let orientRad = params.orientationDeg * PI / 180.0;

    // 1. Low-frequency macro elevation & valley-width envelope (varies peak heights across the map)
    let envFreq = max(freq * 0.36, 0.45);
    let envNoise = fractalNoiseRotated(p + vec2f(13.7, 29.1), envFreq, 2, 2.0, 0.45);
    // env01 in [0, 1]: 0 in broad lowland basins, 1 on major mountain massifs
    let env01 = clamp01(envNoise.x * 0.65 + 0.52);
    // Envelope multiplier: modulates local peak height between 0.42x and 1.32x
    let envMult = mix(1.0, 0.42 + 0.90 * env01, scaleVar);
    let dEnvMult = (0.90 * 0.65 * scaleVar) * envNoise.yz;

    // 2. Smooth analytical domain warp so mountain ranges curve organically
    let warpAmp = (0.09 / max(freq * 0.45, 0.6)) * scaleVar;
    let warp = evaluateAnalyticalWarp(p, max(freq * 0.55, 0.7), warpAmp, seedOffset);
    let wp = warp.q;

    var baseQ = vec3f(0.0, 0.0, 0.0);

    if (params.landformMode == 0u) {
        // MODE 0: Tectonic Range Chains (Himalayan High Peaks / Karakoram)
        // Anisotropic primary range + intersecting secondary range + smooth ridge folding
        let stretch1 = mix(vec2f(1.0, 1.0), vec2f(0.58, 1.38), scaleVar);
        let stretch2 = mix(vec2f(1.0, 1.0), vec2f(0.68, 1.28), scaleVar);
        let effGain = max(gain, mix(gain, 0.34, scaleVar));

        let r1Raw = anisotropicRangeNoise(wp, freq, octaves, lac, effGain, orientRad, stretch1, vec2f(0.0, 0.0));
        let r2Raw = anisotropicRangeNoise(wp, freq * 0.86, octaves, lac, effGain, orientRad + 1.02, stretch2, vec2f(37.4, 19.8));

        let r1 = smoothRidgeFold(r1Raw, 0.045, 0.52 * scaleVar);
        let r2 = smoothRidgeFold(r2Raw, 0.055, 0.45 * scaleVar);

        // Smoothly combine primary and secondary intersecting ranges + broad tectonic massif swell
        let crossWeight = 0.38 * scaleVar;
        baseQ = r1 * (1.0 - crossWeight * 0.45) + r2 * crossWeight;
    } else if (params.landformMode == 1u) {
        // MODE 1: Tabular Carbonate Massifs & Wide Alpine Valleys (Alpine Dolomites)
        // Distinct massif blocks separated by broad passes, shaped by an analytical
        // valley-floor-to-plateau transfer curve.
        let effGain = max(gain, mix(gain, 0.28, scaleVar));
        let m1 = anisotropicRangeNoise(wp, freq * 0.88, octaves, lac, effGain, orientRad, vec2f(0.85, 1.15), vec2f(0.0, 0.0));
        let m2 = anisotropicRangeNoise(wp, freq * 1.05, max(octaves - 1, 2), lac, effGain, orientRad + 1.35, vec2f(1.12, 0.88), vec2f(53.1, 17.6));

        let combined = m1 * 0.65 + m2 * 0.45;
        // Analytical plateau-pedestal shaping: incises broad U-basins (u < 0) and lifts steep-sided massif blocks (u > 0)
        let u = combined.x;
        let kSharp = 1.0 + 1.15 * scaleVar;
        let tanhU = tanh(u * kSharp);
        let dTanhDu = kSharp * (1.0 - tanhU * tanhU);
        // Asymmetric basin bias: lowers valleys more than it flattens summits
        let basinPull = -0.18 * scaleVar * (1.0 - tanhU * tanhU);
        let dBasinDu = 0.36 * scaleVar * tanhU * dTanhDu;

        let shapedVal = mix(u, tanhU * 0.88 + basinPull, 0.65 * scaleVar);
        let dShapedDu = mix(1.0, dTanhDu * 0.88 + dBasinDu, 0.65 * scaleVar);
        baseQ = vec3f(shapedVal, combined.yz * dShapedDu);
    } else {
        // MODE 2: Classic Isotropic Runevision Base (with optional scaleVariation)
        let effGain = max(gain, mix(gain, 0.26, scaleVar * 0.6));
        baseQ = fractalNoiseRotated(wp, freq, octaves, lac, effGain);
    }

    // Transform gradient through the domain-warp Jacobian: d/dp = J^T * d/dq
    let baseP = applyWarpJacobian(baseQ, warp);

    // Product rule with macro envelope: H(p) = baseP.x * envMult + envShift
    let envShift = (env01 - 0.5) * 0.55 * scaleVar;
    let dEnvShift = (0.55 * 0.65 * scaleVar) * envNoise.yz;

    let finalVal = baseP.x * envMult + envShift;
    let finalGrad = baseP.yz * envMult + baseP.x * dEnvMult + dEnvShift;

    return vec4f(finalVal, finalGrad.x, finalGrad.y, env01);
}

// Runevision 2026 stacked-gully erosion filter with scale-consistent rounding (.zw)
// and per-pixel valley-floor damping.
struct ErosionResult {
    heightDelta: f32,
    magnitude: f32,
    ridgeMap: f32,
};

fn erosionFilter(
    p: vec2f,
    heightAndSlopeIn: vec3f,
    fadeTargetIn: f32,
    effScale: f32,
    effStrength: f32,
    roundingInputMult: f32,
    roundingOctaveMult: f32,
    localRidgeRound: f32,
    localCreaseRound: f32
) -> ErosionResult {
    let octaves = clamp(i32(params.erosionOctaves), 1, 7);
    let normalization = params.normalization * step(0.001, params.assumedSlopeAmount);

    var strength = effStrength * effScale;
    var fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);
    var heightAndSlope = heightAndSlopeIn;
    var freq = 1.0 / max(effScale * params.cellScale, 0.005);
    let slopeLength = max(length(heightAndSlopeIn.yz), 1e-10);

    var magnitude = 0.0;
    var roundingMult = 1.0;

    let roundingForInput = mix(localCreaseRound, localRidgeRound, clamp01(fadeTarget + 0.5)) * roundingInputMult;
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

        let roundingForOctave = mix(localCreaseRound, localRidgeRound, clamp01(phacelle.x + 0.5)) * roundingMult;
        let newMask = ease_out(smooth_start(sloping * 1.25, roundingForOctave * 1.25));
        combiMask = pow_inv(combiMask, params.detail) * newMask;

        ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
        ridgeMapCombiMask = ridgeMapCombiMask * ease_out(sloping * 1.5);

        strength = strength * params.gain;
        freq = freq * params.lacunarity;
        roundingMult = roundingMult * roundingOctaveMult;
    }

    var result: ErosionResult;
    result.heightDelta = heightAndSlope.x - heightAndSlopeIn.x;
    result.magnitude = magnitude;
    result.ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
    return result;
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

    let freq = max(params.heightFrequency, 0.5);
    let octs = clamp(i32(params.heightOctaves), 1, 6);

    // 1. Scale-consistent amplitude coupling (Clean/Advanced Terrain Erosion Filter):
    // Scaling base heightAmp inversely with frequency keeps physical slope steepness
    // consistent when the user adjusts Mountain size (heightFrequency).
    let freqScale = 3.0 / max(freq, 0.75);
    let effHeightAmp = params.heightAmp * mix(1.0, freqScale, 0.72);

    // 2. Evaluate multi-scale analytical base + exact chain-rule derivatives
    let macroBase = evaluateMacroBase(p, freq, octs, params.heightLacunarity, params.heightGain, seedOffset);
    let env01 = macroBase.w;
    var n = macroBase.xyz * effHeightAmp;

    // Fade target: -1 in valleys, +1 on high peaks
    let fadeTarget = clamp(n.x / max(effHeightAmp * 0.65, 1e-4), -1.0, 1.0);

    // Shift base height into [0, 1] working space; halve derivatives to match height*0.5
    // (Clean Terrain Erosion Filter BufferA comment #2: heights halved -> derivatives halved)
    n = n * 0.5 + vec3f(0.5, 0.0, 0.0);

    // 3. Scale-coupled gully spacing & rounding multipliers (Advanced BufferA lines 331-337)
    let effErosionScale = clamp(
        params.erosionScale * mix(1.0, clamp(sqrt(freqScale), 0.55, 1.65), 0.45),
        0.025,
        0.55
    );
    let roundingInputMult = clamp(freq * effErosionScale * params.cellScale * 0.75, 0.05, 0.45);
    let roundingOctaveMult = max(params.lacunarity, 1.2);

    // 4. Per-pixel valley-floor erosion damping (Clean Terrain Erosion Filter line 282:
    //    strength *= smoothstep(WATER_HEIGHT - 0.1, WATER_HEIGHT + 0.1, n.x))
    //    Stops gullies from carving uniform grooves across flat valley basins.
    let vFloor = clamp01(params.valleyFloor);
    let valleyGate = mix(
        1.0,
        smoothstep(-0.85 + 0.55 * vFloor, 0.20 + 0.40 * vFloor, fadeTarget),
        vFloor * 0.82
    );
    // Modulate gully depth slightly by the macro massif envelope so primary peaks
    // develop deeper couloirs than low foothills
    let envStrengthMod = mix(1.0, 0.72 + 0.45 * env01, clamp01(params.scaleVariation) * 0.6);
    let effStrength = params.erosionStrength * valleyGate * envStrengthMod;

    // For Dolomites (mode 1), round valley creases into broader U-basins while keeping upper arêtes crisp
    let localCreaseRound = clamp01(params.creaseRounding + (1.0 - valleyGate) * 0.35 * vFloor);
    let localRidgeRound = params.ridgeRounding;

    let erosion = erosionFilter(
        p,
        n,
        fadeTarget,
        effErosionScale,
        effStrength,
        roundingInputMult,
        roundingOctaveMult,
        localRidgeRound,
        localCreaseRound
    );

    // 5. Reference unfiltered magnitude (MagnitudeSum) for stable, unclipped normalization
    let refMag = effErosionScale * params.erosionStrength * magnitudeSum(clamp(i32(params.erosionOctaves), 1, 7), params.gain);
    let offset = mix(params.heightOffset, -fadeTarget, params.heightOffsetFadeAmount) * erosion.magnitude;
    var eroded = n.x + erosion.heightDelta + offset;

    // Tight, scale-consistent normalization window that uses the full [0, baseHeight] relief
    let centerBias = 0.5 + params.heightOffset * refMag * 0.58;
    let halfSpan = max(0.36 * effHeightAmp + refMag * (0.32 + 0.42 * params.gullyWeight), 0.045);
    let lo = centerBias - halfSpan;
    let hi = centerBias + halfSpan;
    var normalizedHeight = clamp01((eroded - lo) / max(hi - lo, 1e-4));

    if (vFloor > 0.01) {
        // Subtle concave valley-floor easing so basins open out naturally between massifs
        let valleyPower = 1.0 + vFloor * 0.38;
        normalizedHeight = mix(normalizedHeight, pow(normalizedHeight, valleyPower), 0.55);
    }

    let heightMeters = normalizedHeight * params.baseHeight;
    heights[idx] = clamp(i32(heightMeters * FIXED_SCALE), 0, MAX_FIXED);

    if (params.clearAux != 0u) {
        // aux.y = loose sediment (enriched in valley floors & scree aprons), aux.z = mask, aux.w = ridge map 0..1
        let gullyScree = max(0.0, -erosion.heightDelta) * params.baseHeight * 0.55;
        let basinSediment = (1.0 - valleyGate) * vFloor * params.baseHeight * 0.06;
        aux[idx] = vec4f(0.0, gullyScree + basinSediment, 1.0, clamp01(erosion.ridgeMap * 0.5 + 0.5));
    }
}
`;
