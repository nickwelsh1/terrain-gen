// GPU pipeline manager: creates buffers, compute pipelines, and runs passes.
// Uses Babylon Lite's StorageBuffer for render-side binding,
// accesses ._buffer for compute shader bind groups.

import { createStorageBuffer } from "@babylonjs/lite";

import {
    N,
    GRID_CELLS,
    HEIGHT_BUFFER_BYTES,
    HARDNESS_BUFFER_BYTES,
    DROPLET_BUFFER_BYTES,
    UNIFORM_BUFFER_BYTES,
    DROPLET_COUNT,
    DROPLET_WORKGROUPS,
    WORKGROUP_SIZE,
    FIXED_POINT_SCALE,
    DEFAULT_PARAMS,
} from "./constants.js";
import { HEIGHTMAP_SHADER } from "./shaders/heightmap.wgsl.js";
import { HARDNESS_SHADER } from "./shaders/hardness.wgsl.js";
import { ANALYSIS_SHADER } from "./shaders/analysis.wgsl.js";
import { EROSION_SHADER } from "./shaders/erosion.wgsl.js";

export class TerrainPipeline {
    constructor(engine) {
        this.engine = engine;
        this.device = engine._device;
        this.pipelines = {};
        this.bindGroups = {};
        this.storageBuffers = {};
        this.params = { ...DEFAULT_PARAMS };
    }

    async init() {
        this._createBuffers();
        this._createPipelines();
        this._createBindGroups();
    }

    _createBuffers() {
        const engine = this.engine;
        const device = this.device;

        // Uniform buffer — raw GPUBuffer (not used by Babylon Lite material system)
        this.uniformBuffer = device.createBuffer({
            size: UNIFORM_BUFFER_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Height buffers — StorageBuffer wrappers for render binding
        const zeroI32 = new Int32Array(GRID_CELLS);
        this.storageBuffers.baseHeight = createStorageBuffer(engine, zeroI32, "baseHeight");
        this.storageBuffers.erodedHeight = createStorageBuffer(engine, zeroI32, "erodedHeight");

        // Hardness buffer
        this.storageBuffers.hardness = createStorageBuffer(engine, new Int32Array(GRID_CELLS), "hardness");

        // Analysis output buffers — u32 per cell
        const zeroU32 = new Uint32Array(GRID_CELLS);
        this.storageBuffers.normals = createStorageBuffer(engine, zeroU32, "normals");
        this.storageBuffers.slopes = createStorageBuffer(engine, zeroU32, "slopes");
        this.storageBuffers.aspects = createStorageBuffer(engine, zeroU32, "aspects");

        // Droplet buffer — raw GPUBuffer (not needed for render)
        this.dropletBuffer = device.createBuffer({
            size: DROPLET_BUFFER_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    _createPipelines() {
        const device = this.device;

        const heightmapModule = device.createShaderModule({ code: HEIGHTMAP_SHADER });
        this.pipelines.heightmap = device.createComputePipeline({
            layout: "auto",
            compute: { module: heightmapModule, entryPoint: "generateHeightmap" },
        });

        const hardnessModule = device.createShaderModule({ code: HARDNESS_SHADER });
        this.pipelines.hardness = device.createComputePipeline({
            layout: "auto",
            compute: { module: hardnessModule, entryPoint: "generateHardness" },
        });

        const analysisModule = device.createShaderModule({ code: ANALYSIS_SHADER });
        this.pipelines.analysis = device.createComputePipeline({
            layout: "auto",
            compute: { module: analysisModule, entryPoint: "computeNormals" },
        });

        const erosionModule = device.createShaderModule({ code: EROSION_SHADER });
        this.pipelines.erosion = device.createComputePipeline({
            layout: "auto",
            compute: { module: erosionModule, entryPoint: "simulateDroplets" },
        });
    }

    _createBindGroups() {
        const device = this.device;

        // Heightmap → baseHeight
        this.bindGroups.heightmap = device.createBindGroup({
            layout: this.pipelines.heightmap.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.baseHeight._buffer } },
            ],
        });

        // Heightmap → erodedHeight (for initial copy / reset)
        this.bindGroups.heightmapEroded = device.createBindGroup({
            layout: this.pipelines.heightmap.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.erodedHeight._buffer } },
            ],
        });

