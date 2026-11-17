// GPU pipeline manager: two compute passes (base landform → Phacelle arms).
// Uses Babylon Lite's StorageBuffer for render-side binding,
// accesses ._buffer for compute shader bind groups.

import { createStorageBuffer } from "@babylonjs/lite";

import {
    N,
    GRID_CELLS,
    HEIGHT_BUFFER_BYTES,
    UNIFORM_BUFFER_BYTES,
    UNIFORM_FLOATS,
    PARAM_KEYS,
    WORKGROUP_SIZE,
    DEFAULT_PARAMS,
} from "./constants.js";
import { DUNES_BASE_SHADER, DUNES_ARMS_SHADER } from "./shaders/dunes.wgsl.js";

export class DunesPipeline {
    constructor(engine) {
        this.engine = engine;
        this.device = engine._device;
        this.storageBuffers = {};
        this.params = { ...DEFAULT_PARAMS };
    }

    async init() {
        this._createBuffers();
        await this._createPipelines();
        this._createBindGroups();
    }

    _createBuffers() {
        const device = this.device;

        this.uniformBuffer = device.createBuffer({
            size: UNIFORM_BUFFER_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Intermediate base landform in metres (compute-only):
        // vec2f(main landform, smaller dune generations) per cell
        this.baseBuffer = device.createBuffer({
            size: HEIGHT_BUFFER_BYTES * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Final fixed-point heights + detail layer (bound to the render material).
        // The Lite createStorageBuffer sets no COPY_SRC, so swap in an
        // equivalent buffer that has it — needed for GPU readback/debugging.
        this.storageBuffers.heights = createStorageBuffer(this.engine, new Int32Array(GRID_CELLS), "dunesHeight");
        this.storageBuffers.detail = createStorageBuffer(this.engine, new Float32Array(GRID_CELLS), "dunesDetail");
        for (const name of ["heights", "detail"]) {
            const sb = this.storageBuffers[name];
            sb._buffer.destroy();
            sb._buffer = device.createBuffer({
                size: HEIGHT_BUFFER_BYTES,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                label: name,
            });
        }
    }

    async _compile(code, entryPoint, label) {
        const device = this.device;
        const module = device.createShaderModule({ code, label });
        const info = await module.getCompilationInfo();
        for (const msg of info.messages) {
            const fn = msg.type === "error" ? console.error : console.warn;
            fn(`[${label}] ${msg.type} ${msg.lineNum}:${msg.linePos} ${msg.message}`);
        }
        return device.createComputePipeline({ layout: "auto", compute: { module, entryPoint }, label });
    }

    async _createPipelines() {
        this.basePipeline = await this._compile(DUNES_BASE_SHADER, "generateBase", "dunesBase");
        this.armsPipeline = await this._compile(DUNES_ARMS_SHADER, "applyArms", "dunesArms");
    }

    _createBindGroups() {
        const device = this.device;
        const uniform = { buffer: this.uniformBuffer };
        const base = { buffer: this.baseBuffer };
        const heights = { buffer: this.storageBuffers.heights._buffer };
        const detail = { buffer: this.storageBuffers.detail._buffer };

        this.baseBindGroup = device.createBindGroup({
            layout: this.basePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: uniform },
                { binding: 1, resource: base },
            ],
        });
        this.armsBindGroup = device.createBindGroup({
            layout: this.armsPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: uniform },
                { binding: 1, resource: base },
                { binding: 2, resource: heights },
                { binding: 3, resource: detail },
            ],
        });
    }

    updateUniforms(params) {
        this.params = { ...this.params, ...params };
        const data = new Float32Array(UNIFORM_FLOATS);
        PARAM_KEYS.forEach((key, i) => {
            data[i] = this.params[key];
        });
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    generateDunes() {
        const encoder = this.device.createCommandEncoder();
        const groups = N / WORKGROUP_SIZE;

        const basePass = encoder.beginComputePass();
        basePass.setPipeline(this.basePipeline);
        basePass.setBindGroup(0, this.baseBindGroup);
        basePass.dispatchWorkgroups(groups, groups);
        basePass.end();

        const armsPass = encoder.beginComputePass();
        armsPass.setPipeline(this.armsPipeline);
        armsPass.setBindGroup(0, this.armsBindGroup);
        armsPass.dispatchWorkgroups(groups, groups);
        armsPass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    getStorageBuffers() {
        return this.storageBuffers;
    }

    getParams() {
        return this.params;
    }
}
