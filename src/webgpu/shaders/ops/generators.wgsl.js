// WGSL compute shaders for Stage 1 Generators (Upgraded with Geological Landform Modes):
// 1. gen.ridgeFbm      — Modes: 0=Tectonic Range (Himalayas), 1=Tabular Massif (Dolomites), 2=Karst Towers (Zhangjiajie)
// 2. gen.duneField     — Modes: 0=Phacelle Y-junctions, 1=Warped Transverse, 2=Isolated Barchans (Sudan), 3=Star Dunes (Namib)
//                        + spatial size/spacing modulation + resolution-adaptive windward ripples
// 3. gen.voronoiBlock  — Modes: 0=Dendritic Canyon (Grand Canyon/Island in the Sky), 1=Isolated Buttes (Monument Valley/Mt Conner),
//                        2=Sheer Table Tepui (Roraima), 3=Beehive Karst Domes (Bungle Bungles)
// 4. gen.islandCaldera — Modes: 0=Volcanic Caldera Island, 1=Synclinal Amphitheater (Wilpena Pound)

import { AREA_M } from "../../constants.js";
import { COMMON_WGSL } from "../common.wgsl.js";

const AREA_M_F = `${AREA_M}.0`;

// =============================================================================
// 1. gen.ridgeFbm — Tectonic Ranges, Dolomite Massifs & Zhangjiajie Karst Towers
// =============================================================================
export const GEN_RIDGE_FBM_SHADER = /* wgsl */`
${COMMON_WGSL}

struct RidgeFbmParams {
    landformMode: u32,       // 0 = Tectonic Range (Himalayas), 1 = Dolomite Massif, 2 = Karst Towers (Zhangjiajie)
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
    scaleVariation: f32,     // [0..1] breaks up repetitive ridge spacing
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
    let baseFreq = max(params.frequency, 0.25);
    let oct = clamp(i32(params.octaves), 1, 8);
    let lac = max(params.lacunarity, 1.2);
    let gain = clamp(params.gain, 0.1, 0.85);
    let sharp = max(params.ridgeSharpness, 0.5);
    let scaleVar = clamp01(params.scaleVariation);

    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);

    // Low-frequency spatial modulation of scale & amplitude to prevent repetitive noise
    let macroMod = fbmEx(uv.x * 1.3 + 11.0, uv.y * 1.3 + 29.0, seed + 5.0, 3, 2.0, 0.5);
    let localFreqMult = mix(1.0, 0.65 + 0.75 * macroMod, scaleVar);
    let ampEnvelope = mix(1.0, 0.45 + 0.85 * smoothstep(0.2, 0.8, macroMod), scaleVar);

    let nx = uv.x * baseFreq * localFreqMult;
    let ny = uv.y * baseFreq * localFreqMult;

    let wf = max(params.warpFrequency, 0.2);
    let wa = params.warpAmplitude;
    let warpX = (fbmEx(nx * wf + 50.0, ny * wf, seed + 13.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wa;
    let warpY = (fbmEx(nx * wf, ny * wf + 50.0, seed + 19.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wa;
    let wx = nx + warpX;
    let wy = ny + warpY;

    var h = 0.0;
    var initSediment = 0.0;

    if (params.landformMode == 1u) {
        // MODE 1: Tabular Carbonate Massif (Alpine Dolomites — Tre Cime / Seceda / Tofane)
        // Massive uplifted reef blocks separated by deep glacial saddles, with a 33° scree apron
        // at the base and sheer vertical dolomitic cliff walls crowned by jagged spires (torri).
        let mUv = uv * max(baseFreq * 0.55, 0.8) + vec2f(warpX * 0.4, warpY * 0.4);
        let vMassif = voronoi2D(mUv, 0.85, seed + 17.0);
        let ridgeSpine = ridgedEx(wx * 0.65 + 40.0, wy * 0.65 + 40.0, seed + 7.0, 5, lac, gain, sharp);
        let massifCore = clamp01((1.0 - vMassif.x * 0.95) * 0.55 + ridgeSpine * 0.65);

        // Valley floor & broad dolomitic scree apron [0.0 .. 0.42]
        let valleyBase = fbmEx(wx * 0.5, wy * 0.5, seed + 3.0, 4, 2.0, 0.5) * 0.22;
        let screeApron = smoothstep(0.18, 0.48, massifCore) * 0.34;

        // Sheer vertical carbonate cliff wall [0.46 .. 0.56] jumping up to the massif summit
        let cliffWall = smoothstep(0.44, 0.55, massifCore);
        // Jagged dolomitic towers (torri), clefts, and inclined bedding ledges on the massif top
        let spires = ridgedEx(wx * 2.4, wy * 2.4, seed + 71.0, 5, 2.1, 0.55, max(sharp * 1.3, 2.5));
        let strataBenches = floor(spires * 6.0) / 6.0 * 0.25 + spires * 0.75;

        h = valleyBase + screeApron + cliffWall * (0.42 + 0.36 * strataBenches);
        h = clamp01(h * (0.85 + 0.3 * ampEnvelope));
        // Mark scree apron in sediment channel for authentic talus coloring & repose
        initSediment = screeApron * (1.0 - cliffWall) * params.baseHeight * 0.18;
    } else if (params.landformMode == 2u) {
        // MODE 2: Fenglin Limestone / Sandstone Karst Pillars (Zhangjiajie / Guilin)
        // Clustered vertical-walled rock pillars and towers rising out of deep dissolution ravines.
        let kScale = max(baseFreq * 1.6, 2.5);
        let kp = (uv + vec2f(warpX * 0.15, warpY * 0.15)) * kScale;
        let v1 = voronoi2D(kp, 0.9, seed + 31.0);
        let v2 = voronoi2D(kp * 2.1 + vec2f(17.3, 9.1), 0.85, seed + 67.0);

        // Pillar silhouette: steep vertical column inside each cell where cellHash > threshold
        let pillarPresence = smoothstep(0.22, 0.75, v1.z * 0.7 + macroMod * 0.3);
        let pillarRadius = 0.28 + 0.22 * v1.z;
        let columnWall1 = 1.0 - smoothstep(pillarRadius * 0.45, pillarRadius, v1.x);
        let columnWall2 = 1.0 - smoothstep(0.18, 0.42, v2.x);

        // Steep-sided tower with horizontal bedding notches and craggy vegetated crown
        let towerRaw = max(columnWall1, columnWall2 * 0.75) * pillarPresence;
        let steepTower = smoothstep(0.12, 0.38, towerRaw) * (0.65 + 0.35 * pow(towerRaw, 0.6));
        let crownCrags = ridgedEx(wx * 3.0, wy * 3.0, seed + 97.0, 4, 2.0, 0.5, 2.2) * 0.22;
        let valleyMistFloor = fbmEx(wx * 0.6, wy * 0.6, seed + 11.0, 4, 2.0, 0.5) * 0.16;

        h = clamp01(valleyMistFloor + steepTower * (0.68 + 0.32 * v1.z) + steepTower * crownCrags);
    } else {
        // MODE 0: Tectonic High-Mountain Range (Himalayas / Karakoram / Alps)
        let baseFbm = fbmEx(wx, wy, seed, oct, lac, gain);
        let ridge1 = ridgedEx(wx + 100.0, wy + 100.0, seed + 7.0, max(oct - 1, 2), lac, gain, sharp);

        let angRad = params.secondRangeAngle * PI / 180.0;
        let ca = cos(angRad);
        let sa = sin(angRad);
        let rx2 = wx * ca - wy * sa;
        let ry2 = wx * sa + wy * ca;
        let ridge2 = ridgedEx(rx2 * 0.85 + 210.0, ry2 * 0.85 + 140.0, seed + 41.0, max(oct - 1, 2), lac, gain, sharp);

        let combinedRidge = mix(ridge1, max(ridge1, ridge2 * 0.94), clamp01(params.secondRangeWeight));
        let rawMix = mix(baseFbm, combinedRidge, clamp01(params.ridgeWeight));

        // Fine craggy detail
        let fine = (fbmEx(wx * 2.4, wy * 2.4, seed + 23.0, 4, 2.0, 0.5) - 0.38) * 0.16;

        // Normalize raw noise range (~[0.12, 0.78]) into full [0, 1] before applying heightCurve
        // so that peaks genuinely reach baseHeight instead of being crushed to 25%!
        let normalized = clamp01((rawMix + fine - 0.10) / 0.68) * ampEnvelope;
        let curve = max(params.heightCurve, 0.3);
        h = clamp01(pow(clamp01(normalized), curve) * 1.15);
    }

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, initSediment, 1.0, 0.0);
    }
}
`;

