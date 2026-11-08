// GPU pipeline manager: orchestrates TerrainState, OperatorRegistry, and
// OperatorGraphRunner to execute a composable N-layer stack (up to MAX_BIOME_LAYERS)
// + global simulation chain.

import {
    DEFAULT_PARAMS,
    DEFAULT_PALETTE_SWATCHES,
    PALETTE_NEUTRAL_CLAY,
    MAX_BIOME_LAYERS,
    PASS_HEIGHTMAP,
    PASS_HARDNESS,
    PASS_NORMALS,
    PASS_EROSION,
} from "./constants.js";
import { TerrainState } from "./state.js";
import { createDefaultRegistry } from "./operators/index.js";
import { OperatorGraphRunner } from "./operators/graph.js";
import {
    DEFAULT_PRESET_ID,
    getPresetById,
    createDefaultOverlayLayer,
    normalizeStack,
} from "./presets.js";

export const MACRO_SHAPER_ORDER = [
    "shape.terrace",
    "shape.fold",
    "shape.glacialCarve",
    "shape.warp",
    "shape.curveRemap",
];

export const SHAPER_ORDER = [
    ...MACRO_SHAPER_ORDER,
    "shape.surfaceDetail",
];

function hexToRgb01(hex) {
    if (typeof hex !== "string") return [0.72, 0.7, 0.67];
    const clean = hex.trim().replace(/^#/, "");
    if (clean.length === 3) {
        const r = Number.parseInt(clean[0] + clean[0], 16) / 255;
        const g = Number.parseInt(clean[1] + clean[1], 16) / 255;
        const b = Number.parseInt(clean[2] + clean[2], 16) / 255;
        return [r || 0, g || 0, b || 0];
    }
    if (clean.length >= 6) {
        const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
        const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
        const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
        return [r || 0, g || 0, b || 0];
    }
    return [0.72, 0.7, 0.67];
}

export class TerrainPipeline {
    constructor(engine) {
        this.engine = engine;
        this.device = engine ? engine._device : null;
        this.state = new TerrainState(engine);
        this.registry = createDefaultRegistry();
        this.runner = new OperatorGraphRunner(this.device, this.registry, this.state);
        this.params = { ...DEFAULT_PARAMS };
        this.stack = getPresetById(DEFAULT_PRESET_ID);
        this.onBuffersChanged = null;
    }

    async init() {
        this.state.init();
        this.runner.init();
        this.syncMaterialsBuffer();
    }

    setOnBuffersChanged(cb) {
        this.onBuffersChanged = cb;
    }

    _notifyBuffersChanged() {
        if (typeof this.onBuffersChanged === "function") {
            this.onBuffersChanged(this.state);
        }
    }

    getStack() {
        return this.stack;
    }

    getRegistry() {
        return this.registry;
    }

    setPreset(presetId) {
        const prevMat = this.stack?.materials ? JSON.parse(JSON.stringify(this.stack.materials)) : null;
        const prevPalette = this.stack?.materialPalette;
        this.stack = getPresetById(presetId);
        // Preserve current material selection (e.g. Neutral Clay default) when switching presets
        if (prevMat) {
            this.stack.materials = prevMat;
        }
        if (prevPalette !== undefined) {
            this.stack.materialPalette = prevPalette;
        }
        this.params.seed = this.stack.seed;
        if (this.stack.layer1.generatorParams.baseHeight !== undefined) {
            this.params.baseHeight = this.stack.layer1.generatorParams.baseHeight;
        }
        const dropSim = this.stack.simulations["sim.dropletErosion"];
        if (dropSim) {
            this.params = { ...this.params, ...dropSim };
        }
        this.syncMaterialsBuffer();
        return this.stack;
    }

    /**
     * Restores a complete stack object (e.g. from Open Terrain JSON), normalizes it,
     * syncs uniforms and GPU material buffers, and returns the normalized stack.
     */
    loadStack(stackData) {
        const cloned = JSON.parse(JSON.stringify(stackData));
        this.stack = normalizeStack(cloned);
        this.params.seed = this.stack.seed ?? 42;
        if (this.stack.layer1?.generatorParams?.baseHeight !== undefined) {
            this.params.baseHeight = this.stack.layer1.generatorParams.baseHeight;
        }
        const dropSim = this.stack.simulations?.["sim.dropletErosion"];
        if (dropSim) {
            this.params = { ...this.params, ...dropSim };
        }
        if (this.stack.materialPalette !== undefined) {
            this.params.materialPalette = this.stack.materialPalette;
        }
        this.syncMaterialsBuffer();
        return this.stack;
    }

    syncMaterialsBuffer() {
        if (!this.state || typeof this.state.updateMaterials !== "function") return;
        const buf = new Float32Array(32 * 4);
        const mats = this.stack?.materials || {};

        const packSlot = (slotObj, vec4Offset, fallbackEnabled) => {
            if (!slotObj) return;
            const b = vec4Offset * 4;
            const enabled = slotObj.enabled ?? fallbackEnabled ? 1.0 : 0.0;
            const paletteId = Number(slotObj.paletteId ?? PALETTE_NEUTRAL_CLAY);
            const opacity = Number(slotObj.opacity ?? 1.0);
            const hasCustom = slotObj.customColors ? 1.0 : 1.0;

            buf[b + 0] = enabled;
            buf[b + 1] = paletteId;
            buf[b + 2] = opacity;
            buf[b + 3] = hasCustom;

            const sh = slotObj.shader || {};
            buf[b + 4] = Number(sh.rockType ?? 0);
            buf[b + 5] = Number(sh.cliffScale ?? 1.0);
            buf[b + 6] = Number(sh.foldStrength ?? 1.2);
            buf[b + 7] = Number(sh.outcropExposure ?? 0.55);

            const m = slotObj.maskParams || {};
            buf[b + 8] = Number(sh.snowLineM ?? 1800);
            buf[b + 9] = Number(m.sourceStep ?? 0);
            buf[b + 10] = Number(m.maskSource ?? 0);
            buf[b + 11] = Number(m.invertMask ?? 0);

            buf[b + 12] = Number(m.contrast ?? 1.0);
            buf[b + 13] = Number(m.bias ?? 0.0);
            buf[b + 14] = Number(m.minAltM ?? -50);
            buf[b + 15] = Number(m.maxAltM ?? 2500);

            buf[b + 16] = Number(m.maxSlopeDeg ?? 90);
            buf[b + 17] = Number(m.curvatureBias ?? 0.0);
            buf[b + 18] = Number(m.warpAmpM ?? 40);
            buf[b + 19] = Number(m.warpFreq ?? 1.25);

            const defaultColors =
                DEFAULT_PALETTE_SWATCHES[paletteId]?.colors ||
                DEFAULT_PALETTE_SWATCHES[PALETTE_NEUTRAL_CLAY].colors;
            const cols = Array.isArray(slotObj.colors) && slotObj.colors.length >= 5 ? slotObj.colors : defaultColors;
            for (let c = 0; c < 5; c++) {
                const [r, g, bl] = hexToRgb01(cols[c]);
                const cb = b + (5 + c) * 4;
                buf[cb + 0] = r;
                buf[cb + 1] = g;
                buf[cb + 2] = bl;
                buf[cb + 3] = 1.0;
            }
        };

        packSlot(mats.material1, 0, true);
        packSlot(mats.material2, 16, false);
        this.state.updateMaterials(buf);
    }

    /**
     * Appends a new overlay biome layer to the stack up to MAX_BIOME_LAYERS (8).
     */
    addLayer(overrides = {}) {
        if (this.stack.layers.length >= MAX_BIOME_LAYERS) {
            return null;
        }
        const nextIndex = this.stack.layers.length + 1;
        const newLayer = createDefaultOverlayLayer(nextIndex, {
            enabled: true,
            ...overrides,
        });
        this.stack.layers.push(newLayer);
        normalizeStack(this.stack);
        return newLayer;
    }

    /**
     * Removes an overlay layer by 0-based index (keeps at least 2 layers so layer1/layer2 always exist).
     */
    removeLayer(layerIndex) {
        if (layerIndex < 2 || layerIndex >= this.stack.layers.length) {
            return false;
        }
        this.stack.layers.splice(layerIndex, 1);
        normalizeStack(this.stack);
        return true;
    }

    /**
     * Updates a scoped parameter inside any layer (`layer1`, `layer2`, ..., `layer8`) or simulation.
     * @param {string} scope e.g. "layer1.gen", "layer1.shaper:shape.terrace", "layer2.gen", "layer2.mask", "layer2.blend", "sim:sim.thermalTalus"
     * @param {string} key
     * @param {number|boolean|string} value
     */
    updateScopedParam(scope, key, value) {
        if (scope === "global") {
            if (key === "seed") {
                this.stack.seed = Number(value);
                this.params.seed = Number(value);
            }
            return;
        }

        const maskVal = key === "invertMask" ? (value ? 1 : 0) : value;

        if (scope === "erosion.mask") {
            if (!this.stack.erosionMask) this.stack.erosionMask = {};
            this.stack.erosionMask[key] = maskVal;
            return;
        }

        const matMatch = /^(material[12])(?:\.(.+))?$/.exec(scope);
        if (matMatch) {
            const matKey = matMatch[1];
            const sub = matMatch[2] || "";
            if (!this.stack.materials) normalizeStack(this.stack);
            const matSlot = this.stack.materials[matKey];
            if (!matSlot) return;

            if (sub === "") {
                if (key === "enabled") matSlot.enabled = Boolean(value);
                else if (key === "opacity") matSlot.opacity = Number(value);
            } else if (sub === "mask") {
                matSlot.maskParams[key] = maskVal;
            } else if (sub === "shader") {
                matSlot.shader[key] = value;
            } else if (sub === "palette") {
                if (key === "paletteId") {
                    const pid = Number(value);
                    matSlot.paletteId = pid;
                    if (matKey === "material1") {
                        this.stack.materialPalette = pid;
                    }
                    const presetSwatch = DEFAULT_PALETTE_SWATCHES[pid];
                    if (presetSwatch) {
                        matSlot.colors = [...presetSwatch.colors];
                        matSlot.shader = {
                            ...matSlot.shader,
                            rockType: presetSwatch.rockType,
                            cliffScale: presetSwatch.cliffScale,
                            foldStrength: presetSwatch.foldStrength,
                            outcropExposure: presetSwatch.outcropExposure,
                            snowLineM: presetSwatch.snowLineM,
                        };
                    }
                } else if (key === "colors" && Array.isArray(value)) {
                    matSlot.colors = [...value];
                    matSlot.customColors = true;
                } else if (key.startsWith("color")) {
                    const cIdx = Number.parseInt(key.slice("color".length), 10);
                    if (cIdx >= 0 && cIdx < 5) {
                        matSlot.colors[cIdx] = String(value);
                        matSlot.customColors = true;
                    }
                }
            }
            this.syncMaterialsBuffer();
            return;
        }

        // Match layerN, layerN.gen, layerN.mask, layerN.detailMask, layerN.detail, layerN.blend, layerN.shaper:<id>
        const layerMatch = /^layer(\d+)(?:\.(.+))?$/.exec(scope);
        if (layerMatch) {
            const layerIdx = Number.parseInt(layerMatch[1], 10) - 1;
            const subScope = layerMatch[2] || "";
            const layer = this.stack.layers[layerIdx];
            if (!layer) return;

            if (subScope === "") {
                if (key === "enabled") {
                    layer.enabled = Boolean(value);
                } else if (key === "name") {
                    layer.name = String(value);
                }
                return;
            }

            if (subScope === "gen") {
                if (key === "generatorId") {
                    const newGenId = String(value);
                    const op = this.registry.get(newGenId);
                    layer.generatorId = newGenId;
                    if (op) {
                        layer.generatorParams = {
                            ...op.defaultParams,
                            ...layer.generatorParams,
                        };
                    }
                } else {
                    layer.generatorParams[key] = value;
                    if (key === "baseHeight") {
                        layer.generatorParams.duneHeight = Number(value);
                        if (layerIdx === 0) this.params.baseHeight = Number(value);
                    } else if (key === "duneHeight") {
                        layer.generatorParams.baseHeight = Number(value);
                        if (layerIdx === 0) this.params.baseHeight = Number(value);
                    } else if (key === "frequency") {
                        layer.generatorParams.cellScale = Number(value);
                    } else if (key === "cellScale") {
                        layer.generatorParams.frequency = Number(value);
                    } else if (key === "orientationDeg") {
                        layer.generatorParams.windDirection = Number(value);
                    } else if (key === "windDirection") {
                        layer.generatorParams.orientationDeg = Number(value);
                    }
                }
                return;
            }

            if (subScope === "detailMask") {
                if (!layer.detailMaskParams) layer.detailMaskParams = {};
                layer.detailMaskParams[key] = maskVal;
                return;
            }

            if (subScope === "detail") {
                if (!layer.shapers["shape.surfaceDetail"]) {
                    const op = this.registry.get("shape.surfaceDetail");
                    layer.shapers["shape.surfaceDetail"] = { enabled: false, ...(op ? op.defaultParams : {}) };
                }
                if (key === "generatorId") {
                    layer.detailGeneratorId = String(value);
                } else {
                    layer.shapers["shape.surfaceDetail"][key] = value;
                }
                return;
            }

            if (subScope.startsWith("shaper:")) {
                const shaperId = subScope.slice("shaper:".length);
                if (!layer.shapers[shaperId]) {
                    const op = this.registry.get(shaperId);
                    layer.shapers[shaperId] = { enabled: false, ...(op ? op.defaultParams : {}) };
                }
                layer.shapers[shaperId][key] = value;
                return;
            }

            if (subScope === "mask" && layer.maskParams) {
                layer.maskParams[key] = maskVal;
                return;
            }

            if (subScope === "blend" && layer.blendParams) {
                layer.blendParams[key] = value;
                return;
            }
        }

        if (scope.startsWith("sim:")) {
            const simId = scope.slice("sim:".length);
            if (!this.stack.simulations[simId]) {
                const op = this.registry.get(simId);
                this.stack.simulations[simId] = { enabled: false, ...(op ? op.defaultParams : {}) };
            }
            this.stack.simulations[simId][key] = value;
            if (simId === "sim.dropletErosion") {
                this.params[key] = value;
            }
        }
    }

    updateUniforms(params) {
        this.params = { ...this.params, ...params };
        if (params.seed !== undefined) {
            this.stack.seed = Number(params.seed);
        }
        if (params.baseHeight !== undefined) {
            this.stack.layers[0].generatorParams.baseHeight = Number(params.baseHeight);
            this.stack.layers[0].generatorParams.duneHeight = Number(params.baseHeight);
        }
        const dropSim = this.stack.simulations["sim.dropletErosion"];
        if (dropSim) {
            for (const k of ["rainRate", "erosionRate", "depositionRate", "evaporation", "sedimentCapacity", "stepCount"]) {
                if (params[k] !== undefined) {
                    dropSim[k] = Number(params[k]);
                }
            }
        }
    }

    _resolveMaskHeightBuffer(sourceStep) {
        if (Number(sourceStep) === 1 && this.state.baseLayerHeight) {
            return this.state.baseLayerHeight;
        }
        if (Number(sourceStep) === 2 && this.state.baseHeight) {
            return this.state.baseHeight;
        }
        return this.state.activeHeight;
    }

    _evaluateMaskPass(maskCfg = {}, seed = 42) {
        this.runner.runOperator("detail.analysis", {});
        const heightBuffer = this._resolveMaskHeightBuffer(maskCfg.sourceStep);
        this.runner.runOperator(
            "mask.select",
            {
                ...maskCfg,
                seed,
            },
            { heightBuffer },
        );
        const blurPasses = Math.max(0, Math.trunc(maskCfg.blurIterations ?? 2));
        if (blurPasses > 0) {
            this.runner.runOperator(
                "mask.blur",
                { radius: maskCfg.blurRadius ?? 2 },
                { iterations: blurPasses },
            );
        }
    }

    _runLayerDetailPass(layer, seed) {
        const detailCfg = layer.shapers?.["shape.surfaceDetail"];
        if (!detailCfg?.enabled) return;

        this._evaluateMaskPass(layer.detailMaskParams || {}, seed + 19);
        const detailGenId = layer.detailGeneratorId || "shape.surfaceDetail";
        if (detailGenId === "shape.surfaceDetail") {
            this.runner.runOperator("shape.surfaceDetail", {
                ...detailCfg,
                seed: seed + 37,
                useMask: 1,
            });
        } else {
            this.runner.runOperator(
                detailGenId,
                {
                    ...layer.generatorParams,
                    ...detailCfg,
                    seed: seed + 37,
                    clearAux: 0,
                    writeSediment: 0,
                },
                { targetBuffer: this.state.layerScratch },
            );
            this.runner.runOperator("blend.layer", {
                blendMode: 3,
                opacity: detailCfg.strength ?? 0.85,
                blendDepthM: 25,
                blendSmoothM: 12,
                heightOffsetM: 0,
                markSediment: 0,
            });
        }
    }

    /**
     * Executes the full N-layer compositor stack + enabled non-droplet simulations.
     */
    generateMaps() {
        const seed = this.stack.seed ?? this.params.seed ?? 42;
        const flags = this.params.passFlags ?? DEFAULT_PARAMS.passFlags;
        this.state.resetIndices();

        const layers = this.stack.layers || [];
        const baseLayer = layers[0];

        // 1. Layer 1 (index 0): Broad Terrain Generator + Macro Shapers + Masked Detail Terrain
        if ((flags & PASS_HEIGHTMAP) !== 0 && baseLayer && baseLayer.enabled !== false) {
            const genId = baseLayer.generatorId || "gen.ridgeFbm";
            if (genId === "shape.surfaceDetail") {
                this.runner.runOperator("shape.surfaceDetail", {
                    ...(baseLayer.shapers?.["shape.surfaceDetail"] || {}),
                    ...baseLayer.generatorParams,
                    seed,
                    useMask: 0,
                });
            } else {
                this.runner.runOperator(genId, {
                    ...baseLayer.generatorParams,
                    seed,
                    clearAux: 1,
                    writeSediment: genId === "gen.duneField" ? 1 : 0,
                });
            }

            for (const shaperId of MACRO_SHAPER_ORDER) {
                const shaperCfg = baseLayer.shapers?.[shaperId];
                if (shaperCfg?.enabled) {
                    this.runner.runOperator(shaperId, { ...shaperCfg, seed });
                }
            }

            // Snapshot Layer 1 Broad Terrain before detail/overlay layers for sourceStep = 1
            this.runner.runOperator(
                "util.copyHeight",
                {},
                { srcBuffer: this.state.activeHeight, targetBuffer: this.state.baseLayerHeight },
            );

            // Run Layer 1 Detail Mask -> Layer 1 Detail Terrain
            this._runLayerDetailPass(baseLayer, seed);
        }

        // 2. Overlay Layers (indices 1 .. min(layers.length, MAX_BIOME_LAYERS) - 1)
        const maxLayerCount = Math.min(layers.length, MAX_BIOME_LAYERS);
        for (let i = 1; i < maxLayerCount; i++) {
            const overlay = layers[i];
            if (!overlay?.enabled) continue;

            const layerSeed = seed + i * 107;

            // Evaluate Layer N placement mask into aux.z (maskA)
            this._evaluateMaskPass(overlay.maskParams || {}, layerSeed + 31);

            const genId = overlay.generatorId || "gen.duneField";
            if (genId === "shape.surfaceDetail") {
                this.runner.runOperator("shape.surfaceDetail", {
                    ...(overlay.shapers?.["shape.surfaceDetail"] || {}),
                    ...overlay.generatorParams,
                    seed: layerSeed + 73,
                    useMask: 1,
                });
            } else {
                // Generate overlay layer heightmap into layerScratch
                this.runner.runOperator(
                    genId,
                    {
                        ...overlay.generatorParams,
                        seed: layerSeed + 73,
                        clearAux: 0,
                        writeSediment: 0,
                    },
                    { targetBuffer: this.state.layerScratch },
                );

                // Run pointwise shapers on layerScratch if enabled on this overlay layer
                for (const shaperId of ["shape.terrace", "shape.curveRemap"]) {
                    const shaperCfg = overlay.shapers?.[shaperId];
                    if (shaperCfg?.enabled) {
                        this.runner.runOperator(
                            shaperId,
                            { ...shaperCfg, seed: layerSeed + 91 },
                            { targetBuffer: this.state.layerScratch },
                        );
                    }
                }

                // Blend layerScratch onto activeHeight using aux.z (maskA)
                this.runner.runOperator("blend.layer", {
                    ...overlay.blendParams,
                });
            }

            // Run Layer N Detail Mask -> Layer N Detail Terrain if enabled
            this._runLayerDetailPass(overlay, layerSeed + 149);
        }

        // 3. Generate rock hardness field
        if ((flags & PASS_HARDNESS) !== 0) {
            this.runner.runOperator("mask.hardness", {
                ...this.params,
                seed,
            });
        }

        // 4. Snapshot pre-simulation composite height into baseHeight (for Reset to Base & sourceStep = 2)
        this.runner.runOperator(
            "util.copyHeight",
            {},
            { srcBuffer: this.state.activeHeight, targetBuffer: this.state.baseHeight },
        );

        // 5. Evaluate Erosion Influence Mask & run enabled global simulations
        const sims = this.stack.simulations || {};
        const anyExtraSimEnabled =
            sims["sim.phacelleErosion"]?.enabled ||
            sims["sim.thermalTalus"]?.enabled ||
            sims["sim.windDrift"]?.enabled ||
            sims["sim.waterLevel"]?.enabled;

        if (anyExtraSimEnabled && this.stack.erosionMask) {
            this._evaluateMaskPass(this.stack.erosionMask, seed + 503);
        }

        if (sims["sim.phacelleErosion"]?.enabled) {
            this.runner.runOperator("sim.phacelleErosion", {
                ...sims["sim.phacelleErosion"],
                seed,
            });
        }

        if (sims["sim.thermalTalus"]?.enabled) {
            const talusCfg = sims["sim.thermalTalus"];
            this.runner.runOperator("sim.thermalTalus", talusCfg, {
                iterations: talusCfg.iterations ?? 10,
            });
        }

        if (sims["sim.windDrift"]?.enabled) {
            const windCfg = sims["sim.windDrift"];
            this.runner.runOperator("sim.windDrift", windCfg, {
                iterations: windCfg.iterations ?? 10,
            });
        }

        if (sims["sim.waterLevel"]?.enabled) {
            this.runner.runOperator("sim.waterLevel", sims["sim.waterLevel"]);
        } else {
            this.runner.runOperator("sim.waterLevel", { waterLevelM: 0 });
        }

        this.syncMaterialsBuffer();
        this._notifyBuffersChanged();
    }

    computeAnalysis() {
        if ((this.params.passFlags & PASS_NORMALS) !== 0) {
            this.runner.runOperator("detail.analysis", {});
        }
        this._notifyBuffersChanged();
    }

    runErosion(batches) {
        if ((this.params.passFlags & PASS_EROSION) !== 0) {
            const count = Math.max(1, Math.trunc(batches || this.params.stepCount || 1));
            for (let i = 0; i < count; i++) {
                this.params.batchSeed = (this.params.batchSeed || 0) + 1;
                this.runner.runOperator("sim.dropletErosion", {
                    ...this.params,
                });
            }
        }
        this.computeAnalysis();
    }

    resetToBase() {
        this.runner.runOperator(
            "util.copyHeight",
            {},
            { srcBuffer: this.state.baseHeight, targetBuffer: this.state.activeHeight },
        );
        this.computeAnalysis();
    }

    getStorageBuffers() {
        return this.state.getStorageBuffers();
    }
}
