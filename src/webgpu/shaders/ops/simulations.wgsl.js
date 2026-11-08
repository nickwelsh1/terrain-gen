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
// 4. sim.phacelleErosion — Analytic Stacked-Gully & Gavoronoise Filter
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
    erosionMode: u32,        // 0 = Runevision Phacelle (2026), 1 = Classic Gavoronoise (Clay John / Fewes)
    cellScale: f32,
    normalization: f32,
    lacunarity: f32,
    gain: f32,
    detail: f32,
    laplacianWeight: f32,    // Post-erosion ridgeMap + Laplacian unsharp mask weight
    plateauRim: f32,         // Rim-wall & basin erosion focus modulation
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
    return 1.0 - pow(1.0 - clamp01(t), max(power, 0.001));
}

fn easeOut(t: f32) -> f32 {
    let v = 1.0 - clamp01(t);
    return 1.0 - v * v;
}

fn smoothStart(t: f32, smoothing: f32) -> f32 {
    if (smoothing <= 1e-4) { return t; }
    if (t >= smoothing) { return t - 0.5 * smoothing; }
    return 0.5 * t * t / max(smoothing, 1e-4);
}

fn safeNorm(v: vec2f) -> vec2f {
    let l = length(v);
    if (l > 1e-6) { return v / l; }
    return vec2f(0.0, 0.0);
}

