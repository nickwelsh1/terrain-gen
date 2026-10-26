// Catalog of all composable GPU terrain operators registered into OperatorRegistry.
// Covers:
// - Generators (4): gen.ridgeFbm, gen.duneField, gen.voronoiBlock, gen.islandCaldera
// - Shapers (5):    shape.terrace, shape.fold, shape.warp, shape.curveRemap, shape.glacialCarve
// - Masks/Blend(4): mask.hardness, mask.select, mask.blur, blend.layer
// - Simulations(4): sim.dropletErosion, sim.phacelleErosion, sim.thermalTalus, sim.windDrift, sim.waterLevel
// - Analysis/Util:  detail.analysis, util.copyHeight

import {
    DROPLET_WORKGROUPS,
    DEFAULT_PARAMS,
    MAX_HEIGHT_M,
} from "../constants.js";
import { OperatorRegistry } from "./registry.js";
import {
    GEN_RIDGE_FBM_SHADER,
    GEN_DUNE_FIELD_SHADER,
    GEN_VORONOI_BLOCK_SHADER,
    GEN_ISLAND_CALDERA_SHADER,
} from "../shaders/ops/generators.wgsl.js";
import {
    SHAPE_TERRACE_SHADER,
    SHAPE_FOLD_SHADER,
    SHAPE_WARP_SHADER,
    SHAPE_CURVE_REMAP_SHADER,
    SHAPE_GLACIAL_CARVE_SHADER,
    SHAPE_SURFACE_DETAIL_SHADER,
} from "../shaders/ops/shapers.wgsl.js";
import {
    MASK_SELECT_SHADER,
    MASK_BLUR_SHADER,
    BLEND_LAYER_SHADER,
} from "../shaders/ops/masks-blends.wgsl.js";
import {
    SIM_THERMAL_TALUS_SHADER,
    SIM_WIND_DRIFT_SHADER,
    SIM_WATER_LEVEL_SHADER,
    SIM_PHACELLE_EROSION_SHADER,
    UTIL_COPY_HEIGHT_SHADER,
} from "../shaders/ops/simulations.wgsl.js";
import { HARDNESS_SHADER } from "../shaders/hardness.wgsl.js";
import { EROSION_SHADER } from "../shaders/erosion.wgsl.js";
import { ANALYSIS_SHADER } from "../shaders/analysis.wgsl.js";

