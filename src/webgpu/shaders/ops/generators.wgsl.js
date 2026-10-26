// WGSL compute shaders for Stage 1 Generators:
// 1. gen.ridgeFbm      — Tectonic multi-range fBm + ridged crests + domain warp
// 2. gen.duneField     — Aeolian sand dunes (Phacelle Y-junctions OR Warped-fBm,
//                        piecewise brink profile, Draa mega-dunes, wind shadow)
// 3. gen.voronoiBlock  — Multi-scale Voronoi fault blocks, mesas & canyons
// 4. gen.islandCaldera — Radial island / volcanic cone / caldera rim

import { AREA_M } from "../../constants.js";
import { COMMON_WGSL } from "../common.wgsl.js";

const AREA_M_F = `${AREA_M}.0`;

// =============================================================================
// 1. gen.ridgeFbm — Tectonic Multi-Range Ridges & fBm
// =============================================================================
export const GEN_RIDGE_FBM_SHADER = /* wgsl */`
${COMMON_WGSL}

struct RidgeFbmParams {
    baseHeight: f32,
    frequency: f32,
    octaves: f32,
    lacunarity: f32,
    gain: f32,
    ridgeWeight: f32,
    ridgeSharpness: f32,
    warpAmplitude: f32,
    warpFrequency: f32,
    secondRangeWeight: f32,
    secondRangeAngle: f32,
    heightCurve: f32,
    seed: f32,
    clearAux: u32,
};

@group(0) @binding(0) var<uniform> params: RidgeFbmParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn generateHeightmap(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let seed = params.seed;
    let freq = max(params.frequency, 0.25);
    let oct = clamp(i32(params.octaves), 1, 8);
    let lac = max(params.lacunarity, 1.2);
    let gain = clamp(params.gain, 0.1, 0.85);
    let sharp = max(params.ridgeSharpness, 0.5);

    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let nx = uv.x * freq;
    let ny = uv.y * freq;

    // Domain warp coordinates
    let wf = max(params.warpFrequency, 0.2);
    let wa = params.warpAmplitude;
    let warpX = (fbmEx(nx * wf + 50.0, ny * wf, seed + 13.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wa;
    let warpY = (fbmEx(nx * wf, ny * wf + 50.0, seed + 19.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wa;

    let wx = nx + warpX;
    let wy = ny + warpY;

    // Broad fBm elevation
    let baseFbm = fbmEx(wx, wy, seed, oct, lac, gain);

    // Primary mountain range (ridged multifractal)
    let ridge1 = ridgedEx(wx + 100.0, wy + 100.0, seed + 7.0, max(oct - 1, 2), lac, gain, sharp);

    // Secondary tectonic range at an intersecting angle
    let angRad = params.secondRangeAngle * PI / 180.0;
    let ca = cos(angRad);
    let sa = sin(angRad);
    let rx2 = wx * ca - wy * sa;
    let ry2 = wx * sa + wy * ca;
    let ridge2 = ridgedEx(rx2 * 0.85 + 210.0, ry2 * 0.85 + 140.0, seed + 41.0, max(oct - 1, 2), lac, gain, sharp);

    let combinedRidge = mix(ridge1, max(ridge1, ridge2 * 0.92), clamp01(params.secondRangeWeight));
    var h = mix(baseFbm, combinedRidge, clamp01(params.ridgeWeight));

    // Fine detail octave
    h = h + (fbmEx(wx * 2.2, wy * 2.2, seed + 23.0, 3, 2.0, 0.5) - 0.35) * 0.14;

    // Valley-flattening height curve
    let curve = max(params.heightCurve, 0.3);
    h = pow(clamp01(h), curve);

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, 0.0, 1.0, 0.0);
    }
}
`;

