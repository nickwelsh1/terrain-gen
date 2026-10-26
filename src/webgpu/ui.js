// UI module: Layer-Centric Accordion Composer Panel for webgpu.html.
// Organizes controls into:
//   - Top Preset Bar (6 Gaea-style presets + Seed + Regenerate)
//   - Scale & World Extent Accordion (256/512/1024 grid + 1.28..10.24 km world size)
//   - Layer 1: Base Terrain Accordion (Generator selector + Primary/Advanced params + 5 Shapers)
//   - Layer 2: Secondary Biome / Overlay Accordion (Generator + Mask & Placement + Height-Fill Blend)
//   - Simulations & Hydraulic Erosion Accordion (Droplet sim + Phacelle + Thermal Talus + Wind Drift + Water Level)
//   - Visualization & Mask Inspector Accordion (8 render modes)
//   - Pass Toggles Accordion
//
// Preserves all existing DOM IDs and callback contracts tested by test/unit/webgpu-ui.test.js.

import {
    DEFAULT_PARAMS,
    PASS_HEIGHTMAP,
    PASS_HARDNESS,
    PASS_NORMALS,
    PASS_EROSION,
    PASS_DEPOSITION,
    RENDER_LIT,
    RENDER_HARDNESS,
    RENDER_NORMALS,
    RENDER_EROSION_HEATMAP,
    RENDER_HEIGHTMAP,
    RENDER_MASK_INSPECTOR,
    RENDER_SEDIMENT,
    RENDER_CURVATURE_AO,
    AREA_M,
    AREA_KM,
    AREA_SIZES,
    AREA_SIZE_STORAGE_KEY,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    N,
    GRID_SIZES,
    GRID_SIZE_STORAGE_KEY,
} from "./constants.js";
import { PRESETS, DEFAULT_PRESET_ID, getPresetById } from "./presets.js";
import { createDefaultRegistry } from "./operators/index.js";

const GENERATOR_IDS = [
    "gen.ridgeFbm",
    "gen.duneField",
    "gen.voronoiBlock",
    "gen.islandCaldera",
];

const SHAPER_IDS = [
    "shape.terrace",
    "shape.fold",
    "shape.glacialCarve",
    "shape.warp",
    "shape.curveRemap",
];

const EXTRA_SIM_IDS = [
    "sim.phacelleErosion",
    "sim.thermalTalus",
    "sim.windDrift",
    "sim.waterLevel",
];

function renderScopedParamControl(scope, paramDef, currentValue) {
    const val = currentValue !== undefined ? currentValue : paramDef.default;
    if (paramDef.type === "select" && Array.isArray(paramDef.options)) {
        return `
            <label>${paramDef.label}
                <select class="scoped-select" data-scope="${scope}" data-param="${paramDef.key}">
                    ${paramDef.options
                        .map(
                            (opt) =>
                                `<option value="${opt.value}"${Number(val) === Number(opt.value) ? " selected" : ""}>${opt.label}</option>`,
                        )
                        .join("")}
                </select>
            </label>`;
    }
    return `
        <label>${paramDef.label}
            <input type="range" class="scoped-slider" data-scope="${scope}" data-param="${paramDef.key}"
                min="${paramDef.min}" max="${paramDef.max}" step="${paramDef.step}" value="${val}">
            <span class="value" data-val-for="${scope}:${paramDef.key}">${val}</span>
        </label>`;
}

