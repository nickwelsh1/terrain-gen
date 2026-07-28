// Main app: integrates all modules — device, pipeline, renderer, UI.
// Entry point for webgpu.html.

import { checkWebGPUSupport } from "./device.js";
import { TerrainPipeline } from "./pipeline.js";
import { createRenderer } from "./renderer.js";
import { createUI } from "./ui.js";
import { DEFAULT_PARAMS } from "./constants.js";

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
    const { createEngine } = await import("@babylonjs/lite");
    const engine = await createEngine(canvas);

    // 3. Create and initialize the terrain pipeline (uses engine._device for compute)
    const pipeline = new TerrainPipeline(engine);
    await pipeline.init();

    // 4. Generate initial terrain
    pipeline.updateUniforms(DEFAULT_PARAMS);
    pipeline.generateMaps();
    pipeline.computeAnalysis();

    // 5. Create renderer (uses the same engine for scene/mesh/material)
    const renderer = await createRenderer(canvas, pipeline, engine);

    // 6. Create UI
    createUI(document.body, {
        onParamChange(params) {
            pipeline.updateUniforms(params);
        },
        onErode(steps) {
            pipeline.runErosion(steps);
        },
        onResetToBase() {
            pipeline.resetToBase();
        },
        onRegenerate() {
            pipeline.generateMaps();
            pipeline.computeAnalysis();
        },
        onRenderModeChange(mode) {
            renderer.setRenderMode(mode);
        },
        onPassToggle(flags) {
            pipeline.updateUniforms({ passFlags: flags });
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