        // Hardness
        this.bindGroups.hardness = device.createBindGroup({
            layout: this.pipelines.hardness.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.hardness._buffer } },
            ],
        });

        // Analysis: erodedHeight (read) + normals/slopes/aspects (write)
        this.bindGroups.analysis = device.createBindGroup({
            layout: this.pipelines.analysis.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.storageBuffers.erodedHeight._buffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.normals._buffer } },
                { binding: 2, resource: { buffer: this.storageBuffers.slopes._buffer } },
                { binding: 3, resource: { buffer: this.storageBuffers.aspects._buffer } },
            ],
        });

        // Erosion: uniform + erodedHeight (atomic) + hardness (read) + droplets
        this.bindGroups.erosion = device.createBindGroup({
            layout: this.pipelines.erosion.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.storageBuffers.erodedHeight._buffer } },
                { binding: 2, resource: { buffer: this.storageBuffers.hardness._buffer } },
                { binding: 3, resource: { buffer: this.dropletBuffer } },
            ],
        });
    }

    updateUniforms(params) {
        this.params = { ...this.params, ...params };
        const data = new ArrayBuffer(UNIFORM_BUFFER_BYTES);
        const view = new DataView(data);
        view.setFloat32(0, this.params.rainRate, true);
        view.setFloat32(4, this.params.erosionRate, true);
        view.setFloat32(8, this.params.depositionRate, true);
        view.setFloat32(12, this.params.evaporation, true);
        view.setFloat32(16, this.params.sedimentCapacity, true);
        view.setFloat32(20, this.params.stepCount, true);
        view.setUint32(24, this.params.passFlags, true);
        view.setFloat32(28, this.params.seed, true);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    generateMaps() {
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();

        // Generate heightmap into baseHeight
        pass.setPipeline(this.pipelines.heightmap);
        pass.setBindGroup(0, this.bindGroups.heightmap);
        pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));

        // Generate hardness
        pass.setPipeline(this.pipelines.hardness);
        pass.setBindGroup(0, this.bindGroups.hardness);
        pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));

        pass.end();

        // Generate same heightmap into erodedHeight (deterministic → same result)
        const pass2 = encoder.beginComputePass();
        pass2.setPipeline(this.pipelines.heightmap);
        pass2.setBindGroup(0, this.bindGroups.heightmapEroded);
        pass2.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
        pass2.end();

        this.device.queue.submit([encoder.finish()]);
    }

    computeAnalysis() {
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines.analysis);
        pass.setBindGroup(0, this.bindGroups.analysis);
        pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    runErosion(steps) {
        const encoder = this.device.createCommandEncoder();

        for (var i = 0; i < steps; i++) {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.pipelines.erosion);
            pass.setBindGroup(0, this.bindGroups.erosion);
            pass.dispatchWorkgroups(DROPLET_WORKGROUPS);
            pass.end();
        }

        // Recompute analysis after erosion
        const analysisPass = encoder.beginComputePass();
        analysisPass.setPipeline(this.pipelines.analysis);
        analysisPass.setBindGroup(0, this.bindGroups.analysis);
        analysisPass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
        analysisPass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    resetToBase() {
        // Re-generate heightmap into erodedHeight (deterministic, same seed)
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines.heightmap);
        pass.setBindGroup(0, this.bindGroups.heightmapEroded);
        pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
        pass.end();

        // Recompute analysis
        const analysisPass = encoder.beginComputePass();
        analysisPass.setPipeline(this.pipelines.analysis);
        analysisPass.setBindGroup(0, this.bindGroups.analysis);
        analysisPass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
        analysisPass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    getStorageBuffers() {
        return this.storageBuffers;
    }
}
