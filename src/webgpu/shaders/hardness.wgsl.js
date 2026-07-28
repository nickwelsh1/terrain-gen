// WGSL compute shader: hardness map generation
// Ridged multifractal → threshold → hardness buffer.
// Hardness is in [0, 1] encoded as fixed-point i32 (value * 10000).

import { N, FIXED_POINT_SCALE } from "../constants.js";

export const HARDNESS_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> hardness: array<i32>;

struct SimParams {
    rainRate: f32,
    erosionRate: f32,
    depositionRate: f32,
    evaporation: f32,
    sedimentCapacity: f32,
    stepCount: f32,
    passFlags: u32,
    seed: f32,
};

fn hash2(p: vec2u) -> f32 {
    var v: u32 = p.x * 374761393u + p.y * 668265263u;
    v = (v ^ (v >> 13u)) * 1274126177u;
    return f32(v) / 4294967295.0;
}

fn smoothstep01(t: f32) -> f32 {
    return t * t * (3.0 - 2.0 * t);
}

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

fn ridged(x: f32, y: f32, seed: f32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var weight = 1.0;
    var sum = 0.0;
    
    for (var i: i32 = 0; i < 5; i = i + 1) {
        var n = valueNoise(x * frequency, y * frequency, seed + f32(i) * 29.0);
        n = 1.0 - abs(n * 2.0 - 1.0);
        n = n * n * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        value = value + amplitude * n;
        sum = sum + amplitude;
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }
    
    return value / sum;
}

@compute @workgroup_size(8, 8)
fn generateHardness(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }
    
    let idx = y * N + x;
    let seed = params.seed + 101.0;
    
    let nx = f32(x) / f32(N) * 6.0;
    let ny = f32(y) / f32(N) * 6.0;
    
    // Ridged multifractal for rock hardness patterns
    var h = ridged(nx, ny, seed);
    
    // Add some large-scale variation
    let lowFreq = valueNoise(nx * 0.5, ny * 0.5, seed + 53.0);
    h = h * 0.7 + lowFreq * 0.3;
    
    // Threshold to create distinct hard/soft zones
    h = smoothstep(0.3, 0.7, h);
    
    // Encode as fixed-point [0, 10000]
    hardness[idx] = i32(h * FIXED_SCALE);
}
`;