// =============================================================================
// 2. gen.duneField — 4 Dune Morphologies, Spatial Variation & Stoss Ripples
// =============================================================================
export const GEN_DUNE_FIELD_SHADER = /* wgsl */`
${COMMON_WGSL}

const WORLD_M : f32 = ${AREA_M_F};

struct DuneFieldParams {
    crestMode: u32,          // 0=Phacelle Y-junctions, 1=Warped Transverse, 2=Isolated Barchans (Sudan), 3=Star Dunes (Namib)
    duneHeight: f32,
    duneWavelength: f32,
    windDirection: f32,
    brinkPosition: f32,
    interduneFlatness: f32,
    draaHeight: f32,
    draaWavelength: f32,
    draaAngleOffset: f32,
    warpFrequency: f32,
    warpAmplitude: f32,
    stossPower: f32,
    leePower: f32,
    angleOfRepose: f32,
    rippleFrequency: f32,
    rippleAmplitude: f32,
    shadowAngle: f32,
    sizeVariation: f32,      // [0..1] breaks up uniform wavelength & height across the desert
    seed: f32,
    writeSediment: u32,
};

@group(0) @binding(0) var<uniform> params: DuneFieldParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;
@group(0) @binding(2) var<storage, read_write> aux: array<vec4f>;

fn asymmetricDuneProfile(phase01: f32, brink: f32, stossPow: f32, leePow: f32) -> vec2f {
    let b = clamp(brink, 0.52, 0.90);
    let f = fract(phase01);
    if (f < b) {
        let x = clamp(f / b, 0.0, 1.0);
        let w = x * x * (2.0 - x);
        let h = pow(clamp(w, 0.0001, 1.0), max(stossPow, 0.35));
        return vec2f(h, 0.0);
    } else {
        let y = clamp((f - b) / max(1.0 - b, 0.05), 0.0, 1.0);
        let oy = 1.0 - y;
        let s = pow(clamp(oy, 0.0, 1.0), max(leePow, 0.8));
        return vec2f(s, 1.0);
    }
}

// Evaluates a single isolated barchan crescent inside a cell:
// u = downwind in [-1, 1], v = crosswind in [-1, 1]
fn evaluateBarchanCrescent(u: f32, v: f32, brink: f32, hornLength: f32) -> vec2f {
    // Parabolic brink line curving downwind toward the lateral horns (v = +-1)
    let hornShift = v * v * hornLength;
    let uShifted = u - hornShift;
    let lateralTaper = clamp01(1.0 - v * v * 1.15);
    if (lateralTaper <= 0.001) {
        return vec2f(0.0, 0.0);
    }
    // Map uShifted in [-0.75, 0.65] into [0, 1] dune profile phase
    let normU = (uShifted + 0.75) / 1.4;
    if (normU <= 0.0 || normU >= 1.0) {
        return vec2f(0.0, 0.0);
    }
    let prof = asymmetricDuneProfile(normU, brink, 1.1, 1.9);
    let longitudinalTaper = sin(clamp01(normU) * PI);
    let h = prof.x * lateralTaper * lateralTaper * smoothstep(0.0, 0.25, longitudinalTaper);
    return vec2f(h, prof.y);
}

fn evaluateDuneSystem(worldPosM: vec2f, windRad: f32) -> vec3f {
    let seed = params.seed;
    let windDir = vec2f(cos(windRad), sin(windRad));
    let crestDir = vec2f(-windDir.y, windDir.x);

    let uv = worldPosM / WORLD_M;
    let sizeVar = clamp01(params.sizeVariation);

    // Multi-scale spatial variation in sand supply, dune height, and spacing
    let supplyNoise = fbmEx(uv.x * 1.6 + 19.0, uv.y * 1.6 + 43.0, seed + 3.0, 3, 2.0, 0.5);
    let scaleNoise = fbmEx(uv.x * 0.9 + 83.0, uv.y * 0.9 + 17.0, seed + 9.0, 2, 2.0, 0.5);
    let localHeightMult = mix(1.0, 0.25 + 1.25 * smoothstep(0.18, 0.82, supplyNoise), sizeVar);
    let localWaveMult = mix(1.0, 0.68 + 0.72 * scaleNoise, sizeVar * 0.75);

    let warpFreq = max(params.warpFrequency, 0.2);
    let warpAmp = params.warpAmplitude;
    let warpVec = vec2f(
        (fbmEx(uv.x * warpFreq * 3.5 + 37.0, uv.y * warpFreq * 3.5, seed + 13.0, 3, 2.0, 0.5) - 0.5) * warpAmp,
        (fbmEx(uv.x * warpFreq * 3.5, uv.y * warpFreq * 3.5 + 73.0, seed + 19.0, 3, 2.0, 0.5) - 0.5) * warpAmp
    );
    let warpedUv = uv + warpVec * 0.28;
    let warpedWorldM = warpedUv * WORLD_M;

    // 1. Primary Draa (Mega-dune) underlying wave + rocky/gravel desert floor undulation
    var draaMeters = (fbmEx(uv.x * 2.2, uv.y * 2.2, seed + 61.0, 4, 2.0, 0.5) - 0.35) * 14.0;
    if (params.draaHeight > 0.5) {
        let draaRad = windRad + params.draaAngleOffset * PI / 180.0;
        let draaWind = vec2f(cos(draaRad), sin(draaRad));
        let draaWaveM = max(params.draaWavelength, 250.0) * localWaveMult;
        let draaDownwind = dot(warpedWorldM, draaWind) / draaWaveM;
        let draaPhase = fract(draaDownwind + seed * 0.07);
        let draaProf = asymmetricDuneProfile(draaPhase, clamp(params.brinkPosition + 0.04, 0.55, 0.90), params.stossPower, params.leePower);
        draaMeters = max(0.0, draaMeters) + draaProf.x * params.draaHeight * (0.55 + 0.65 * supplyNoise);
    }

    let waveM = max(params.duneWavelength * localWaveMult, 30.0);
    let cyclesPerTile = WORLD_M / waveM;

    var rawDune01 = 0.0;
    var isSlipFace = 0.0;

    if (params.crestMode == 2u) {
        // MODE 2: Isolated Barchan Crescents & Variable Dune Trains (Sudan / Nubian Desert)
        // Overlapping staggered cellular grid of individual crescent dunes with varying sizes
        let downwindM = dot(worldPosM, windDir);
        let crosswindM = dot(worldPosM, crestDir);
        let cellSizeM = max(params.duneWavelength * 1.35, 60.0);
        let bGrid = vec2f(downwindM / cellSizeM, crosswindM / cellSizeM);
        let bInt = floor(bGrid);
        let bFrac = fract(bGrid);

        for (var dj: i32 = -1; dj <= 1; dj = dj + 1) {
            for (var di: i32 = -1; di <= 1; di = di + 1) {
                let cellId = bInt + vec2f(f32(di), f32(dj));
                let rnd = hash22f(cellId + vec2f(seed * 3.1, seed * 7.3));
                let sizeHash = hash2(vec2u(u32(max(cellId.x + 512.0, 0.0)), u32(max(cellId.y + 512.0, 0.0))));

                // Skip some cells so barchans form natural clusters and open desert corridors
                if (sizeHash < params.interduneFlatness * 0.85) { continue; }

                let duneScale = mix(0.45, 1.35, sizeHash);
                let centerOffset = vec2f(f32(di), f32(dj)) + vec2f(0.5, 0.5) + rnd * 0.32;
                let rel = (bFrac - centerOffset) / max(duneScale, 0.4);
                let hornLen = 0.55 + 0.35 * (rnd.x * 0.5 + 0.5);
                let bEval = evaluateBarchanCrescent(rel.x * 1.4, rel.y * 1.35, params.brinkPosition, hornLen);
                let candH = bEval.x * duneScale * localHeightMult;
                if (candH > rawDune01) {
                    rawDune01 = candH;
                    isSlipFace = bEval.y;
                }
            }
        }
    } else if (params.crestMode == 3u) {
        // MODE 3: Pyramidal Star Dunes (Namib / Grand Erg Oriental)
        // 3 intersecting wind directions forming radiating sinuous crest arms that peak at star junctions
        var armSum = 0.0;
        var armMax = 0.0;
        var slipAcc = 0.0;
        let angles = array<f32, 3>(0.0, 2.05, -2.05);
        let weights = array<f32, 3>(1.0, 0.78, 0.72);

        for (var a: i32 = 0; a < 3; a = a + 1) {
            let aRad = windRad + angles[a];
            let aDir = vec2f(-sin(aRad), cos(aRad));
            let cellDensity = max(cyclesPerTile * 0.32, 2.0);
            let seedOff = vec2f(f32(a) * 31.7 + seed * 0.13, f32(a) * 19.3 + seed * 0.09);
            let ph = phacelleNoise(warpedUv * cellDensity + seedOff, aDir, 1.0 / 0.35, 0.0, 0.55, true);
            let angle = atan2(ph.y, ph.x);
            let phase = fract(angle / TAU + 0.5);
            let prof = asymmetricDuneProfile(phase, 0.62, params.stossPower, params.leePower);
            let env = smoothstep(0.05, 0.55, length(ph.xy));
            let armH = prof.x * env * weights[a];
            armSum = armSum + armH;
            if (armH > armMax) {
                armMax = armH;
                slipAcc = prof.y;
            }
        }
        // Star peak boost where 2 or 3 arms intersect
        rawDune01 = (armMax * 0.65 + pow(clamp01(armSum * 0.48), 1.4) * 0.65) * localHeightMult;
        isSlipFace = slipAcc;
    } else if (params.crestMode == 0u) {
        // MODE 0: Barchanoid Phacelle Phase-Defect Ridges (Y-junctions)
        let cellDensity = max(cyclesPerTile * 0.35, 2.0);
        let seedOff = vec2f(fract(seed * 0.1031) * 64.0, fract(seed * 0.0973) * 64.0);
        let ph = phacelleNoise(warpedUv * cellDensity + seedOff, crestDir, 1.0 / 0.35, 0.0, 0.45, true);
        let mag = length(ph.xy);
        let angle = atan2(ph.y, ph.x);
        let dunePhase = fract(angle / TAU + 0.5);
        let defectEnvelope = smoothstep(0.08, 0.55, mag);
        let prof = asymmetricDuneProfile(dunePhase, params.brinkPosition, params.stossPower, params.leePower);
        rawDune01 = prof.x * defectEnvelope * localHeightMult;
        isSlipFace = prof.y;
    } else {
        // MODE 1: Classic Sinuous Warped-fBm Ridges
        let downwindM = dot(warpedWorldM, windDir);
        let crosswindM = dot(warpedWorldM, crestDir);
        let meander = (fbmEx(crosswindM / (waveM * 2.5), downwindM / (waveM * 4.0), seed + 29.0, 4, 2.0, 0.5) - 0.5) * warpAmp * 2.2;
        let dunePhase = fract(downwindM / waveM + meander);
        let ridgeMod = 0.55 + 0.45 * fbmEx(warpedUv.x * 3.0, warpedUv.y * 3.0, seed + 5.0, 3, 2.0, 0.5);
        let prof = asymmetricDuneProfile(dunePhase, params.brinkPosition, params.stossPower, params.leePower);
        rawDune01 = prof.x * ridgeMod * localHeightMult;
        isSlipFace = prof.y;
    }

    // Interdune corridor flattening (exposes flat gravel/bedrock corridors)
    let flat = clamp(params.interduneFlatness, 0.0, 0.75);
    if (flat > 0.001 && params.crestMode != 2u) {
        rawDune01 = clamp01((rawDune01 - flat) / (1.0 - flat));
    }

    let reposeRad = clamp(params.angleOfRepose, 25.0, 42.0) * PI / 180.0;
    let leeRunM = waveM * max(1.0 - params.brinkPosition, 0.12);
    let maxReposeHeightM = tan(reposeRad) * leeRunM * 1.45;
    let effDuneHeightM = min(params.duneHeight, maxReposeHeightM);

    let mesoMeters = rawDune01 * effDuneHeightM;
    return vec3f(max(0.0, draaMeters + mesoMeters), isSlipFace, rawDune01);
}

@compute @workgroup_size(8, 8)
fn generateDunes(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let windRad = params.windDirection * PI / 180.0;
    let windDir = vec2f(cos(windRad), sin(windRad));

    let worldPosM = vec2f(f32(x) * CELL_M, f32(y) * CELL_M);
    let centerEval = evaluateDuneSystem(worldPosM, windRad);
    var hMeters = centerEval.x;
    let isSlipFace = centerEval.y;
    let sandCover01 = centerEval.z;

    // Upwind wind-shadow ray-march
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

    // Resolution-adaptive windward stoss ripples:
    // Tied to grid cell spacing so ripples are never sub-pixel or Nyquist-aliased,
    // and scaled so they catch grazing sunlight on the windward slope!
    if (params.rippleAmplitude > 0.001) {
        let rippleGate = (1.0 - isSlipFace) * (1.0 - inWindShadow * 0.85) * smoothstep(0.01, 0.14, sandCover01);
        let uv = worldPosM / WORLD_M;
        // Keep ripple wavelength >= 3.2 cells so every ripple crest has a lit face and a shadowed face
        let maxSafeCycles = N_F / 3.2;
        let rCycles = clamp(params.rippleFrequency * 1.8, 12.0, maxSafeCycles);
        let rMeander = (fbmEx(uv.x * 14.0, uv.y * 14.0, params.seed + 31.0, 2, 2.0, 0.5) - 0.5) * 1.2;
        let rPhase = fract(dot(uv, windDir) * rCycles + rMeander);
        // Asymmetric wind-ripple profile (gentle stoss, steeper lee)
        let rippleWave = select((1.0 - rPhase) / 0.32, rPhase / 0.68, rPhase < 0.68);
        // Scale ripple relief with cell spacing so it produces visible surface normals at any zoom
        let effectiveRippleM = params.rippleAmplitude * max(1.0, CELL_M * 0.18);
        hMeters = hMeters + (rippleWave - 0.3) * effectiveRippleM * rippleGate;
    }

    heights[idx] = toFixedHeight(max(0.0, hMeters));

    if (params.writeSediment != 0u) {
        let prev = aux[idx];
        aux[idx] = vec4f(prev.x, max(4.0, hMeters * clamp01(sandCover01 + 0.15)), prev.z, inWindShadow);
    }
}
`;

