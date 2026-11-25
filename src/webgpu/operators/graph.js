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
        this.pendingOps = new Map();
    }

    /**
     * Asynchronously compiles the specified operators (or all registered operators
     * if opIds is omitted) on the GPUDevice.
     */
    async init(opIds = null) {
        if (!this.device) return;
        const ids = opIds ? [...opIds] : this.registry.listAll().map((op) => op.id);
        await this.compileOperators(ids);
    }

    async compileOperators(opIds) {
        if (!this.device) return;
        const uniqueOps = [];
        const seen = new Set();
        for (const id of opIds) {
            if (seen.has(id) || this.compiledOps.has(id)) continue;
            const op = this.registry.get(id);
            if (op) {
                seen.add(id);
                uniqueOps.push(op);
            }
        }
        await Promise.all(uniqueOps.map((op) => this._compileOperatorAsync(op)));
    }

    /**
     * Warms all remaining uncompiled operators in the background without blocking startup.
     */
    warmRemainingOperators() {
        if (!this.device) return Promise.resolve();
        const remaining = this.registry
            .listAll()
            .filter((op) => !this.compiledOps.has(op.id) && !this.pendingOps.has(op.id));
        return Promise.allSettled(remaining.map((op) => this._compileOperatorAsync(op)));
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

        const entry = {
            op,
            pipeline,
            uniformBuffer,
        };
        this.compiledOps.set(op.id, entry);
        return entry;
    }

    async _compileOperatorAsync(op) {
        const existing = this.compiledOps.get(op.id);
        if (existing) return existing;

        const inFlight = this.pendingOps.get(op.id);
        if (inFlight) return inFlight;

        const device = this.device;
        const compilePromise = (async () => {
            const uniformBuffer = device.createBuffer({
                size: op.uniformSchema.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            let pipeline = null;
            if (typeof op.shaderCode === "function" || typeof op.shaderCode === "string") {
                const code = typeof op.shaderCode === "function" ? op.shaderCode() : op.shaderCode;
                const module = device.createShaderModule({ code });
                const descriptor = {
                    layout: "auto",
                    compute: {
                        module,
                        entryPoint: op.entryPoint || "main",
                    },
                };
                pipeline =
                    typeof device.createComputePipelineAsync === "function"
                        ? await device.createComputePipelineAsync(descriptor)
                        : device.createComputePipeline(descriptor);
            }

            // If synchronous getCompiled() already populated this entry while awaiting, keep it
            // so any uniforms written to its buffer remain intact.
            const winner = this.compiledOps.get(op.id);
            if (winner) {
                uniformBuffer.destroy?.();
                return winner;
            }

            const entry = {
                op,
                pipeline,
                uniformBuffer,
            };
            this.compiledOps.set(op.id, entry);
            return entry;
        })().finally(() => {
            if (this.pendingOps.get(op.id) === compilePromise) {
                this.pendingOps.delete(op.id);
            }
        });

        this.pendingOps.set(op.id, compilePromise);
        return compilePromise;
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
