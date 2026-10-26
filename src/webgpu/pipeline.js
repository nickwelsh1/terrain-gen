// GPU pipeline manager: orchestrates TerrainState, OperatorRegistry, and
// OperatorGraphRunner to execute a composable layer stack + simulation chain.
// Preserves the legacy TerrainPipeline public methods (updateUniforms,
// generateMaps, computeAnalysis, runErosion, resetToBase, getStorageBuffers)
// while adding layer-stack preset & scoped parameter controls.

import {
    DEFAULT_PARAMS,
    PASS_HEIGHTMAP,
    PASS_HARDNESS,
    PASS_NORMALS,
    PASS_EROSION,
} from "./constants.js";
import { TerrainState } from "./state.js";
import { createDefaultRegistry } from "./operators/index.js";
import { OperatorGraphRunner } from "./operators/graph.js";
import { DEFAULT_PRESET_ID, getPresetById } from "./presets.js";

const SHAPER_ORDER = [
    "shape.terrace",
    "shape.fold",
    "shape.glacialCarve",
    "shape.warp",
    "shape.curveRemap",
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
     * Updates a scoped parameter inside the active layer stack.
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

        if (scope === "layer1.gen") {
            if (key === "generatorId") {
                const newGenId = String(value);
                const op = this.registry.get(newGenId);
                this.stack.layer1.generatorId = newGenId;
                if (op) {
                    this.stack.layer1.generatorParams = {
                        ...op.defaultParams,
                        ...this.stack.layer1.generatorParams,
                    };
                }
            } else {
                this.stack.layer1.generatorParams[key] = value;
                if (key === "baseHeight") {
                    this.params.baseHeight = Number(value);
                }
            }
            return;
        }

        if (scope.startsWith("layer1.shaper:")) {
            const shaperId = scope.slice("layer1.shaper:".length);
            if (!this.stack.layer1.shapers[shaperId]) {
                const op = this.registry.get(shaperId);
                this.stack.layer1.shapers[shaperId] = { enabled: false, ...(op ? op.defaultParams : {}) };
            }
            this.stack.layer1.shapers[shaperId][key] = value;
            return;
        }

        if (scope === "layer2") {
            if (key === "enabled") {
                this.stack.layer2.enabled = Boolean(value);
            }
            return;
        }

        if (scope === "layer2.gen") {
            if (key === "generatorId") {
                const newGenId = String(value);
                const op = this.registry.get(newGenId);
                this.stack.layer2.generatorId = newGenId;
                if (op) {
                    this.stack.layer2.generatorParams = {
                        ...op.defaultParams,
                        ...this.stack.layer2.generatorParams,
                    };
                }
            } else {
                this.stack.layer2.generatorParams[key] = value;
            }
            return;
        }

        if (scope === "layer2.mask") {
            this.stack.layer2.maskParams[key] = value;
            return;
        }

        if (scope === "layer2.blend") {
            this.stack.layer2.blendParams[key] = value;
            return;
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
            this.stack.layer1.generatorParams.baseHeight = Number(params.baseHeight);
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
     * Executes the full layer compositor stack + enabled non-droplet simulations.
     */
    generateMaps() {
        const seed = this.stack.seed ?? this.params.seed ?? 42;
        const flags = this.params.passFlags ?? DEFAULT_PARAMS.passFlags;
        this.state.resetIndices();

        // 1. Layer 1: Base Terrain Generator
        if ((flags & PASS_HEIGHTMAP) !== 0 && this.stack.layer1.enabled !== false) {
            const genId = this.stack.layer1.generatorId || "gen.ridgeFbm";
            this.runner.runOperator(genId, {
                ...this.stack.layer1.generatorParams,
                seed,
                clearAux: 1,
                writeSediment: genId === "gen.duneField" ? 1 : 0,
            });

            // Layer 1 Shapers
            for (const shaperId of SHAPER_ORDER) {
                const shaperCfg = this.stack.layer1.shapers?.[shaperId];
                if (shaperCfg?.enabled) {
                    this.runner.runOperator(shaperId, { ...shaperCfg, seed });
                }
            }
        }

        // 2. Preliminary analysis so Layer 2's slope/curvature mask has up-to-date slopes
        if (this.stack.layer2?.enabled) {
            this.runner.runOperator("detail.analysis", {});

            // Compute Layer 2 placement mask into aux.z (maskA)
            const maskCfg = this.stack.layer2.maskParams || {};
            this.runner.runOperator("mask.select", {
                ...maskCfg,
                seed: seed + 101,
            });

            const blurPasses = Math.max(0, Math.trunc(maskCfg.blurIterations ?? 2));
            if (blurPasses > 0) {
                this.runner.runOperator(
                    "mask.blur",
                    { radius: maskCfg.blurRadius ?? 2 },
                    { iterations: blurPasses },
                );
            }

            // Generate Layer 2 heightmap into layerScratch
            const gen2Id = this.stack.layer2.generatorId || "gen.duneField";
            this.runner.runOperator(
                gen2Id,
                {
                    ...this.stack.layer2.generatorParams,
                    seed: seed + 211,
                    clearAux: 0,
                    writeSediment: 0,
                },
                { targetBuffer: this.state.layerScratch },
            );

            // Blend Layer 2 (layerScratch) onto Layer 1 (activeHeight) using aux.z (maskA)
            this.runner.runOperator("blend.layer", {
                ...this.stack.layer2.blendParams,
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

        // 5. Run enabled global simulations (Phacelle Gullies, Thermal Talus, Wind Drift, Water Level)
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

    // `batches` batches of DROPLET_COUNT droplets. Each batch is submitted
    // separately with a new batchSeed so droplets trace distinct paths.
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
