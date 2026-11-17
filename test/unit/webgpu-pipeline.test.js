import { describe, expect, it, vi } from "vitest";
import { TerrainPipeline } from "../../src/webgpu/pipeline.js";

describe("TerrainPipeline mask inspection", () => {
    function createPipeline() {
        const pipeline = Object.create(TerrainPipeline.prototype);
        pipeline.stack = {
            seed: 10,
            layers: [
                { maskParams: { name: "layer1" }, detailMaskParams: { name: "detail1" } },
                { maskParams: { name: "layer2" }, detailMaskParams: { name: "detail2" } },
            ],
            erosionMask: { name: "erosion" },
            materials: {
                material1: { maskParams: { name: "material1" } },
                material2: { maskParams: { name: "material2" } },
            },
        };
        pipeline.params = {};
        pipeline._evaluateMaskPass = vi.fn();
        pipeline._notifyBuffersChanged = vi.fn();
        return pipeline;
    }

    it("evaluates the selected layer mask with its generation seed and refreshes renderer bindings", () => {
        const pipeline = createPipeline();

        expect(pipeline.inspectMask("layer2.mask")).toBe(true);
        expect(pipeline._evaluateMaskPass).toHaveBeenCalledWith({ name: "layer2" }, 148);
        expect(pipeline._notifyBuffersChanged).toHaveBeenCalledOnce();
    });

    it("uses the matching detail and erosion mask seeds", () => {
        const pipeline = createPipeline();

        pipeline.inspectMask("layer2.detailMask");
        pipeline.inspectMask("erosion.mask");

        expect(pipeline._evaluateMaskPass).toHaveBeenNthCalledWith(1, { name: "detail2" }, 285);
        expect(pipeline._evaluateMaskPass).toHaveBeenNthCalledWith(2, { name: "erosion" }, 513);
        expect(pipeline._notifyBuffersChanged).toHaveBeenCalledTimes(2);
    });

    it("rejects unknown mask scopes without changing renderer bindings", () => {
        const pipeline = createPipeline();

        expect(pipeline.inspectMask("other.mask")).toBe(false);
        expect(pipeline.inspectMask("layer9.mask")).toBe(false);
        expect(pipeline._evaluateMaskPass).not.toHaveBeenCalled();
        expect(pipeline._notifyBuffersChanged).not.toHaveBeenCalled();
    });
});