// =============================================================================
// 2. gen.duneField — Aeolian Sand Dunes (Phacelle Y-Junctions & Warped-fBm)
// =============================================================================
export const GEN_DUNE_FIELD_SHADER = /* wgsl */`
${COMMON_WGSL}

const WORLD_M : f32 = ${AREA_M_F};

struct DuneFieldParams {
    crestMode: u32,          // 0 = Phacelle (Y-junctions), 1 = Warped-fBm (Classic)
    duneHeight: f32,         // meters (e.g. 140)
    duneWavelength: f32,     // meters (e.g. 180)
    windDirection: f32,      // degrees (0..360)
    brinkPosition: f32,      // [0.55..0.90], default 0.74
    interduneFlatness: f32,  // [0.0..0.7], default 0.15
    draaHeight: f32,         // mega-dune height in meters (0..500)
    draaWavelength: f32,     // mega-dune spacing in meters (300..2500)
    draaAngleOffset: f32,    // degrees (-45..45)
    warpFrequency: f32,      // sinuous warp frequency
    warpAmplitude: f32,      // sinuous warp amplitude
    stossPower: f32,         // windward profile exponent
    leePower: f32,           // slip-face exponent
    angleOfRepose: f32,      // degrees (28..38)
    rippleFrequency: f32,    // wind ripple frequency
    rippleAmplitude: f32,    // wind ripple height in meters
    shadowAngle: f32,        // degrees (8..22) wind shadow cone
    seed: f32,
    writeSediment: u32,
};

@group(0) @binding(0) var<uniform> params: DuneFieldParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

// Piecewise asymmetric windward / sharp-brink / slip-face profile.
// Returns vec2f(height01, isSlipFace01).
fn asymmetricDuneProfile(phase01: f32, brink: f32, stossPow: f32, leePow: f32) -> vec2f {
    let b = clamp(brink, 0.52, 0.90);
    let f = fract(phase01);
    if (f < b) {
        let x = clamp(f / b, 0.0, 1.0);
        // Convex windward rise with non-zero slope at the brink
        let w = x * x * (2.0 - x);
        let h = pow(clamp(w, 0.0001, 1.0), max(stossPow, 0.35));
        return vec2f(h, 0.0);
    } else {
        let y = clamp((f - b) / max(1.0 - b, 0.05), 0.0, 1.0);
        let oy = 1.0 - y;
        // Sharp brink dropping along steep leeward slip face
        let s = pow(clamp(oy, 0.0, 1.0), max(leePow, 0.8));
        return vec2f(s, 1.0);
    }
}

// Evaluates dune height and slip-face indicator at world coordinates (meters).
fn evaluateDuneSystem(worldPosM: vec2f, windRad: f32) -> vec3f {
    let seed = params.seed;
    let windDir = vec2f(cos(windRad), sin(windRad));
    // Stripe direction is perpendicular to wind so crests run across the wind
    let crestDir = vec2f(-windDir.y, windDir.x);

    let uv = worldPosM / WORLD_M;
    let warpFreq = max(params.warpFrequency, 0.2);
    let warpAmp = params.warpAmplitude;
    let warpVec = vec2f(
        (fbmEx(uv.x * warpFreq * 4.0 + 37.0, uv.y * warpFreq * 4.0, seed + 13.0, 3, 2.0, 0.5) - 0.5) * warpAmp,
        (fbmEx(uv.x * warpFreq * 4.0, uv.y * warpFreq * 4.0 + 73.0, seed + 19.0, 3, 2.0, 0.5) - 0.5) * warpAmp
    );
    let warpedUv = uv + warpVec * 0.25;
    let warpedWorldM = warpedUv * WORLD_M;

    // 1. Primary Draa (Mega-dune) underlying wave
    var draaMeters = 0.0;
    if (params.draaHeight > 0.5) {
        let draaRad = windRad + params.draaAngleOffset * PI / 180.0;
        let draaWind = vec2f(cos(draaRad), sin(draaRad));
        let draaWaveM = max(params.draaWavelength, 250.0);
        let draaDownwind = dot(warpedWorldM, draaWind) / draaWaveM;
        let draaPhase = fract(draaDownwind + seed * 0.07);
        let draaProf = asymmetricDuneProfile(draaPhase, clamp(params.brinkPosition + 0.04, 0.55, 0.90), params.stossPower, params.leePower);
        draaMeters = draaProf.x * params.draaHeight;
    }

    // 2. Secondary Meso-Dune Field (Phacelle Y-junctions OR Warped-fBm)
    let waveM = max(params.duneWavelength, 30.0);
    let cyclesPerTile = WORLD_M / waveM;

    var dunePhase = 0.0;
    var defectEnvelope = 1.0;

    if (params.crestMode == 0u) {
        // Mode 0: Phacelle phase-defect ridges -> natural Y-junction merges & splits
        let cellDensity = max(cyclesPerTile * 0.35, 2.0);
        let seedOff = vec2f(fract(seed * 0.1031) * 64.0, fract(seed * 0.0973) * 64.0);
        let ph = phacelleNoise(warpedUv * cellDensity + seedOff, crestDir, 1.0 / 0.35, 0.0, 0.45, true);
        let mag = length(ph.xy);
        // Phase in [0, 1) oriented downwind
        let angle = atan2(ph.y, ph.x);
        dunePhase = fract(angle / TAU + 0.5);
        // Smoothly taper dune crest height at Y-junction defect cores (barchan horns)
        defectEnvelope = smoothstep(0.08, 0.55, mag);
    } else {
        // Mode 1: Classic Sinuous Warped-fBm Ridges
        let downwindM = dot(warpedWorldM, windDir);
        let crosswindM = dot(warpedWorldM, crestDir);
        let meander = (fbmEx(crosswindM / (waveM * 2.5), downwindM / (waveM * 4.0), seed + 29.0, 4, 2.0, 0.5) - 0.5) * warpAmp * 2.2;
        dunePhase = fract(downwindM / waveM + meander);
        let ridgeMod = 0.65 + 0.35 * fbmEx(warpedUv.x * 3.0, warpedUv.y * 3.0, seed + 5.0, 3, 2.0, 0.5);
        defectEnvelope = ridgeMod;
    }

    let prof = asymmetricDuneProfile(dunePhase, params.brinkPosition, params.stossPower, params.leePower);
    var rawDune01 = prof.x * defectEnvelope;

    // Interdune corridor flattening (exposes flat gravel/bedrock corridors between barchans)
    let flat = clamp(params.interduneFlatness, 0.0, 0.75);
    if (flat > 0.001) {
        rawDune01 = clamp01((rawDune01 - flat) / (1.0 - flat));
    }

    // Angle-of-repose geometric ceiling: a dune of wavelength waveM and lee fraction (1 - brink)
    // cannot exceed tan(repose) * waveM * (1 - brink) without avalanching.
    let reposeRad = clamp(params.angleOfRepose, 25.0, 42.0) * PI / 180.0;
    let leeRunM = waveM * max(1.0 - params.brinkPosition, 0.12);
    let maxReposeHeightM = tan(reposeRad) * leeRunM * 1.35;
    let effDuneHeightM = min(params.duneHeight, maxReposeHeightM);

    let mesoMeters = rawDune01 * effDuneHeightM;
    return vec3f(draaMeters + mesoMeters, prof.y, rawDune01);
}

@compute @workgroup_size(8, 8)
fn generateDunes(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let windRad = params.windDirection * PI / 180.0;
    let windDir = vec2f(cos(windRad), sin(windRad));
    let crestDir = vec2f(-windDir.y, windDir.x);

    let worldPosM = vec2f(f32(x) * CELL_M, f32(y) * CELL_M);
    let centerEval = evaluateDuneSystem(worldPosM, windRad);
    var hMeters = centerEval.x;
    let isSlipFace = centerEval.y;
    let sandCover01 = centerEval.z;

    // Upwind wind-shadow ray-march (8 steps along -windDir)
    let shadowTan = tan(clamp(params.shadowAngle, 6.0, 25.0) * PI / 180.0);
    let stepDistM = max(CELL_M * 1.5, params.duneWavelength * 0.06);
    var maxUpwindSlope = 0.0;
    for (var s: i32 = 1; s <= 6; s = s + 1) {
        let distM = f32(s) * stepDistM;
        let samplePosM = worldPosM - windDir * distM;
        let upEval = evaluateDuneSystem(samplePosM, windRad);
        let riseSlope = (upEval.x - hMeters) / distM;
        maxUpwindSlope = max(maxUpwindSlope, riseSlope);
    }
    let inWindShadow = smoothstep(shadowTan * 0.75, shadowTan * 1.15, maxUpwindSlope);

    // Wind ripples on exposed windward stoss faces (suppressed on slip faces and in lee shadow)
    if (params.rippleAmplitude > 0.001) {
        let rippleGate = (1.0 - isSlipFace) * (1.0 - inWindShadow) * smoothstep(0.02, 0.18, sandCover01);
        let uv = worldPosM / WORLD_M;
        let rFreq = max(params.rippleFrequency, 4.0) * 6.0;
        let rCoord = dot(uv, windDir) * rFreq + (fbmEx(uv.x * 16.0, uv.y * 16.0, params.seed + 31.0, 2, 2.0, 0.5) - 0.5) * 1.5;
        let rPhase = fract(rCoord);
        // Asymmetric micro-ripple sawtooth
        let rippleWave = select((1.0 - rPhase) / 0.3, rPhase / 0.7, rPhase < 0.7);
        hMeters = hMeters + rippleWave * params.rippleAmplitude * rippleGate;
    }

    heights[idx] = toFixedHeight(hMeters);

    if (params.writeSediment != 0u) {
        let prev = aux[idx];
        aux[idx] = vec4f(prev.x, hMeters * clamp01(sandCover01), prev.z, inWindShadow);
    }
}
`;

