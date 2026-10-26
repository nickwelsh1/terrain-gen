// Built-in Gaea-style terrain compositor presets & dynamic N-layer stack helpers.
// Supports up to MAX_BIOME_LAYERS (8) composable biome layers per stack while
// keeping backward-compatible layer1 / layer2 references on every stack object.

import {
    MAX_BIOME_LAYERS,
    PALETTE_ALPINE_SUMMER,
    PALETTE_ALPINE_WINTER,
    PALETTE_ARIZONA_SUMMER,
    PALETTE_ZHANGJIAJIE_SUMMER,
    PALETTE_TROPICAL_TEPUIS,
    PALETTE_SAHARA_DESERT,
    PALETTE_NAMIB_RED,
    PALETTE_OUTBACK_PURNULULU,
} from "./constants.js";

const PRESET_DEFAULT_PALETTE = {
    "classic-fbm-mountains": PALETTE_ALPINE_SUMMER,
    "alpine-dolomites": PALETTE_ALPINE_SUMMER,
    "himalayan-peaks": PALETTE_ALPINE_WINTER,
    "roraima-tepui": PALETTE_TROPICAL_TEPUIS,
    "monument-valley-buttes": PALETTE_ARIZONA_SUMMER,
    "grand-canyon-gorge": PALETTE_ARIZONA_SUMMER,
    "grand-mesa-canyons": PALETTE_ARIZONA_SUMMER,
    "zhangjiajie-karst": PALETTE_ZHANGJIAJIE_SUMMER,
    "bungle-bungles-domes": PALETTE_OUTBACK_PURNULULU,
    "wilpena-pound": PALETTE_OUTBACK_PURNULULU,
    "sudan-barchan-dunes": PALETTE_SAHARA_DESERT,
    "namib-mega-dunes": PALETTE_NAMIB_RED,
    "canyon-valley-dunes": PALETTE_ARIZONA_SUMMER,
    "volcanic-caldera-island": PALETTE_TROPICAL_TEPUIS,
};

export function defaultShapers(overrides = {}) {
    const base = {
        "shape.terrace": { enabled: false, stepHeightM: 55, sharpness: 0.78, strength: 0.75, strataTiltM: 35, strataAngleDeg: 30, strataWarpM: 20 },
        "shape.fold": { enabled: false, directionDeg: 120, steepen: 0.85, gentle: 0.65, minAltM: 80, maxAltM: 1800, strength: 0.75 },
        "shape.glacialCarve": { enabled: false, carveDepthM: 65, valleyWidth: 2, apexSharpen: 0.75, altitudeGateM: 220, strength: 0.8 },
        "shape.warp": { enabled: false, warpAmplitudeM: 50, warpFrequency: 2.5, swirlStrength: 0, octaves: 3 },
        "shape.curveRemap": { enabled: false, gamma: 1.1, valleyFloorM: 35, valleySmoothM: 40, plateauCeilingM: 2200, strength: 0.9 },
        "shape.surfaceDetail": { enabled: false, boulderHeightM: 18, boulderScale: 14, caprockRoughnessM: 14, basinHummocksM: 12, strength: 0.85 },
    };
    for (const [k, v] of Object.entries(overrides)) {
        if (base[k]) {
            base[k] = { ...base[k], ...v };
        }
    }
    return base;
}

export function defaultSimulations(overrides = {}) {
    const base = {
        "sim.phacelleErosion": {
            enabled: false,
            erosionStrength: 0.16,
            erosionScale: 0.14,
            erosionOctaves: 4,
            gullyWeight: 0.5,
            ridgeRounding: 0.12,
            creaseRounding: 0.05,
            assumedSlope: 0.7,
        },
        "sim.thermalTalus": {
            enabled: false,
            talusReposeDeg: 33,
            bedrockReposeDeg: 65,
            iterations: 10,
            transferRate: 0.25,
            weatheringRate: 0.35,
        },
        "sim.windDrift": {
            enabled: false,
            windDirectionDeg: 45,
            minAltitudeM: 380,
            snowSupplyM: 0.8,
            iterations: 10,
            transportRate: 0.6,
            depositionRate: 1.1,
            shadowAngleDeg: 15,
            reposeAngleDeg: 36,
        },
        "sim.waterLevel": {
            enabled: false,
            waterLevelM: 0,
            shorelineFlattenM: 12,
            sedimentFill: 0.35,
        },
        "sim.dropletErosion": {
            erosionRate: 0.5,
            stepCount: 10,
            rainRate: 2.0,
            depositionRate: 0.3,
            evaporation: 0.05,
            sedimentCapacity: 0.5,
        },
    };
    for (const [k, v] of Object.entries(overrides)) {
        if (base[k]) {
            base[k] = { ...base[k], ...v };
        }
    }
    return base;
}

