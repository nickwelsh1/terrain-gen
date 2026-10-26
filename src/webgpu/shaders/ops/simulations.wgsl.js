// WGSL compute shaders for Stage 4 GPU Simulations:
// 1. sim.thermalTalus    — Two-tier bedrock/sediment angle-of-repose rockslide & scree sim
// 2. sim.windDrift       — Aeolian saltation & alpine snow drift / cornice sim
// 3. sim.waterLevel      — Sea, lake & valley flooding with shoreline shelf shaping
// 4. sim.phacelleErosion — Analytic multi-octave Phacelle gully filter on existing heightmap
// 5. util.copyHeight     — Fast GPU height & aux snapshot / restore pass

import { COMMON_WGSL } from "../common.wgsl.js";

// =============================================================================
// 1. sim.thermalTalus — Two-Tier Bedrock / Scree Angle-of-Repose Simulation
// =============================================================================
export const SIM_THERMAL_TALUS_SHADER = /* wgsl */`
${COMMON_WGSL}

struct ThermalTalusParams {
    talusReposeDeg: f32,    // Angle of repose for loose scree/sand (default 33 deg)
    bedrockReposeDeg: f32,  // Angle of repose for solid cliff rock (default 62 deg)
    transferRate: f32,      // Fraction of excess moved per step (0.05..0.5)
    weatheringRate: f32,    // Rate at which steep cliffs shed new scree (0..1)
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
};

@group(0) @binding(0) var<uniform> params: ThermalTalusParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;
@group(0) @binding(3) var<storage, read> srcAux: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dstAux: array<vec4f>;
@group(0) @binding(5) var<storage, read> hardness: array<i32>;

fn hAt(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]);
}

fn auxAt(x: i32, y: i32) -> vec4f {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return srcAux[u32(cy) * N + u32(cx)];
}

fn hardAt(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return f32(hardness[u32(cy) * N + u32(cx)]) / FIXED_SCALE;
}

// Effective max height drop allowed from cell (sx, sy) to a neighbor at distance distM
fn maxDropForCell(sx: i32, sy: i32, distM: f32) -> f32 {
    let sed = auxAt(sx, sy).y;
    let hard = hardAt(sx, sy);
    // Loose sediment slumps at talusReposeDeg (~33°); bare hard bedrock holds up to bedrockReposeDeg (~62°)
    let sedFactor = clamp01(sed / 2.0 + params.weatheringRate * (1.0 - hard * 0.6));
    let effDeg = mix(params.bedrockReposeDeg * (0.75 + 0.25 * hard), params.talusReposeDeg, sedFactor);
    let effRad = clamp(effDeg, 22.0, 80.0) * PI / 180.0;
    return tan(effRad) * distM;
}

@compute @workgroup_size(8, 8)
fn stepThermalTalus(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let hC = hAt(x, y);
    let curAux = auxAt(x, y);
    let rate = clamp(params.transferRate, 0.02, 0.45) * 0.125;

    var netDelta = 0.0;
    var gainedSediment = 0.0;

    // 8-neighborhood gather/scatter (mass conserving)
    for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
        for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
            if (dx == 0 && dy == 0) { continue; }
            let nx = x + dx;
            let ny = y + dy;
            if (nx < 0 || nx >= N_I || ny < 0 || ny >= N_I) { continue; }

            let isDiag = (dx != 0) && (dy != 0);
            let distM = select(CELL_M, CELL_M * 1.41421356, isDiag);
            let hN = hAt(nx, ny);

            // Outflow from center (x, y) to lower neighbor (nx, ny)
            let maxDropOut = maxDropForCell(x, y, distM);
            let diffOut = hC - hN;
            if (diffOut > maxDropOut) {
                let sloughed = (diffOut - maxDropOut) * rate;
                netDelta = netDelta - sloughed;
            }

            // Inflow from higher neighbor (nx, ny) to center (x, y)
            let maxDropIn = maxDropForCell(nx, ny, distM);
            let diffIn = hN - hC;
            if (diffIn > maxDropIn) {
                let received = (diffIn - maxDropIn) * rate;
                netDelta = netDelta + received;
                gainedSediment = gainedSediment + received;
            }
        }
    }

    let newH = clamp(hC + netDelta, 0.0, MAX_HEIGHT);
    let newSed = max(0.0, curAux.y + netDelta + gainedSediment * 0.5);

    dstHeights[idx] = toFixedHeight(newH);
    dstAux[idx] = vec4f(curAux.x, newSed, curAux.z, curAux.w);
}
`;

