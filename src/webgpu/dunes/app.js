// Main app: integrates all modules — device, pipeline, renderer, UI.
// Entry point for dunes.html.

import { checkWebGPUSupport } from "./device.js";
import { DunesPipeline } from "./pipeline.js";
import { createRenderer } from "./renderer.js";
import { createUI } from "./ui.js";
import { DEFAULT_PARAMS } from "./constants.js";
import { createEngine } from "@babylonjs/lite";

export async function main() {
    const canvas = document.getElementById("renderCanvas");
    const statusEl = document.getElementById("status");

    // 1. Check WebGPU support
    const result = await checkWebGPUSupport();
    if (result.error) {
        statusEl.textContent = result.error;
        statusEl.style.color = "#ff6060";
        return;
    }

    // 2. Create Babylon Lite engine (wraps the GPUDevice + canvas context)
    const engine = await createEngine(canvas);

    // 3. Create and initialize the dunes pipeline (uses engine._device for compute)
    const pipeline = new DunesPipeline(engine);
    await pipeline.init();

    // 4. Generate initial dunes
    pipeline.updateUniforms(DEFAULT_PARAMS);
    pipeline.generateDunes();

    // 5. Create renderer (uses the same engine for scene/mesh/material)
    const renderer = await createRenderer(canvas, pipeline, engine);

    // 6. Create UI
    createUI(document.body, {
        onParamChange(params) {
            pipeline.updateUniforms(params);
            pipeline.generateDunes();
        },
        onRegenerate() {
            pipeline.generateDunes();
        },
        onRenderModeChange(mode) {
            renderer.setRenderMode(mode);
        },
        onPassToggle(flags) {
            pipeline.updateUniforms({ passFlags: flags });
            pipeline.generateDunes();
        },
    });

    // 7. Start render loop
    statusEl.style.display = "none";
    await renderer.start();
}

main().catch((err) => {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.textContent = `Error: ${err.message}`;
        statusEl.style.color = "#ff6060";
    }
    console.error(err);
});