@compute @workgroup_size(8, 8)
fn applyPhacelleErosion(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let h0 = hNorm(x, y);

    // Smoothed finite-difference gradient in normalized UV space (step = 3 cells ~ eps=0.024 in GLSL)
    let hL = hNorm(x - 3, y);
    let hR = hNorm(x + 3, y);
    let hU = hNorm(x, y - 3);
    let hD = hNorm(x, y + 3);
    let gx = (hR - hL) * (N_F / 6.0);
    let gy = (hD - hU) * (N_F / 6.0);

    let seedVec = vec2f(
        fract(params.seed * 0.1031) * 256.0 + 11.3,
        fract(params.seed * 0.0973) * 256.0 + 23.7
    );
    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let ep = uv * 0.85;

    let scale = clamp(params.erosionScale, 0.03, 0.45);
    let cellSc = clamp(select(params.cellScale, 0.62, params.cellScale <= 0.01), 0.25, 1.5);
    let normFactor = clamp(select(params.normalization, 0.65, params.normalization <= 0.01), 0.0, 1.0);
    let lac = clamp(select(params.lacunarity, 1.80, params.lacunarity <= 0.5), 1.2, 3.0);
    let gn = clamp(select(params.gain, 0.68, params.gain <= 0.05), 0.2, 0.9);
    let det = clamp(select(params.detail, 0.84, params.detail <= 0.05), 0.2, 2.5);
    let rimAmt = clamp(params.plateauRim, 0.0, 0.6);

    // Plateau-rim & cliff-wall erosion modulation (from GLSL erodedHeightAndRidge)
    let rimThresh = 0.42 + 0.14 * rimAmt;
    let slopeMag = length(vec2f(gx, gy));
    let inBasin = 1.0 - smoothstep(rimThresh - 0.06, rimThresh + 0.14, h0);
    let onRimWall = smoothstep(0.18, 0.75, slopeMag);
    let plateauMask = mix(1.0, clamp(max(inBasin, onRimWall * 0.85), 0.18, 1.0), rimAmt);

    let curAux = aux[idx];
    let influenceMask = clamp01(select(1.0, curAux.z, curAux.z > 0.001));
    let effStrength = params.erosionStrength * plateauMask * influenceMask;

    let baseHS = vec3f(h0, gx * 0.75, gy * 0.75);
    let octs = clamp(i32(params.erosionOctaves), 1, 6);

    var deltaNorm = 0.0;
    var ridgeMap = 0.0;

    if (params.erosionMode == 1u) {
        // MODE 1: Classic Clay John / Fewes Gavoronoise Frequency-Approach Erosion Filter
        let tiles = 1.0 / max(scale * cellSc * 1.35, 0.02);
        let slopeStrength = 1.6 + params.gullyWeight * 2.8;
        let branchStrength = 1.0 + det * 1.25;
        let dir = baseHS.zy * vec2f(1.0, -1.0) * slopeStrength;

        var hAcc = vec3f(0.0, 0.0, 0.0);
        var a = 0.5 * mix(1.0, smoothstep(0.10, 0.48, h0), clamp01(params.ridgeRounding * 2.2));
        var f = 1.0;

        for (var eo: i32 = 0; eo < octs; eo = eo + 1) {
            let octSeed = seedVec + vec2f(f32(eo) * 19.1, f32(eo) * 29.3);
            let branchDir = dir + hAcc.zy * vec2f(1.0, -1.0) * branchStrength;
            let er = gavoronoiseErosion(ep * tiles * f, branchDir, normFactor, octSeed);
            hAcc = hAcc + er * a * vec3f(1.0, f, f);
            a = a * gn;
            f = f * lac;
        }

        deltaNorm = hAcc.x * effStrength * 0.75;
        ridgeMap = clamp(hAcc.x * 1.4, -1.0, 1.0) * plateauMask;
    } else {
        // MODE 0: Runevision 2026 Advanced Terrain Erosion Filter (Phacelle Noise)
        var strength = effStrength * scale;
        var fadeTarget = clamp((h0 - 0.38) * 2.6 - rimAmt * inBasin * 0.85, -1.0, 1.0);
        var hAndS = baseHS;
        let safeScale = max(scale * cellSc, 0.005);
        var freq = 1.0 / safeScale;
        let slopeLength = max(length(baseHS.yz), 1e-6);
        var roundingMult = 1.0;

        // onset = vec4(1.25, 1.25, 2.8, 1.5), assumedSlope = vec2(assumedSlope, 0.78)
        let roundingForInput = mix(params.creaseRounding, params.ridgeRounding, clamp01(fadeTarget + 0.5)) * 0.1;
        var combiMask = easeOut(smoothStart(slopeLength * 1.25, roundingForInput * 1.25));
        var ridgeMapCombiMask = easeOut(slopeLength * 2.8);
        var ridgeMapFadeTarget = fadeTarget;
        var gullySlope = mix(baseHS.yz, (baseHS.yz / slopeLength) * max(params.assumedSlope, 0.2), 0.78);

        for (var eo: i32 = 0; eo < octs; eo = eo + 1) {
            let octSeed = seedVec + vec2f(f32(eo) * 17.3, f32(eo) * 31.7);
            let ph = phacelleNoiseSeeded(ep * freq, safeNorm(gullySlope), cellSc, 0.25, normFactor, octSeed);
            let pZw = ph.zw * (-freq);
            let sloping = abs(ph.y);

            // Straight gullies: sign(sin) fakes constant triangle-wave sides so child gullies branch cleanly
            let sgn = select(select(0.0, -1.0, ph.y < 0.0), 1.0, ph.y > 0.0);
            gullySlope = gullySlope + sgn * pZw * strength * params.gullyWeight;

            let octaveHS = vec3f(ph.x, ph.y * pZw.x, ph.y * pZw.y);
            let faded = mix(vec3f(fadeTarget, 0.0, 0.0), octaveHS * params.gullyWeight, combiMask);
            hAndS = hAndS + faded * strength;
            fadeTarget = faded.x;

            let roundingForOctave = mix(params.creaseRounding, params.ridgeRounding, clamp01(ph.x + 0.5)) * roundingMult;
            let newMask = easeOut(smoothStart(sloping * 1.25, roundingForOctave * 1.25));
            combiMask = powInv(combiMask, det) * newMask;

            ridgeMapFadeTarget = mix(ridgeMapFadeTarget, octaveHS.x, ridgeMapCombiMask);
            ridgeMapCombiMask = ridgeMapCombiMask * easeOut(sloping * 1.5);

            strength = strength * gn;
            freq = freq * lac;
            roundingMult = roundingMult * 2.0;
        }

        // Scale height delta (matching GLSL er.x * 2.4..3.2 coupling while staying proportional to relief)
        deltaNorm = (hAndS.x - baseHS.x) * 2.35;
        ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask) * plateauMask;
    }

    var hOut = h0 + deltaNorm;

    // Post-erosion ridgeMap-coupled Laplacian unsharp mask (from GLSL mainImage)
    if (abs(params.laplacianWeight) > 0.001) {
        let eps = 3.0 / N_F;
        let lapRaw = ((hL + hR + hU + hD) - 4.0 * h0) / eps;
        let lap = tanh((lapRaw - ridgeMap * 2.2) * 0.35);
        hOut = hOut - params.laplacianWeight * 0.085 * lap * influenceMask;
    }

    let outMeters = clamp(hOut * MAX_HEIGHT, 0.0, MAX_HEIGHT);
    dstHeights[idx] = toFixedHeight(outMeters);

    let erodedDepth = max(0.0, (h0 - hOut) * MAX_HEIGHT);
    aux[idx] = vec4f(curAux.x, curAux.y + erodedDepth * 0.25, curAux.z, clamp01(ridgeMap * 0.5 + 0.5));
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
