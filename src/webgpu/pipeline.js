// GPU pipeline manager: orchestrates TerrainState, OperatorRegistry, and
// OperatorGraphRunner to execute a composable N-layer stack (up to MAX_BIOME_LAYERS)
// + global simulation chain.

import {
    DEFAULT_PARAMS,
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

export const SHAPER_ORDER = [
    "shape.terrace",
    "shape.fold",
    "shape.glacialCarve",
    "shape.warp",
    "shape.curveRemap",
    "shape.surfaceDetail",
];

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
        this.stack = getPresetById(presetId);
        this.params.seed = this.stack.seed;
        if (this.stack.layer1.generatorParams.baseHeight !== undefined) {
            this.params.baseHeight = this.stack.layer1.generatorParams.baseHeight;
        }
        const dropSim = this.stack.simulations["sim.dropletErosion"];
        if (dropSim) {
            this.params = { ...this.params, ...dropSim };
        }
        return this.stack;
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

        // Match layerN, layerN.gen, layerN.mask, layerN.blend, layerN.shaper:<id>
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
                    if (layerIdx === 0 && key === "baseHeight") {
                        this.params.baseHeight = Number(value);
                    }
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
                layer.maskParams[key] = value;
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

    /**
     * Executes the full N-layer compositor stack + enabled non-droplet simulations.
     */
    generateMaps() {
        const seed = this.stack.seed ?? this.params.seed ?? 42;
        const flags = this.params.passFlags ?? DEFAULT_PARAMS.passFlags;
        this.state.resetIndices();

        const layers = this.stack.layers || [];
        const baseLayer = layers[0];

        // 1. Layer 1 (index 0): Base Terrain Generator + Shapers
        if ((flags & PASS_HEIGHTMAP) !== 0 && baseLayer && baseLayer.enabled !== false) {
            const genId = baseLayer.generatorId || "gen.ridgeFbm";
            this.runner.runOperator(genId, {
                ...baseLayer.generatorParams,
                seed,
                clearAux: 1,
                writeSediment: genId === "gen.duneField" ? 1 : 0,
            });

            for (const shaperId of SHAPER_ORDER) {
                const shaperCfg = baseLayer.shapers?.[shaperId];
                if (shaperCfg?.enabled) {
                    this.runner.runOperator(shaperId, { ...shaperCfg, seed });
                }
            }
        }

        // 2. Overlay Layers (indices 1 .. min(layers.length, MAX_BIOME_LAYERS) - 1)
        const maxLayerCount = Math.min(layers.length, MAX_BIOME_LAYERS);
        for (let i = 1; i < maxLayerCount; i++) {
            const overlay = layers[i];
            if (!overlay?.enabled) continue;

            const layerSeed = seed + i * 107;

            // Compute current normals/slopes/curvature so mask.select has accurate terrain data
            this.runner.runOperator("detail.analysis", {});

            // Evaluate placement mask into aux.z (maskA)
            const maskCfg = overlay.maskParams || {};
            this.runner.runOperator("mask.select", {
                ...maskCfg,
                seed: layerSeed + 31,
            });

            const blurPasses = Math.max(0, Math.trunc(maskCfg.blurIterations ?? 2));
            if (blurPasses > 0) {
                this.runner.runOperator(
                    "mask.blur",
                    { radius: maskCfg.blurRadius ?? 2 },
                    { iterations: blurPasses },
                );
            }

            // Generate overlay layer heightmap into layerScratch
            const genId = overlay.generatorId || "gen.duneField";
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

        // 3. Generate rock hardness field
        if ((flags & PASS_HARDNESS) !== 0) {
            this.runner.runOperator("mask.hardness", {
                ...this.params,
                seed,
            });
        }

        // 4. Snapshot pre-simulation composite height into baseHeight (for Reset to Base)
        this.runner.runOperator(
            "util.copyHeight",
            {},
            { srcBuffer: this.state.activeHeight, targetBuffer: this.state.baseHeight },
        );

        // 5. Run enabled global simulations
        const sims = this.stack.simulations || {};

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