// =============================================================================
// 2. sim.windDrift — Aeolian Saltation & Alpine Snow Drift / Cornice Sim
// =============================================================================
export const SIM_WIND_DRIFT_SHADER = /* wgsl */`
${COMMON_WGSL}

struct WindDriftParams {
    windDirectionDeg: f32,
    transportRate: f32,
    depositionRate: f32,
    minAltitudeM: f32,      // 0 = desert sand, >300 = alpine snow line
    shadowAngleDeg: f32,    // 10..20 deg lee separation bubble
    reposeAngleDeg: f32,    // 33 deg sand, 38 deg snow
    snowSupplyM: f32,       // fresh snowfall / sand injection per step
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: WindDriftParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;
@group(0) @binding(3) var<storage, read> srcAux: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dstAux: array<vec4f>;

fn hAt(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]);
}

fn auxAt(x: i32, y: i32) -> vec4f {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return srcAux[u32(cy) * N + u32(cx)];
}

fn windShadowAt(x: i32, y: i32, windDir: vec2f, shadowTan: f32) -> f32 {
    let h0 = hAt(x, y);
    var maxSlope = 0.0;
    for (var s: i32 = 1; s <= 6; s = s + 1) {
        let upX = i32(round(f32(x) - windDir.x * f32(s) * 1.5));
        let upY = i32(round(f32(y) - windDir.y * f32(s) * 1.5));
        let distM = f32(s) * 1.5 * CELL_M;
        let upH = hAt(upX, upY);
        maxSlope = max(maxSlope, (upH - h0) / distM);
    }
    return smoothstep(shadowTan * 0.7, shadowTan * 1.15, maxSlope);
}

@compute @workgroup_size(8, 8)
fn stepWindDrift(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let hC = hAt(x, y);
    let curAux = auxAt(x, y);

    let rad = params.windDirectionDeg * PI / 180.0;
    let windDir = vec2f(cos(rad), sin(rad));
    let shadowTan = tan(clamp(params.shadowAngleDeg, 8.0, 25.0) * PI / 180.0);

    let altGate = smoothstep(params.minAltitudeM - 40.0, params.minAltitudeM + 60.0, hC);
    let shadowC = windShadowAt(x, y, windDir, shadowTan);

    // Upwind source cell
    let upX = i32(round(f32(x) - windDir.x * 1.5));
    let upY = i32(round(f32(y) - windDir.y * 1.5));
    let shadowUp = windShadowAt(upX, upY, windDir, shadowTan);
    let hUp = hAt(upX, upY);

    let availC = curAux.y + params.snowSupplyM * altGate;
    let availUp = auxAt(upX, upY).y + params.snowSupplyM * smoothstep(params.minAltitudeM - 40.0, params.minAltitudeM + 60.0, hUp);

    // Scour exposed windward crests; deposit in leeward wind shadows
    let erodeOut = min(availC, params.transportRate * (1.0 - shadowC) * altGate * 0.6);
    let depositIn = min(availUp, params.transportRate * (1.0 - shadowUp) * 0.6)
                  * mix(0.35, 1.35, shadowC) * clamp(params.depositionRate, 0.1, 2.0);

    var netDrift = (depositIn - erodeOut) + params.snowSupplyM * altGate * shadowC * 0.5;

    // Local avalanche relaxation at reposeAngleDeg
    let maxDrop = tan(clamp(params.reposeAngleDeg, 28.0, 45.0) * PI / 180.0) * CELL_M;
    let hL = hAt(x - 1, y);
    let hR = hAt(x + 1, y);
    let hU = hAt(x, y - 1);
    let hD = hAt(x, y + 1);
    let mean4 = 0.25 * (hL + hR + hU + hD);
    if (abs(hC + netDrift - mean4) > maxDrop) {
        netDrift = mix(netDrift, mean4 - hC, 0.35);
    }

    let newH = clamp(hC + netDrift, 0.0, MAX_HEIGHT);
    let newSed = max(0.0, availC + netDrift);

    dstHeights[idx] = toFixedHeight(newH);
    dstAux[idx] = vec4f(curAux.x, newSed, curAux.z, shadowC);
}
`;

// =============================================================================
// 3. sim.waterLevel — Sea, Lake & Valley Flooding Pass
// =============================================================================
export const SIM_WATER_LEVEL_SHADER = /* wgsl */`
${COMMON_WGSL}

struct WaterLevelParams {
    waterLevelM: f32,
    shorelineFlattenM: f32,
    sedimentFill: f32,
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: WaterLevelParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn applyWaterLevel(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    var h = fromFixedHeight(heights[idx]);
    let curAux = aux[idx];
    let level = params.waterLevelM;

    if (level <= 0.01) {
        aux[idx] = vec4f(0.0, curAux.y, curAux.z, curAux.w);
        return;
    }

    // Optional gently shelving beach / lacustrine sediment fill near & below shoreline
    let band = max(params.shorelineFlattenM, 1.0);
    let shoreDist = abs(h - level);
    if (shoreDist < band) {
        let t = 1.0 - shoreDist / band;
        h = mix(h, level, t * 0.25 * clamp01(params.sedimentFill));
    } else if (h < level) {
        h = mix(h, level - (level - h) * 0.85, clamp01(params.sedimentFill) * 0.35);
    }

    let waterDepth = max(0.0, level - h);
    let shoreWetness = 1.0 - smoothstep(0.0, band * 1.5, max(0.0, h - level));

    heights[idx] = toFixedHeight(h);
    aux[idx] = vec4f(waterDepth, curAux.y, curAux.z, shoreWetness);
}
`;

