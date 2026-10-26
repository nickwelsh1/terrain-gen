// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUI } from "../../src/webgpu/ui.js";
import {
    DEFAULT_PARAMS,
    MATERIAL_PALETTES,
    PALETTE_ARIZONA_SUMMER,
    PALETTE_ZHANGJIAJIE_WINTER,
    RENDER_HARDNESS,
    PASS_EROSION,
    PASS_DEPOSITION,
} from "../../src/webgpu/constants.js";

describe("WebGPU UI (src/webgpu/ui.js)", () => {
    let container;
    let callbacks;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        callbacks = {
            onParamChange: vi.fn(),
            onErode: vi.fn(),
            onResetToBase: vi.fn(),
            onRegenerate: vi.fn(),
            onRenderModeChange: vi.fn(),
            onPassToggle: vi.fn(),
        };
    });

    afterEach(() => {
        container.remove();
    });

    it("renders hybrid collapsible accordions with primary sections open and secondary collapsed", () => {
        createUI(container, callbacks);

        const sectionScale = document.getElementById("sectionScale");
        const sectionTerrain = document.getElementById("sectionTerrain");
        const sectionErosion = document.getElementById("sectionErosion");
        const sectionRender = document.getElementById("sectionRender");
        const sectionPasses = document.getElementById("sectionPasses");
        const fineTuneDrawer = document.getElementById("fineTuneDrawer");

        expect(sectionScale.hasAttribute("open")).toBe(false);
        expect(sectionTerrain.hasAttribute("open")).toBe(true);
        expect(sectionErosion.hasAttribute("open")).toBe(true);
        expect(sectionRender.hasAttribute("open")).toBe(true);
        expect(sectionPasses.hasAttribute("open")).toBe(false);
        expect(fineTuneDrawer.hasAttribute("open")).toBe(false);
    });

    it("marks Erode button and section badge as pending when an erosion slider changes", () => {
        createUI(container, callbacks);

        const erosionRate = document.getElementById("erosionRate");
        const erodeBtn = document.getElementById("erodeBtn");
        const erodeHint = document.getElementById("erodeHint");
        const erosionBadge = document.getElementById("erosionBadge");

        expect(erodeBtn.classList.contains("pending")).toBe(false);
        expect(erodeBtn.textContent).toBe("Erode");
        expect(erodeHint.hidden).toBe(true);
        expect(erosionBadge.textContent).toBe(`${DEFAULT_PARAMS.stepCount} batches`);

        erosionRate.value = "1.2";
        erosionRate.dispatchEvent(new Event("input", { bubbles: true }));

        expect(callbacks.onParamChange).toHaveBeenCalledWith({ erosionRate: 1.2 });
        expect(erodeBtn.classList.contains("pending")).toBe(true);
        expect(erodeBtn.textContent).toBe("Erode (Apply)");
        expect(erodeHint.hidden).toBe(false);
        expect(erosionBadge.textContent).toBe("Pending");
        expect(erosionBadge.classList.contains("pending")).toBe(true);
    });

    it("clears pending state when Erode, Reset to Base, or Regenerate is clicked", () => {
        createUI(container, callbacks);

        const rainRate = document.getElementById("rainRate");
        const erodeBtn = document.getElementById("erodeBtn");
        const resetBtn = document.getElementById("resetBtn");
        const regenerateBtn = document.getElementById("regenerateBtn");

        // Trigger pending via fine-tune slider
        rainRate.value = "3.5";
        rainRate.dispatchEvent(new Event("input", { bubbles: true }));
        expect(erodeBtn.classList.contains("pending")).toBe(true);

        // Clicking Erode clears pending
        erodeBtn.click();
        expect(callbacks.onErode).toHaveBeenCalledWith(DEFAULT_PARAMS.stepCount);
        expect(erodeBtn.classList.contains("pending")).toBe(false);
        expect(erodeBtn.textContent).toBe("Erode");

        // Trigger pending again, then Reset to Base
        rainRate.value = "4.0";
        rainRate.dispatchEvent(new Event("input", { bubbles: true }));
        expect(erodeBtn.classList.contains("pending")).toBe(true);

        resetBtn.click();
        expect(callbacks.onResetToBase).toHaveBeenCalled();
        expect(erodeBtn.classList.contains("pending")).toBe(false);

        // Trigger pending again, then Regenerate
        rainRate.value = "4.5";
        rainRate.dispatchEvent(new Event("input", { bubbles: true }));
        expect(erodeBtn.classList.contains("pending")).toBe(true);

        regenerateBtn.click();
        expect(callbacks.onRegenerate).toHaveBeenCalled();
        expect(erodeBtn.classList.contains("pending")).toBe(false);
    });

    it("updates summary badges when terrain, render mode, or pass toggles change", () => {
        createUI(container, callbacks);

        const baseHeight = document.getElementById("baseHeight");
        const terrainBadge = document.getElementById("terrainBadge");
        const renderBadge = document.getElementById("renderBadge");
        const passesBadge = document.getElementById("passesBadge");
        const passErosion = document.getElementById("passErosion");
        const erodeBtn = document.getElementById("erodeBtn");

        baseHeight.value = "950";
        baseHeight.dispatchEvent(new Event("input", { bubbles: true }));
        expect(terrainBadge.textContent).toBe(`950m · #${DEFAULT_PARAMS.seed}`);

        const hardnessRadio = document.querySelector(`input[name="renderMode"][value="${RENDER_HARDNESS}"]`);
        hardnessRadio.checked = true;
        hardnessRadio.dispatchEvent(new Event("change", { bubbles: true }));
        expect(renderBadge.textContent).toBe("Hardness");

        // Unchecking passErosion disables passDeposition too -> 3/5 on, and marks erosion pending
        passErosion.checked = false;
        passErosion.dispatchEvent(new Event("change", { bubbles: true }));
        expect(passesBadge.textContent).toBe("3/5 on");
        expect(erodeBtn.classList.contains("pending")).toBe(true);
        expect(callbacks.onPassToggle).toHaveBeenCalledWith(
            DEFAULT_PARAMS.passFlags & ~PASS_EROSION & ~PASS_DEPOSITION,
        );
    });

    it("supports switching presets, toggling Layer 2 overlay, and updating scoped operator controls", () => {
        const onPresetChange = vi.fn();
        const onScopedParamChange = vi.fn();
        createUI(container, {
            ...callbacks,
            onPresetChange,
            onScopedParamChange,
        });

        const presetSelect = document.getElementById("presetSelect");
        presetSelect.value = "canyon-valley-dunes";
        presetSelect.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onPresetChange).toHaveBeenCalledWith("canyon-valley-dunes");
        expect(document.getElementById("layer2Badge").textContent).toBe("On");

        // Change Layer 2 Dune Crest Mode to Warped fBm (1)
        const crestSelect = document.querySelector(
            '.scoped-select[data-scope="layer2.gen"][data-param="crestMode"]',
        );
        expect(crestSelect).not.toBeNull();
        crestSelect.value = "1";
        crestSelect.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onScopedParamChange).toHaveBeenCalledWith("layer2.gen", "crestMode", 1);

        // Add a 3rd biome layer via #addLayerBtn
        const addLayerBtn = document.getElementById("addLayerBtn");
        expect(addLayerBtn).not.toBeNull();
        addLayerBtn.click();
        expect(document.getElementById("sectionLayer3")).not.toBeNull();
    });

    it("renders 10 landscape material palettes, auto-syncs palette on preset change, and allows manual override", () => {
        const onMaterialPaletteChange = vi.fn();
        createUI(container, {
            ...callbacks,
            onMaterialPaletteChange,
        });

        const matSelect = document.getElementById("materialPaletteSelect");
        expect(matSelect).not.toBeNull();
        expect(MATERIAL_PALETTES.length).toBeGreaterThanOrEqual(10);
        expect(matSelect.querySelectorAll("option").length).toBe(MATERIAL_PALETTES.length);

        // Switching preset to Monument Valley auto-selects Dry Summer Arizona (Red Rock)
        const presetSelect = document.getElementById("presetSelect");
        presetSelect.value = "monument-valley-buttes";
        presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
        expect(Number(matSelect.value)).toBe(PALETTE_ARIZONA_SUMMER);
        expect(onMaterialPaletteChange).toHaveBeenCalledWith(PALETTE_ARIZONA_SUMMER);

        // Manually switching material dropdown to Zhangjiajie Karst (Winter Frost)
        matSelect.value = String(PALETTE_ZHANGJIAJIE_WINTER);
        matSelect.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onMaterialPaletteChange).toHaveBeenCalledWith(PALETTE_ZHANGJIAJIE_WINTER);
    });
});
