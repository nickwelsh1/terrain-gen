// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUI, parseColoursHtmlJson } from "../../src/webgpu/ui.js";
import {
    DEFAULT_PARAMS,
    MATERIAL_PALETTES,
    PALETTE_NEUTRAL_CLAY,
    PALETTE_ZHANGJIAJIE_WINTER,
    RENDER_HARDNESS,
    PASS_EROSION,
    PASS_DEPOSITION,
} from "../../src/webgpu/constants.js";

describe("WebGPU UI (src/webgpu/ui.js)", () => {
    let container;
    let callbacks;

    beforeEach(() => {
        localStorage.clear();
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

    it("renders hybrid collapsible accordions with causal pipeline sections (Broad -> Detail -> Layer 2 -> Erosion -> Materials)", () => {
        createUI(container, callbacks);

        const sectionScale = document.getElementById("sectionScale");
        const sectionTerrain = document.getElementById("sectionTerrain");
        const sectionErosion = document.getElementById("sectionErosion");
        const sectionMaterials = document.getElementById("sectionMaterials");
        const sectionRender = document.getElementById("sectionRender");
        const sectionPasses = document.getElementById("sectionPasses");
        const fineTuneDrawer = document.getElementById("fineTuneDrawer");

        expect(sectionScale.hasAttribute("open")).toBe(false);
        expect(sectionTerrain.hasAttribute("open")).toBe(true);
        expect(sectionErosion.hasAttribute("open")).toBe(true);
        expect(sectionMaterials.hasAttribute("open")).toBe(true);
        expect(sectionRender.hasAttribute("open")).toBe(true);
        expect(sectionPasses.hasAttribute("open")).toBe(false);
        expect(fineTuneDrawer.hasAttribute("open")).toBe(false);

        // Seed sits near the top of Layer 1 and Regenerate button is no longer needed
        expect(document.getElementById("seed")).not.toBeNull();
        expect(document.getElementById("regenerateBtn")).toBeNull();

        // Enlarged 200x200 (>3x 64x64) 2D mask preview canvases are rendered for each mask step
        const maskCanvases = container.querySelectorAll("canvas.mask-preview-canvas");
        expect(maskCanvases.length).toBeGreaterThanOrEqual(5);
        for (const c of maskCanvases) {
            expect(c.width).toBe(200);
            expect(c.height).toBe(200);
            expect(c.dataset.previewRendered).toBe("true");
        }

        // Top-level Invert mask checkbox toggle & "Map" label are present in mask primary controls
        const invertToggles = container.querySelectorAll(".mask-primary-controls .mask-invert-cb");
        expect(invertToggles.length).toBeGreaterThanOrEqual(5);
        const mapLabel = container.querySelector('.mask-primary-controls select[data-param="maskSource"]')?.closest("label");
        expect(mapLabel?.textContent).toContain("Map");
        expect(mapLabel?.textContent).not.toContain("Signal / Map");
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

    it("clears pending state when Erode, Reset to Base, or Seed is changed immediately", () => {
        createUI(container, callbacks);

        const rainRate = document.getElementById("rainRate");
        const erodeBtn = document.getElementById("erodeBtn");
        const resetBtn = document.getElementById("resetBtn");
        const seedInput = document.getElementById("seed");

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

        // Trigger pending again, then change Seed (applies immediately without Regenerate button)
        rainRate.value = "4.5";
        rainRate.dispatchEvent(new Event("input", { bubbles: true }));
        expect(erodeBtn.classList.contains("pending")).toBe(true);

        seedInput.value = "777";
        seedInput.dispatchEvent(new Event("input", { bubbles: true }));
        expect(callbacks.onParamChange).toHaveBeenCalledWith({ seed: 777 });
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

    it("places Layer 2 enable checkbox inside .ui-summary next to On/Off badge and supports toggling without expanding", () => {
        const onPresetChange = vi.fn();
        const onScopedParamChange = vi.fn();
        createUI(container, {
            ...callbacks,
            onPresetChange,
            onScopedParamChange,
        });

        const sectionLayer2 = document.getElementById("sectionLayer2");
        const summaryLayer2 = sectionLayer2.querySelector("summary.ui-summary");
        const layer2Enabled = document.getElementById("layer2Enabled");
        const layer2Badge = document.getElementById("layer2Badge");

        expect(summaryLayer2.contains(layer2Enabled)).toBe(true);
        expect(summaryLayer2.contains(layer2Badge)).toBe(true);
        expect(sectionLayer2.hasAttribute("open")).toBe(false);

        // Toggle Layer 2 checkbox inside summary while keeping sectionLayer2 collapsed
        layer2Enabled.checked = true;
        layer2Enabled.dispatchEvent(new Event("change", { bubbles: true }));
        expect(layer2Badge.textContent).toBe("On");
        expect(sectionLayer2.hasAttribute("open")).toBe(false);

        // Switch preset to canyon-valley-dunes
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

    it("toggles floating (i) shader hint popovers below controls without layout shift", () => {
        createUI(container, callbacks);

        const infoBtn = container.querySelector(".info-btn");
        expect(infoBtn).not.toBeNull();
        const targetId = infoBtn.dataset.hintTarget;
        const popover = document.getElementById(targetId);
        expect(popover).not.toBeNull();
        expect(popover.hidden).toBe(true);

        infoBtn.click();
        expect(popover.hidden).toBe(false);
        expect(infoBtn.getAttribute("aria-expanded")).toBe("true");
        expect(popover.textContent).toContain("Shader Uniform:");
        expect(popover.textContent).toContain("Common Shader Term:");

        infoBtn.click();
        expect(popover.hidden).toBe(true);
        expect(infoBtn.getAttribute("aria-expanded")).toBe("false");
    });

    it("defaults to Neutral Clay (Geometry Only), preserves material across preset changes, and supports importing/deleting colours.html JSON palettes", () => {
        const onMaterialPaletteChange = vi.fn();
        const onScopedParamChange = vi.fn();
        const ui = createUI(container, {
            ...callbacks,
            onMaterialPaletteChange,
            onScopedParamChange,
        });

        const matSelect = document.getElementById("materialPaletteSelect");
        expect(matSelect).not.toBeNull();
        expect(MATERIAL_PALETTES.length).toBeGreaterThanOrEqual(12);
        // Starts on Neutral Clay (11)
        expect(Number(matSelect.value)).toBe(PALETTE_NEUTRAL_CLAY);

        // Switching preset keeps Neutral Clay selected so user isn't distracted by painted textures
        const presetSelect = document.getElementById("presetSelect");
        presetSelect.value = "monument-valley-buttes";
        presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
        expect(Number(matSelect.value)).toBe(PALETTE_NEUTRAL_CLAY);

        // User can manually switch to any landscape material (e.g., Zhangjiajie Winter)
        matSelect.value = String(PALETTE_ZHANGJIAJIE_WINTER);
        matSelect.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onMaterialPaletteChange).toHaveBeenCalledWith(PALETTE_ZHANGJIAJIE_WINTER);

        // Import a colours.html JSON export
        const sampleColoursExport = JSON.stringify({
            palettes: [
                {
                    name: "Red Desert Sunset",
                    method: "diagonal/",
                    source: "desert.jpg",
                    colors: ["#3b1d1a", "#7a3624", "#c45a32", "#e38c4d", "#f5c87a"],
                },
            ],
        });
        const parsed = parseColoursHtmlJson(sampleColoursExport, 100);
        expect(parsed.length).toBe(1);
        expect(parsed[0].label).toBe("Red Desert Sunset");
        expect(parsed[0].colors).toEqual(["#3b1d1a", "#7a3624", "#c45a32", "#e38c4d", "#f5c87a"]);

        const imported = ui.importPalettesFromJsonString(sampleColoursExport, "material1");
        expect(imported.length).toBe(1);
        expect(Number(matSelect.value)).toBe(100);

        const delBtn = container.querySelector('.delete-palette-btn[data-mat-slot="material1"]');
        expect(delBtn.disabled).toBe(false);

        // Delete the imported palette -> reverts cleanly to Neutral Clay
        delBtn.click();
        expect(Number(matSelect.value)).toBe(PALETTE_NEUTRAL_CLAY);
        expect(delBtn.disabled).toBe(true);
    });

    it("supports toggling Invert mask checkbox and saving/opening terrain settings JSON", () => {
        const onScopedParamChange = vi.fn();
        const onLoadStack = vi.fn((s) => s);
        const ui = createUI(container, {
            ...callbacks,
            onScopedParamChange,
            onLoadStack,
        });

        // Toggle Invert mask on Layer 2 mask
        const layer2InvertCb = container.querySelector(
            '.mask-invert-cb[data-scope="layer2.mask"][data-param="invertMask"]',
        );
        expect(layer2InvertCb).not.toBeNull();
        expect(layer2InvertCb.checked).toBe(false);
        layer2InvertCb.checked = true;
        layer2InvertCb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onScopedParamChange).toHaveBeenCalledWith("layer2.mask", "invertMask", true);

        // Save / Open JSON buttons exist
        expect(document.getElementById("saveTerrainJsonBtn")).not.toBeNull();
        expect(document.getElementById("openTerrainJsonInput")).not.toBeNull();

        // Export current stack JSON, modify seed & baseHeight, and re-open it
        const exportedJson = ui.exportTerrainSettingsToJsonString();
        const parsedStack = JSON.parse(exportedJson);
        expect(parsedStack.layer2.maskParams.invertMask).toBe(1);

        parsedStack.seed = 909;
        parsedStack.layers[0].generatorParams.baseHeight = 1880;
        ui.loadTerrainSettingsFromJsonString(JSON.stringify(parsedStack));

        expect(onLoadStack).toHaveBeenCalled();
        expect(document.getElementById("seed").value).toBe("909");
        expect(document.getElementById("baseHeight").value).toBe("1880");
        expect(callbacks.onRegenerate).toHaveBeenCalled();
    });
});
