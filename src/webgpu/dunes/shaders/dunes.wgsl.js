// WGSL compute shader: 5-stage sand dune generation pipeline
// Writes fixed-point heights (meters * 10000) to the height buffer.
// One workgroup processes a tile of the grid.

import { N, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT, SCENE_SCALE, SCENE_MAX_HEIGHT } from "../constants.js";

export const DUNES_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};

// Stage toggle flags
const STAGE_BASE_WAVEFORM : u32 = 1u;
const STAGE_CREST_WARPING : u32 = 2u;
const STAGE_PROFILE_MODIFIER : u32 = 4u;
const STAGE_ANGLE_REPOSE : u32 = 8u;
const STAGE_MICRO_DETAIL : u32 = 16u;

@group(0) @binding(0) var<uniform> params: DunesParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;

struct DunesParams {
    // Stage 1: Base Waveform & Orientation
    windDirection: f32,      // degrees
    ridgeSpacing: f32,
    ridgeSharpness: f32,

    // Stage 2: Sinuous Crest Warping
    warpFrequency: f32,
    warpAmplitude: f32,

    // Stage 3: Directional Profile Modifier
    windwardPower: f32,
    leewardPower: f32,

    // Stage 4: Angle of Repose & Talus Limiter
    angleOfRepose: f32,      // degrees
    talusStrength: f32,

    // Stage 5: Micro-Surface Detail
    rippleFrequency: f32,
    rippleAmplitude: f32,
    slopeMaskThreshold: f32,

    // Global parameters
    seed: f32,
    overallScale: f32,
    heightScale: f32,

