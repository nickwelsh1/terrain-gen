// Operator graph runner: compiles operator compute pipelines, manages per-op
// uniform buffers, and executes a composable layer stack + simulation chain
// over TerrainState with automatic ping-pong buffer swapping.

import { N } from "../constants.js";
import { packUniforms } from "./registry.js";

export class OperatorGraphRunner {
    constructor(device, registry, state) {
        this.device = device;
        this.registry = registry;
        this.state = state;
        this.compiledOps = new Map();
    }

    /**
     * Compiles all registered operators on the GPUDevice (if a device is present).
     */
    init() {
        if (!this.device) return;

        for (const op of this.registry.listAll()) {
            this._compileOperator(op);
        }
    }

    _compileOperator(op) {
        const device = this.device;
        const uniformBuffer = device.createBuffer({
            size: op.uniformSchema.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        let pipeline = null;
        if (typeof op.shaderCode === "function" || typeof op.shaderCode === "string") {
            const code = typeof op.shaderCode === "function" ? op.shaderCode() : op.shaderCode;
            const module = device.createShaderModule({ code });
            pipeline = device.createComputePipeline({
                layout: "auto",
                compute: {
                    module,
                    entryPoint: op.entryPoint || "main",
                },
            });
        }

        this.compiledOps.set(op.id, {
            op,
            pipeline,
            uniformBuffer,
        });
    }

    getCompiled(opId) {
        let entry = this.compiledOps.get(opId);
        if (!entry && this.device && this.registry.has(opId)) {
            this._compileOperator(this.registry.get(opId));
            entry = this.compiledOps.get(opId);
        }
        return entry || null;
    }

    writeOpUniforms(opId, params) {
        const op = this.registry.get(opId);
        if (!op) {
            throw new Error(`Unknown operator "${opId}"`);
        }
        const merged = { ...op.defaultParams, ...params };
        const bytes = packUniforms(op.uniformSchema, merged);
        const compiled = this.getCompiled(opId);
        if (compiled && this.device) {
            this.device.queue.writeBuffer(compiled.uniformBuffer, 0, bytes);
        }
        return { op, merged, bytes, compiled };
    }

    /**
     * Executes a single operator step.
     * In headless/unit-test mode (no GPUDevice), still runs uniform packing and
     * ping-pong state transitions so graph ordering and buffer ownership are testable.
     */
    runOperator(opId, params = {}, options = {}) {
        const { op, merged, compiled } = this.writeOpUniforms(opId, params);
        const iterations = Math.max(1, Math.trunc(options.iterations ?? merged.iterations ?? 1));
        const targetBuffer = options.targetBuffer || null;

        for (let iter = 0; iter < iterations; iter++) {
            if (options.onBeforeIteration) {
                options.onBeforeIteration(iter, merged);
                this.writeOpUniforms(opId, merged);
            }

            if (this.device && compiled?.pipeline) {
                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(compiled.pipeline);

                const bindGroup = op.createBindGroup(
                    this.device,
                    compiled.pipeline,
                    this.state,
                    compiled.uniformBuffer,
                    { targetBuffer, params: merged, iteration: iter },
                );
                pass.setBindGroup(0, bindGroup);

                if (typeof op.dispatch === "function") {
                    op.dispatch(pass, merged);
                } else {
                    const wg = op.workgroupSize || 8;
                    pass.dispatchWorkgroups(Math.ceil(N / wg), Math.ceil(N / wg));
                }

                pass.end();
                this.device.queue.submit([encoder.finish()]);
            }

            if (op.pingPong && !targetBuffer) {
                this.state.swapHeight();
            }
            if (op.auxPingPong) {
                this.state.swapAux();
            }
        }
    }
}