// =============================================================================
// 3. gen.voronoiBlock — Dendritic Canyons, Isolated Buttes, Tepuis & Beehive Domes
// =============================================================================
export const GEN_VORONOI_BLOCK_SHADER = /* wgsl */`
${COMMON_WGSL}

struct VoronoiBlockParams {
    formationMode: u32,      // 0=Dendritic Canyon (Grand Canyon), 1=Isolated Buttes (Monument Valley), 2=Table Tepui (Roraima), 3=Beehive Domes (Bungle Bungles)
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
    let warpAmp = params.warpAmplitude;

    let wx = (fbmEx(uv.x * 2.8 + 19.0, uv.y * 2.8, seed + 11.0, 4, 2.0, 0.5) - 0.5) * warpAmp;
    let wy = (fbmEx(uv.x * 2.8, uv.y * 2.8 + 47.0, seed + 23.0, 4, 2.0, 0.5) - 0.5) * warpAmp;
    let wUv = uv + vec2f(wx, wy);

    var h = 0.0;
    var initSediment = 0.0;
    var maskOut = 1.0;

    if (params.formationMode == 0u) {
        // MODE 0: Dendritic Trunk & Tributary Gorge (Grand Canyon / Island in the Sky)
        // A sinuous meandering main river canyon with branching multi-scale side gorges
        // incised through a compound cliff-bench horizontal plateau.
        let trunkMeander = (fbmEx(uv.x * 1.8 + 7.0, uv.y * 1.2, seed + 5.0, 3, 2.0, 0.5) - 0.5) * 0.45 * (0.5 + warpAmp);
        let trunkDist = abs((uv.y - 0.5) + trunkMeander + (uv.x - 0.5) * params.blockTilt * 0.5);

        // Branching side tributaries via multi-octave ridged valleys oriented toward the trunk
        let trib1 = abs(fbmEx(wUv.x * scale * 1.4, wUv.y * scale * 0.9, seed + 31.0, 3, 2.0, 0.5) - 0.5) * 2.0;
        let trib2 = abs(fbmEx(wUv.x * scale * 3.1 + 13.0, wUv.y * scale * 2.7, seed + 59.0, 3, 2.0, 0.5) - 0.5) * 2.0;
        let trib3 = abs(fbmEx(wUv.x * scale * 6.5 + 29.0, wUv.y * scale * 6.5, seed + 83.0, 2, 2.0, 0.5) - 0.5) * 2.0;

        let cW = max(params.canyonWidth, 0.04);
        let mainGorge = smoothstep(cW * 0.18, cW * 1.35, trunkDist);
        let sideGorge1 = smoothstep(cW * 0.12, cW * 0.85, trib1);
        let sideGorge2 = smoothstep(cW * 0.08, cW * 0.55, trib2);
        let sideGorge3 = smoothstep(cW * 0.05, cW * 0.35, trib3);

        // Combine trunk and dendritic side canyons so tributaries deepen as they approach the main gorge
        var plateau = mainGorge * mix(0.32, 1.0, sideGorge1) * mix(0.62, 1.0, sideGorge2);
        if (params.fractureOctaves >= 2.5) {
            plateau = plateau * mix(0.82, 1.0, sideGorge3);
        }

        // Compound cliff-and-bench profile (characteristic of Grand Canyon Redwall / Supai / Kaibab formations)
        let steps = 5.0;
        let stepFloor = floor(plateau * steps) / steps;
        let stepFrac = fract(plateau * steps);
        let cliffBench = stepFloor + smoothstep(0.15, 0.78, stepFrac) / steps;
        plateau = mix(plateau, cliffBench, clamp01(params.blockRelief));

        // Plateau top undulation, buttes, and rock roughness
        let rimDetail = (fbmEx(uv.x * 8.0, uv.y * 8.0, seed + 101.0, 4, 2.0, 0.5) - 0.45) * params.roughness;
        h = clamp01((1.0 - params.canyonDepth) + params.canyonDepth * plateau + rimDetail * (0.3 + 0.7 * plateau));
        initSediment = (1.0 - mainGorge) * 16.0;
        maskOut = plateau;
    } else if (params.formationMode == 1u) {
        // MODE 1: Isolated Buttes, Mittens & Mesas (Monument Valley / Mount Conner / Attila)
        // Broad, rough desert pediment floor with sparse flat-topped caprock remnants,
        // sheer vertical sandstone walls, and flared 32° conical talus skirts.
        let p = wUv * scale;
        let n = floor(p);
        let f = fract(p);

        // Gently undulating desert floor with rocky hummocks and dry washes
        let desertFloor = 0.08 + 0.09 * fbmEx(uv.x * 3.5, uv.y * 3.5, seed + 19.0, 4, 2.0, 0.5)
                        + 0.04 * ridgedEx(uv.x * 9.0, uv.y * 9.0, seed + 43.0, 3, 2.0, 0.5, 1.8) * params.roughness;

        var butteMax = 0.0;
        var talusMax = 0.0;

        for (var dj: i32 = -1; dj <= 1; dj = dj + 1) {
            for (var di: i32 = -1; di <= 1; di = di + 1) {
                let g = vec2f(f32(di), f32(dj));
                let cellId = n + g + vec2f(seed * 11.3, seed * 23.7);
                let rnd = hash22f(cellId);
                let presenceHash = hash2(vec2u(u32(max(cellId.x + 512.0, 0.0)), u32(max(cellId.y + 512.0, 0.0))));

                // Only a fraction of cells host a surviving mesa/butte/spire
                let coverage = clamp(1.0 - params.canyonWidth * 1.4, 0.18, 0.72);
                if (presenceHash > coverage) { continue; }

                let center = g + vec2f(0.5, 0.5) + rnd * 0.28 * params.jitter;
                let rel = f - center;
                // Elongate some buttes into mesas or mittens
                let angle = rnd.x * PI;
                let ca = cos(angle);
                let sa = sin(angle);
                let rot = vec2f(rel.x * ca - rel.y * sa, (rel.x * sa + rel.y * ca) * (1.0 + abs(rnd.y) * 0.85));

                // Super-ellipse / fluted rock perimeter
                let flute = (fbmEx(rot.x * 6.0 + cellId.x, rot.y * 6.0 + cellId.y, seed + 77.0, 3, 2.0, 0.5) - 0.5) * 0.12;
                let dist = length(rot) + flute;

                let capRadius = 0.10 + 0.18 * (presenceHash / coverage);
                let talusRadius = capRadius + 0.28;
                let mesaHeight = 0.55 + 0.42 * (rnd.y * 0.5 + 0.5);

                // Conical 32° talus pedestal rising from the desert floor
                let talusT = clamp01((talusRadius - dist) / max(talusRadius - capRadius, 0.05));
                let talusCone = pow(talusT, 1.45) * 0.36 * mesaHeight;

                // Sheer vertical sandstone caprock cliff rising above the talus cone
                let capWall = 1.0 - smoothstep(capRadius - 0.025, capRadius + 0.02, dist);
                // Weathered caprock top with slight dip and erosion ledges
                let capTopRough = (fbmEx(uv.x * 12.0, uv.y * 12.0, seed + 131.0, 3, 2.0, 0.5) - 0.5) * params.roughness * 0.35;
                let totalButte = talusCone + capWall * (0.58 * mesaHeight + rel.x * params.blockTilt + capTopRough);

                if (totalButte > butteMax) {
                    butteMax = totalButte;
                    talusMax = talusCone * (1.0 - capWall * 0.85);
                }
            }
        }

        h = clamp01(desertFloor + butteMax * params.canyonDepth);
        initSediment = talusMax * params.baseHeight * 0.35;
        maskOut = clamp01(butteMax);
    } else if (params.formationMode == 2u) {
        // MODE 2: Sheer Table-Top Tepui (Mount Roraima / Guiana Highlands)
        // A monumental flat-topped vertical-walled quartzite table mountain rising from a
        // stepped talus pedestal and jungle highland floor, with a fractured labyrinth summit.
        let c = (uv - vec2f(0.5, 0.5)) * 2.0;
        let rotAngle = 0.55;
        let rc = vec2f(c.x * cos(rotAngle) - c.y * sin(rotAngle), (c.x * sin(rotAngle) + c.y * cos(rotAngle)) * 1.35);

        // Jagged notched prow & cliff line (like Mount Roraima's famous prow)
        let rimNotch = (fbmEx(uv.x * scale * 1.8, uv.y * scale * 1.8, seed + 17.0, 4, 2.0, 0.5) - 0.5) * 0.32 * (0.5 + warpAmp);
        let vRim = voronoi2D(uv * scale * 2.2, 0.8, seed + 41.0);
        let boxDist = pow(pow(abs(rc.x), 3.2) + pow(abs(rc.y), 3.2), 1.0 / 3.2) + rimNotch - (vRim.y * 0.08);

        let tepuiRadius = clamp(0.62 - params.canyonWidth * 0.5, 0.32, 0.78);
        let skirtRadius = tepuiRadius + 0.42;

        // Surrounding Gran Sabana rolling highland floor & stepped talus pedestal
        let sabanaFloor = 0.08 + 0.10 * fbmEx(uv.x * 2.5, uv.y * 2.5, seed + 9.0, 4, 2.0, 0.5);
        let skirtT = clamp01((skirtRadius - boxDist) / max(skirtRadius - tepuiRadius, 0.08));
        let pedestal = (pow(skirtT, 1.6) * 0.26 + floor(skirtT * 3.0) / 3.0 * 0.06);

        // Sheer vertical quartzite cliff wall (600–1000m vertical drop)
        let sheerCliff = 1.0 - smoothstep(tepuiRadius - 0.018, tepuiRadius + 0.018, boxDist);

        // Summit plateau: fractured sandstone labyrinth, joint crevasses, and sinkholes (sima)
        let vSummit = voronoi2D(uv * 14.0, 0.85, seed + 99.0);
        let jointCrevasse = smoothstep(0.0, 0.14, vSummit.y);
        let summitRough = (ridgedEx(uv.x * 10.0, uv.y * 10.0, seed + 113.0, 4, 2.0, 0.5, 2.0) - 0.4) * params.roughness * 0.45;
        let summitSurface = 0.64 * mix(0.84, 1.0, jointCrevasse) + summitRough + rc.x * params.blockTilt * 0.25;

        h = clamp01(sabanaFloor + pedestal + sheerCliff * summitSurface * params.canyonDepth);
        initSediment = pedestal * (1.0 - sheerCliff) * params.baseHeight * 0.25;
        maskOut = sheerCliff;
    } else {
        // MODE 3: Beehive Karst Domes (Bungle Bungles / Purnululu, Western Australia)
        // Orthogonal joint-controlled gorges separating rounded hemispherical beehive towers
        // with horizontal alternating orange/dark cyanobacterial strata bands.
        let p = wUv * scale * 1.4;
        // Orthogonal joint grid + Voronoi dome cells
        let jointX = abs(sin(p.x * PI));
        let jointY = abs(sin(p.y * PI));
        let vDome = voronoi2D(p, clamp(params.jitter * 0.65, 0.1, 0.75), seed + 53.0);

        let cW = max(params.canyonWidth, 0.05);
        let slotGorge = smoothstep(0.0, cW * 1.2, vDome.y) * smoothstep(0.0, cW * 0.9, min(jointX, jointY));
        // Rounded hemispherical/beehive dome profile: (1 - r^1.8)^0.65
        let rNorm = clamp01(vDome.x / 0.62);
        let domeShape = pow(max(0.0, 1.0 - pow(rNorm, 1.85)), 0.62) * slotGorge;

        // Horizontal beehive strata ribs along the dome flanks
        let bandCount = 14.0;
        let bandWave = sin(domeShape * bandCount * TAU) * 0.018 * (1.0 - rNorm * 0.3);
        let domeHeightVar = 0.55 + 0.45 * vDome.z;
        let basePlain = 0.08 + 0.08 * fbmEx(uv.x * 3.0, uv.y * 3.0, seed + 19.0, 3, 2.0, 0.5);

        h = clamp01(basePlain + (domeShape * domeHeightVar + bandWave) * params.canyonDepth);
        initSediment = (1.0 - slotGorge) * 12.0;
        maskOut = domeShape;
    }

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, initSediment, maskOut, 0.0);
    }
}
`;

