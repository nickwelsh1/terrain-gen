// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
    computeUniformSchema,
    packUniforms,
} from "../../src/webgpu/operators/registry.js";
import { createDefaultRegistry } from "../../src/webgpu/operators/index.js";
import { OperatorGraphRunner } from "../../src/webgpu/operators/graph.js";
import {
    PRESETS,
    getPresetById,
    serializeStack,
    deserializeStack,
} from "../../src/webgpu/presets.js";
import { TerrainPipeline } from "../../src/webgpu/pipeline.js";
import { MAX_BIOME_LAYERS, MAX_HEIGHT_M } from "../../src/webgpu/constants.js";

describe("WebGPU Terrain Compositor Architecture", () => {
    describe("Uniform schema calculation & DataView binary packing", () => {
        it("computes exact WGSL scalar/vector offsets and rounds struct size to 16-byte multiple", () => {
            const schema = computeUniformSchema([
                { key: "crestMode", type: "u32" },
                { key: "duneHeight", type: "f32" },
                { key: "windDirection", type: "f32" },
            ]);

            expect(schema.fields[0].offset).toBe(0);
            expect(schema.fields[1].offset).toBe(4);
            expect(schema.fields[2].offset).toBe(8);
            expect(schema.dataBytes).toBe(12);
            expect(schema.byteLength).toBe(16);
        });

        it("packs mixed u32 and f32 fields accurately with DataView (little-endian)", () => {
            const schema = computeUniformSchema([
                { key: "crestMode", type: "u32" },
                { key: "duneHeight", type: "f32" },
                { key: "brinkPosition", type: "f32" },
            ]);

            const buf = packUniforms(schema, {
                crestMode: 1,
                duneHeight: 240.5,
                brinkPosition: 0.74,
            });

            const view = new DataView(buf);
            expect(view.getUint32(0, true)).toBe(1);
            expect(view.getFloat32(4, true)).toBeCloseTo(240.5, 4);
            expect(view.getFloat32(8, true)).toBeCloseTo(0.74, 4);
        });
    });

    describe("Operator Registry & Shader Catalog", () => {
        const registry = createDefaultRegistry();

        it("registers all required generators, shapers (including surfaceDetail), masks, blends, and simulations", () => {
            const expectedIds = [
                "gen.ridgeFbm",
                "gen.duneField",
                "gen.voronoiBlock",
                "gen.islandCaldera",
                "shape.terrace",
                "shape.fold",
                "shape.warp",
                "shape.curveRemap",
                "shape.glacialCarve",
                "shape.surfaceDetail",
                "mask.hardness",
                "mask.select",
                "mask.blur",
                "blend.layer",
                "sim.dropletErosion",
                "sim.phacelleErosion",
                "sim.thermalTalus",
                "sim.windDrift",
                "sim.waterLevel",
                "detail.analysis",
                "util.copyHeight",
            ];

            for (const id of expectedIds) {
                const op = registry.get(id);
                expect(op, `Missing operator ${id}`).not.toBeNull();
                expect(op.uniformSchema.byteLength % 16).toBe(0);
                expect(typeof op.shaderCode).toBe("string");
                expect(op.shaderCode.length).toBeGreaterThan(50);
            }
        });

        it("exposes all 4 dune crest modes (Phacelle, Warped fBm, Sudan Barchans, Namib Star Dunes) and geological landform modes", () => {
            expect(MAX_HEIGHT_M).toBeGreaterThanOrEqual(2500);

            const duneOp = registry.get("gen.duneField");
            const crestParam = duneOp.paramSchema.find((p) => p.key === "crestMode");
            expect(crestParam).toBeDefined();
            expect(crestParam.options).toEqual([
                { value: 0, label: "Phacelle (Y-junctions)" },
                { value: 1, label: "Warped fBm (Classic)" },
                { value: 2, label: "Barchan Crescents (Sudan)" },
                { value: 3, label: "Pyramidal Star Dunes (Namib)" },
            ]);

            const voronoiOp = registry.get("gen.voronoiBlock");
            const formationParam = voronoiOp.paramSchema.find((p) => p.key === "formationMode");
            expect(formationParam.options.map((o) => o.value)).toEqual([0, 1, 2, 3]);
        });
    });

    describe("Ping-Pong Buffer Ownership in OperatorGraphRunner", () => {
        it("swaps heightA/heightB only on neighborhood ping-pong operators and swaps aux on auxPingPong operators", () => {
            const registry = createDefaultRegistry();
            const fakeState = {
                heightIndex: 0,
                auxIndex: 0,
                swapHeight() {
                    this.heightIndex = 1 - this.heightIndex;
                },
                swapAux() {
                    this.auxIndex = 1 - this.auxIndex;
                },
            };
            const runner = new OperatorGraphRunner(null, registry, fakeState);

            runner.runOperator("gen.ridgeFbm", { baseHeight: 1650 });
            expect(fakeState.heightIndex).toBe(0);

            runner.runOperator("shape.terrace", { stepHeightM: 50 });
            expect(fakeState.heightIndex).toBe(0);

            runner.runOperator("shape.fold", { directionDeg: 90 });
            expect(fakeState.heightIndex).toBe(1);

            runner.runOperator("shape.surfaceDetail", { boulderHeightM: 22 });
            expect(fakeState.heightIndex).toBe(0);

            runner.runOperator("sim.thermalTalus", {}, { iterations: 3 });
            expect(fakeState.heightIndex).toBe(1);
            expect(fakeState.auxIndex).toBe(1);
        });
    });

    describe("12 Real-World Landmark Presets & Dynamic N-Layer Stack", () => {
        it("ships 14 valid landmark presets that round-trip through JSON serialization", () => {
            expect(PRESETS.length).toBe(14);
            const expectedPresetIds = [
                "classic-fbm-mountains",
                "alpine-dolomites",
                "himalayan-peaks",
                "roraima-tepui",
                "monument-valley-buttes",
                "grand-canyon-gorge",
                "grand-mesa-canyons",
                "zhangjiajie-karst",
                "bungle-bungles-domes",
                "wilpena-pound",
                "sudan-barchan-dunes",
                "namib-mega-dunes",
                "canyon-valley-dunes",
                "volcanic-caldera-island",
            ];
            for (const id of expectedPresetIds) {
                const copy = getPresetById(id);
                const json = serializeStack(copy);
                const restored = deserializeStack(json);
                expect(restored.layer1.generatorId).toBe(copy.layer1.generatorId);
                expect(Array.isArray(restored.layers)).toBe(true);
            }
        });

        it("supports adding and removing dynamic biome layers up to MAX_BIOME_LAYERS (8)", () => {
            const pipeline = new TerrainPipeline(null);
            pipeline.setPreset("canyon-valley-dunes");
            expect(pipeline.getStack().layers.length).toBe(2);

            for (let i = 2; i < MAX_BIOME_LAYERS; i++) {
                const added = pipeline.addLayer({ name: `Custom Layer ${i + 1}` });
                expect(added).not.toBeNull();
            }
            expect(pipeline.getStack().layers.length).toBe(MAX_BIOME_LAYERS);

            // Adding beyond MAX_BIOME_LAYERS returns null
            expect(pipeline.addLayer()).toBeNull();

            // Update a parameter on layer4
            pipeline.updateScopedParam("layer4.gen", "duneHeight", 210);
            expect(pipeline.getStack().layers[3].generatorParams.duneHeight).toBe(210);

            // Remove layer index 2
            expect(pipeline.removeLayer(2)).toBe(true);
            expect(pipeline.getStack().layers.length).toBe(MAX_BIOME_LAYERS - 1);
        });
    });
});
