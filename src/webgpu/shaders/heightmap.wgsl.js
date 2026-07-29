// WGSL compute shader: fBm heightmap generation
// Writes fixed-point heights (meters * 10000) to the height buffer.
// One workgroup processes a tile of the grid.

import { N, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT, HEIGHT_CURVE } from "../constants.js";

export const HEIGHTMAP_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const HEIGHT_CURVE : f32 = ${HEIGHT_CURVE.toFixed(3)};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;

struct SimParams {
    rainRate: f32,
    erosionRate: f32,
    depositionRate: f32,
    evaporation: f32,
    sedimentCapacity: f32,
    stepCount: f32,
    passFlags: u32,
    seed: f32,
    baseHeight: f32,
};

// Hash-based pseudo-random for deterministic generation
fn hash2(p: vec2u) -> f32 {
    var v: u32 = p.x * 374761393u + p.y * 668265263u;
    v = (v ^ (v >> 13u)) * 1274126177u;
    return f32(v) / 4294967295.0;
}

// 2D hash for gradient noise
fn hash22(x: f32, y: f32, seed: f32) -> vec2f {
    let s = vec2f(x * 127.1 + seed * 311.7, y * 311.7 + seed * 74.7);
    let h = vec2f(
        fract(sin(s.x) * 43758.5453),
        fract(sin(s.y) * 43758.5453),
    );
    return h * 2.0 - 1.0;
}

// Smooth interpolation
fn smoothstep01(t: f32) -> f32 {
    return t * t * (3.0 - 2.0 * t);
}

// 2D value noise
fn valueNoise(x: f32, y: f32, seed: f32) -> f32 {
    let ix = floor(x);
    let iy = floor(y);
    let fx = fract(x);
    let fy = fract(y);
    
    let sx = u32(seed * 1000.0);
    let sy = u32(seed * 2000.0);
    
    let a = hash2(vec2u(u32(ix) + sx, u32(iy) + sy));
    let b = hash2(vec2u(u32(ix + 1.0) + sx, u32(iy) + sy));
    let c = hash2(vec2u(u32(ix) + sx, u32(iy + 1.0) + sy));
    let d = hash2(vec2u(u32(ix + 1.0) + sx, u32(iy + 1.0) + sy));
    
    let ux = smoothstep01(fx);
    let uy = smoothstep01(fy);
    
    return mix(mix(a, b, ux), mix(c, d, ux), uy) * 0.5 + 0.5;
}

// fBm — fractal Brownian motion with 6 octaves
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

// Ridged multifractal — creates sharp ridges
fn ridged(x: f32, y: f32, seed: f32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var weight = 1.0;
    var sum = 0.0;
    
    for (var i: i32 = 0; i < 5; i = i + 1) {
        var n = valueNoise(x * frequency, y * frequency, seed + f32(i) * 31.0);
        n = 1.0 - abs(n * 2.0 - 1.0);
        n = n * n;
        n = n * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        value = value + amplitude * n;
        sum = sum + amplitude;
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }
    
    return value / sum;
}

@compute @workgroup_size(8, 8)
fn generateHeightmap(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }
    
    let idx = y * N + x;
    let seed = params.seed;
    
    // Normalized coordinates with some zoom
    let nx = f32(x) / f32(N) * 4.0;
    let ny = f32(y) / f32(N) * 4.0;
    
    // Base elevation: fBm for rolling terrain
    var h = fbm(nx, ny, seed);
    
    // Add ridged component for mountain ridges
    let ridge = ridged(nx + 100.0, ny + 100.0, seed + 7.0);
    h = h * 0.6 + ridge * 0.4;
    
    // Domain warp for natural variation
    let warpX = fbm(nx * 2.0 + 50.0, ny * 2.0, seed + 13.0) * 0.3;
    let warpY = fbm(nx * 2.0, ny * 2.0 + 50.0, seed + 19.0) * 0.3;
    h = h + fbm(nx + warpX, ny + warpY, seed + 23.0) * 0.15;
    
    // Height curve — the raw noise averages around mid-range, which left the
    // whole landscape floating high above y = 0. Raising it to a power pulls the
    // common (low/mid) elevations down toward the base plane while leaving the
    // peaks at full height.
    h = pow(clamp(h, 0.0, 1.0), HEIGHT_CURVE);

    // No border falloff: the heightmap runs to the edges so the result reads as
    // a clean slice cut out of the landscape rather than a fading island.

    // Map to height range [0, baseHeight] meters (clamped to the global max)
    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    h = clamp(h * relief, 0.0, MAX_HEIGHT);

    // Convert to fixed-point
    let fixed = i32(h * FIXED_SCALE);
    heights[idx] = clamp(fixed, 0, MAX_FIXED);
}
`;
