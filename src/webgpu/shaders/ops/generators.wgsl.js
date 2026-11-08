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
    orientationDeg: f32,     // [0..360] rotates primary mountain range / massif / karst canyon axis
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
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

    let rawUv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let orientRad = params.orientationDeg * PI / 180.0;
    let oCos = cos(orientRad);
    let oSin = sin(orientRad);
    let cUv = rawUv - vec2f(0.5, 0.5);
    let uv = vec2f(cUv.x * oCos - cUv.y * oSin, cUv.x * oSin + cUv.y * oCos) + vec2f(0.5, 0.5);

    // Low-frequency spatial modulation of scale & amplitude to prevent repetitive noise
    let macroMod = fbmEx(uv.x * 1.3 + 11.0, uv.y * 1.3 + 29.0, seed + 5.0, 3, 2.0, 0.5);
    let localFreqMult = mix(1.0, 0.65 + 0.75 * macroMod, scaleVar);
    let ampEnvelope = mix(1.0, 0.45 + 0.85 * smoothstep(0.2, 0.8, macroMod), scaleVar);

    let nx = uv.x * baseFreq * localFreqMult;
    let ny = uv.y * baseFreq * localFreqMult;

    let wf = max(params.warpFrequency, 0.2);
    let wa = params.warpAmplitude;
    // 2-stage iterated Inigo Quilez domain warp (from GLSL reference)
    let warpedP = domainWarpIQ(vec2f(nx, ny), seed + 13.0, wa, wf, 2, gain);
    let wx = warpedP.x;
    let wy = warpedP.y;
    let warpX = wx - nx;
    let warpY = wy - ny;

    var h = 0.0;
    var initSediment = 0.0;
    var initMask = 1.0;

    if (params.landformMode == 1u) {
        // MODE 1: Tabular Carbonate Massif (Alpine Dolomites — Tre Cime / Seceda / Tofane)
        // Combines Perlin-Worley cellular reef massifs + octave-rotated Musgrave ridges
        // with the GLSL applyPlateauRim() incised scree-basin to sheer-cliff plateau transfer.
        let rWeight = clamp01(params.ridgeWeight);
        let mUv = uv * (baseFreq * 0.72 * localFreqMult) + vec2f(warpX * 0.35, warpY * 0.35);
        let vMassif = voronoi2D(mUv, 0.85, seed + 17.0);
        let pwMassif = fbmPerlinWorley(vec2f(wx * 0.78, wy * 0.78), seed + 5.0, max(oct - 1, 2), lac, gain);
        let ridgeSpine = ridgedEx(wx * 0.72 + 40.0, wy * 0.72 + 40.0, seed + 7.0, oct, lac, gain, sharp);

        // Blend Perlin-Worley reef block, Voronoi massif core, and Musgrave ridge spine
        let blockCore = mix(pwMassif, 1.0 - vMassif.x * 0.88, 0.42);
        let rawMassif = clamp01(mix(blockCore, ridgeSpine, 0.32 + rWeight * 0.48) * (0.88 + 0.24 * ampEnvelope));

        // GLSL Plateau-Rim transfer: concave incised valley/scree ramp below rim, uplifted reef table above rim
        let rimAmount = clamp(0.22 + 0.20 * rWeight, 0.14, 0.45);
        let rimThresh = 0.42 + 0.14 * rimAmount;
        let rimShaped = applyPlateauRim(rawMassif, rimAmount);

        // Steep dolomitic cliff wall transition around rimThresh controlled by Peak sharpness (sharp)
        let wallHalfSpan = clamp(0.11 / max(sharp * 0.65, 0.5), 0.022, 0.13);
        let cliffWall = smoothstep(rimThresh - wallHalfSpan, rimThresh + wallHalfSpan, rawMassif);
        let screeApron = smoothstep(rimThresh - 0.24, rimThresh + 0.02, rawMassif) * (1.0 - cliffWall * 0.75);

        // Craggy dolomitic towers (torri) and stepped carbonate bedding ledges on the massif crown
        let spires = ridgedEx(wx * 1.85, wy * 1.85, seed + 71.0, min(oct, 4), 2.15, 0.52, max(sharp * 1.15, 1.2));
        let strataBenches = floor(spires * 6.0) / 6.0 * 0.22 + spires * 0.78;

        let rawH = mix(rimShaped, rimShaped * 0.76 + cliffWall * (0.18 + 0.20 * strataBenches), 0.65);
        let curve = max(params.heightCurve, 0.3);
        h = clamp01(pow(clamp01(rawH), curve * 0.78) * 1.08);

        // Rim-wall & scree-basin erosion focus mask (from GLSL plateauMask)
        let inBasin = 1.0 - smoothstep(rimThresh - 0.06, rimThresh + 0.14, rawMassif);
        initMask = mix(1.0, clamp(max(inBasin, cliffWall * 0.9), 0.22, 1.0), rimAmount);
        initSediment = screeApron * params.baseHeight * 0.16;
    } else if (params.landformMode == 2u) {
        // MODE 2: Fenglin Karst Pillars & Quartz-Sandstone Needles (Zhangjiajie / Guilin)
        // All 4 primary sliders directly shape the karst formations:
        // - Massif frequency (baseFreq): pillar & needle grid density
        // - Ridge crest weight (ridgeWeight): pillar packing density & connected rock fin ridges
        // - Peak sharpness (sharp): wall verticality, pillar slenderness, and crown spire sharpness
        // - Scale variety (scaleVar): contrast between giant monoliths, thin needles, and deep gorges
        let rWeight = clamp01(params.ridgeWeight);
        let kScale = max(baseFreq * 2.8, 1.5) * mix(1.0, 0.75 + 0.55 * macroMod, scaleVar * 0.5);
        let kWarpX = (fbmEx(uv.x * 2.5 + 13.0, uv.y * 2.5, seed + 17.0, 3, 2.0, 0.5) - 0.5) * 0.12 * wa;
        let kWarpY = (fbmEx(uv.x * 2.5, uv.y * 2.5 + 41.0, seed + 29.0, 3, 2.0, 0.5) - 0.5) * 0.12 * wa;
        let kp = (uv + vec2f(kWarpX, kWarpY)) * kScale;

        // 3-tier Voronoi karst grids (monoliths, slender needles, and flanking spires)
        let v1 = voronoi2D(kp, 0.88, seed + 31.0);
        let v2 = voronoi2D(kp * 1.85 + vec2f(7.3, 4.1), 0.92, seed + 67.0);
        let v3 = voronoi2D(kp * 3.10 + vec2f(13.7, 9.4), 0.85, seed + 103.0);

        // Winding canyon gorge floor scaled by baseFreq
        let gorgeFreq = max(baseFreq * 0.75, 0.6);
        let gorgeChannel = smoothstep(0.18, 0.72, fbmEx(uv.x * gorgeFreq + 5.0, uv.y * gorgeFreq + 11.0, seed + 3.0, 3, 2.0, 0.5));
        let valleyFloor = 0.05 + 0.12 * gorgeChannel
                        + 0.04 * fbmEx(uv.x * gorgeFreq * 3.2, uv.y * gorgeFreq * 3.2, seed + 11.0, 3, 2.0, 0.5);

        // Ridge crest weight controls what fraction of cells host a pillar (from 25% sparse to 85% dense)
        let survivalThreshold1 = clamp(0.72 - rWeight * 0.58, 0.12, 0.78);
        let survivalThreshold2 = clamp(0.80 - rWeight * 0.55, 0.18, 0.84);

        // Peak sharpness controls pillar slenderness and wall verticality
        let slenderFactor = clamp(1.25 / pow(max(sharp, 0.5), 0.35), 0.55, 1.45);
        let wallWidth = clamp(0.09 / max(sharp, 0.6), 0.015, 0.12);

        // Scale variety controls height & diameter variance across pillars
        let heightVar1 = mix(0.72, 0.32 + 0.68 * pow(v1.z, 0.7), scaleVar);
        let heightVar2 = mix(0.65, 0.25 + 0.75 * pow(v2.z, 0.6), scaleVar);

        // Tier 1: Primary vertical karst monoliths & twin rock fins
        let score1 = fract(v1.z * 1.73 + gorgeChannel * 0.25 * scaleVar);
        let keep1 = smoothstep(survivalThreshold1 - 0.04, survivalThreshold1 + 0.04, score1);
        let rad1 = (0.18 + 0.22 * mix(0.5, fract(v1.z * 3.17), scaleVar)) * slenderFactor;
        let shaft1 = (1.0 - smoothstep(max(0.02, rad1 - wallWidth), rad1 + wallWidth, v1.x)) * keep1;
        let slot1 = smoothstep(0.015, 0.065, v1.y);
        // Taper top according to Peak sharpness (flat table vs pointed pinnacle)
        let coneProfile1 = max(0.0, 1.0 - (v1.x / max(rad1, 0.05)) * clamp01((sharp - 1.5) * 0.22));
        let pillar1 = shaft1 * slot1 * heightVar1 * coneProfile1;

        // Tier 2: Slender high-aspect-ratio quartz-sandstone needles
        let score2 = fract(v2.z * 2.31 + macroMod * 0.25 * scaleVar);
        let keep2 = smoothstep(survivalThreshold2 - 0.04, survivalThreshold2 + 0.04, score2);
        let rad2 = (0.15 + 0.17 * mix(0.5, fract(v2.z * 4.13), scaleVar)) * slenderFactor;
        let shaft2 = (1.0 - smoothstep(max(0.02, rad2 - wallWidth), rad2 + wallWidth, v2.x)) * keep2;
        let coneProfile2 = max(0.0, 1.0 - (v2.x / max(rad2, 0.05)) * clamp01((sharp - 1.2) * 0.25));
        let pillar2 = shaft2 * heightVar2 * coneProfile2;

        // Tier 3: Flanking spires & rock pinnacles (boosted by Ridge crest weight)
        let keep3 = smoothstep(0.65 - rWeight * 0.35, 0.72 - rWeight * 0.35, v3.z);
        let rad3 = (0.16 + 0.14 * v3.z) * slenderFactor;
        let shaft3 = (1.0 - smoothstep(max(0.02, rad3 - wallWidth), rad3 + wallWidth, v3.x)) * keep3;
        let pillar3 = shaft3 * (0.28 + 0.45 * v3.z) * (0.5 + 0.5 * rWeight);

        let maxPillar = max(pillar1, max(pillar2, pillar3));
        let isOnPillar = clamp01(max(shaft1 * slot1, max(shaft2, shaft3)));

        // Conical talus foot skirt around the base of each pillar cluster
        let foot1 = clamp01((rad1 + 0.22 - v1.x) / 0.24) * keep1;
        let foot2 = clamp01((rad2 + 0.18 - v2.x) / 0.20) * keep2;
        let talusBase = pow(max(foot1, foot2 * 0.8), 1.8) * 0.16;

        // Horizontal bedding ledges along vertical shafts + craggy crown on pillar tops
        let crownNoise = (ridgedEx(uv.x * 20.0, uv.y * 20.0, seed + 97.0, 3, 2.0, 0.5, max(sharp, 1.2)) - 0.35)
                       * (0.06 + 0.05 * sharp);
        let stepLedges = floor(maxPillar * 9.0) / 9.0 * 0.12 + maxPillar * 0.88;

        h = clamp01(valleyFloor + talusBase + stepLedges + isOnPillar * crownNoise);
        initSediment = talusBase * (1.0 - isOnPillar * 0.85) * params.baseHeight * 0.25;
    } else if (params.landformMode == 3u) {
        // MODE 3: Classic fBm & Ridged Mountains (Original webgpu.html heightmap formula)
        let origNx = uv.x * baseFreq;
        let origNy = uv.y * baseFreq;
        var origH = fbm(origNx, origNy, seed);
        let origRidge = ridged(origNx + 100.0, origNy + 100.0, seed + 7.0);
        let rWeight = clamp01(params.ridgeWeight);
        origH = origH * (1.0 - rWeight) + origRidge * rWeight;

        let origWarpX = fbm(origNx * wf + 50.0, origNy * wf, seed + 13.0) * wa;
        let origWarpY = fbm(origNx * wf, origNy * wf + 50.0, seed + 19.0) * wa;
        origH = origH + fbm(origNx + origWarpX, origNy + origWarpY, seed + 23.0) * 0.15;

        let curve = max(params.heightCurve, 0.3);
        h = pow(clamp01(origH), curve);
    } else if (params.landformMode == 4u) {
        // MODE 4: Evolved Ridged Plateau-Rim Massif (Direct GLSL Genotype Port)
        // Low-octave rotated Musgrave ridged + Perlin-Worley hybrid with applyPlateauRim()
        // and inverted gorge/massif contrast curve for dramatic high-relief peaks.
        let rWeight = clamp01(params.ridgeWeight);
        let ridgeRaw = ridgedEx(wx, wy, seed + 7.0, oct, lac, gain, max(sharp * 0.85, 1.0));
        let pwRaw = fbmPerlinWorley(vec2f(wx * 0.85, wy * 0.85), seed + 19.0, oct, lac, gain);
        let rawH = mix(pwRaw, 1.0 - ridgeRaw, rWeight);
        let rimAmount = 0.22;
        let rimH = applyPlateauRim(rawH, rimAmount);
        let curved = pow(clamp01(rimH), max(params.heightCurve * 0.65, 0.4));
        h = clamp01(((curved - 0.5) * 0.96 + 0.55) * (0.88 + 0.22 * ampEnvelope));
    } else {
        // MODE 0: Tectonic High-Mountain Range (Himalayas / Karakoram / Alps)
        // Uses octave-rotated Musgrave ridged chains + Perlin-Worley massif structure + incised gorge envelope
        // so macro slopes remain coherent for Phacelle / Gavoronoise gully branching.
        let baseMassif = fbmPerlinWorley(vec2f(wx, wy), seed, oct, lac, gain);
        let ridge1 = ridgedEx(wx + 100.0, wy + 100.0, seed + 7.0, oct, lac, gain, sharp);

        let angRad = params.secondRangeAngle * PI / 180.0;
        let ca = cos(angRad);
        let sa = sin(angRad);
        let rx2 = wx * ca - wy * sa;
        let ry2 = wx * sa + wy * ca;
        let ridge2 = ridgedEx(rx2 * 0.88 + 210.0, ry2 * 0.88 + 140.0, seed + 41.0, oct, lac, gain, sharp);

        // Inverted low-octave crease network carves deep tectonic river gorges between massif blocks
        let gorgeCrease = 1.0 - ridgedEx(wx * 0.75 + 55.0, wy * 0.75 + 85.0, seed + 59.0, min(oct, 2), lac, gain, 1.8);

        let combinedRidge = mix(ridge1, max(ridge1, ridge2 * 0.95), clamp01(params.secondRangeWeight));
        let tectonicCore = mix(combinedRidge, combinedRidge * (0.55 + 0.65 * gorgeCrease), 0.45);
        let rawMix = mix(baseMassif, tectonicCore, clamp01(params.ridgeWeight));

        // Incise low basins while preserving soaring pyramidal peak relief
        let rimInjected = applyPlateauRim(clamp01((rawMix - 0.08) / 0.78), 0.16);
        let normalized = clamp01(rimInjected * ampEnvelope);
        let curve = max(params.heightCurve, 0.3);
        let shaped = pow(clamp01(normalized), curve) * 1.12;
        h = clamp01((shaped - 0.5) * 0.96 + 0.54);
    }

    let relief = clamp(params.baseHeight, 0.0, MAX_HEIGHT);
    heights[idx] = toFixedHeight(h * relief);

    if (params.clearAux != 0u) {
        aux[idx] = vec4f(0.0, initSediment, initMask, 0.0);
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
    frequency: f32,          // [0.25..4.0] global scale / frequency multiplier for dunes, draa & meanders
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
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
    let freqScale = select(max(params.frequency, 0.25), 1.0, params.frequency <= 0.01);

    // Multi-scale spatial variation in sand supply, dune height, and spacing
    let supplyNoise = fbmEx(uv.x * 1.6 * freqScale + 19.0, uv.y * 1.6 * freqScale + 43.0, seed + 3.0, 3, 2.0, 0.5);
    let scaleNoise = fbmEx(uv.x * 0.9 * freqScale + 83.0, uv.y * 0.9 * freqScale + 17.0, seed + 9.0, 2, 2.0, 0.5);
    let localHeightMult = mix(1.0, 0.25 + 1.25 * smoothstep(0.18, 0.82, supplyNoise), sizeVar);
    let localWaveMult = mix(1.0, 0.68 + 0.72 * scaleNoise, sizeVar * 0.75);

    let warpFreq = max(params.warpFrequency * freqScale, 0.2);
    let warpAmp = params.warpAmplitude;
    let warpVec = vec2f(
        (fbmEx(uv.x * warpFreq * 3.5 + 37.0, uv.y * warpFreq * 3.5, seed + 13.0, 3, 2.0, 0.5) - 0.5) * warpAmp,
        (fbmEx(uv.x * warpFreq * 3.5, uv.y * warpFreq * 3.5 + 73.0, seed + 19.0, 3, 2.0, 0.5) - 0.5) * warpAmp
    );
    let warpedUv = uv + warpVec * 0.28;
    let warpedWorldM = warpedUv * WORLD_M;

    // 1. Primary Draa (Mega-dune) underlying wave + rocky/gravel desert floor undulation
    var draaMeters = (fbmEx(uv.x * 2.2 * freqScale, uv.y * 2.2 * freqScale, seed + 61.0, 4, 2.0, 0.5) - 0.35) * 14.0;
    if (params.draaHeight > 0.5) {
        let draaRad = windRad + params.draaAngleOffset * PI / 180.0;
        let draaWind = vec2f(cos(draaRad), sin(draaRad));
        let draaWaveM = max((params.draaWavelength / freqScale) * localWaveMult, 150.0);
        let draaDownwind = dot(warpedWorldM, draaWind) / draaWaveM;
        let draaPhase = fract(draaDownwind + seed * 0.07);
        let draaProf = asymmetricDuneProfile(draaPhase, clamp(params.brinkPosition + 0.04, 0.55, 0.90), params.stossPower, params.leePower);
        draaMeters = max(0.0, draaMeters) + draaProf.x * params.draaHeight * (0.55 + 0.65 * supplyNoise);
    }

    let waveM = max((params.duneWavelength / freqScale) * localWaveMult, 25.0);
    let cyclesPerTile = WORLD_M / waveM;

    var rawDune01 = 0.0;
    var isSlipFace = 0.0;

    if (params.crestMode == 2u) {
        // MODE 2: Isolated Barchan Crescents & Variable Dune Trains (Sudan / Nubian Desert)
        // Overlapping staggered cellular grid of individual crescent dunes with varying sizes
        let downwindM = dot(worldPosM, windDir);
        let crosswindM = dot(worldPosM, crestDir);
        let cellSizeM = max((params.duneWavelength / freqScale) * 1.35, 45.0);
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
    let reposeSteepening = clamp(tan(reposeRad) / tan(33.0 * PI / 180.0), 0.75, 1.35);
    let effDuneHeightM = max(params.duneHeight, 0.0) * mix(1.0, reposeSteepening, isSlipFace * 0.25);

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
    cellScale: f32,          // Terrain frequency (scale)
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
    orientationDeg: f32,     // [0..360] rotates canyon / tepui / butte / joint-grid axis (e.g. 45° diagonal canyon)
    warpFrequency: f32,      // Distortion / meander frequency
    _pad0: f32,
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
    let rawUv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let orientRad = params.orientationDeg * PI / 180.0;
    let oCos = cos(orientRad);
    let oSin = sin(orientRad);
    let cUv = rawUv - vec2f(0.5, 0.5);
    let uv = vec2f(cUv.x * oCos - cUv.y * oSin, cUv.x * oSin + cUv.y * oCos) + vec2f(0.5, 0.5);

    let scale = max(params.cellScale, 0.4);
    let warpAmp = params.warpAmplitude;
    let wFreq = select(max(params.warpFrequency, 0.4), 2.8, params.warpFrequency <= 0.01);

    let wx = (fbmEx(uv.x * wFreq + 19.0, uv.y * wFreq, seed + 11.0, 4, 2.0, 0.5) - 0.5) * warpAmp;
    let wy = (fbmEx(uv.x * wFreq, uv.y * wFreq + 47.0, seed + 23.0, 4, 2.0, 0.5) - 0.5) * warpAmp;
    let wUv = uv + vec2f(wx, wy);

    var h = 0.0;
    var initSediment = 0.0;
    var maskOut = 1.0;

    if (params.formationMode == 0u) {
        // MODE 0: Dendritic Trunk & Tributary Gorge (Grand Canyon / Island in the Sky / Bryce Canyon)
        // Rotatable via orientationDeg so the main canyon can run diagonally across the tile,
        // and scalable via cellScale (Terrain frequency) & warpFrequency!
        let freqRatio = scale / 2.8;
        let meanderFreq = max(wFreq * 0.65 * freqRatio, 0.4);
        let trunkMeander = (fbmEx(uv.x * meanderFreq + 7.0, uv.y * meanderFreq * 0.7, seed + 5.0, 3, 2.0, 0.5) - 0.5) * 0.45 * (0.5 + warpAmp);
        let rawTrunkCoord = (uv.y - 0.5) * max(freqRatio, 0.35) + trunkMeander + (uv.x - 0.5) * params.blockTilt * 0.5;
        let trunkDist = select(abs(sin(rawTrunkCoord * PI)) / PI, abs(rawTrunkCoord), freqRatio <= 1.35);

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

        // Plateau top undulation, buttes, and rock roughness scaled with frequency
        let rimDetail = (fbmEx(uv.x * scale * 2.8, uv.y * scale * 2.8, seed + 101.0, 4, 2.0, 0.5) - 0.45) * params.roughness;
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
        // stepped talus pedestal and jungle highland floor, rotatable & scalable via sliders.
        let tepuiScale = clamp(scale / 2.4, 0.4, 3.2);
        let c = (uv - vec2f(0.5, 0.5)) * 2.0 * tepuiScale;
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
    frequency: f32,          // Terrain / detail frequency (scale)
    orientationDeg: f32,     // [0..360] rotates synclinal oval ring, outlet gorge & caldera asymmetry
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
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
    let rawUv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let orientRad = params.orientationDeg * PI / 180.0;
    let oCos = cos(orientRad);
    let oSin = sin(orientRad);
    let cUv = rawUv - vec2f(0.5, 0.5);
    let uv = vec2f(cUv.x * oCos - cUv.y * oSin, cUv.x * oSin + cUv.y * oCos) + vec2f(0.5, 0.5);
    let centered = (uv - vec2f(0.5, 0.5)) * 2.0;

    let freq = select(max(params.frequency, 0.4), 2.5, params.frequency <= 0.01);
    let freqRatio = freq / 2.5;

    let wAmp = params.coastWarp;
    let wx = (fbmEx(uv.x * 3.5 * freqRatio + 17.0, uv.y * 3.5 * freqRatio, seed + 11.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wy = (fbmEx(uv.x * 3.5 * freqRatio, uv.y * 3.5 * freqRatio + 43.0, seed + 29.0, 4, 2.0, 0.5) - 0.5) * 2.0 * wAmp;
    let wp = centered + vec2f(wx, wy);

    var h = 0.0;
    var maskVal = 0.0;

    if (params.landformMode == 1u) {
        // MODE 1: Synclinal Structural Amphitheater (Wilpena Pound / Ikara, Flinders Ranges, South Australia)
        // Boat-shaped bilobed syncline of inward-dipping Rawnsley Quartzite beds with a continuous,
        // asymmetric cuesta rim (highest at St Mary Peak & Rawnsley Bluff), sheer outward escarpments,
        // gently bowled interior basin floor, eastern outlet gorge breach, and flanking strike ridges.
        let rot = 0.42;
        let baseEp = vec2f(
            (wp.x * cos(rot) - wp.y * sin(rot)) * 0.88,
            (wp.x * sin(rot) + wp.y * cos(rot)) * 1.34
        );

        // Bilobed boat-shaped synclinal outline: slightly wider northern/southern lobes with a gentle medial waist
        let waistPinch = 1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.55, abs(baseEp.x))) - 0.08 * baseEp.x;
        let ep = vec2f(baseEp.x, baseEp.y * waistPinch);
        let angle = atan2(ep.y, ep.x);

        // Low-order non-periodic structural warp of the syncline rim (zero high-frequency cogwheel teeth!)
        let rimMacroWarp = (fbmEx(cos(angle) * 0.9 + 7.1, sin(angle) * 0.9 + 13.7, seed + 19.0, 3, 2.0, 0.5) - 0.5) * 0.14 * (0.5 + wAmp);
        let rOval = length(ep) + rimMacroWarp;
        let rimR = clamp(params.islandRadius * 0.72, 0.36, 0.78);

        // Smooth asymmetric rim crest elevation around the perimeter:
        // Rises highest on the north-west / north-east bluff (St Mary Peak) and south-east bluff (Rawnsley Bluff)
        let stMaryBluff = 0.76 + 0.24 * smoothstep(-0.6, 0.85, cos(angle - 0.55));
        let rimUndulation = (fbmEx(uv.x * 1.8 * freqRatio + 5.0, uv.y * 1.8 * freqRatio + 11.0, seed + 31.0, 3, 2.0, 0.5) - 0.5) * 0.16;
        // Subtle flatiron dip-slope facets controlled by radialGullies (smooth asymmetric waves, not spiky teeth)
        let flatironPhase = fract(angle * round(5.0 * freqRatio) / TAU + wx * 0.65);
        let flatironFacet = (smoothstep(0.0, 0.72, flatironPhase) - 0.35) * 0.08 * clamp01(params.radialGullies);
        let crestHeight = clamp(stMaryBluff + rimUndulation + flatironFacet, 0.52, 1.05);

        // Narrow water-gap outlet gorge breach on the eastern flank (Wilpena Creek Gorge)
        let breachDist = abs(angle - 0.32);
        let gorgeBreach = smoothstep(0.045, 0.19, breachDist);

        // Gently undulating outback plain & interior basin floor base
        let plainFloor = 0.10 + 0.045 * fbmEx(uv.x * 2.4 * freqRatio + 3.0, uv.y * 2.4 * freqRatio + 9.0, seed + 47.0, 3, 2.0, 0.5);

        var ringElev = plainFloor;
        if (rOval < rimR) {
            // Inside the Pound: smooth concave inward-dipping quartzite bedding slope (14°–22°)
            // grading into a flat-ish bowled interior basin floor
            let innerT = clamp01(rOval / rimR);
            let dipCurve = pow(innerT, max(params.rimSharpness * 1.35, 1.85));
            // Subtle dip-slope bedding steps along the inward incline
            let dipSteps = sin(innerT * 18.0) * 0.008 * innerT * (1.0 - innerT);
            // Axial creek channel draining the interior basin toward the eastern gorge breach
            let creekDist = abs(ep.y - 0.04 * sin(ep.x * 3.0));
            let axialCreek = (1.0 - smoothstep(0.0, 0.16, creekDist)) * (1.0 - innerT * 0.5) * 0.035;
            let interiorBasin = plainFloor + 0.03 * (1.0 - innerT) - axialCreek;
            ringElev = interiorBasin + (crestHeight * 0.84 * dipCurve + dipSteps) * mix(0.08, 1.0, gorgeBreach);
        } else {
            // Outside the Pound: steep upper quartzite cliff escarpment (45°–65°) dropping onto a 30° talus apron
            let outerDist = rOval - rimR;
            let cliffWall = exp(-outerDist * 13.5) * 0.62;
            let talusPediment = exp(-outerDist * 4.2) * 0.24;
            let mainEscarpment = (cliffWall + talusPediment) * crestHeight * mix(0.08, 1.0, gorgeBreach);

            // Discontinuous parallel flanking homoclinal strike ridges (ABC Range / Bunyeroo style)
            // Gated primarily to the lateral NE/SW flanks so it never forms an artificial 360° bullseye ring!
            let lateralFlankGate = pow(abs(sin(angle + 0.15)), 1.6) * smoothstep(0.18, 0.45, breachDist);
            let strikeDist1 = outerDist - 0.19;
            let strikeRidge1 = select(
                exp(-strikeDist1 * 11.0),
                exp(-strikeDist1 * strikeDist1 / 0.0032),
                strikeDist1 < 0.0
            ) * 0.34 * lateralFlankGate;
            let strikeDist2 = outerDist - 0.34;
            let strikeRidge2 = select(
                exp(-strikeDist2 * 10.0),
                exp(-strikeDist2 * strikeDist2 / 0.0038),
                strikeDist2 < 0.0
            ) * 0.21 * lateralFlankGate * clamp01(params.radialGullies + 0.35);

            ringElev = plainFloor + max(mainEscarpment, max(strikeRidge1, strikeRidge2));
        }

        // Subtle weathered sandstone/quartzite surface texture (smooth fBm, no spiky cones)
        let rockWeathered = (fbmEx(uv.x * 6.0 * freqRatio, uv.y * 6.0 * freqRatio, seed + 73.0, 3, 2.0, 0.5) - 0.5)
                          * 0.035 * smoothstep(0.18, 0.55, ringElev);
        h = clamp01(ringElev + rockWeathered);
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
        let radialWave = abs(sin(angle * round(14.0 * freqRatio) + fbmEx(uv.x * 5.0 * freqRatio, uv.y * 5.0 * freqRatio, seed + 61.0, 3, 2.0, 0.5) * 4.0));
        let gullyFactor = mix(1.0, 0.72 + 0.28 * radialWave, clamp01(params.radialGullies) * flankT * (1.0 - flankT * 0.5));

        let noiseTex = ridgedEx(uv.x * 4.5 * freqRatio, uv.y * 4.5 * freqRatio, seed + 5.0, 5, 2.0, 0.5, 1.8);
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
