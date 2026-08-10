// GPU pipeline manager: creates buffers, compute pipelines, and runs erosion generation passes.

import { createStorageBuffer } from "@babylonjs/lite";

import {
    N,
    GRID_CELLS,
    UNIFORM_BUFFER_BYTES,
    WORKGROUP_SIZE,
    DEFAULT_PARAMS,
} from "./constants.js";
import { EROSION_SHADER } from "./shaders/erosion.wgsl.js";

export class ErosionPipeline {
    constructor(engine) {
        this.engine = engine;
        this.device = engine._device;
        this.pipeline = null;
        this.bindGroup = null;
        this.storageBuffers = {};
        this.params = { ...DEFAULT_PARAMS };
    }

    async init() {
        this._createBuffers();
        this._createPipeline();
        this._createBindGroup();
    }

    _createBuffers() {
        const engine = this.engine;
        const device = this.device;

        // Uniform buffer
        this.uniformBuffer = device.createBuffer({
            size: UNIFORM_BUFFER_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Height buffer
        const zeroI32 = new Int32Array(GRID_CELLS);
        this.storageBuffers.heights = createStorageBuffer(engine, zeroI32, "erosionHeight");

        // Ridge/stream map buffer
        const zeroF32 = new Float32Array(GRID_CELLS);
        this.storageBuffers.ridgeMaps = createStorageBuffer(engine, zeroF32, "erosionRidgeMap");
    }

    _createPipeline() {
        const device = this.device;

        const erosionModule = device.createShaderModule({ code: EROSION_SHADER });
        this.pipeline = device.createComputePipeline({
            layout: "auto",
            compute: { module: erosionModule, entryPoint: "generateErosion" },
        });
    }

    _createBindGroup() {
        const device = this.device;

        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.heights._buffer } },
                { binding: 2, resource: { buffer: this.storageBuffers.ridgeMaps._buffer } },
            ],
        });
    }

    updateUniforms(params) {
        this.params = { ...this.params, ...params };
        const p = this.params;
        const data = new ArrayBuffer(UNIFORM_BUFFER_BYTES);
        const view = new DataView(data);

        // Field order must match the ErosionParams struct in erosion.wgsl.js.
        const floats = [
            p.heightFrequency, p.heightAmp, p.heightOctaves, p.heightLacunarity, p.heightGain,
            p.cellScale, p.normalization,
            p.erosionOctaves, p.lacunarity, p.gain,
            p.erosionStrength, p.gullyWeight, p.detail,
            p.onsetInitial, p.onsetOctave, p.onsetRidgeInitial, p.onsetRidgeOctave,
            p.assumedSlope, p.assumedSlopeAmount,
            p.ridgeRounding, p.creaseRounding, p.roundingInputMult, p.roundingOctaveMult,
            p.erosionScale, p.heightOffset, p.heightOffsetFadeAmount, p.seed,
        ];

        floats.forEach((value, i) => {
            view.setFloat32(i * 4, value, true);
        });

        const flagsOffset = floats.length * 4;
        view.setUint32(flagsOffset, p.passFlags, true);
        view.setUint32(flagsOffset + 4, p.renderMode, true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    generateErosion() {
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(N / WORKGROUP_SIZE, N / WORKGROUP_SIZE);

        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    getStorageBuffers() {
        return this.storageBuffers;
    }

    getParams() {
        return this.params;
    }
}