export function createUI(container, callbacks = {}) {
    const {
        onParamChange = () => {},
        onErode = () => {},
        onResetToBase = () => {},
        onRegenerate = () => {},
        onRenderModeChange = () => {},
        onPassToggle = () => {},
        onPresetChange = null,
        onScopedParamChange = null,
        registry = createDefaultRegistry(),
        initialStack = null,
    } = callbacks;

    let activeStack = initialStack || getPresetById(DEFAULT_PRESET_ID);

    const RENDER_MODE_LABELS = {
        [RENDER_LIT]: "Lit",
        [RENDER_HARDNESS]: "Hardness",
        [RENDER_NORMALS]: "Slopes",
        [RENDER_EROSION_HEATMAP]: "Erosion",
        [RENDER_HEIGHTMAP]: "Height",
        [RENDER_MASK_INSPECTOR]: "Mask",
        [RENDER_SEDIMENT]: "Sediment",
        [RENDER_CURVATURE_AO]: "Curvature",
    };

    function renderGeneratorExtraParams(scope, genId, paramsMap, excludeBaseHeight = false) {
        const op = registry.get(genId);
        if (!op) return "";
        const primary = op.paramSchema.filter(
            (p) => p.tier === "primary" && !(excludeBaseHeight && p.key === "baseHeight"),
        );
        const advanced = op.paramSchema.filter((p) => p.tier === "advanced");
        return `
            <div class="scoped-controls-group">
                ${primary.map((p) => renderScopedParamControl(scope, p, paramsMap?.[p.key])).join("")}
                ${
                    advanced.length > 0
                        ? `<details class="ui-subdrawer">
                            <summary class="ui-subsummary">
                                <span>Generator fine-tune</span>
                                <span class="summary-badge">${advanced.length}</span>
                            </summary>
                            <div class="ui-subdrawer-body">
                                ${advanced.map((p) => renderScopedParamControl(scope, p, paramsMap?.[p.key])).join("")}
                            </div>
                        </details>`
                        : ""
                }
            </div>`;
    }

    function renderShapersList(shapersState) {
        return SHAPER_IDS.map((shaperId) => {
            const op = registry.get(shaperId);
            if (!op) return "";
            const stateObj = shapersState?.[shaperId] || { enabled: false, ...op.defaultParams };
            const scope = `layer1.shaper:${shaperId}`;
            const visibleParams = op.paramSchema.filter((p) => p.tier === "primary" || p.tier === "advanced");
            return `
                <details class="ui-subdrawer shaper-item" data-shaper="${shaperId}">
                    <summary class="ui-subsummary">
                        <span>${op.label}</span>
                        <span class="summary-badge" data-shaper-badge="${shaperId}">${stateObj.enabled ? "On" : "Off"}</span>
                    </summary>
                    <div class="ui-subdrawer-body">
                        <label class="pass-toggle">
                            <input type="checkbox" class="scoped-checkbox" data-scope="${scope}" data-param="enabled"${stateObj.enabled ? " checked" : ""}>
                            Enable ${op.label}
                        </label>
                        ${visibleParams.map((p) => renderScopedParamControl(scope, p, stateObj[p.key])).join("")}
                    </div>
                </details>`;
        }).join("");
    }

    function renderExtraSimulationsList(simsState) {
        return EXTRA_SIM_IDS.map((simId) => {
            const op = registry.get(simId);
            if (!op) return "";
            const stateObj = simsState?.[simId] || { enabled: false, ...op.defaultParams };
            const scope = `sim:${simId}`;
            const visibleParams = op.paramSchema.filter((p) => p.tier === "primary" || p.tier === "advanced");
            return `
                <details class="ui-subdrawer sim-item" data-sim="${simId}">
                    <summary class="ui-subsummary">
                        <span>${op.label}</span>
                        <span class="summary-badge" data-sim-badge="${simId}">${stateObj.enabled ? "On" : "Off"}</span>
                    </summary>
                    <div class="ui-subdrawer-body">
                        <label class="pass-toggle">
                            <input type="checkbox" class="scoped-checkbox" data-scope="${scope}" data-param="enabled"${stateObj.enabled ? " checked" : ""}>
                            Enable ${op.label}
                        </label>
                        ${visibleParams.map((p) => renderScopedParamControl(scope, p, stateObj[p.key])).join("")}
                    </div>
                </details>`;
        }).join("");
    }

    function countActiveShapers() {
        let count = 0;
        for (const id of SHAPER_IDS) {
            if (activeStack.layer1?.shapers?.[id]?.enabled) count++;
        }
        return count;
    }

    function countActiveExtraSims() {
        let count = 0;
        for (const id of EXTRA_SIM_IDS) {
            if (activeStack.simulations?.[id]?.enabled) count++;
        }
        return count;
    }

    const maskOp = registry.get("mask.select");
    const blendOp = registry.get("blend.layer");

    const panel = document.createElement("div");
    panel.id = "webgpu-ui";
    panel.innerHTML = `
            <div class="ui-section preset-bar" id="sectionPresets">
                <label for="presetSelect">Biome Preset
                    <select id="presetSelect">
                        ${PRESETS.map(
                            (p) =>
                                `<option value="${p.id}"${p.id === activeStack.id ? " selected" : ""}>${p.name}</option>`,
                        ).join("")}
                    </select>
                </label>
                <div class="info-line" id="presetDesc">${activeStack.description || ""}</div>
            </div>

            <details class="ui-section ui-accordion" id="sectionScale">
                <summary class="ui-summary">
                    <span class="summary-title">Scale &amp; World Size</span>
                    <span class="summary-badge" id="scaleBadge">${N} × ${N} · ${AREA_KM}km</span>
                </summary>
                <div class="ui-section-body">
                    <div class="sub-label">Grid resolution</div>
                    <div class="btn-group">
                        ${GRID_SIZES.map(
                            (size) =>
                                `<button class="grid-size-btn${size === N ? " active" : ""}" data-size="${size}">${size}</button>`,
                        ).join("")}
                    </div>
                    <div class="sub-label">World extent (tile width)</div>
                    <div class="btn-group">
                        ${AREA_SIZES.map(
                            (areaM) =>
                                `<button class="area-size-btn grid-size-btn${areaM === AREA_M ? " active" : ""}" data-area="${areaM}">${(areaM / 1000).toFixed(2).replace(/\.?0+$/, "")}km</button>`,
                        ).join("")}
                    </div>
                    <div class="info-line">Changing resolution or world extent reloads the simulator.</div>
                    <div class="info-grid">
                        <div class="info-line">Grid: ${N} × ${N}</div>
                        <div class="info-line">Area: ${AREA_KM} × ${AREA_KM} km</div>
                        <div class="info-line">Height: 0–${MAX_HEIGHT_M} m</div>
                        <div class="info-line">Cell: ${CELL_SPACING_M.toFixed(1)} m</div>
                    </div>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionTerrain" open>
                <summary class="ui-summary">
                    <span class="summary-title">Layer 1: Base Terrain</span>
                    <span class="summary-badge" id="terrainBadge">${DEFAULT_PARAMS.baseHeight}m · #${DEFAULT_PARAMS.seed}</span>
                </summary>
                <div class="ui-section-body">
                    <label>Generator
                        <select id="layer1GeneratorSelect" data-scope="layer1.gen" data-param="generatorId">
                            ${GENERATOR_IDS.map((gid) => {
                                const op = registry.get(gid);
                                return `<option value="${gid}"${activeStack.layer1.generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                            }).join("")}
                        </select>
                    </label>
                    <label>Base height (m)
                        <input type="range" id="baseHeight" min="25" max="${MAX_HEIGHT_M}" step="5" value="${DEFAULT_PARAMS.baseHeight}">
                        <span class="value" id="baseHeightVal">${DEFAULT_PARAMS.baseHeight}</span>
                    </label>
                    <div id="layer1GenControls">
                        ${renderGeneratorExtraParams("layer1.gen", activeStack.layer1.generatorId, activeStack.layer1.generatorParams, true)}
                    </div>

                    <details class="ui-subdrawer" id="layer1ShapersDrawer">
                        <summary class="ui-subsummary">
                            <span>Shapers &amp; Filters (Strata, Fold, Glacial)</span>
                            <span class="summary-badge" id="shapersCountBadge">${countActiveShapers()} on</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="layer1ShapersBody">
                            ${renderShapersList(activeStack.layer1.shapers)}
                        </div>
                    </details>

                    <label>Seed value
                        <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                    </label>
                    <button id="regenerateBtn">Regenerate Terrain</button>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionLayer2">
                <summary class="ui-summary">
                    <span class="summary-title">Layer 2: Biome Overlay</span>
                    <span class="summary-badge" id="layer2Badge">${activeStack.layer2.enabled ? "On" : "Off"}</span>
                </summary>
                <div class="ui-section-body">
                    <label class="pass-toggle">
                        <input type="checkbox" id="layer2Enabled" data-scope="layer2" data-param="enabled"${activeStack.layer2.enabled ? " checked" : ""}>
                        Enable Secondary Biome Layer
                    </label>
                    <label>Overlay generator
                        <select id="layer2GeneratorSelect" data-scope="layer2.gen" data-param="generatorId">
                            ${GENERATOR_IDS.map((gid) => {
                                const op = registry.get(gid);
                                return `<option value="${gid}"${activeStack.layer2.generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                            }).join("")}
                        </select>
                    </label>
                    <div id="layer2GenControls">
                        ${renderGeneratorExtraParams("layer2.gen", activeStack.layer2.generatorId, activeStack.layer2.generatorParams, false)}
                    </div>

                    <details class="ui-subdrawer" id="layer2MaskDrawer">
                        <summary class="ui-subsummary">
                            <span>Mask &amp; Placement (Alt, Slope, Warp)</span>
                            <span class="summary-badge">Mask</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="layer2MaskBody">
                            ${maskOp ? maskOp.paramSchema.filter((p) => p.tier !== "hidden").map((p) => renderScopedParamControl("layer2.mask", p, activeStack.layer2.maskParams?.[p.key])).join("") : ""}
                        </div>
                    </details>

                    <details class="ui-subdrawer" id="layer2BlendDrawer">
                        <summary class="ui-subsummary">
                            <span>Seam-Free Layer Blending</span>
                            <span class="summary-badge">Height-Fill</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="layer2BlendBody">
                            ${blendOp ? blendOp.paramSchema.filter((p) => p.tier !== "hidden").map((p) => renderScopedParamControl("layer2.blend", p, activeStack.layer2.blendParams?.[p.key])).join("") : ""}
                        </div>
                    </details>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionErosion" open>
                <summary class="ui-summary">
                    <span class="summary-title">Simulations &amp; Erosion</span>
                    <span class="summary-badge" id="erosionBadge">${DEFAULT_PARAMS.stepCount} batches</span>
                </summary>
                <div class="ui-section-body">
                    <details class="ui-subdrawer" id="simPassesDrawer">
                        <summary class="ui-subsummary">
                            <span>Talus, Gullies, Wind &amp; Water Sims</span>
                            <span class="summary-badge" id="extraSimsBadge">${countActiveExtraSims()} on</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="extraSimsBody">
                            ${renderExtraSimulationsList(activeStack.simulations)}
                        </div>
                    </details>

                    <label>Erosion strength
                        <input type="range" id="erosionRate" min="0.1" max="5" step="0.1" value="${DEFAULT_PARAMS.erosionRate}">
                        <span class="value" id="erosionRateVal">${DEFAULT_PARAMS.erosionRate}</span>
                    </label>
                    <label>Droplet batches per run
                        <input type="number" id="stepCount" min="1" max="10000" value="${DEFAULT_PARAMS.stepCount}">
                    </label>

                    <details class="ui-subdrawer" id="fineTuneDrawer">
                        <summary class="ui-subsummary">
                            <span>Fine-tune parameters</span>
                            <span class="summary-badge">4</span>
                        </summary>
                        <div class="ui-subdrawer-body">
                            <label>Water per droplet (L)
                                <input type="range" id="rainRate" min="0.1" max="10" step="0.1" value="${DEFAULT_PARAMS.rainRate}">
                                <span class="value" id="rainRateVal">${DEFAULT_PARAMS.rainRate}</span>
                            </label>
                            <label>Deposition strength
                                <input type="range" id="depositionRate" min="0.01" max="1" step="0.01" value="${DEFAULT_PARAMS.depositionRate}">
                                <span class="value" id="depositionRateVal">${DEFAULT_PARAMS.depositionRate}</span>
                            </label>
                            <label>Evaporation (per step)
                                <input type="range" id="evaporation" min="0.01" max="0.5" step="0.01" value="${DEFAULT_PARAMS.evaporation}">
                                <span class="value" id="evaporationVal">${DEFAULT_PARAMS.evaporation}</span>
                            </label>
                            <label>Sediment capacity
                                <input type="range" id="sedimentCapacity" min="0.1" max="2" step="0.1" value="${DEFAULT_PARAMS.sedimentCapacity}">
                                <span class="value" id="sedimentCapacityVal">${DEFAULT_PARAMS.sedimentCapacity}</span>
                            </label>
                        </div>
                    </details>

                    <div class="erode-actions">
                        <div class="btn-group">
                            <button id="erodeBtn">Erode</button>
                            <button id="resetBtn">Reset to Base</button>
                        </div>
                        <div class="info-line pending-hint" id="erodeHint" hidden>Parameters changed — click <strong>Erode</strong> to apply.</div>
                    </div>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionRender" open>
                <summary class="ui-summary">
                    <span class="summary-title">Visualization Mode</span>
                    <span class="summary-badge" id="renderBadge">Lit</span>
                </summary>
                <div class="ui-section-body">
                    <label><input type="radio" name="renderMode" value="${RENDER_LIT}" checked> Lit biome terrain</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_HEIGHTMAP}"> Elevation heightmap</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_HARDNESS}"> Hardness map</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_NORMALS}"> Slope arrows (flow direction)</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_EROSION_HEATMAP}"> Erosion / slope heatmap</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_MASK_INSPECTOR}"> Layer 2 placement mask</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_SEDIMENT}"> Loose sand / scree depth</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_CURVATURE_AO}"> Curvature &amp; horizon AO</label>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionPasses">
                <summary class="ui-summary">
                    <span class="summary-title">Pass Toggles</span>
                    <span class="summary-badge" id="passesBadge">5/5 on</span>
                </summary>
                <div class="ui-section-body">
                    <label class="pass-toggle" data-pass="heightmap">
                        <input type="checkbox" id="passHeightmap" checked> Heightmap generation
                    </label>
                    <label class="pass-toggle" data-pass="hardness">
                        <input type="checkbox" id="passHardness" checked> Hardness map
                    </label>
                    <label class="pass-toggle" data-pass="normals">
                        <input type="checkbox" id="passNormals" checked> Normal/slope/aspect
                    </label>
                    <label class="pass-toggle" data-pass="erosion">
                        <input type="checkbox" id="passErosion" checked> Hydraulic erosion
                    </label>
                    <label class="pass-toggle" data-pass="deposition">
                        <input type="checkbox" id="passDeposition" checked> Deposition
                    </label>
                </div>
            </details>
    `;
    container.appendChild(panel);

    const erodeBtn = panel.querySelector("#erodeBtn");
    const erodeHint = panel.querySelector("#erodeHint");
    const erosionBadge = panel.querySelector("#erosionBadge");
    const terrainBadge = panel.querySelector("#terrainBadge");
    const renderBadge = panel.querySelector("#renderBadge");
    const passesBadge = panel.querySelector("#passesBadge");
    const stepCountInput = panel.querySelector("#stepCount");
    const baseHeightInput = panel.querySelector("#baseHeight");
    const baseHeightVal = panel.querySelector("#baseHeightVal");
    const seedInput = panel.querySelector("#seed");
    const regenerateBtn = panel.querySelector("#regenerateBtn");
    const presetSelect = panel.querySelector("#presetSelect");
    const presetDesc = panel.querySelector("#presetDesc");
    const layer2Badge = panel.querySelector("#layer2Badge");
    const shapersCountBadge = panel.querySelector("#shapersCountBadge");
    const extraSimsBadge = panel.querySelector("#extraSimsBadge");

    let erosionPending = false;

    function updateErosionBadge() {
        const steps = Number.parseInt(stepCountInput.value, 10) || DEFAULT_PARAMS.stepCount;
        if (erosionPending) {
            erosionBadge.textContent = "Pending";
            erosionBadge.classList.add("pending");
        } else {
            erosionBadge.textContent = `${steps} ${steps === 1 ? "batch" : "batches"}`;
            erosionBadge.classList.remove("pending");
        }
    }

    function updateTerrainBadge() {
        terrainBadge.textContent = `${baseHeightInput.value}m · #${seedInput.value}`;
    }

    function setErosionPending(pending) {
        erosionPending = pending;
        erodeBtn.classList.toggle("pending", pending);
        erodeBtn.textContent = pending ? "Erode (Apply)" : "Erode";
        erodeHint.hidden = !pending;
        updateErosionBadge();
    }

    function bindScopedControls(rootEl) {
        rootEl.querySelectorAll(".scoped-slider").forEach((slider) => {
            slider.addEventListener("input", () => {
                const scope = slider.dataset.scope;
                const param = slider.dataset.param;
                const val = Number.parseFloat(slider.value);
                const span = panel.querySelector(`[data-val-for="${scope}:${param}"]`);
                if (span) span.textContent = val;

                if (scope === "layer1.gen") {
                    activeStack.layer1.generatorParams[param] = val;
                } else if (scope.startsWith("layer1.shaper:")) {
                    const sid = scope.slice("layer1.shaper:".length);
                    if (activeStack.layer1.shapers[sid]) activeStack.layer1.shapers[sid][param] = val;
                } else if (scope === "layer2.gen") {
                    activeStack.layer2.generatorParams[param] = val;
                } else if (scope === "layer2.mask") {
                    activeStack.layer2.maskParams[param] = val;
                } else if (scope === "layer2.blend") {
                    activeStack.layer2.blendParams[param] = val;
                } else if (scope.startsWith("sim:")) {
                    const simId = scope.slice("sim:".length);
                    if (activeStack.simulations[simId]) activeStack.simulations[simId][param] = val;
                }

                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(scope, param, val);
                }
                onRegenerate();
            });
        });

        rootEl.querySelectorAll(".scoped-select").forEach((sel) => {
            sel.addEventListener("change", () => {
                const scope = sel.dataset.scope;
                const param = sel.dataset.param;
                const numVal = Number(sel.value);
                const val = Number.isNaN(numVal) ? sel.value : numVal;

                if (scope === "layer1.gen") {
                    activeStack.layer1.generatorParams[param] = val;
                } else if (scope === "layer2.gen") {
                    activeStack.layer2.generatorParams[param] = val;
                } else if (scope === "layer2.blend") {
                    activeStack.layer2.blendParams[param] = val;
                }

                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(scope, param, val);
                }
                onRegenerate();
            });
        });

        rootEl.querySelectorAll(".scoped-checkbox").forEach((cb) => {
            cb.addEventListener("change", () => {
                const scope = cb.dataset.scope;
                const param = cb.dataset.param;
                const checked = cb.checked;

                if (scope.startsWith("layer1.shaper:")) {
                    const sid = scope.slice("layer1.shaper:".length);
                    if (activeStack.layer1.shapers[sid]) {
                        activeStack.layer1.shapers[sid][param] = checked;
                    }
                    const badge = panel.querySelector(`[data-shaper-badge="${sid}"]`);
                    if (badge) badge.textContent = checked ? "On" : "Off";
                    shapersCountBadge.textContent = `${countActiveShapers()} on`;
                } else if (scope.startsWith("sim:")) {
                    const simId = scope.slice("sim:".length);
                    if (activeStack.simulations[simId]) {
                        activeStack.simulations[simId][param] = checked;
                    }
                    const badge = panel.querySelector(`[data-sim-badge="${simId}"]`);
                    if (badge) badge.textContent = checked ? "On" : "Off";
                    extraSimsBadge.textContent = `${countActiveExtraSims()} on`;
                }

                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(scope, param, checked);
                }
                onRegenerate();
            });
        });
    }

    bindScopedControls(panel);

    // Preset selector
    presetSelect.addEventListener("change", () => {
        const presetId = presetSelect.value;
        activeStack = getPresetById(presetId);
        if (typeof onPresetChange === "function") {
            const returned = onPresetChange(presetId);
            if (returned) activeStack = returned;
        }
        presetDesc.textContent = activeStack.description || "";

        // Sync top-level controls from preset
        const newBaseH = activeStack.layer1.generatorParams.baseHeight ?? activeStack.layer1.generatorParams.duneHeight ?? 800;
        baseHeightInput.value = String(newBaseH);
        baseHeightVal.textContent = String(newBaseH);
        seedInput.value = String(activeStack.seed ?? 42);
        updateTerrainBadge();

        // Rebuild Layer 1 & Layer 2 generator controls + Shapers + Extra Sims
        panel.querySelector("#layer1GeneratorSelect").value = activeStack.layer1.generatorId;
        panel.querySelector("#layer1GenControls").innerHTML = renderGeneratorExtraParams(
            "layer1.gen",
            activeStack.layer1.generatorId,
            activeStack.layer1.generatorParams,
            true,
        );
        panel.querySelector("#layer1ShapersBody").innerHTML = renderShapersList(activeStack.layer1.shapers);
        shapersCountBadge.textContent = `${countActiveShapers()} on`;

        const l2EnabledCb = panel.querySelector("#layer2Enabled");
        l2EnabledCb.checked = Boolean(activeStack.layer2.enabled);
        layer2Badge.textContent = activeStack.layer2.enabled ? "On" : "Off";
        panel.querySelector("#layer2GeneratorSelect").value = activeStack.layer2.generatorId;
        panel.querySelector("#layer2GenControls").innerHTML = renderGeneratorExtraParams(
            "layer2.gen",
            activeStack.layer2.generatorId,
            activeStack.layer2.generatorParams,
            false,
        );

        panel.querySelector("#extraSimsBody").innerHTML = renderExtraSimulationsList(activeStack.simulations);
        extraSimsBadge.textContent = `${countActiveExtraSims()} on`;

        bindScopedControls(panel);
        setErosionPending(false);
        onRegenerate();
    });

    // Layer 1 Generator type change
    const layer1GenSelect = panel.querySelector("#layer1GeneratorSelect");
    layer1GenSelect.addEventListener("change", () => {
        const genId = layer1GenSelect.value;
        activeStack.layer1.generatorId = genId;
        const op = registry.get(genId);
        if (op) {
            activeStack.layer1.generatorParams = { ...op.defaultParams, ...activeStack.layer1.generatorParams };
        }
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer1.gen", "generatorId", genId);
        }
        const genControls = panel.querySelector("#layer1GenControls");
        genControls.innerHTML = renderGeneratorExtraParams(
            "layer1.gen",
            genId,
            activeStack.layer1.generatorParams,
            true,
        );
        bindScopedControls(genControls);
        onRegenerate();
    });

    // Layer 2 Enable & Generator type change
    const layer2EnabledCb = panel.querySelector("#layer2Enabled");
    layer2EnabledCb.addEventListener("change", () => {
        activeStack.layer2.enabled = layer2EnabledCb.checked;
        layer2Badge.textContent = layer2EnabledCb.checked ? "On" : "Off";
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer2", "enabled", layer2EnabledCb.checked);
        }
        onRegenerate();
    });

    const layer2GenSelect = panel.querySelector("#layer2GeneratorSelect");
    layer2GenSelect.addEventListener("change", () => {
        const genId = layer2GenSelect.value;
        activeStack.layer2.generatorId = genId;
        const op = registry.get(genId);
        if (op) {
            activeStack.layer2.generatorParams = { ...op.defaultParams, ...activeStack.layer2.generatorParams };
        }
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer2.gen", "generatorId", genId);
        }
        const genControls = panel.querySelector("#layer2GenControls");
        genControls.innerHTML = renderGeneratorExtraParams(
            "layer2.gen",
            genId,
            activeStack.layer2.generatorParams,
            false,
        );
        bindScopedControls(genControls);
        onRegenerate();
    });

    // Wire up droplet erosion slider events (preserved contract)
    const sliders = ["rainRate", "erosionRate", "depositionRate", "evaporation", "sedimentCapacity"];
    for (const name of sliders) {
        const input = panel.querySelector(`#${name}`);
        const valSpan = panel.querySelector(`#${name}Val`);
        input.addEventListener("input", () => {
            const val = Number.parseFloat(input.value);
            valSpan.textContent = val;
            onParamChange({ [name]: val });
            setErosionPending(true);
        });
        input.addEventListener("focus", () => {
            erodeBtn.classList.add("connected");
        });
        input.addEventListener("blur", () => {
            erodeBtn.classList.remove("connected");
        });
    }

    // Base noise height — regenerate so the new relief is visible immediately
    baseHeightInput.addEventListener("input", () => {
        const val = Number.parseFloat(baseHeightInput.value);
        baseHeightVal.textContent = val;
        updateTerrainBadge();
        onParamChange({ baseHeight: val });
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer1.gen", "baseHeight", val);
        }
        onRegenerate();
    });

    // Terrain detail (grid resolution) — persisted, requires a reload
    panel.querySelectorAll(".grid-size-btn[data-size]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const size = Number.parseInt(btn.dataset.size, 10);
            if (size === N) return;
            localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(size));
            window.location.reload();
        });
    });

    // World extent (tile size in meters) — persisted, requires a reload
    panel.querySelectorAll(".area-size-btn[data-area]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const area = Number.parseInt(btn.dataset.area, 10);
            if (area === AREA_M) return;
            localStorage.setItem(AREA_SIZE_STORAGE_KEY, String(area));
            window.location.reload();
        });
    });

    // Step count
    stepCountInput.addEventListener("input", (e) => {
        const steps = Number.parseInt(e.target.value, 10);
        if (!Number.isNaN(steps)) {
            onParamChange({ stepCount: steps });
            setErosionPending(true);
        }
    });
    stepCountInput.addEventListener("change", (e) => {
        const steps = Number.parseInt(e.target.value, 10);
        if (!Number.isNaN(steps)) {
            onParamChange({ stepCount: steps });
            setErosionPending(true);
        }
    });
    stepCountInput.addEventListener("focus", () => {
        erodeBtn.classList.add("connected");
    });
    stepCountInput.addEventListener("blur", () => {
        erodeBtn.classList.remove("connected");
    });
    stepCountInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            erodeBtn.click();
        }
    });

    // Seed
    seedInput.addEventListener("change", (e) => {
        updateTerrainBadge();
        const seedVal = Number.parseFloat(e.target.value);
        onParamChange({ seed: seedVal });
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("global", "seed", seedVal);
        }
    });
    seedInput.addEventListener("input", () => {
        updateTerrainBadge();
    });
    seedInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            regenerateBtn.click();
        }
    });
    seedInput.addEventListener("focus", () => {
        regenerateBtn.classList.add("connected");
    });
    seedInput.addEventListener("blur", () => {
        regenerateBtn.classList.remove("connected");
    });

    // Erode button
    erodeBtn.addEventListener("click", () => {
        const steps = Number.parseInt(stepCountInput.value, 10);
        setErosionPending(false);
        onErode(steps);
    });

    // Reset button
    panel.querySelector("#resetBtn").addEventListener("click", () => {
        setErosionPending(false);
        onResetToBase();
    });

    // Regenerate button
    regenerateBtn.addEventListener("click", () => {
        const seedVal = Number.parseFloat(seedInput.value);
        onParamChange({ seed: seedVal });
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("global", "seed", seedVal);
        }
        updateTerrainBadge();
        setErosionPending(false);
        onRegenerate();
    });

    // Render mode radios
    panel.querySelectorAll('input[name="renderMode"]').forEach((radio) => {
        radio.addEventListener("change", (e) => {
            const mode = Number.parseInt(e.target.value, 10);
            renderBadge.textContent = RENDER_MODE_LABELS[mode] || "Lit";
            onRenderModeChange(mode);
        });
    });

    // Pass toggle checkboxes — hierarchical
    const passMap = {
        heightmap: { flag: PASS_HEIGHTMAP, checkbox: "passHeightmap", deps: ["hardness", "normals", "erosion", "deposition"] },
        hardness: { flag: PASS_HARDNESS, checkbox: "passHardness", deps: ["erosion"] },
        normals: { flag: PASS_NORMALS, checkbox: "passNormals", deps: [] },
        erosion: { flag: PASS_EROSION, checkbox: "passErosion", deps: ["deposition"] },
        deposition: { flag: PASS_DEPOSITION, checkbox: "passDeposition", deps: [] },
    };

    const totalPasses = Object.keys(passMap).length;

    function updatePassToggles(markPending = false) {
        let currentFlags = DEFAULT_PARAMS.passFlags;
        for (const info of Object.values(passMap)) {
            const cb = panel.querySelector(`#${info.checkbox}`);
            if (cb.checked) {
                currentFlags |= info.flag;
            } else {
                currentFlags &= ~info.flag;
            }
        }

        let activeCount = 0;
        for (const [key, info] of Object.entries(passMap)) {
            const label = panel.querySelector(`.pass-toggle[data-pass="${key}"]`);
            const cb = panel.querySelector(`#${info.checkbox}`);

            let parentOff = false;
            for (const parentInfo of Object.values(passMap)) {
                if (parentInfo.deps.includes(key) && !panel.querySelector(`#${parentInfo.checkbox}`).checked) {
                    parentOff = true;
                    break;
                }
            }

            if (parentOff) {
                label.classList.add("disabled");
                cb.disabled = true;
                currentFlags &= ~info.flag;
            } else {
                label.classList.remove("disabled");
                cb.disabled = false;
                if (cb.checked) activeCount++;
            }
        }

        passesBadge.textContent = `${activeCount}/${totalPasses} on`;
        if (markPending) {
            setErosionPending(true);
        }
        onPassToggle(currentFlags);
    }

    for (const [key, info] of Object.entries(passMap)) {
        panel.querySelector(`#${info.checkbox}`).addEventListener("change", () => {
            const isErosionRelated = key === "erosion" || key === "deposition" || key === "hardness";
            updatePassToggles(isErosionRelated);
        });
    }

    return { updatePassToggles, setErosionPending };
}