// =============================================================================
// 3. gen.voronoiBlock — Multi-Scale Voronoi Fault Blocks, Mesas & Canyons
// =============================================================================
export const GEN_VORONOI_BLOCK_SHADER = /* wgsl */`
${COMMON_WGSL}

struct VoronoiBlockParams {
    baseHeight: f32,
    cellScale: f32,
    blockRelief: f32,
    canyonWidth: f32,
    canyonDepth: f32,
    jitter: f32,
    blockTilt: f32,
    fractureOctaves: f32,
    warpAmplitude: f32,
    roughness: f32,
    seed: f32,
    clearAux: u32,
};

@group(0) @binding(0) var<uniform> params: VoronoiBlockParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn generateVoronoiBlocks(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let seed = params.seed;
    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let scale = max(params.cellScale, 0.5);

    // Organic domain warp so fault lines and canyons meander like real river gorges
    let warpAmp = params.warpAmplitude;
    let wx = (fbmEx(uv.x * 3.5 + 19.0, uv.y * 3.5, seed + 11.0, 3, 2.0, 0.5) - 0.5) * warpAmp;
    let wy = (fbmEx(uv.x * 3.5, uv.y * 3.5 + 47.0, seed + 23.0, 3, 2.0, 0.5) - 0.5) * warpAmp;
    let p = (uv + vec2f(wx, wy)) * scale;

    // Macro Voronoi tectonic blocks
    let v1 = voronoi2D(p, clamp01(params.jitter), seed);
    let edgeDist1 = v1.y; // F2 - F1 (0 along cell boundary / canyon fault)
    let blockHeight1 = v1.z;
    let tilt1 = v1.w * params.blockTilt;

    let cWidth = max(params.canyonWidth, 0.02);
    let canyonWall = smoothstep(0.0, cWidth, edgeDist1);

    // Plateau elevation with tilted fault block top
    var h = mix(0.35, blockHeight1, clamp01(params.blockRelief)) + tilt1;

    // Carve primary fault canyons along F2 - F1 boundaries
    h = h * mix(1.0 - clamp01(params.canyonDepth), 1.0, canyonWall);

    // Secondary & tertiary fracture octaves (jointing / side canyons)
    let octs = clamp(i32(params.fractureOctaves), 1, 3);
    if (octs >= 2) {
        let v2 = voronoi2D(p * 2.3 + vec2f(13.7, 29.1), clamp01(params.jitter), seed + 37.0);
        let wall2 = smoothstep(0.0, cWidth * 0.85, v2.y);
        h = h * mix(1.0 - clamp01(params.canyonDepth) * 0.45, 1.0, wall2);
        h = h + (v2.z - 0.5) * 0.12 * params.blockRelief;
    }
    if (octs >= 3) {
        let v3 = voronoi2D(p * 5.2 + vec2f(71.3, 11.9), clamp01(params.jitter), seed + 83.0);
        let crack = smoothstep(0.0, cWidth * 0.65, v3.y);
        h = h * mix(0.82, 1.0, crack);
    }

    // Surface fBm roughness
    let rough = (fbmEx(uv.x * 6.0, uv.y * 6.0, seed + 101.0, 5, 2.0, 0.5) - 0.4) * params.roughness;
    h = clamp01(h + rough);

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, 0.0, canyonWall, 0.0);
    }
}
`;