export function createDefaultOverlayLayer(index = 2, overrides = {}) {
    return {
        id: `layer${index}`,
        name: overrides.name || `Layer ${index}: Biome Overlay`,
        enabled: overrides.enabled ?? false,
        generatorId: overrides.generatorId || "gen.duneField",
        generatorParams: {
            crestMode: 0,
            duneHeight: 115,
            duneWavelength: 190,
            sizeVariation: 0.75,
            windDirection: 40,
            brinkPosition: 0.74,
            draaHeight: 35,
            draaWavelength: 850,
            draaAngleOffset: -12,
            interduneFlatness: 0.15,
            warpFrequency: 1.2,
            warpAmplitude: 0.35,
            stossPower: 1.0,
            leePower: 1.8,
            angleOfRepose: 33,
            rippleFrequency: 34,
            rippleAmplitude: 2.4,
            shadowAngle: 14,
            ...(overrides.generatorParams || {}),
        },
        shapers: defaultShapers(overrides.shapers || {}),
        maskParams: {
            minAltM: -20,
            maxAltM: 320,
            featherAltM: 65,
            minSlopeDeg: 0,
            maxSlopeDeg: 26,
            featherSlopeDeg: 9,
            curvatureBias: -0.3,
            warpAmpM: 70,
            warpFreq: 1.25,
            invertMask: 0,
            blurRadius: 2,
            blurIterations: 2,
            ...(overrides.maskParams || {}),
        },
        blendParams: {
            blendMode: 0,
            opacity: 1.0,
            blendDepthM: 50,
            blendSmoothM: 24,
            heightOffsetM: 10,
            markSediment: 1,
            ...(overrides.blendParams || {}),
        },
    };
}

/**
 * Ensures stack has a valid `layers[]` array (1..MAX_BIOME_LAYERS) and aliases
 * `stack.layer1 = stack.layers[0]` and `stack.layer2 = stack.layers[1]`.
 */
export function normalizeStack(stack) {
    if (!Array.isArray(stack.layers) || stack.layers.length === 0) {
        const l1 = stack.layer1 || {
            id: "layer1",
            name: "Layer 1: Base Terrain",
            enabled: true,
            generatorId: "gen.ridgeFbm",
            generatorParams: { baseHeight: 1500 },
            shapers: defaultShapers(),
        };
        const l2 = stack.layer2 || createDefaultOverlayLayer(2, { enabled: false });
        stack.layers = [l1, l2];
    }
    if (stack.layers.length < 2) {
        stack.layers.push(createDefaultOverlayLayer(2, { enabled: false }));
    }
    if (stack.layers.length > MAX_BIOME_LAYERS) {
        stack.layers.length = MAX_BIOME_LAYERS;
    }
    stack.layers.forEach((layer, idx) => {
        layer.id = `layer${idx + 1}`;
        if (!layer.name) {
            layer.name = idx === 0 ? "Layer 1: Base Terrain" : `Layer ${idx + 1}: Biome Overlay`;
        }
        layer.shapers = defaultShapers(layer.shapers || {});
        if (idx >= 1) {
            const defOverlay = createDefaultOverlayLayer(idx + 1);
            layer.maskParams = { ...defOverlay.maskParams, ...(layer.maskParams || {}) };
            layer.blendParams = { ...defOverlay.blendParams, ...(layer.blendParams || {}) };
        }
    });
    stack.layer1 = stack.layers[0];
    stack.layer2 = stack.layers[1];
    stack.simulations = defaultSimulations(stack.simulations || {});
    if (stack.materialPalette === undefined) {
        stack.materialPalette = PRESET_DEFAULT_PALETTE[stack.id] ?? PALETTE_ALPINE_SUMMER;
    }
    return stack;
}

