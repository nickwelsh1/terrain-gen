// Unified GPU state container for the WebGPU terrain compositor.
// Owns persistent ping-pong height buffers (heightA / heightB), layer scratch
// buffer, ping-pong aux buffers (vec4f: [water, sediment, maskA, maskB]),
// hardness, analysis buffers, and the droplet simulation buffer.

import { createStorageBuffer } from "@babylonjs/lite";
import {
    GRID_CELLS,
    DROPLET_BUFFER_BYTES,
} from "./constants.js";

export class TerrainState {
    constructor(engine) {
        this.engine = engine;
        this.device = engine ? engine._device : null;
        this.heightIndex = 0;
        this.auxIndex = 0;
        this.buffers = {};
        this.dropletBuffer = null;
    }

    init() {
        const engine = this.engine;
        const device = this.device;

        const zeroI32 = new Int32Array(GRID_CELLS);
        const zeroU32 = new Uint32Array(GRID_CELLS);
        const zeroAux = new Float32Array(GRID_CELLS * 4);

        // Ping-pong height pair (fixed-point i32: meters * FIXED_POINT_SCALE)
        this.buffers.heightA = createStorageBuffer(engine, zeroI32, "heightA");
        this.buffers.heightB = createStorageBuffer(engine, zeroI32, "heightB");

        // Snapshot of composite base terrain before global erosion/simulations
        this.buffers.baseHeight = createStorageBuffer(engine, zeroI32, "baseHeight");

        // Scratch height buffer for secondary biome layers before blending
        this.buffers.layerScratch = createStorageBuffer(engine, zeroI32, "layerScratch");

        // Ping-pong aux pair: vec4<f32> per cell -> .x=water, .y=sediment, .z=maskA, .w=maskB
        this.buffers.auxA = createStorageBuffer(engine, zeroAux, "auxA");
        this.buffers.auxB = createStorageBuffer(engine, zeroAux, "auxB");

        // Rock hardness [0..10000]
        this.buffers.hardness = createStorageBuffer(engine, zeroI32, "hardness");

        // Analysis output buffers (packed rgba8unorm u32)
        this.buffers.normals = createStorageBuffer(engine, zeroU32, "normals");
        this.buffers.slopes = createStorageBuffer(engine, zeroU32, "slopes");
        this.buffers.aspects = createStorageBuffer(engine, zeroU32, "aspects");

        // Droplet buffer for hydraulic particle simulation
        if (device) {
            this.dropletBuffer = device.createBuffer({
                size: DROPLET_BUFFER_BYTES,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        this.heightIndex = 0;
        this.auxIndex = 0;
    }

    get activeHeight() {
        return this.heightIndex === 0 ? this.buffers.heightA : this.buffers.heightB;
    }

    get inactiveHeight() {
        return this.heightIndex === 0 ? this.buffers.heightB : this.buffers.heightA;
    }

    // Backward-compatible alias used by renderer.js
    get erodedHeight() {
        return this.activeHeight;
    }

    get baseHeight() {
        return this.buffers.baseHeight;
    }

    get layerScratch() {
        return this.buffers.layerScratch;
    }

    get activeAux() {
        return this.auxIndex === 0 ? this.buffers.auxA : this.buffers.auxB;
    }

    get inactiveAux() {
        return this.auxIndex === 0 ? this.buffers.auxB : this.buffers.auxA;
    }

    get hardness() {
        return this.buffers.hardness;
    }

    get normals() {
        return this.buffers.normals;
    }

    get slopes() {
        return this.buffers.slopes;
    }

    get aspects() {
        return this.buffers.aspects;
    }

    swapHeight() {
        this.heightIndex = 1 - this.heightIndex;
        return this.activeHeight;
    }

    swapAux() {
        this.auxIndex = 1 - this.auxIndex;
        return this.activeAux;
    }

    resetIndices() {
        this.heightIndex = 0;
        this.auxIndex = 0;
    }

    getStorageBuffers() {
        return {
            baseHeight: this.buffers.baseHeight,
            erodedHeight: this.activeHeight,
            heightA: this.buffers.heightA,
            heightB: this.buffers.heightB,
            layerScratch: this.buffers.layerScratch,
            aux: this.activeAux,
            auxA: this.buffers.auxA,
            auxB: this.buffers.auxB,
            hardness: this.buffers.hardness,
            normals: this.buffers.normals,
            slopes: this.buffers.slopes,
            aspects: this.buffers.aspects,
        };
    }
}