// =============================================================================
// 4. sim.phacelleErosion — Analytic Stacked-Gully Filter on Existing Heightmap
// =============================================================================
export const SIM_PHACELLE_EROSION_SHADER = /* wgsl */`
${COMMON_WGSL}

struct PhacelleErosionParams {
    erosionStrength: f32,
    erosionScale: f32,
    erosionOctaves: f32,
    gullyWeight: f32,
    ridgeRounding: f32,
    creaseRounding: f32,
    assumedSlope: f32,
    seed: f32,
};

@group(0) @binding(0) var<uniform> params: PhacelleErosionParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;
@group(0) @binding(3) var<storage, read_write> aux: array<vec4f>;

fn hNorm(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]) / MAX_HEIGHT;
}

fn powInv(t: f32, power: f32) -> f32 {
    return 1.0 - pow(1.0 - clamp01(t), power);
}

fn easeOut(t: f32) -> f32 {
    let v = 1.0 - clamp01(t);
    return 1.0 - v * v;
}

fn smoothStart(t: f32, smoothing: f32) -> f32 {
    if (smoothing <= 1e-10) { return t; }
    if (t >= smoothing) { return t - 0.5 * smoothing; }
    return 0.5 * t * t / smoothing;
}

fn safeNorm(v: vec2f) -> vec2f {
    let l = length(v);
    if (l > 1e-8) { return v / l; }
    return vec2f(1.0, 0.0);
}

@compute @workgroup_size(8, 8)
fn applyPhacelleErosion(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let h0 = hNorm(x, y);

    // Compute smoothed finite-difference gradient in normalized UV space
    let hL = hNorm(x - 2, y);
    let hR = hNorm(x + 2, y);
    let hU = hNorm(x, y - 2);
    let hD = hNorm(x, y + 2);
    let gx = (hR - hL) * N_F * 0.25;
    let gy = (hD - hU) * N_F * 0.25;

    let seedOffset = vec2f(
        fract(params.seed * 0.1031) * 256.0,
        fract(params.seed * 0.0973) * 256.0
    );
    let p = vec2f(f32(x) / N_F, f32(y) / N_F) + seedOffset;

    let scale = clamp(params.erosionScale, 0.03, 0.45);
    var strength = params.erosionStrength * scale;
    var fadeTarget = clamp((h0 - 0.35) * 2.5, -1.0, 1.0);
    var heightAndSlope = vec3f(h0, gx, gy);
    var freq = 1.0 / (scale * 0.7);
    let slopeLength = max(length(vec2f(gx, gy)), 1e-6);

    let roundingForInput = mix(params.creaseRounding, params.ridgeRounding, clamp01(fadeTarget + 0.5)) * 0.1;
    var combiMask = easeOut(smoothStart(slopeLength * 1.25, roundingForInput * 1.25));
    var gullySlope = mix(vec2f(gx, gy), (vec2f(gx, gy) / slopeLength) * params.assumedSlope, 0.85);
    var roundingMult = 1.0;

    let octs = clamp(i32(params.erosionOctaves), 1, 6);
    for (var i: i32 = 0; i < octs; i = i + 1) {
        let ph = phacelleNoise(p * freq, safeNorm(gullySlope), 0.7, 0.25, 0.5, true);
        let sideDeriv = ph.zw * -freq;
        let sloping = abs(ph.y);

        gullySlope = gullySlope + sign(ph.y) * sideDeriv * strength * params.gullyWeight;
        let gullies = vec3f(ph.x, ph.y * sideDeriv.x, ph.y * sideDeriv.y);
        let fadedGullies = mix(vec3f(fadeTarget, 0.0, 0.0), gullies * params.gullyWeight, combiMask);

        heightAndSlope = heightAndSlope + fadedGullies * strength;
        fadeTarget = fadedGullies.x;

        let roundingOct = mix(params.creaseRounding, params.ridgeRounding, clamp01(ph.x + 0.5)) * roundingMult;
        let newMask = easeOut(smoothStart(sloping * 1.25, roundingOct * 1.25));
        combiMask = powInv(combiMask, 1.5) * newMask;

        strength = strength * 0.5;
        freq = freq * 2.0;
        roundingMult = roundingMult * 2.0;
    }

    let deltaNorm = heightAndSlope.x - h0;
    let outMeters = clamp((h0 + deltaNorm) * MAX_HEIGHT, 0.0, MAX_HEIGHT);
    dstHeights[idx] = toFixedHeight(outMeters);

    let curAux = aux[idx];
    let erodedDepth = max(0.0, -deltaNorm * MAX_HEIGHT);
    aux[idx] = vec4f(curAux.x, curAux.y + erodedDepth * 0.25, curAux.z, clamp01(fadeTarget * 0.5 + 0.5));
}
`;

// =============================================================================
// 5. util.copyHeight — Fast GPU Height Buffer Snapshot / Reset Pass
// =============================================================================
export const UTIL_COPY_HEIGHT_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(1) var<storage, read_write> dstHeights: array<i32>;

@compute @workgroup_size(8, 8)
fn copyHeight(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }
    let idx = y * N + x;
    dstHeights[idx] = srcHeights[idx];
}
`;
