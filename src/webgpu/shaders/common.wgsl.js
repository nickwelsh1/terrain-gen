// Shared WGSL library for WebGPU terrain compositor operators.
// Provides deterministic hashes, value noise, analytical-derivative gradient
// noise (noised), fBm, ridged multifractal, Phacelle phase-defect stripe noise,
// multi-feature Voronoi (F1, F2, cell ID), and height-blend primitives.

import {
    N,
    FIXED_POINT_SCALE,
    MAX_HEIGHT_M,
    MAX_FIXED_POINT,
    CELL_SPACING_M,
} from "../constants.js";

export const COMMON_WGSL = /* wgsl */`
const N : u32 = ${N}u;
const N_I : i32 = ${N};
const N_F : f32 = ${N}.0;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const CELL_M : f32 = ${CELL_SPACING_M.toFixed(4)};
const PI : f32 = 3.141592653589793;
const TAU : f32 = 6.283185307179586;

fn clamp01(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn toFixedHeight(meters: f32) -> i32 {
    let clamped = clamp(meters, 0.0, MAX_HEIGHT);
    return clamp(i32(clamped * FIXED_SCALE), 0, MAX_FIXED);
}

fn fromFixedHeight(fixedVal: i32) -> f32 {
    return f32(fixedVal) / FIXED_SCALE;
}

fn packRGBA(r: f32, g: f32, b: f32, a: f32) -> u32 {
    let ri = u32(clamp(r, 0.0, 1.0) * 255.0);
    let gi = u32(clamp(g, 0.0, 1.0) * 255.0);
    let bi = u32(clamp(b, 0.0, 1.0) * 255.0);
    let ai = u32(clamp(a, 0.0, 1.0) * 255.0);
    return (ai << 24u) | (bi << 16u) | (gi << 8u) | ri;
}

fn unpackRGBA(packed: u32) -> vec4f {
    let r = f32(packed & 0xFFu) / 255.0;
    let g = f32((packed >> 8u) & 0xFFu) / 255.0;
    let b = f32((packed >> 16u) & 0xFFu) / 255.0;
    let a = f32((packed >> 24u) & 0xFFu) / 255.0;
    return vec4f(r, g, b, a);
}

// Integer 2D hash in [0, 1]
fn hash2(p: vec2u) -> f32 {
    var v: u32 = p.x * 374761393u + p.y * 668265263u;
    v = (v ^ (v >> 13u)) * 1274126177u;
    return f32(v) / 4294967295.0;
}

// Float 2D -> 2D hash in [-1, 1] (Dave Hoskins fract-first hash: bounded in [0, 36]
// so it never overflows 32-bit float mantissa precision at large coordinates or seeds).
fn hash22f(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return -1.0 + 2.0 * fract((p3.xx + p3.yz) * p3.zy);
}

fn smoothstep01(t: f32) -> f32 {
    return t * t * (3.0 - 2.0 * t);
}

// 2D value noise in [0.5, 1.0] compatible with original heightmap shader
fn valueNoise(x: f32, y: f32, seed: f32) -> f32 {
    let ix = floor(x);
    let iy = floor(y);
    let fx = fract(x);
    let fy = fract(y);

    let sx = u32(abs(seed) * 1000.0 + 17.0);
    let sy = u32(abs(seed) * 2000.0 + 53.0);

    let ux_i = u32(max(ix + 4096.0, 0.0));
    let uy_i = u32(max(iy + 4096.0, 0.0));

    let a = hash2(vec2u(ux_i + sx, uy_i + sy));
    let b = hash2(vec2u(ux_i + 1u + sx, uy_i + sy));
    let c = hash2(vec2u(ux_i + sx, uy_i + 1u + sy));
    let d = hash2(vec2u(ux_i + 1u + sx, uy_i + 1u + sy));

    let ux = smoothstep01(fx);
    let uy = smoothstep01(fy);

    return mix(mix(a, b, ux), mix(c, d, ux), uy) * 0.5 + 0.5;
}

// Full-range [0, 1] value noise
fn valueNoise01(x: f32, y: f32, seed: f32) -> f32 {
    return (valueNoise(x, y, seed) - 0.5) * 2.0;
}

// Inter-octave 2D rotation (~36.87 deg 3-4-5 right triangle) to break axial grid alignment
fn octRotate(p: vec2f) -> vec2f {
    return vec2f(0.8 * p.x + 0.6 * p.y, -0.6 * p.x + 0.8 * p.y);
}

// Quintic-fade 2D gradient Perlin noise in [-1, 1]
fn perlinNoise2D(p: vec2f, seed: vec2f) -> f32 {
    let pi = floor(p);
    let pf = fract(p);
    let w = pf * pf * pf * (pf * (pf * 6.0 - 15.0) + 10.0);

    let a = dot(hash22f(pi + seed), pf);
    let b = dot(hash22f(pi + vec2f(1.0, 0.0) + seed), pf - vec2f(1.0, 0.0));
    let c = dot(hash22f(pi + vec2f(0.0, 1.0) + seed), pf - vec2f(0.0, 1.0));
    let d = dot(hash22f(pi + vec2f(1.0, 1.0) + seed), pf - vec2f(1.0, 1.0));

    return clamp(mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 1.41421356, -1.0, 1.0);
}

// Worley F1 and F2 distances in vec2f(F1, F2)
fn worleyF(p: vec2f, seed: vec2f) -> vec2f {
    let pi = floor(p);
    let pf = fract(p);
    var f1 = 8.0;
    var f2 = 8.0;
    for (var i: i32 = -1; i <= 1; i = i + 1) {
        for (var j: i32 = -1; j <= 1; j = j + 1) {
            let g = vec2f(f32(i), f32(j));
            let o = hash22f(pi + g + seed) * 0.5 + 0.5;
            let r = g + o - pf;
            let d = dot(r, r);
            if (d < f1) {
                f2 = f1;
                f1 = d;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    return vec2f(sqrt(f1), sqrt(f2));
}

// Perlin-Worley hybrid base noise in [0, 1] (blocky cellular massifs fused with gradient ridges)
fn perlinWorleyBase(p: vec2f, seed: vec2f) -> f32 {
    let per = perlinNoise2D(p, seed) * 0.5 + 0.5;
    let wor = 1.0 - clamp01(worleyF(p * 1.7, seed + vec2f(3.1, 7.7)).x);
    return clamp01(mix(per, wor, 0.55) + 0.15 * (per - 0.5));
}

// Analytical-derivative 2D gradient noise: returns (value, d/dx, d/dy)
fn noised(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = fract(p);

    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    let ga = hash22f(i + vec2f(0.0, 0.0));
    let gb = hash22f(i + vec2f(1.0, 0.0));
    let gc = hash22f(i + vec2f(0.0, 1.0));
    let gd = hash22f(i + vec2f(1.0, 1.0));

    let va = dot(ga, f - vec2f(0.0, 0.0));
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));

    let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
    let deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);

    return vec3f(value, deriv.x, deriv.y);
}

// Configurable octave-rotated gradient Perlin fBm with variable octaves, lacunarity, and gain
fn fbmEx(x: f32, y: f32, seed: f32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var value = 0.0;
    var amplitude = 1.0;
    var sum = 0.0;
    let oct = clamp(octaves, 1, 8);
    var sp = vec2f(x, y);
    let seedVec = floor(fract(vec2f(seed * 0.1031, seed * 0.1737)) * 256.0);

    for (var i: i32 = 0; i < oct; i = i + 1) {
        let octSeed = seedVec + vec2f(f32(i) * 17.3, f32(i) * 31.7);
        let n = perlinNoise2D(sp, octSeed) * 0.5 + 0.5;
        value = value + amplitude * n;
        sum = sum + amplitude;
        amplitude = amplitude * gain;
        sp = octRotate(sp) * lacunarity;
    }

    return clamp01(value / max(sum, 1e-6));
}

// Perlin-Worley hybrid fBm with inter-octave rotation (ideal for Dolomite carbonate massifs)
fn fbmPerlinWorley(p: vec2f, seed: f32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var value = 0.0;
    var amplitude = 1.0;
    var sum = 0.0;
    let oct = clamp(octaves, 1, 8);
    var sp = p;
    let seedVec = floor(fract(vec2f(seed * 0.1031, seed * 0.1737)) * 256.0);

    for (var i: i32 = 0; i < oct; i = i + 1) {
        let octSeed = seedVec + vec2f(f32(i) * 19.1, f32(i) * 29.3);
        let n = perlinWorleyBase(sp, octSeed);
        value = value + amplitude * n;
        sum = sum + amplitude;
        amplitude = amplitude * gain;
        sp = octRotate(sp) * lacunarity;
    }

    return clamp01(value / max(sum, 1e-6));
}

// 2-stage iterated Inigo Quilez domain warp: p + intensity * (r * 2 - 1) where r = fbm(p + 4*q)
fn domainWarpIQ(p: vec2f, seed: f32, intensity: f32, freq: f32, octs: i32, persistence: f32) -> vec2f {
    if (intensity < 0.0001) {
        return p;
    }
    let q = vec2f(
        fbmEx(p.x * freq + 5.2, p.y * freq + 1.3, seed + 11.0, octs, 2.0, persistence),
        fbmEx(p.x * freq + 6.8, p.y * freq + 4.1, seed + 23.0, octs, 2.0, persistence)
    );
    let r = vec2f(
        fbmEx(p.x * freq + 4.0 * q.x + 1.7, p.y * freq + 4.0 * q.y + 9.2, seed + 37.0, octs, 2.0, persistence),
        fbmEx(p.x * freq + 4.0 * q.x + 8.3, p.y * freq + 4.0 * q.y + 2.8, seed + 53.0, octs, 2.0, persistence)
    );
    return p + intensity * (r * 2.0 - 1.0);
}

// Plateau-rim transfer function: incises basins below rim and lifts/undulates high tabular massifs above rim
fn applyPlateauRim(h: f32, rimAmount: f32) -> f32 {
    if (rimAmount <= 0.001) {
        return h;
    }
    let rim = 0.42 + 0.14 * rimAmount;
    let plateauFloor = mix(rim, 0.66, rimAmount * 0.82);
    if (h >= rim) {
        let t = (h - rim) / max(1.0 - rim, 1e-4);
        let undulation = pow(clamp01(t), 0.85);
        return mix(h, plateauFloor + (1.0 - plateauFloor) * undulation, rimAmount);
    } else {
        let t = clamp01(h / max(rim, 1e-4));
        let incised = t * t * (3.0 - 2.0 * t) * pow(max(t, 1e-4), 0.55 + 0.85 * rimAmount);
        return mix(h, incised * plateauFloor, rimAmount);
    }
}

// Standard 6-octave fBm compatible with heightmap.wgsl.js
fn fbm(x: f32, y: f32, seed: f32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var sum = 0.0;

    for (var i: i32 = 0; i < 6; i = i + 1) {
        value = value + amplitude * valueNoise(x * frequency, y * frequency, seed + f32(i) * 17.0);
        sum = sum + amplitude;
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }

    return value / sum;
}

// Musgrave-style octave-rotated ridged multifractal with configurable octaves and sharpness
fn ridgedEx(x: f32, y: f32, seed: f32, octaves: i32, lacunarity: f32, gain: f32, sharpness: f32) -> f32 {
    var value = 0.0;
    var amplitude = 1.0;
    var weight = 1.0;
    var sum = 0.0;
    let oct = clamp(octaves, 1, 8);
    var sp = vec2f(x, y);
    let seedVec = floor(fract(vec2f(seed * 0.1031, seed * 0.1737)) * 256.0);

    for (var i: i32 = 0; i < oct; i = i + 1) {
        let octSeed = seedVec + vec2f(f32(i) * 23.7, f32(i) * 41.3);
        var n = 1.0 - abs(perlinNoise2D(sp, octSeed));
        n = pow(clamp(n, 0.0001, 1.0), sharpness);
        n = n * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        value = value + amplitude * n;
        sum = sum + amplitude;
        amplitude = amplitude * gain;
        sp = octRotate(sp) * lacunarity;
    }

    return clamp01(value / max(sum, 1e-6));
}

fn ridged(x: f32, y: f32, seed: f32) -> f32 {
    return ridgedEx(x, y, seed, 5, 2.0, 0.5, 2.0);
}

// Phacelle Noise: 4x4 cell-blended phasor stripe noise.
// Returns normalized (cos, sin) in .xy and orthogonal frequency vector sideDir in .zw.
// Produces natural Y-junction phase dislocations where opposing cell phasors cancel.
fn phacelleNoise(
    p: vec2f,
    normDir: vec2f,
    freq: f32,
    offsetCycles: f32,
    normalization: f32,
    blendCells: bool
) -> vec4f {
    let sideDir = normDir.yx * vec2f(-1.0, 1.0) * freq * TAU;
    let offset = offsetCycles * TAU;

    let pInt = floor(p);
    let pFrac = fract(p);

    var phaseDir = vec2f(0.0, 0.0);
    var weightSum = 0.0;

    var iLo = -1;
    var iHi = 2;
    if (!blendCells) {
        iLo = 0;
        iHi = 0;
    }

    for (var i: i32 = iLo; i <= iHi; i = i + 1) {
        for (var j: i32 = iLo; j <= iHi; j = j + 1) {
            let gridOffset = vec2f(f32(i), f32(j));
            let gridPoint = pInt + gridOffset;
            let randomOffset = hash22f(gridPoint) * 0.5;
            let vectorFromCellPoint = pFrac - gridOffset - randomOffset;

            let sqrDist = dot(vectorFromCellPoint, vectorFromCellPoint);
            var weight = exp(-sqrDist * 2.0);
            weight = max(0.0, weight - 0.01111);

            weightSum = weightSum + weight;
            let waveInput = dot(vectorFromCellPoint, sideDir) + offset;
            phaseDir = phaseDir + vec2f(cos(waveInput), sin(waveInput)) * weight;
        }
    }

    if (weightSum <= 1e-10) {
        return vec4f(0.0, 0.0, sideDir.x, sideDir.y);
    }

    let interpolated = phaseDir / weightSum;
    var magnitude = sqrt(dot(interpolated, interpolated));
    magnitude = max(1.0 - normalization, magnitude);

    let normalized = interpolated / max(magnitude, 1e-6);
    return vec4f(normalized.x, normalized.y, sideDir.x, sideDir.y);
}

// Per-octave seeded Phacelle Noise (Runevision 2026 Advanced Terrain Erosion Filter)
fn phacelleNoiseSeeded(
    p: vec2f,
    normDir: vec2f,
    freq: f32,
    offsetCycles: f32,
    normalization: f32,
    seed: vec2f
) -> vec4f {
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
            let randomOffset = hash22f(gridPoint + seed) * 0.5;
            let v = pFrac - gridOffset - randomOffset;

            let sqrDist = dot(v, v);
            let weight = max(exp(-sqrDist * 2.0) - 0.01111, 0.0);
            weightSum = weightSum + weight;

            let waveInput = dot(v, sideDir) + offset;
            phaseDir = phaseDir + vec2f(cos(waveInput), sin(waveInput)) * weight;
        }
    }

    let interpolated = phaseDir / max(weightSum, 1e-5);
    let magRaw = length(interpolated);
    let magnitude = max(max(1.0 - normalization, magRaw), 1e-5);
    let normalized = interpolated / magnitude;
    return vec4f(normalized.x, normalized.y, sideDir.x, sideDir.y);
}

// Clay John / Fewes 4x4 cellular Gavoronoise directional wave kernel.
// Returns vec3f(cosWave, dWave/dx, dWave/dy).
fn gavoronoiseErosion(p: vec2f, dir: vec2f, normalization: f32, seed: vec2f) -> vec3f {
    let ip = floor(p);
    let fp = fract(p);
    var va = vec3f(0.0, 0.0, 0.0);
    var wt = 0.0;

    for (var i: i32 = -2; i <= 1; i = i + 1) {
        for (var j: i32 = -2; j <= 1; j = j + 1) {
            let o = vec2f(f32(i), f32(j));
            let h = hash22f(ip - o + seed) * 0.5;
            let pp = fp + o - h;
            let d = dot(pp, pp);
            let w = exp(-d * 2.0);
            wt = wt + w;
            let mag = dot(pp, dir);
            let deriv = -sin(mag * TAU) * dir;
            va = va + vec3f(cos(mag * TAU), deriv.x, deriv.y) * w;
        }
    }

    var res = va / max(wt, 1e-5);
    if (normalization > 0.01) {
        let waveAmp = clamp(abs(res.x), max(1.0 - normalization * 0.7, 0.25), 1.0);
        res.x = res.x / max(waveAmp, 0.25);
    }
    return res;
}

// 2D Voronoi / Cellular evaluation:
// Returns vec4f(F1_dist, F2_minus_F1_edgeDist, cellHash01, cellSlopeTilt)
fn voronoi2D(p: vec2f, jitter: f32, seed: f32) -> vec4f {
    let n = floor(p);
    let f = fract(p);

    var d1 = 8.0;
    var d2 = 8.0;
    var bestCell = vec2f(0.0, 0.0);
    var bestVec = vec2f(0.0, 0.0);

    let seedVec = floor(fract(vec2f(seed * 0.1031, seed * 0.1737)) * 256.0);

    for (var j: i32 = -1; j <= 1; j = j + 1) {
        for (var i: i32 = -1; i <= 1; i = i + 1) {
            let g = vec2f(f32(i), f32(j));
            let cellId = n + g + seedVec;
            let rnd = (hash22f(cellId) * 0.5 + 0.5) * jitter + (1.0 - jitter) * 0.5;
            let r = g + rnd - f;
            let d = sqrt(dot(r, r));

            if (d < d1) {
                d2 = d1;
                d1 = d;
                bestCell = cellId;
                bestVec = r;
            } else if (d < d2) {
                d2 = d;
            }
        }
    }

    let h = hash22f(bestCell + vec2f(17.13, 59.41));
    let cellHeight01 = clamp01(h.x * 0.5 + 0.5);
    let tiltDir = normalize(h + vec2f(0.001, 0.001));
    let cellTilt = dot(bestVec, tiltDir);

    return vec4f(d1, max(0.0, d2 - d1), cellHeight01, cellTilt);
}

// Height-aware biome blend: sand/sediment fills low crevices of hBase first
// and smoothly submerges higher peaks as mask -> 1, avoiding hard edge outlines.
fn heightBlend(hBase: f32, hOverlay: f32, mask: f32, depthM: f32, smoothM: f32) -> f32 {
    let m = clamp01(mask);
    if (m <= 0.0001) {
        return hBase;
    }
    let effDepth = max(depthM, 1.0);
    let effSmooth = max(smoothM, 1.0);
    let liftedOverlay = hOverlay + (m * 2.0 - 1.0) * effDepth;
    let diff = liftedOverlay - hBase;
    let weight = smoothstep(-effSmooth, effSmooth, diff) * m;
    return mix(hBase, max(hBase, hOverlay), weight);
}

// Polynomial smooth maximum (fillet radius k in meters)
fn smoothMax(a: f32, b: f32, k: f32) -> f32 {
    let rad = max(k, 0.001);
    let h = max(rad - abs(a - b), 0.0) / rad;
    return max(a, b) + h * h * rad * 0.25;
}
`;
