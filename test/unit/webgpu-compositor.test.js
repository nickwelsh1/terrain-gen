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

        it("registers all required generators, shapers, masks, blends, and simulations", () => {
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

        it("exposes both Phacelle (Y-junctions) and Warped fBm (Classic) crest modes on gen.duneField", () => {
            const duneOp = registry.get("gen.duneField");
            const crestParam = duneOp.paramSchema.find((p) => p.key === "crestMode");
            expect(crestParam).toBeDefined();
            expect(crestParam.options).toEqual([
                { value: 0, label: "Phacelle (Y-junctions)" },
                { value: 1, label: "Warped fBm (Classic)" },
            ]);

            // Also verify mega-dune height range exceeds the old 100m cap
            const heightParam = duneOp.paramSchema.find((p) => p.key === "duneHeight");
            expect(heightParam.max).toBeGreaterThanOrEqual(500);
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

            // Pointwise generator does not swap height
            runner.runOperator("gen.ridgeFbm", { baseHeight: 900 });
            expect(fakeState.heightIndex).toBe(0);

            // Pointwise terrace shaper does not swap height
            runner.runOperator("shape.terrace", { stepHeightM: 50 });
            expect(fakeState.heightIndex).toBe(0);

            // Neighborhood fold shaper swaps height once
            runner.runOperator("shape.fold", { directionDeg: 90 });
            expect(fakeState.heightIndex).toBe(1);

            // Thermal talus with 3 iterations swaps both height and aux 3 times (1 -> 0, 0 -> 1)
            runner.runOperator("sim.thermalTalus", {}, { iterations: 3 });
            expect(fakeState.heightIndex).toBe(0);
            expect(fakeState.auxIndex).toBe(1);
        });
    });

    describe("Built-in Presets & Pipeline Stack Management", () => {
        it("ships 6 valid presets that round-trip through JSON serialization", () => {
            expect(PRESETS.length).toBe(6);
            for (const preset of PRESETS) {
                const copy = getPresetById(preset.id);
                const json = serializeStack(copy);
                const restored = deserializeStack(json);
                expect(restored.id).toBe(preset.id);
                expect(restored.layer1.generatorId).toBe(preset.layer1.generatorId);
            }
        });

        it("updates scoped parameters across Layer 1, Layer 2, Masks, Blends, and Simulations in TerrainPipeline", () => {
            const pipeline = new TerrainPipeline(null);
            pipeline.setPreset("canyon-valley-dunes");

            expect(pipeline.getStack().layer1.generatorId).toBe("gen.voronoiBlock");
            expect(pipeline.getStack().layer2.enabled).toBe(true);
            expect(pipeline.getStack().layer2.generatorId).toBe("gen.duneField");

            pipeline.updateScopedParam("layer2.gen", "crestMode", 1);
            expect(pipeline.getStack().layer2.generatorParams.crestMode).toBe(1);

            pipeline.updateScopedParam("layer1.shaper:shape.terrace", "stepHeightM", 85);
            expect(pipeline.getStack().layer1.shapers["shape.terrace"].stepHeightM).toBe(85);

            pipeline.updateScopedParam("sim:sim.thermalTalus", "talusReposeDeg", 31);
            expect(pipeline.getStack().simulations["sim.thermalTalus"].talusReposeDeg).toBe(31);
        });
    });
});