export const PRESETS = [
    // =========================================================================
    // GROUP 1: MOUNTAINS & MASSIFS
    // =========================================================================
    {
        id: "classic-fbm-mountains",
        group: "Mountains & Massifs",
        name: "Classic fBm Mountains (Original)",
        description: "The original fBm + ridged multifractal + domain-warped mountain heightmap, ready for interactive hydraulic droplet erosion.",
        recommendedAreaM: 2560,
        seed: 42,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Classic fBm Heightmap",
                enabled: true,
                generatorId: "gen.ridgeFbm",
                generatorParams: {
                    landformMode: 3, // Classic fBm & Ridged Mountains (Original)
                    baseHeight: 800,
                    frequency: 4.0,
                    ridgeWeight: 0.4,
                    ridgeSharpness: 2.0,
                    scaleVariation: 0.0,
                    warpAmplitude: 0.3,
                    octaves: 6,
                    lacunarity: 2.0,
                    gain: 0.5,
                    warpFrequency: 2.0,
                    secondRangeWeight: 0.0,
                    secondRangeAngle: 65,
                    heightCurve: 2.585,
                },
                shapers: defaultShapers(),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations(),
    },
    {
        id: "alpine-dolomites",
        group: "Mountains & Massifs",
        name: "Alpine Dolomites (Tre Cime & Seceda)",
        description: "Towering 1650m tabular carbonate massifs with sheer vertical dolomitic walls, jagged torri spires, glacial U-valleys, and 33° scree cones.",
        recommendedAreaM: 2560,
        seed: 42,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Carbonate Reef Massifs",
                enabled: true,
                generatorId: "gen.ridgeFbm",
                generatorParams: {
                    landformMode: 1, // Tabular Carbonate Massif (Dolomites)
                    baseHeight: 1650,
                    frequency: 2.1,
                    ridgeWeight: 0.65,
                    ridgeSharpness: 2.7,
                    scaleVariation: 0.7,
                    warpAmplitude: 0.32,
                    octaves: 6,
                    lacunarity: 2.0,
                    gain: 0.5,
                    warpFrequency: 1.8,
                    secondRangeWeight: 0.35,
                    secondRangeAngle: 65,
                    heightCurve: 1.5,
                },
                shapers: defaultShapers({
                    "shape.fold": { enabled: true, directionDeg: 125, steepen: 0.95, gentle: 0.6, minAltM: 220, maxAltM: 1700, strength: 0.75 },
                    "shape.glacialCarve": { enabled: true, carveDepthM: 75, valleyWidth: 2, apexSharpen: 0.85, altitudeGateM: 320, strength: 0.85 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 22, boulderScale: 14, caprockRoughnessM: 18, basinHummocksM: 12, strength: 0.9 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.16, erosionScale: 0.14, erosionOctaves: 4 },
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 68, iterations: 12, transferRate: 0.26, weatheringRate: 0.42 },
        }),
    },
    {
        id: "himalayan-peaks",
        group: "Mountains & Massifs",
        name: "Himalayan High Peaks (Karakoram)",
        description: "Monumental 2150m intersecting tectonic ridge chains with deep glacial troughs, pyramidal horn peaks, and high-altitude snow drifts.",
        recommendedAreaM: 5120,
        seed: 314,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Tectonic Himalayan Range",
                enabled: true,
                generatorId: "gen.ridgeFbm",
                generatorParams: {
                    landformMode: 0, // Tectonic Mountain Range
                    baseHeight: 2150,
                    frequency: 2.6,
                    ridgeWeight: 0.72,
                    ridgeSharpness: 2.8,
                    scaleVariation: 0.78,
                    warpAmplitude: 0.35,
                    octaves: 7,
                    lacunarity: 2.05,
                    gain: 0.52,
                    warpFrequency: 1.9,
                    secondRangeWeight: 0.48,
                    secondRangeAngle: 58,
                    heightCurve: 1.55,
                },
                shapers: defaultShapers({
                    "shape.fold": { enabled: true, directionDeg: 110, steepen: 0.85, gentle: 0.55, minAltM: 250, maxAltM: 2200, strength: 0.7 },
                    "shape.glacialCarve": { enabled: true, carveDepthM: 95, valleyWidth: 3, apexSharpen: 1.15, altitudeGateM: 350, strength: 0.9 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 20, boulderScale: 16, caprockRoughnessM: 20, basinHummocksM: 10, strength: 0.8 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.18, erosionScale: 0.15, erosionOctaves: 5 },
            "sim.windDrift": { enabled: true, windDirectionDeg: 55, minAltitudeM: 520, snowSupplyM: 1.2, iterations: 12, transportRate: 0.7, depositionRate: 1.25 },
        }),
    },

    // =========================================================================
    // GROUP 2: MESAS, TEPUIS & CANYONS
    // =========================================================================
    {
        id: "roraima-tepui",
        group: "Mesas, Tepuis & Canyons",
        name: "Guiana Highlands Tepui (Mt Roraima)",
        description: "Colossal 1450m sheer-walled flat-topped quartzite table mountain rising above a stepped talus pedestal and Gran Sabana highland floor.",
        recommendedAreaM: 5120,
        seed: 192,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Roraima Table Mountain",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 2, // Sheer Table-Top Tepui
                    baseHeight: 1450,
                    cellScale: 2.4,
                    blockRelief: 0.85,
                    canyonWidth: 0.22,
                    canyonDepth: 0.88,
                    jitter: 0.8,
                    blockTilt: 0.06,
                    fractureOctaves: 3,
                    warpAmplitude: 0.32,
                    roughness: 0.26,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 65, sharpness: 0.82, strength: 0.55, strataTiltM: 20, strataAngleDeg: 15, strataWarpM: 18 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 26, boulderScale: 16, caprockRoughnessM: 28, basinHummocksM: 16, strength: 0.95 },
                }),
            },
            createDefaultOverlayLayer(2, {
                name: "Layer 2: Summit Labyrinth & Boulders",
                enabled: true,
                generatorId: "gen.ridgeFbm",
                generatorParams: {
                    landformMode: 2,
                    baseHeight: 120,
                    frequency: 6.5,
                    ridgeWeight: 0.7,
                    ridgeSharpness: 2.6,
                    scaleVariation: 0.8,
                    warpAmplitude: 0.4,
                },
                maskParams: {
                    minAltM: 780,
                    maxAltM: 2400,
                    featherAltM: 80,
                    minSlopeDeg: 0,
                    maxSlopeDeg: 28,
                    featherSlopeDeg: 8,
                    curvatureBias: 0.0,
                    warpAmpM: 45,
                    warpFreq: 1.5,
                    invertMask: 0,
                    blurRadius: 1,
                    blurIterations: 1,
                },
                blendParams: {
                    blendMode: 3, // Masked Additive
                    opacity: 0.75,
                    blendDepthM: 35,
                    blendSmoothM: 18,
                    heightOffsetM: 0,
                    markSediment: 0,
                },
            }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.11, erosionScale: 0.12, erosionOctaves: 4 },
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 34, bedrockReposeDeg: 75, iterations: 8, transferRate: 0.22, weatheringRate: 0.28 },
        }),
    },
    {
        id: "monument-valley-buttes",
        group: "Mesas, Tepuis & Canyons",
        name: "Monument Valley & Mt Conner (Buttes)",
        description: "Isolated flat-topped sandstone buttes, mittens, and mesas rising on sheer caprock cliffs above conical 32° talus skirts and a boulder-strewn desert floor.",
        recommendedAreaM: 5120,
        seed: 88,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Sandstone Buttes & Pediment",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 1, // Isolated Buttes, Mittens & Mesas
                    baseHeight: 1020,
                    cellScale: 2.5,
                    blockRelief: 0.8,
                    canyonWidth: 0.42,
                    canyonDepth: 0.86,
                    jitter: 0.85,
                    blockTilt: 0.04,
                    fractureOctaves: 2,
                    warpAmplitude: 0.25,
                    roughness: 0.24,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 52, sharpness: 0.82, strength: 0.65, strataTiltM: 18, strataAngleDeg: 20, strataWarpM: 14 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 26, boulderScale: 15, caprockRoughnessM: 20, basinHummocksM: 18, strength: 0.95 },
                }),
            },
            createDefaultOverlayLayer(2, {
                name: "Layer 2: Arid Basin Sand Drifts",
                enabled: true,
                generatorId: "gen.duneField",
                generatorParams: {
                    crestMode: 0,
                    duneHeight: 42,
                    duneWavelength: 150,
                    sizeVariation: 0.85,
                    windDirection: 35,
                    brinkPosition: 0.74,
                    draaHeight: 0,
                    interduneFlatness: 0.35,
                    rippleFrequency: 36,
                    rippleAmplitude: 2.2,
                },
                maskParams: {
                    minAltM: -20,
                    maxAltM: 185,
                    featherAltM: 45,
                    minSlopeDeg: 0,
                    maxSlopeDeg: 18,
                    featherSlopeDeg: 6,
                    curvatureBias: -0.25,
                    warpAmpM: 55,
                    warpFreq: 1.3,
                    invertMask: 0,
                    blurRadius: 2,
                    blurIterations: 2,
                },
                blendParams: {
                    blendMode: 0, // Height-Fill
                    opacity: 0.9,
                    blendDepthM: 32,
                    blendSmoothM: 18,
                    heightOffsetM: 5,
                    markSediment: 1,
                },
            }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 70, iterations: 10, transferRate: 0.25, weatheringRate: 0.35 },
        }),
    },
    {
        id: "grand-canyon-gorge",
        group: "Mesas, Tepuis & Canyons",
        name: "Grand Canyon & Island in the Sky",
        description: "Dendritic meandering river gorge with branching side tributaries incised through compound cliff-and-bench horizontal strata.",
        recommendedAreaM: 5120,
        seed: 108,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Dendritic Canyon Plateau",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 0, // Dendritic Trunk & Tributary Gorge
                    baseHeight: 1380,
                    cellScale: 2.8,
                    blockRelief: 0.78,
                    canyonWidth: 0.26,
                    canyonDepth: 0.88,
                    jitter: 0.85,
                    blockTilt: 0.08,
                    fractureOctaves: 3,
                    warpAmplitude: 0.38,
                    roughness: 0.22,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 68, sharpness: 0.84, strength: 0.85, strataTiltM: 28, strataAngleDeg: 25, strataWarpM: 20 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 22, boulderScale: 14, caprockRoughnessM: 22, basinHummocksM: 14, strength: 0.9 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.12, erosionScale: 0.13, erosionOctaves: 4 },
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 34, bedrockReposeDeg: 68, iterations: 12, transferRate: 0.26, weatheringRate: 0.4 },
        }),
    },
    {
        id: "grand-mesa-canyons",
        group: "Mesas, Tepuis & Canyons",
        name: "Grand Mesa & Canyons",
        description: "Stepped canyonlands plateau with multi-tier strata benches, rock outcrops, and eroded talus slopes.",
        recommendedAreaM: 5120,
        seed: 144,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Terraced Mesa Plateau",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 0,
                    baseHeight: 1180,
                    cellScale: 3.2,
                    blockRelief: 0.74,
                    canyonWidth: 0.24,
                    canyonDepth: 0.82,
                    jitter: 0.85,
                    blockTilt: 0.12,
                    fractureOctaves: 3,
                    warpAmplitude: 0.32,
                    roughness: 0.22,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 58, sharpness: 0.8, strength: 0.82, strataTiltM: 35, strataAngleDeg: 25, strataWarpM: 22 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 20, boulderScale: 14, caprockRoughnessM: 18, basinHummocksM: 14, strength: 0.88 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 34, bedrockReposeDeg: 66, iterations: 12, transferRate: 0.26, weatheringRate: 0.42 },
        }),
    },

    // =========================================================================
    // GROUP 3: KARST & AUSTRALIAN LANDMARKS
    // =========================================================================
    {
        id: "zhangjiajie-karst",
        group: "Karst & Australian Landmarks",
        name: "Zhangjiajie Limestone Karst Pillars",
        description: "Dozens of slender, vertical quartz-sandstone and limestone karst pillars, needles, and rock fins rising from a misty canyon floor.",
        recommendedAreaM: 2560,
        seed: 512,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Fenglin Karst Pillars",
                enabled: true,
                generatorId: "gen.ridgeFbm",
                generatorParams: {
                    landformMode: 2, // Karst Towers & Pillars (Zhangjiajie)
                    baseHeight: 1480,
                    frequency: 2.4,
                    ridgeWeight: 0.75,
                    ridgeSharpness: 2.8,
                    scaleVariation: 0.85,
                    warpAmplitude: 0.22,
                    octaves: 6,
                    lacunarity: 2.0,
                    gain: 0.5,
                    warpFrequency: 2.0,
                    secondRangeWeight: 0.3,
                    secondRangeAngle: 70,
                    heightCurve: 1.3,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 38, sharpness: 0.78, strength: 0.35, strataTiltM: 12, strataAngleDeg: 10, strataWarpM: 8 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 14, boulderScale: 18, caprockRoughnessM: 22, basinHummocksM: 14, strength: 0.85 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            // Keep thermalTalus off by default so slender 2-cell-wide vertical rock needles aren't slumped into cones
            "sim.thermalTalus": { enabled: false, talusReposeDeg: 36, bedrockReposeDeg: 78, iterations: 4, transferRate: 0.15, weatheringRate: 0.1 },
        }),
    },
    {
        id: "bungle-bungles-domes",
        group: "Karst & Australian Landmarks",
        name: "Bungle Bungles (Purnululu Domes)",
        description: "Rounded beehive-striped sandstone karst domes carved along orthogonal joint gorges with horizontal strata ribs and boulder floors.",
        recommendedAreaM: 2560,
        seed: 271,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Beehive Sandstone Domes",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 3, // Beehive Domes (Bungle Bungles)
                    baseHeight: 720,
                    cellScale: 3.4,
                    blockRelief: 0.75,
                    canyonWidth: 0.18,
                    canyonDepth: 0.84,
                    jitter: 0.65,
                    blockTilt: 0.03,
                    fractureOctaves: 2,
                    warpAmplitude: 0.22,
                    roughness: 0.2,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 24, sharpness: 0.75, strength: 0.68, strataTiltM: 10, strataAngleDeg: 15, strataWarpM: 8 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 14, boulderScale: 16, caprockRoughnessM: 12, basinHummocksM: 15, strength: 0.85 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 62, iterations: 6, transferRate: 0.2, weatheringRate: 0.25 },
        }),
    },
    {
        id: "wilpena-pound",
        group: "Karst & Australian Landmarks",
        name: "Wilpena Pound (Flinders Ranges)",
        description: "Synclinal oval amphitheater of inward-dipping quartzite strata with sheer outward escarpments, serrated hogback cuesta ridges, and a breached outlet gorge.",
        recommendedAreaM: 5120,
        seed: 404,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Synclinal Quartzite Pound",
                enabled: true,
                generatorId: "gen.islandCaldera",
                generatorParams: {
                    landformMode: 1, // Synclinal Ring (Wilpena Pound)
                    baseHeight: 1160,
                    islandRadius: 0.86,
                    calderaRadius: 0.32,
                    calderaDepth: 0.72,
                    coastWarp: 0.22,
                    rimSharpness: 1.9,
                    radialGullies: 0.45,
                    falloffMix: 0.9,
                },
                shapers: defaultShapers({
                    "shape.fold": { enabled: true, directionDeg: 35, steepen: 0.8, gentle: 0.55, minAltM: 100, maxAltM: 1200, strength: 0.65 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 18, boulderScale: 14, caprockRoughnessM: 18, basinHummocksM: 16, strength: 0.9 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.14, erosionScale: 0.13, erosionOctaves: 4 },
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 34, bedrockReposeDeg: 66, iterations: 8, transferRate: 0.24, weatheringRate: 0.32 },
        }),
    },

    // =========================================================================
    // GROUP 4: GREAT DESERTS & DUNES
    // =========================================================================
    {
        id: "sudan-barchan-dunes",
        group: "Great Deserts & Dunes",
        name: "Sudan Desert (Barchans & Dune Trains)",
        description: "Migrating crescentic barchan dunes and variable dune trains across rough Nubian desert gravel plains with crisp windward ripples.",
        recommendedAreaM: 5120,
        seed: 73,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Barchan Crescent Field",
                enabled: true,
                generatorId: "gen.duneField",
                generatorParams: {
                    crestMode: 2, // Isolated Barchan Crescents (Sudan)
                    duneHeight: 165,
                    duneWavelength: 250,
                    sizeVariation: 0.88,
                    windDirection: 42,
                    brinkPosition: 0.72,
                    draaHeight: 45,
                    draaWavelength: 950,
                    draaAngleOffset: -12,
                    interduneFlatness: 0.28,
                    warpFrequency: 1.2,
                    warpAmplitude: 0.35,
                    stossPower: 1.0,
                    leePower: 1.9,
                    angleOfRepose: 33,
                    rippleFrequency: 38,
                    rippleAmplitude: 3.2,
                    shadowAngle: 14,
                },
                shapers: defaultShapers({
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 10, boulderScale: 18, caprockRoughnessM: 6, basinHummocksM: 12, strength: 0.75 },
                }),
            },
            createDefaultOverlayLayer(2, {
                name: "Layer 2: Secondary Transverse Train",
                enabled: true,
                generatorId: "gen.duneField",
                generatorParams: {
                    crestMode: 0, // Phacelle Y-junctions
                    duneHeight: 110,
                    duneWavelength: 190,
                    sizeVariation: 0.82,
                    windDirection: 48,
                    brinkPosition: 0.75,
                    draaHeight: 0,
                    interduneFlatness: 0.22,
                    rippleFrequency: 36,
                    rippleAmplitude: 2.6,
                },
                maskParams: {
                    minAltM: -10,
                    maxAltM: 280,
                    featherAltM: 60,
                    minSlopeDeg: 0,
                    maxSlopeDeg: 35,
                    featherSlopeDeg: 10,
                    curvatureBias: 0.0,
                    warpAmpM: 120,
                    warpFreq: 0.9,
                    invertMask: 0,
                    blurRadius: 2,
                    blurIterations: 2,
                },
                blendParams: {
                    blendMode: 1, // SmoothMax Fillet
                    opacity: 0.85,
                    blendDepthM: 40,
                    blendSmoothM: 28,
                    heightOffsetM: 0,
                    markSediment: 1,
                },
            }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 38, iterations: 5, transferRate: 0.2, weatheringRate: 0.5 },
        }),
    },
    {
        id: "namib-mega-dunes",
        group: "Great Deserts & Dunes",
        name: "Namib Star & Mega-Dune Sea",
        description: "Towering 340m multi-arm pyramidal star dunes and draa ridges with sharp 33° slip-face brinks, wind-shadow hollows, and stoss ripples.",
        recommendedAreaM: 5120,
        seed: 77,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Pyramidal Star & Draa Dunes",
                enabled: true,
                generatorId: "gen.duneField",
                generatorParams: {
                    crestMode: 3, // Pyramidal Star Dunes (Namib)
                    duneHeight: 310,
                    duneWavelength: 320,
                    sizeVariation: 0.85,
                    windDirection: 40,
                    brinkPosition: 0.74,
                    draaHeight: 190,
                    draaWavelength: 1150,
                    draaAngleOffset: -15,
                    interduneFlatness: 0.2,
                    warpFrequency: 1.1,
                    warpAmplitude: 0.38,
                    stossPower: 1.0,
                    leePower: 1.9,
                    angleOfRepose: 33,
                    rippleFrequency: 36,
                    rippleAmplitude: 3.4,
                    shadowAngle: 14,
                },
                shapers: defaultShapers(),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 36, iterations: 6, transferRate: 0.22, weatheringRate: 0.6 },
        }),
    },
    {
        id: "canyon-valley-dunes",
        group: "Great Deserts & Dunes",
        name: "Canyon & Valley Dunes (Multi-Biome)",
        description: "Multi-layer showcase: dendritic terraced sandstone canyons with barchanoid sand dunes filling the low basin floors and boulder-strewn rims.",
        recommendedAreaM: 5120,
        seed: 64,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Sandstone Canyon & Buttes",
                enabled: true,
                generatorId: "gen.voronoiBlock",
                generatorParams: {
                    formationMode: 0,
                    baseHeight: 1180,
                    cellScale: 3.0,
                    blockRelief: 0.76,
                    canyonWidth: 0.28,
                    canyonDepth: 0.84,
                    jitter: 0.85,
                    blockTilt: 0.1,
                    fractureOctaves: 3,
                    warpAmplitude: 0.34,
                    roughness: 0.22,
                },
                shapers: defaultShapers({
                    "shape.terrace": { enabled: true, stepHeightM: 60, sharpness: 0.8, strength: 0.8, strataTiltM: 30, strataAngleDeg: 20, strataWarpM: 20 },
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 22, boulderScale: 14, caprockRoughnessM: 18, basinHummocksM: 12, strength: 0.9 },
                }),
            },
            createDefaultOverlayLayer(2, {
                name: "Layer 2: Basin Sand Dunes",
                enabled: true,
                generatorId: "gen.duneField",
                generatorParams: {
                    crestMode: 0,
                    duneHeight: 155,
                    duneWavelength: 190,
                    sizeVariation: 0.8,
                    windDirection: 35,
                    brinkPosition: 0.74,
                    draaHeight: 50,
                    draaWavelength: 800,
                    draaAngleOffset: -10,
                    interduneFlatness: 0.12,
                    warpFrequency: 1.2,
                    warpAmplitude: 0.35,
                    stossPower: 1.0,
                    leePower: 1.8,
                    angleOfRepose: 33,
                    rippleFrequency: 34,
                    rippleAmplitude: 2.8,
                    shadowAngle: 14,
                },
                maskParams: {
                    minAltM: -20,
                    maxAltM: 360,
                    featherAltM: 75,
                    minSlopeDeg: 0,
                    maxSlopeDeg: 26,
                    featherSlopeDeg: 9,
                    curvatureBias: -0.3,
                    warpAmpM: 80,
                    warpFreq: 1.25,
                    invertMask: 0,
                    blurRadius: 2,
                    blurIterations: 2,
                },
                blendParams: {
                    blendMode: 0, // Height-Fill
                    opacity: 1.0,
                    blendDepthM: 60,
                    blendSmoothM: 28,
                    heightOffsetM: 20,
                    markSediment: 1,
                },
            }),
        ],
        simulations: defaultSimulations({
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 33, bedrockReposeDeg: 66, iterations: 10, transferRate: 0.25, weatheringRate: 0.32 },
        }),
    },

    // =========================================================================
    // GROUP 5: VOLCANIC & COASTAL
    // =========================================================================
    {
        id: "volcanic-caldera-island",
        group: "Volcanic & Coastal",
        name: "Volcanic Caldera Island",
        description: "Radial volcanic island cone with a collapsed central caldera rim, radial barranco gullies, and surrounding ocean water level.",
        recommendedAreaM: 2560,
        seed: 215,
        layers: [
            {
                id: "layer1",
                name: "Layer 1: Volcanic Caldera Cone",
                enabled: true,
                generatorId: "gen.islandCaldera",
                generatorParams: {
                    landformMode: 0,
                    baseHeight: 1180,
                    islandRadius: 0.84,
                    calderaRadius: 0.24,
                    calderaDepth: 0.62,
                    coastWarp: 0.28,
                    rimSharpness: 1.75,
                    radialGullies: 0.42,
                    falloffMix: 0.88,
                },
                shapers: defaultShapers({
                    "shape.surfaceDetail": { enabled: true, boulderHeightM: 16, boulderScale: 14, caprockRoughnessM: 16, basinHummocksM: 10, strength: 0.8 },
                }),
            },
            createDefaultOverlayLayer(2, { enabled: false }),
        ],
        simulations: defaultSimulations({
            "sim.phacelleErosion": { enabled: true, erosionStrength: 0.15, erosionScale: 0.13, erosionOctaves: 4, gullyWeight: 0.55 },
            "sim.thermalTalus": { enabled: true, talusReposeDeg: 34, bedrockReposeDeg: 62, iterations: 8, transferRate: 0.25, weatheringRate: 0.3 },
            "sim.waterLevel": { enabled: true, waterLevelM: 105, shorelineFlattenM: 16, sedimentFill: 0.4 },
        }),
    },
];

export const DEFAULT_PRESET_ID = "alpine-dolomites";

export function clonePreset(preset) {
    const cloned = JSON.parse(JSON.stringify(preset));
    return normalizeStack(cloned);
}

export function getPresetById(id) {
    // Support legacy preset alias "snow-drifted-peaks" -> "himalayan-peaks"
    const normalizedId = id === "snow-drifted-peaks" ? "himalayan-peaks" : id;
    const found = PRESETS.find((p) => p.id === normalizedId) || PRESETS[0];
    return clonePreset(found);
}

export function serializeStack(stack) {
    return JSON.stringify(normalizeStack(stack), null, 2);
}

export function deserializeStack(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== "object" || (!parsed.layer1 && !Array.isArray(parsed.layers)) || !parsed.simulations) {
        throw new Error("Invalid terrain compositor stack JSON");
    }
    return normalizeStack(parsed);
}