// =============================================================================
// 4. gen.islandCaldera — Volcanic Caldera & Wilpena Pound Synclinal Amphitheater
// =============================================================================
export const GEN_ISLAND_CALDERA_SHADER = /* wgsl */`
${COMMON_WGSL}

struct IslandCalderaParams {
    landformMode: u32,       // 0 = Volcanic Caldera Island, 1 = Synclinal Amphitheater (Wilpena Pound)
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
    let centered = (uv - vec2f(0.5, 0.5)) * 2.0;

    let wAmp = params.coastWarp;
    let wx = (fbmEx(uv.x * 3.5 + 17.0, uv.y * 3.5, seed + 11.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wy = (fbmEx(uv.x * 3.5, uv.y * 3.5 + 43.0, seed + 29.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wp = centered + vec2f(wx, wy);

    var h = 0.0;
    var maskVal = 0.0;

    if (params.landformMode == 1u) {
        // MODE 1: Synclinal Structural Amphitheater (Wilpena Pound, Flinders Ranges, South Australia)
        // An elongated oval ring of inward-dipping quartzite strata:
        // - Steep outward-facing scarp cliff around the oval perimeter
        // - Gentle inward-dipping dip slope descending into the central Pound basin
        // - Serrated cuesta hogback peaks along the rim + eastern outlet gorge breach
        let rot = 0.42;
        let ep = vec2f(
            (wp.x * cos(rot) - wp.y * sin(rot)) * 0.82,
            (wp.x * sin(rot) + wp.y * cos(rot)) * 1.28
        );
        let rOval = length(ep);
        let rimR = clamp(params.islandRadius * 0.72, 0.35, 0.78);

        var ringElev = 0.0;
        if (rOval < rimR) {
            // Inside the Pound: gentle inward synclinal dip slope curving down to a flat-ish basin floor
            let innerT = clamp01(rOval / rimR);
            ringElev = 0.14 + 0.82 * pow(innerT, max(params.rimSharpness * 1.25, 1.6));
        } else {
            // Outside the Pound: steep outward-facing escarpment scarp + secondary outer hogback cuesta ring
            let outerDist = rOval - rimR;
            let scarpDrop = exp(-outerDist * 9.5);
            let outerHogback = exp(-pow((outerDist - 0.22) / 0.075, 2.0)) * 0.42;
            ringElev = 0.10 + 0.86 * max(scarpDrop, outerHogback);
        }

        // Serrated quartzite hogback peaks & dip-slope gullies around the rim
        let angle = atan2(ep.y, ep.x);
        let hogbackNotches = 0.78 + 0.22 * abs(sin(angle * 18.0 + wx * 6.0));
        // Narrow outlet gorge breach on one side (like Edeowie / Wilpena Creek gorge)
        let gorgeBreach = smoothstep(0.06, 0.24, abs(angle - 0.35));

        let detail = ridgedEx(uv.x * 5.0, uv.y * 5.0, seed + 37.0, 4, 2.0, 0.5, 1.8) * 0.22;
        h = clamp01(ringElev * hogbackNotches * mix(0.22, 1.0, gorgeBreach) + detail * 0.5);
        maskVal = select(0.0, 1.0 - clamp01(rOval / rimR), rOval < rimR);
    } else {
        // MODE 0: Volcanic Caldera Island
        let rRadial = length(wp);
        let rSquare = max(abs(wp.x), abs(wp.y));
        let r = mix(rSquare, rRadial, clamp01(params.falloffMix));

        let maxR = max(params.islandRadius, 0.15);
        let cRad = clamp(params.calderaRadius, 0.0, maxR * 0.85);

        let flankT = clamp01((maxR - r) / max(maxR - cRad, 0.05));
        var cone = pow(flankT, max(params.rimSharpness * 0.65, 0.4));

        if (cRad > 0.01 && r < cRad) {
            let innerT = clamp01(r / cRad);
            let bowl = smoothstep(0.0, 1.0, innerT);
            cone = mix(1.0 - clamp01(params.calderaDepth), 1.0, bowl);
        }

        let angle = atan2(wp.y, wp.x);
        let radialWave = abs(sin(angle * 14.0 + fbmEx(uv.x * 5.0, uv.y * 5.0, seed + 61.0, 3, 2.0, 0.5) * 4.0));
        let gullyFactor = mix(1.0, 0.72 + 0.28 * radialWave, clamp01(params.radialGullies) * flankT * (1.0 - flankT * 0.5));

        let noiseTex = ridgedEx(uv.x * 4.5, uv.y * 4.5, seed + 5.0, 5, 2.0, 0.5, 1.8);
        h = clamp01(cone * gullyFactor * (0.65 + 0.35 * noiseTex));
        maskVal = clamp01(flankT);
    }

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, 0.0, maskVal, 0.0);
    }
}
`;
