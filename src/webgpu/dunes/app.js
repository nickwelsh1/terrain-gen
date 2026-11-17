// Main app: integrates all modules — device, pipeline, renderer, UI.
// Entry point for dunes.html (Namib star-dune prototype).

import { checkWebGPUSupport } from "./device.js";
import { DunesPipeline } from "./pipeline.js";
import { createRenderer } from "./renderer.js";
import { createUI } from "./ui.js";
import { DEFAULT_PARAMS } from "./constants.js";
import { createEngine } from "@babylonjs/lite";

export async function main() {
    const canvas = document.getElementById("renderCanvas");
    const statusEl = document.getElementById("status");

    const result = await checkWebGPUSupport();
    if (result.error) {
        statusEl.textContent = result.error;
        statusEl.style.color = "#ff6060";
        return;
    }

    const engine = await createEngine(canvas);

    const pipeline = new DunesPipeline(engine);
    await pipeline.init();
    pipeline.updateUniforms(DEFAULT_PARAMS);
    pipeline.generateDunes();

    const renderer = await createRenderer(canvas, pipeline, engine);

    // Coalesce slider drags into one regeneration per frame.
    let pending = false;
    const regenerate = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            pipeline.generateDunes();
        });
    };

    createUI(document.body, {
        onParamChange(params) {
            pipeline.updateUniforms(params);
            regenerate();
        },
        onRenderModeChange(mode) {
            renderer.setRenderMode(mode);
        },
    });

    window.__dunes = { pipeline, renderer };

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