    // Stage toggles and render mode
    passFlags: u32,
    renderMode: u32,
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

// fBm — fractal Brownian motion
fn fbm(x: f32, y: f32, seed: f32, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var sum = 0.0;

    for (var i: i32 = 0; i < octaves; i = i + 1) {
        value = value + amplitude * valueNoise(x * frequency, y * frequency, seed + f32(i) * 17.0);
        sum = sum + amplitude;
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }

    return value / sum;
}

// Compute gradient (finite difference)
fn computeGradient(h: f32, x: f32, y: f32, scale: f32, seed: f32) -> vec2f {
    let eps = 0.01;
    let h_plus_x = fbm((x + eps) * scale, y * scale, seed, 4);
    let h_minus_x = fbm((x - eps) * scale, y * scale, seed, 4);
    let h_plus_y = fbm(x * scale, (y + eps) * scale, seed, 4);
    let h_minus_y = fbm(x * scale, (y - eps) * scale, seed, 4);

    return vec2f((h_plus_x - h_minus_x) / (2.0 * eps), (h_plus_y - h_minus_y) / (2.0 * eps));
}

// Stage 1: Base Waveform & Orientation
// Generates parallel ridge lines perpendicular to wind direction
fn stageBaseWaveform(uv: vec2f, windDirRad: f32, noiseFreq: f32) -> f32 {
    // Rotate UV coordinates to align with wind direction
    let cos_w = cos(windDirRad);
    let sin_w = sin(windDirRad);

    // Rotate to wind-aligned space
    let uv_wind = vec2f(
        uv.x * cos_w + uv.y * sin_w,
        -uv.x * sin_w + uv.y * cos_w
    );

    // Non-uniform stretching: stretch along wind-perpendicular axis
    let uv_stretched = vec2f(uv_wind.x / params.ridgeSpacing, uv_wind.y);

    // Generate ridged noise for parallel dune crests
    let ridge = fbm(uv_stretched.x * noiseFreq * 0.5, uv_stretched.y * noiseFreq * 0.5, params.seed, 4);
    let ridged = 1.0 - abs(ridge * 2.0 - 1.0);
    let sharpened = pow(ridged, params.ridgeSharpness);

    return sharpened;
}

// Stage 2: Sinuous Crest Warping
// Applies domain warping for organic meandering
fn stageCrestWarping(uv: vec2f) -> vec2f {
    let warpFreq = params.warpFrequency;
    let warpAmp = params.warpAmplitude;

    // Low-frequency noise for warping
    let warpX = fbm(uv.x * warpFreq + 100.0, uv.y * warpFreq, params.seed + 13.0, 3) * warpAmp;
    let warpY = fbm(uv.x * warpFreq, uv.y * warpFreq + 100.0, params.seed + 19.0, 3) * warpAmp;

    return uv + vec2f(warpX, warpY);
}

// Stage 3: Directional Profile Modifier
// Creates slope asymmetry (gentle windward, steep leeward)
fn stageProfileModifier(height: f32, gradient: vec2f, windDirRad: f32) -> f32 {
    // Wind direction vector
    let windDir = vec2f(cos(windDirRad), sin(windDirRad));

    // Compute directional slope (dot product with wind direction)
    let directionalSlope = dot(gradient, windDir);

    // Apply asymmetric power curves
    if (directionalSlope > 0.0) {
        // Windward side: gentle slope
        return pow(height, params.windwardPower);
    } else {
        // Leeward side: steep slope
        return pow(height, params.leewardPower);
    }
}

// Stage 4: Angle of Repose & Talus Limiter
// Simulates avalanching when slope exceeds angle of repose
fn stageAngleRepose(height: f32, gradient: vec2f) -> f32 {
    let slopeMagnitude = length(gradient);
    let angleOfReposeRad = params.angleOfRepose * 3.14159 / 180.0;
    let maxSlope = tan(angleOfReposeRad);

    // If slope exceeds angle of repose, reduce height (avalanching)
    if (slopeMagnitude > maxSlope) {
        let excess = slopeMagnitude - maxSlope;
        return height - excess * params.talusStrength;
    }

    return height;
}

// Stage 5: Micro-Surface Detail
// Adds wind ripples on stoss slopes
fn stageMicroDetail(uv: vec2f, gradient: vec2f, windDirRad: f32) -> f32 {
    let slopeMagnitude = length(gradient);

    // Slope mask: ripples appear on gentle slopes, fade on steep slopes
    let slopeMask = 1.0 - smoothstep(params.slopeMaskThreshold, 0.8, slopeMagnitude);

    // High-frequency directional noise for ripples
    let rippleFreq = params.rippleFrequency;
    let rippleNoise = fbm(uv.x * rippleFreq, uv.y * rippleFreq, params.seed + 31.0, 2);

    // Sawtooth-like pattern for sharp ripples
    let sawtooth = abs(rippleNoise * 2.0 - 1.0);

    return sawtooth * params.rippleAmplitude * slopeMask;
}

@compute @workgroup_size(8, 8)
fn generateDunes(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;

    // Normalized coordinates
    let uv = vec2f(f32(x) / f32(N), f32(y) / f32(N));
    let noiseFreq = 4.0 / params.overallScale; // Overall scale affects noise frequency

    // Start with base height from noise
    var height = fbm(uv.x * noiseFreq, uv.y * noiseFreq, params.seed, 6);
    height = height * params.heightScale;

    // Stage 1: Base Waveform & Orientation
    if ((params.passFlags & STAGE_BASE_WAVEFORM) != 0u) {
        let windDirRad = params.windDirection * 3.14159 / 180.0;
        let baseWave = stageBaseWaveform(uv, windDirRad, noiseFreq);
        height = height * 0.3 + baseWave * 0.7;
    }

    // Stage 2: Sinuous Crest Warping
    var warpedUV = uv;
    if ((params.passFlags & STAGE_CREST_WARPING) != 0u) {
        warpedUV = stageCrestWarping(uv);
    }

    // Recompute height with warped coordinates if warping is enabled
    if ((params.passFlags & STAGE_CREST_WARPING) != 0u) {
        let warpedHeight = fbm(warpedUV.x * noiseFreq, warpedUV.y * noiseFreq, params.seed, 6);
        height = warpedHeight * params.heightScale;

        if ((params.passFlags & STAGE_BASE_WAVEFORM) != 0u) {
            let windDirRad = params.windDirection * 3.14159 / 180.0;
            let baseWave = stageBaseWaveform(warpedUV, windDirRad, noiseFreq);
            height = height * 0.3 + baseWave * 0.7;
        }
    }

    // Compute gradient for subsequent stages
    let gradient = computeGradient(height, uv.x, uv.y, noiseFreq, params.seed);

    // Stage 3: Directional Profile Modifier
    if ((params.passFlags & STAGE_PROFILE_MODIFIER) != 0u) {
        let windDirRad = params.windDirection * 3.14159 / 180.0;
        height = stageProfileModifier(height, gradient, windDirRad);
    }

    // Stage 4: Angle of Repose & Talus Limiter
    if ((params.passFlags & STAGE_ANGLE_REPOSE) != 0u) {
        height = stageAngleRepose(height, gradient);
    }

    // Stage 5: Micro-Surface Detail
    if ((params.passFlags & STAGE_MICRO_DETAIL) != 0u) {
        let windDirRad = params.windDirection * 3.14159 / 180.0;
        let microDetail = stageMicroDetail(uv, gradient, windDirRad);
        height = height + microDetail;
    }

    // Map to height range [0, MAX_HEIGHT] meters
    // Dunes are typically lower than mountains, so we scale appropriately
    // Use heightScale to control overall height range
    let heightRange = 0.5 * MAX_HEIGHT * params.heightScale;
    height = clamp(height * heightRange, 0.0, MAX_HEIGHT);

    // Convert to fixed-point
    let fixed = i32(height * FIXED_SCALE);
    heights[idx] = clamp(fixed, 0, MAX_FIXED);
}
`;