// =============================================================================
// 4. gen.islandCaldera — Radial Island, Volcanic Cone & Caldera Rim
// =============================================================================
export const GEN_ISLAND_CALDERA_SHADER = /* wgsl */`
${COMMON_WGSL}

struct IslandCalderaParams {
    baseHeight: f32,
    islandRadius: f32,
    calderaRadius: f32,
    calderaDepth: f32,
    coastWarp: f32,
    rimSharpness: f32,
    radialGullies: f32,
    falloffMix: f32,
    seed: f32,
    clearAux: u32,
};

@group(0) @binding(0) var<uniform> params: IslandCalderaParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn generateIslandCaldera(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let seed = params.seed;
    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let centered = (uv - vec2f(0.5, 0.5)) * 2.0; // [-1, 1]

    // Domain warp coastline
    let wAmp = params.coastWarp;
    let wx = (fbmEx(uv.x * 3.5 + 17.0, uv.y * 3.5, seed + 11.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wy = (fbmEx(uv.x * 3.5, uv.y * 3.5 + 43.0, seed + 29.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wp = centered + vec2f(wx, wy);

    let rRadial = length(wp);
    let rSquare = max(abs(wp.x), abs(wp.y));
    let r = mix(rSquare, rRadial, clamp01(params.falloffMix));

    let maxR = max(params.islandRadius, 0.15);
    let cRad = clamp(params.calderaRadius, 0.0, maxR * 0.85);

    // Outer volcanic flank rising from coastline (r = maxR) toward caldera rim (r = cRad)
    let flankT = clamp01((maxR - r) / max(maxR - cRad, 0.05));
    var cone = pow(flankT, max(params.rimSharpness * 0.65, 0.4));

    // Inner caldera crater depression for r < cRad
    if (cRad > 0.01 && r < cRad) {
        let innerT = clamp01(r / cRad);
        let bowl = smoothstep(0.0, 1.0, innerT);
        cone = mix(1.0 - clamp01(params.calderaDepth), 1.0, bowl);
    }

    // Radial volcanic barranco gullies radiating from the cone center
    let angle = atan2(wp.y, wp.x);
    let radialWave = abs(sin(angle * 14.0 + fbmEx(uv.x * 5.0, uv.y * 5.0, seed + 61.0, 3, 2.0, 0.5) * 4.0));
    let gullyFactor = mix(1.0, 0.72 + 0.28 * radialWave, clamp01(params.radialGullies) * flankT * (1.0 - flankT * 0.5));

    // Mountain ridge texture
    let noiseTex = ridgedEx(uv.x * 4.5, uv.y * 4.5, seed + 5.0, 5, 2.0, 0.5, 1.8);
    var h = cone * gullyFactor * (0.65 + 0.35 * noiseTex);
    h = clamp01(h);

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, 0.0, clamp01(flankT), 0.0);
    }
}
`;