export function createDefaultRegistry() {
    const reg = new OperatorRegistry();

    // =========================================================================
    // GENERATORS
    // =========================================================================
    reg.register({
        id: "gen.ridgeFbm",
        label: "Mountains, Massifs & Karst",
        category: "generator",
        pingPong: false,
        entryPoint: "generateHeightmap",
        shaderCode: GEN_RIDGE_FBM_SHADER,
        paramSchema: [
            {
                key: "landformMode",
                label: "Mountain type",
                type: "select",
                options: [
                    { value: 0, label: "Tectonic Range (Himalayas)" },
                    { value: 1, label: "Carbonate Massif (Dolomites)" },
                    { value: 2, label: "Karst Towers (Zhangjiajie)" },
                    { value: 3, label: "Classic fBm Mountains (Original)" },
                ],
                min: 0,
                max: 3,
                step: 1,
                default: 0,
                tier: "primary",
            },
            { key: "baseHeight", label: "Base height (m)", min: 25, max: MAX_HEIGHT_M, step: 10, default: 1500, tier: "primary" },
            { key: "frequency", label: "Massif frequency", min: 0.5, max: 10, step: 0.25, default: 2.6, tier: "primary" },
            { key: "ridgeWeight", label: "Ridge crest weight", min: 0, max: 1, step: 0.05, default: 0.55, tier: "primary" },
            { key: "ridgeSharpness", label: "Peak sharpness", min: 0.5, max: 4, step: 0.1, default: 2.2, tier: "primary" },
            { key: "scaleVariation", label: "Scale variety", min: 0, max: 1, step: 0.05, default: 0.65, tier: "primary" },
            { key: "warpAmplitude", label: "Domain warp", min: 0, max: 1, step: 0.05, default: 0.35, tier: "advanced" },
            { key: "octaves", label: "Octaves", min: 1, max: 8, step: 1, default: 6, tier: "advanced" },
            { key: "lacunarity", label: "Lacunarity", min: 1.5, max: 3, step: 0.1, default: 2.0, tier: "advanced" },
            { key: "gain", label: "Gain", min: 0.2, max: 0.8, step: 0.05, default: 0.5, tier: "advanced" },
            { key: "warpFrequency", label: "Warp frequency", min: 0.5, max: 6, step: 0.25, default: 2.0, tier: "advanced" },
            { key: "secondRangeWeight", label: "Cross-range weight", min: 0, max: 1, step: 0.05, default: 0.35, tier: "advanced" },
            { key: "secondRangeAngle", label: "Cross-range angle (°)", min: 0, max: 180, step: 5, default: 65, tier: "advanced" },
            { key: "heightCurve", label: "Valley curve", min: 0.5, max: 4, step: 0.05, default: 1.65, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
            { key: "clearAux", label: "Clear Aux", min: 0, max: 1, step: 1, default: 1, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "landformMode", type: "u32" },
            { key: "baseHeight", type: "f32" },
            { key: "frequency", type: "f32" },
            { key: "octaves", type: "f32" },
            { key: "lacunarity", type: "f32" },
            { key: "gain", type: "f32" },
            { key: "ridgeWeight", type: "f32" },
            { key: "ridgeSharpness", type: "f32" },
            { key: "warpAmplitude", type: "f32" },
            { key: "warpFrequency", type: "f32" },
            { key: "secondRangeWeight", type: "f32" },
            { key: "secondRangeAngle", type: "f32" },
            { key: "heightCurve", type: "f32" },
            { key: "scaleVariation", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "clearAux", type: "u32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                    { binding: 2, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "gen.duneField",
        label: "Aeolian Sand Dunes",
        category: "generator",
        pingPong: false,
        entryPoint: "generateDunes",
        shaderCode: GEN_DUNE_FIELD_SHADER,
        paramSchema: [
            {
                key: "crestMode",
                label: "Crest mode",
                type: "select",
                options: [
                    { value: 0, label: "Phacelle (Y-junctions)" },
                    { value: 1, label: "Warped fBm (Classic)" },
                    { value: 2, label: "Barchan Crescents (Sudan)" },
                    { value: 3, label: "Pyramidal Star Dunes (Namib)" },
                ],
                min: 0,
                max: 3,
                step: 1,
                default: 0,
                tier: "primary",
            },
            { key: "duneHeight", label: "Dune height (m)", min: 5, max: 600, step: 5, default: 160, tier: "primary" },
            { key: "duneWavelength", label: "Dune spacing (m)", min: 40, max: 900, step: 10, default: 240, tier: "primary" },
            { key: "sizeVariation", label: "Formation variety", min: 0, max: 1, step: 0.05, default: 0.75, tier: "primary" },
            { key: "windDirection", label: "Wind direction (°)", min: 0, max: 360, step: 5, default: 45, tier: "primary" },
            { key: "brinkPosition", label: "Brink asymmetry", min: 0.55, max: 0.9, step: 0.02, default: 0.74, tier: "primary" },
            { key: "draaHeight", label: "Draa mega-dune (m)", min: 0, max: 500, step: 10, default: 110, tier: "primary" },
            { key: "rippleAmplitude", label: "Windward ripples (m)", min: 0, max: 8, step: 0.2, default: 2.4, tier: "primary" },
            { key: "draaWavelength", label: "Draa spacing (m)", min: 300, max: 2500, step: 50, default: 950, tier: "advanced" },
            { key: "draaAngleOffset", label: "Draa angle offset (°)", min: -45, max: 45, step: 5, default: -15, tier: "advanced" },
            { key: "interduneFlatness", label: "Interdune flatness", min: 0, max: 0.7, step: 0.05, default: 0.18, tier: "advanced" },
            { key: "warpFrequency", label: "Crest warp freq", min: 0.2, max: 5, step: 0.1, default: 1.2, tier: "advanced" },
            { key: "warpAmplitude", label: "Crest warp amp", min: 0, max: 1, step: 0.05, default: 0.38, tier: "advanced" },
            { key: "stossPower", label: "Windward curve", min: 0.5, max: 2, step: 0.05, default: 1.0, tier: "advanced" },
            { key: "leePower", label: "Slip-face curve", min: 1.0, max: 3.5, step: 0.1, default: 1.8, tier: "advanced" },
            { key: "angleOfRepose", label: "Angle of repose (°)", min: 28, max: 38, step: 1, default: 33, tier: "advanced" },
            { key: "rippleFrequency", label: "Ripple frequency", min: 5, max: 60, step: 1, default: 34, tier: "advanced" },
            { key: "shadowAngle", label: "Wind shadow (°)", min: 8, max: 22, step: 1, default: 14, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
            { key: "writeSediment", label: "Write Sediment", min: 0, max: 1, step: 1, default: 1, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "crestMode", type: "u32" },
            { key: "duneHeight", type: "f32" },
            { key: "duneWavelength", type: "f32" },
            { key: "windDirection", type: "f32" },
            { key: "brinkPosition", type: "f32" },
            { key: "interduneFlatness", type: "f32" },
            { key: "draaHeight", type: "f32" },
            { key: "draaWavelength", type: "f32" },
            { key: "draaAngleOffset", type: "f32" },
            { key: "warpFrequency", type: "f32" },
            { key: "warpAmplitude", type: "f32" },
            { key: "stossPower", type: "f32" },
            { key: "leePower", type: "f32" },
            { key: "angleOfRepose", type: "f32" },
            { key: "rippleFrequency", type: "f32" },
            { key: "rippleAmplitude", type: "f32" },
            { key: "shadowAngle", type: "f32" },
            { key: "sizeVariation", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "writeSediment", type: "u32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                    { binding: 2, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "gen.voronoiBlock",
        label: "Canyons, Buttes, Tepuis & Domes",
        category: "generator",
        pingPong: false,
        entryPoint: "generateVoronoiBlocks",
        shaderCode: GEN_VORONOI_BLOCK_SHADER,
        paramSchema: [
            {
                key: "formationMode",
                label: "Formation type",
                type: "select",
                options: [
                    { value: 0, label: "Dendritic Gorge (Grand Canyon)" },
                    { value: 1, label: "Isolated Buttes (Monument Valley)" },
                    { value: 2, label: "Table-Top Tepui (Mt Roraima)" },
                    { value: 3, label: "Beehive Domes (Bungle Bungles)" },
                ],
                min: 0,
                max: 3,
                step: 1,
                default: 0,
                tier: "primary",
            },
            { key: "baseHeight", label: "Plateau / Butte height (m)", min: 50, max: MAX_HEIGHT_M, step: 10, default: 1100, tier: "primary" },
            { key: "cellScale", label: "Formation scale", min: 1, max: 16, step: 0.5, default: 3.0, tier: "primary" },
            { key: "blockRelief", label: "Step / Caprock relief", min: 0, max: 1, step: 0.05, default: 0.72, tier: "primary" },
            { key: "canyonWidth", label: "Gorge / Basin spacing", min: 0.04, max: 0.6, step: 0.02, default: 0.22, tier: "primary" },
            { key: "canyonDepth", label: "Vertical incision", min: 0.1, max: 1, step: 0.05, default: 0.82, tier: "primary" },
            { key: "jitter", label: "Cell jitter", min: 0, max: 1, step: 0.05, default: 0.85, tier: "advanced" },
            { key: "blockTilt", label: "Strata dip / tilt", min: -0.4, max: 0.4, step: 0.02, default: 0.08, tier: "advanced" },
            { key: "fractureOctaves", label: "Tributary octaves", min: 1, max: 3, step: 1, default: 3, tier: "advanced" },
            { key: "warpAmplitude", label: "River / Rim meander", min: 0, max: 0.8, step: 0.05, default: 0.35, tier: "advanced" },
            { key: "roughness", label: "Caprock roughness", min: 0, max: 0.6, step: 0.02, default: 0.22, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
            { key: "clearAux", label: "Clear Aux", min: 0, max: 1, step: 1, default: 1, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "formationMode", type: "u32" },
            { key: "baseHeight", type: "f32" },
            { key: "cellScale", type: "f32" },
            { key: "blockRelief", type: "f32" },
            { key: "canyonWidth", type: "f32" },
            { key: "canyonDepth", type: "f32" },
            { key: "jitter", type: "f32" },
            { key: "blockTilt", type: "f32" },
            { key: "fractureOctaves", type: "f32" },
            { key: "warpAmplitude", type: "f32" },
            { key: "roughness", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "clearAux", type: "u32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                    { binding: 2, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "gen.islandCaldera",
        label: "Caldera & Syncline Pound",
        category: "generator",
        pingPong: false,
        entryPoint: "generateIslandCaldera",
        shaderCode: GEN_ISLAND_CALDERA_SHADER,
        paramSchema: [
            {
                key: "landformMode",
                label: "Ring landform",
                type: "select",
                options: [
                    { value: 0, label: "Volcanic Caldera Island" },
                    { value: 1, label: "Synclinal Ring (Wilpena Pound)" },
                ],
                min: 0,
                max: 1,
                step: 1,
                default: 0,
                tier: "primary",
            },
            { key: "baseHeight", label: "Rim height (m)", min: 50, max: MAX_HEIGHT_M, step: 10, default: 1050, tier: "primary" },
            { key: "islandRadius", label: "Ring / Island radius", min: 0.2, max: 1.0, step: 0.05, default: 0.8, tier: "primary" },
            { key: "calderaRadius", label: "Inner basin radius", min: 0, max: 0.6, step: 0.02, default: 0.24, tier: "primary" },
            { key: "calderaDepth", label: "Basin depth", min: 0, max: 1, step: 0.05, default: 0.6, tier: "primary" },
            { key: "coastWarp", label: "Perimeter warp", min: 0, max: 0.6, step: 0.05, default: 0.25, tier: "primary" },
            { key: "rimSharpness", label: "Dip / Rim steepness", min: 0.5, max: 4.0, step: 0.1, default: 1.8, tier: "advanced" },
            { key: "radialGullies", label: "Radial gullies / notches", min: 0, max: 1.0, step: 0.05, default: 0.35, tier: "advanced" },
            { key: "falloffMix", label: "Radial / square mix", min: 0, max: 1.0, step: 0.05, default: 0.85, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
            { key: "clearAux", label: "Clear Aux", min: 0, max: 1, step: 1, default: 1, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "landformMode", type: "u32" },
            { key: "baseHeight", type: "f32" },
            { key: "islandRadius", type: "f32" },
            { key: "calderaRadius", type: "f32" },
            { key: "calderaDepth", type: "f32" },
            { key: "coastWarp", type: "f32" },
            { key: "rimSharpness", type: "f32" },
            { key: "radialGullies", type: "f32" },
            { key: "falloffMix", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "clearAux", type: "u32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                    { binding: 2, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    // =========================================================================
    // SHAPERS / FILTERS
    // =========================================================================
    reg.register({
        id: "shape.terrace",
        label: "Terrace & Tilted Strata",
        category: "shaper",
        pingPong: false,
        entryPoint: "applyTerrace",
        shaderCode: SHAPE_TERRACE_SHADER,
        paramSchema: [
            { key: "stepHeightM", label: "Strata step (m)", min: 10, max: 250, step: 5, default: 55, tier: "primary" },
            { key: "sharpness", label: "Bench sharpness", min: 0.1, max: 0.95, step: 0.05, default: 0.75, tier: "primary" },
            { key: "strength", label: "Terrace blend", min: 0, max: 1, step: 0.05, default: 0.75, tier: "primary" },
            { key: "strataTiltM", label: "Strata tilt (m)", min: 0, max: 200, step: 5, default: 35, tier: "advanced" },
            { key: "strataAngleDeg", label: "Tilt direction (°)", min: 0, max: 360, step: 5, default: 30, tier: "advanced" },
            { key: "strataWarpM", label: "Bed undulation (m)", min: 0, max: 100, step: 5, default: 20, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "stepHeightM", type: "f32" },
            { key: "sharpness", type: "f32" },
            { key: "strataTiltM", type: "f32" },
            { key: "strataAngleDeg", type: "f32" },
            { key: "strataWarpM", type: "f32" },
            { key: "strength", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "_pad0", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "shape.fold",
        label: "Asymmetric Scarp / Dip Fold",
        category: "shaper",
        pingPong: true,
        entryPoint: "applyFold",
        shaderCode: SHAPE_FOLD_SHADER,
        paramSchema: [
            { key: "directionDeg", label: "Dip direction (°)", min: 0, max: 360, step: 5, default: 120, tier: "primary" },
            { key: "steepen", label: "Scarp steepening", min: 0, max: 2, step: 0.1, default: 0.85, tier: "primary" },
            { key: "gentle", label: "Dip gentling", min: 0, max: 2, step: 0.1, default: 0.65, tier: "primary" },
            { key: "strength", label: "Fold strength", min: 0, max: 1, step: 0.05, default: 0.8, tier: "primary" },
            { key: "minAltM", label: "Min altitude (m)", min: 0, max: 800, step: 20, default: 80, tier: "advanced" },
            { key: "maxAltM", label: "Max altitude (m)", min: 200, max: 1500, step: 20, default: 1200, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "directionDeg", type: "f32" },
            { key: "steepen", type: "f32" },
            { key: "gentle", type: "f32" },
            { key: "minAltM", type: "f32" },
            { key: "maxAltM", type: "f32" },
            { key: "strength", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "_pad0", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "shape.warp",
        label: "Domain Warp & Swirl",
        category: "shaper",
        pingPong: true,
        entryPoint: "applyWarp",
        shaderCode: SHAPE_WARP_SHADER,
        paramSchema: [
            { key: "warpAmplitudeM", label: "Warp offset (m)", min: 0, max: 300, step: 5, default: 65, tier: "primary" },
            { key: "warpFrequency", label: "Warp frequency", min: 0.5, max: 8, step: 0.25, default: 2.5, tier: "primary" },
            { key: "swirlStrength", label: "Tectonic swirl", min: -2, max: 2, step: 0.1, default: 0.0, tier: "primary" },
            { key: "octaves", label: "Warp octaves", min: 1, max: 5, step: 1, default: 3, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "warpAmplitudeM", type: "f32" },
            { key: "warpFrequency", type: "f32" },
            { key: "swirlStrength", type: "f32" },
            { key: "octaves", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
            { key: "_pad2", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "shape.curveRemap",
        label: "Altitude Curve & Valley Flatten",
        category: "shaper",
        pingPong: false,
        entryPoint: "applyCurveRemap",
        shaderCode: SHAPE_CURVE_REMAP_SHADER,
        paramSchema: [
            { key: "gamma", label: "Slope gamma", min: 0.3, max: 3.0, step: 0.05, default: 1.15, tier: "primary" },
            { key: "valleyFloorM", label: "Valley floor (m)", min: 0, max: 400, step: 10, default: 40, tier: "primary" },
            { key: "plateauCeilingM", label: "Plateau cap (m)", min: 200, max: 1500, step: 20, default: 1500, tier: "primary" },
            { key: "valleySmoothM", label: "Floor fillet (m)", min: 5, max: 150, step: 5, default: 45, tier: "advanced" },
            { key: "strength", label: "Remap blend", min: 0, max: 1, step: 0.05, default: 1.0, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "gamma", type: "f32" },
            { key: "valleyFloorM", type: "f32" },
            { key: "valleySmoothM", type: "f32" },
            { key: "plateauCeilingM", type: "f32" },
            { key: "strength", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
            { key: "_pad2", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer, opts = {}) {
            const target = opts.targetBuffer || state.activeHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: target._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "shape.glacialCarve",
        label: "Glacial U-Valleys & Apex Peaks",
        category: "shaper",
        pingPong: true,
        entryPoint: "applyGlacialCarve",
        shaderCode: SHAPE_GLACIAL_CARVE_SHADER,
        paramSchema: [
            { key: "carveDepthM", label: "U-valley depth (m)", min: 0, max: 200, step: 5, default: 60, tier: "primary" },
            { key: "apexSharpen", label: "Apex peak sharpen", min: -0.5, max: 2.0, step: 0.1, default: 0.7, tier: "primary" },
            { key: "strength", label: "Glacial strength", min: 0, max: 1, step: 0.05, default: 0.85, tier: "primary" },
            { key: "valleyWidth", label: "Trough radius", min: 1, max: 4, step: 1, default: 2, tier: "advanced" },
            { key: "altitudeGateM", label: "Peak gate (m)", min: 0, max: 1000, step: 25, default: 200, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "carveDepthM", type: "f32" },
            { key: "valleyWidth", type: "f32" },
            { key: "apexSharpen", type: "f32" },
            { key: "altitudeGateM", type: "f32" },
            { key: "strength", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
            { key: "_pad2", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "shape.surfaceDetail",
        label: "Boulders, Outcrops & Micro-Relief",
        category: "shaper",
        pingPong: true,
        entryPoint: "applySurfaceDetail",
        shaderCode: SHAPE_SURFACE_DETAIL_SHADER,
        paramSchema: [
            { key: "boulderHeightM", label: "Boulders & blocks (m)", min: 0, max: 60, step: 2, default: 18, tier: "primary" },
            { key: "caprockRoughnessM", label: "Caprock ledges (m)", min: 0, max: 50, step: 2, default: 14, tier: "primary" },
            { key: "basinHummocksM", label: "Valley hummocks & rills (m)", min: 0, max: 40, step: 2, default: 12, tier: "primary" },
            { key: "strength", label: "Detail blend", min: 0, max: 1, step: 0.05, default: 0.85, tier: "primary" },
            { key: "boulderScale", label: "Boulder cluster scale", min: 4, max: 32, step: 2, default: 14, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "boulderHeightM", type: "f32" },
            { key: "boulderScale", type: "f32" },
            { key: "caprockRoughnessM", type: "f32" },
            { key: "basinHummocksM", type: "f32" },
            { key: "strength", type: "f32" },
            { key: "seed", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                ],
            });
        },
    });

    // =========================================================================
    // MASKS & BIOME BLENDING
    // =========================================================================
    reg.register({
        id: "mask.hardness",
        label: "Bedrock Hardness Field",
        category: "detailer",
        pingPong: false,
        entryPoint: "generateHardness",
        shaderCode: HARDNESS_SHADER,
        paramSchema: [
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "rainRate", type: "f32" },
            { key: "erosionRate", type: "f32" },
            { key: "depositionRate", type: "f32" },
            { key: "evaporation", type: "f32" },
            { key: "sedimentCapacity", type: "f32" },
            { key: "stepCount", type: "f32" },
            { key: "passFlags", type: "u32" },
            { key: "seed", type: "f32" },
            { key: "baseHeight", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.hardness._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "mask.select",
        label: "Biome Placement Mask",
        category: "detailer",
        pingPong: false,
        entryPoint: "selectMask",
        shaderCode: MASK_SELECT_SHADER,
        paramSchema: [
            { key: "minAltM", label: "Min altitude (m)", min: -50, max: 1200, step: 10, default: -20, tier: "primary" },
            { key: "maxAltM", label: "Max altitude (m)", min: 20, max: 1500, step: 10, default: 320, tier: "primary" },
            { key: "maxSlopeDeg", label: "Max slope (°)", min: 5, max: 90, step: 1, default: 26, tier: "primary" },
            { key: "warpAmpM", label: "Organic edge warp (m)", min: 0, max: 250, step: 5, default: 65, tier: "primary" },
            { key: "featherAltM", label: "Altitude feather (m)", min: 5, max: 250, step: 5, default: 60, tier: "advanced" },
            { key: "minSlopeDeg", label: "Min slope (°)", min: 0, max: 75, step: 1, default: 0, tier: "advanced" },
            { key: "featherSlopeDeg", label: "Slope feather (°)", min: 2, max: 30, step: 1, default: 8, tier: "advanced" },
            { key: "curvatureBias", label: "Valley / Ridge bias", min: -1, max: 1, step: 0.1, default: -0.35, tier: "advanced" },
            { key: "warpFreq", label: "Warp frequency", min: 0.25, max: 4, step: 0.25, default: 1.25, tier: "advanced" },
            { key: "invertMask", label: "Invert mask", min: 0, max: 1, step: 1, default: 0, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "minAltM", type: "f32" },
            { key: "maxAltM", type: "f32" },
            { key: "featherAltM", type: "f32" },
            { key: "minSlopeDeg", type: "f32" },
            { key: "maxSlopeDeg", type: "f32" },
            { key: "featherSlopeDeg", type: "f32" },
            { key: "curvatureBias", type: "f32" },
            { key: "warpAmpM", type: "f32" },
            { key: "warpFreq", type: "f32" },
            { key: "invertMask", type: "u32" },
            { key: "seed", type: "f32" },
            { key: "_pad0", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.slopes._buffer } },
                    { binding: 3, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "mask.blur",
        label: "Mask Spatial Feather",
        category: "detailer",
        pingPong: false,
        auxPingPong: true,
        entryPoint: "blurMask",
        shaderCode: MASK_BLUR_SHADER,
        paramSchema: [
            { key: "radius", label: "Feather radius", min: 1, max: 3, step: 1, default: 2, tier: "primary" },
            { key: "iterations", label: "Blur passes", min: 1, max: 4, step: 1, default: 2, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "radius", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
            { key: "_pad2", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeAux._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "blend.layer",
        label: "Biome Layer Blend",
        category: "blend",
        pingPong: false,
        entryPoint: "blendLayers",
        shaderCode: BLEND_LAYER_SHADER,
        paramSchema: [
            {
                key: "blendMode",
                label: "Blend mode",
                type: "select",
                options: [
                    { value: 0, label: "Height-Fill (Crevices First)" },
                    { value: 1, label: "Smooth Max Fillet" },
                    { value: 2, label: "Feathered Replace" },
                    { value: 3, label: "Masked Additive" },
                ],
                min: 0,
                max: 3,
                step: 1,
                default: 0,
                tier: "primary",
            },
            { key: "opacity", label: "Layer opacity", min: 0, max: 1, step: 0.05, default: 1.0, tier: "primary" },
            { key: "blendDepthM", label: "Fill depth (m)", min: 5, max: 250, step: 5, default: 45, tier: "primary" },
            { key: "blendSmoothM", label: "Seam smoothness (m)", min: 2, max: 120, step: 2, default: 24, tier: "primary" },
            { key: "heightOffsetM", label: "Elevation offset (m)", min: -200, max: 200, step: 5, default: 0, tier: "advanced" },
            { key: "markSediment", label: "Track as sand/sediment", min: 0, max: 1, step: 1, default: 1, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "blendMode", type: "u32" },
            { key: "opacity", type: "f32" },
            { key: "blendDepthM", type: "f32" },
            { key: "blendSmoothM", type: "f32" },
            { key: "heightOffsetM", type: "f32" },
            { key: "markSediment", type: "u32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.layerScratch._buffer } },
                    { binding: 3, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    // =========================================================================
    // SIMULATIONS
    // =========================================================================
    reg.register({
        id: "sim.dropletErosion",
        label: "Hydraulic Droplet Erosion",
        category: "simulation",
        pingPong: false,
        entryPoint: "simulateDroplets",
        shaderCode: EROSION_SHADER,
        paramSchema: [
            { key: "erosionRate", label: "Erosion strength", min: 0.1, max: 5, step: 0.1, default: DEFAULT_PARAMS.erosionRate, tier: "primary" },
            { key: "stepCount", label: "Droplet batches", min: 1, max: 10000, step: 1, default: DEFAULT_PARAMS.stepCount, tier: "primary" },
            { key: "rainRate", label: "Water per droplet (L)", min: 0.1, max: 10, step: 0.1, default: DEFAULT_PARAMS.rainRate, tier: "advanced" },
            { key: "depositionRate", label: "Deposition strength", min: 0.01, max: 1, step: 0.01, default: DEFAULT_PARAMS.depositionRate, tier: "advanced" },
            { key: "evaporation", label: "Evaporation", min: 0.01, max: 0.5, step: 0.01, default: DEFAULT_PARAMS.evaporation, tier: "advanced" },
            { key: "sedimentCapacity", label: "Sediment capacity", min: 0.1, max: 2, step: 0.1, default: DEFAULT_PARAMS.sedimentCapacity, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "rainRate", type: "f32" },
            { key: "erosionRate", type: "f32" },
            { key: "depositionRate", type: "f32" },
            { key: "evaporation", type: "f32" },
            { key: "sedimentCapacity", type: "f32" },
            { key: "stepCount", type: "f32" },
            { key: "passFlags", type: "u32" },
            { key: "seed", type: "f32" },
            { key: "baseHeight", type: "f32" },
            { key: "batchSeed", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.hardness._buffer } },
                    { binding: 3, resource: { buffer: state.dropletBuffer } },
                ],
            });
        },
        dispatch(pass) {
            pass.dispatchWorkgroups(DROPLET_WORKGROUPS);
        },
    });

    reg.register({
        id: "sim.phacelleErosion",
        label: "Phacelle Analytic Gully Erosion",
        category: "simulation",
        pingPong: true,
        entryPoint: "applyPhacelleErosion",
        shaderCode: SIM_PHACELLE_EROSION_SHADER,
        paramSchema: [
            { key: "erosionStrength", label: "Gully depth", min: 0.01, max: 0.45, step: 0.01, default: 0.16, tier: "primary" },
            { key: "erosionScale", label: "Gully spacing", min: 0.04, max: 0.35, step: 0.01, default: 0.14, tier: "primary" },
            { key: "erosionOctaves", label: "Branching octaves", min: 1, max: 6, step: 1, default: 4, tier: "primary" },
            { key: "gullyWeight", label: "Gully weight", min: 0.1, max: 1, step: 0.05, default: 0.5, tier: "advanced" },
            { key: "ridgeRounding", label: "Ridge rounding", min: 0, max: 1, step: 0.05, default: 0.12, tier: "advanced" },
            { key: "creaseRounding", label: "Crease rounding", min: 0, max: 1, step: 0.05, default: 0.05, tier: "advanced" },
            { key: "assumedSlope", label: "Assumed slope", min: 0.2, max: 1.5, step: 0.05, default: 0.7, tier: "advanced" },
            { key: "seed", label: "Seed", min: 0, max: 999999, step: 1, default: 42, tier: "hidden" },
        ],
        uniformLayout: [
            { key: "erosionStrength", type: "f32" },
            { key: "erosionScale", type: "f32" },
            { key: "erosionOctaves", type: "f32" },
            { key: "gullyWeight", type: "f32" },
            { key: "ridgeRounding", type: "f32" },
            { key: "creaseRounding", type: "f32" },
            { key: "assumedSlope", type: "f32" },
            { key: "seed", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                    { binding: 3, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "sim.thermalTalus",
        label: "Thermal Talus & Scree Cones",
        category: "simulation",
        pingPong: true,
        auxPingPong: true,
        entryPoint: "stepThermalTalus",
        shaderCode: SIM_THERMAL_TALUS_SHADER,
        paramSchema: [
            { key: "talusReposeDeg", label: "Scree repose (°)", min: 26, max: 42, step: 1, default: 33, tier: "primary" },
            { key: "bedrockReposeDeg", label: "Cliff bedrock (°)", min: 45, max: 78, step: 1, default: 62, tier: "primary" },
            { key: "iterations", label: "Talus steps", min: 1, max: 40, step: 1, default: 12, tier: "primary" },
            { key: "transferRate", label: "Slump rate", min: 0.05, max: 0.45, step: 0.05, default: 0.25, tier: "advanced" },
            { key: "weatheringRate", label: "Cliff scree supply", min: 0, max: 1, step: 0.05, default: 0.35, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "talusReposeDeg", type: "f32" },
            { key: "bedrockReposeDeg", type: "f32" },
            { key: "transferRate", type: "f32" },
            { key: "weatheringRate", type: "f32" },
            { key: "_pad0", type: "f32" },
            { key: "_pad1", type: "f32" },
            { key: "_pad2", type: "f32" },
            { key: "_pad3", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                    { binding: 3, resource: { buffer: state.activeAux._buffer } },
                    { binding: 4, resource: { buffer: state.inactiveAux._buffer } },
                    { binding: 5, resource: { buffer: state.hardness._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "sim.windDrift",
        label: "Wind Saltation & Snow Drift",
        category: "simulation",
        pingPong: true,
        auxPingPong: true,
        entryPoint: "stepWindDrift",
        shaderCode: SIM_WIND_DRIFT_SHADER,
        paramSchema: [
            { key: "windDirectionDeg", label: "Wind direction (°)", min: 0, max: 360, step: 5, default: 45, tier: "primary" },
            { key: "minAltitudeM", label: "Snow / drift line (m)", min: 0, max: 1000, step: 20, default: 320, tier: "primary" },
            { key: "snowSupplyM", label: "Drift supply (m)", min: 0, max: 3, step: 0.1, default: 0.8, tier: "primary" },
            { key: "iterations", label: "Drift steps", min: 1, max: 30, step: 1, default: 10, tier: "primary" },
            { key: "transportRate", label: "Saltation rate", min: 0.1, max: 2, step: 0.1, default: 0.6, tier: "advanced" },
            { key: "depositionRate", label: "Leeward trap", min: 0.2, max: 2, step: 0.1, default: 1.1, tier: "advanced" },
            { key: "shadowAngleDeg", label: "Shadow angle (°)", min: 8, max: 22, step: 1, default: 15, tier: "advanced" },
            { key: "reposeAngleDeg", label: "Drift repose (°)", min: 28, max: 42, step: 1, default: 36, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "windDirectionDeg", type: "f32" },
            { key: "transportRate", type: "f32" },
            { key: "depositionRate", type: "f32" },
            { key: "minAltitudeM", type: "f32" },
            { key: "shadowAngleDeg", type: "f32" },
            { key: "reposeAngleDeg", type: "f32" },
            { key: "snowSupplyM", type: "f32" },
            { key: "_pad0", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.inactiveHeight._buffer } },
                    { binding: 3, resource: { buffer: state.activeAux._buffer } },
                    { binding: 4, resource: { buffer: state.inactiveAux._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "sim.waterLevel",
        label: "Water Level & Lake Flooding",
        category: "simulation",
        pingPong: false,
        entryPoint: "applyWaterLevel",
        shaderCode: SIM_WATER_LEVEL_SHADER,
        paramSchema: [
            { key: "waterLevelM", label: "Water elevation (m)", min: 0, max: 600, step: 5, default: 0, tier: "primary" },
            { key: "shorelineFlattenM", label: "Shore shelf (m)", min: 2, max: 40, step: 2, default: 12, tier: "primary" },
            { key: "sedimentFill", label: "Basin silt fill", min: 0, max: 1, step: 0.05, default: 0.35, tier: "advanced" },
        ],
        uniformLayout: [
            { key: "waterLevelM", type: "f32" },
            { key: "shorelineFlattenM", type: "f32" },
            { key: "sedimentFill", type: "f32" },
            { key: "_pad0", type: "f32" },
        ],
        createBindGroup(device, pipeline, state, uniformBuffer) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 2, resource: { buffer: state.activeAux._buffer } },
                ],
            });
        },
    });

    // =========================================================================
    // ANALYSIS & UTILITIES
    // =========================================================================
    reg.register({
        id: "detail.analysis",
        label: "Normals, Slope, Curvature & AO",
        category: "detailer",
        pingPong: false,
        entryPoint: "computeNormals",
        shaderCode: ANALYSIS_SHADER,
        paramSchema: [],
        uniformLayout: [],
        createBindGroup(device, pipeline, state) {
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: state.activeHeight._buffer } },
                    { binding: 1, resource: { buffer: state.normals._buffer } },
                    { binding: 2, resource: { buffer: state.slopes._buffer } },
                    { binding: 3, resource: { buffer: state.aspects._buffer } },
                ],
            });
        },
    });

    reg.register({
        id: "util.copyHeight",
        label: "Copy Height Buffer",
        category: "utility",
        pingPong: false,
        entryPoint: "copyHeight",
        shaderCode: UTIL_COPY_HEIGHT_SHADER,
        paramSchema: [],
        uniformLayout: [],
        createBindGroup(device, pipeline, state, _uniformBuffer, opts = {}) {
            const src = opts.srcBuffer || state.activeHeight;
            const dst = opts.targetBuffer || state.baseHeight;
            return device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: src._buffer } },
                    { binding: 1, resource: { buffer: dst._buffer } },
                ],
            });
        },
    });

    return reg;
}
