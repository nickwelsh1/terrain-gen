// GPU pipeline manager: creates buffers, compute pipelines, and runs dunes generation passes.
// Uses Babylon Lite's StorageBuffer for render-side binding,
// accesses ._buffer for compute shader bind groups.

import { createStorageBuffer } from "@babylonjs/lite";

import {
    N,
    GRID_CELLS,
    HEIGHT_BUFFER_BYTES,
    UNIFORM_BUFFER_BYTES,
    WORKGROUP_SIZE,
    FIXED_POINT_SCALE,
    DEFAULT_PARAMS,
} from "./constants.js";
import { DUNES_SHADER } from "./shaders/dunes.wgsl.js";

export class DunesPipeline {
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

        // Uniform buffer — raw GPUBuffer (not used by Babylon Lite material system)
        this.uniformBuffer = device.createBuffer({
            size: UNIFORM_BUFFER_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Height buffer — StorageBuffer wrapper for render binding
        const zeroI32 = new Int32Array(GRID_CELLS);
        this.storageBuffers.heights = createStorageBuffer(engine, zeroI32, "dunesHeight");
    }

    _createPipeline() {
        const device = this.device;

        const dunesModule = device.createShaderModule({ code: DUNES_SHADER });
        this.pipeline = device.createComputePipeline({
            layout: "auto",
            compute: { module: dunesModule, entryPoint: "generateDunes" },
        });
    }

    _createBindGroup() {
        const device = this.device;

        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.heights._buffer } },
            ],
        });
    }

    updateUniforms(params) {
        this.params = { ...this.params, ...params };
        const data = new ArrayBuffer(UNIFORM_BUFFER_BYTES);
        const view = new DataView(data);

        // Stage 1: Base Waveform & Orientation
        view.setFloat32(0, this.params.windDirection, true);
        view.setFloat32(4, this.params.ridgeSpacing, true);
        view.setFloat32(8, this.params.ridgeSharpness, true);

        // Stage 2: Sinuous Crest Warping
        view.setFloat32(12, this.params.warpFrequency, true);
        view.setFloat32(16, this.params.warpAmplitude, true);

        // Stage 3: Directional Profile Modifier
        view.setFloat32(20, this.params.windwardPower, true);
        view.setFloat32(24, this.params.leewardPower, true);

        // Stage 4: Angle of Repose & Talus Limiter
        view.setFloat32(28, this.params.angleOfRepose, true);
        view.setFloat32(32, this.params.talusStrength, true);

        // Stage 5: Micro-Surface Detail
        view.setFloat32(36, this.params.rippleFrequency, true);
        view.setFloat32(40, this.params.rippleAmplitude, true);
        view.setFloat32(44, this.params.slopeMaskThreshold, true);

        // Global parameters
        view.setFloat32(48, this.params.seed, true);
        view.setFloat32(52, this.params.overallScale, true);
        view.setFloat32(56, this.params.heightScale, true);

        // Stage toggles and render mode
        view.setUint32(60, this.params.passFlags, true);
        view.setUint32(64, this.params.renderMode, true);

        // Padding to reach 80 bytes (16-byte aligned)
        view.setUint32(68, 0, true);
        view.setUint32(72, 0, true);
        view.setUint32(76, 0, true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    generateDunes() {
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(N / WORKGROUP_SIZE), Math.ceil(N / WORKGROUP_SIZE));

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
