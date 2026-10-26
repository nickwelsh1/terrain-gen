// UI module: Layer-Centric Accordion Composer Panel for webgpu.html.
// Supports:
//   - 12 Grouped Real-World Landmark Presets (<optgroup> categories)
//   - Dynamic N-Layer Biome Stack (up to MAX_BIOME_LAYERS = 8, with "+ Add Biome Layer" & "Remove")
//   - 6 Shapers including Post-Terrace Boulders, Outcrops & Micro-Relief (shape.surfaceDetail)
//   - 5 Simulations (Phacelle Gullies, Two-Tier Thermal Talus, Wind/Snow Drift, Water Level, Droplets)
//   - 8 Visualization & Mask Inspector Modes

import {
    DEFAULT_PARAMS,
    MAX_BIOME_LAYERS,
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
import {
    PRESETS,
    DEFAULT_PRESET_ID,
    getPresetById,
    createDefaultOverlayLayer,
    normalizeStack,
} from "./presets.js";
import { createDefaultRegistry } from "./operators/index.js";

const GENERATOR_IDS = [
    "gen.ridgeFbm",
    "gen.voronoiBlock",
    "gen.duneField",
    "gen.islandCaldera",
];

const SHAPER_IDS = [
    "shape.terrace",
    "shape.fold",
    "shape.glacialCarve",
    "shape.warp",
    "shape.curveRemap",
    "shape.surfaceDetail",
];

const EXTRA_SIM_IDS = [
    "sim.phacelleErosion",
    "sim.thermalTalus",
    "sim.windDrift",
    "sim.waterLevel",
];

function renderPresetOptGroups(selectedId) {
    const groups = new Map();
    for (const preset of PRESETS) {
        const g = preset.group || "Presets";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(preset);
    }
    let html = "";
    for (const [groupName, items] of groups.entries()) {
        html += `<optgroup label="${groupName}">`;
        for (const p of items) {
            html += `<option value="${p.id}"${p.id === selectedId ? " selected" : ""}>${p.name}</option>`;
        }
        html += `</optgroup>`;
    }
    return html;
}

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
        onAddLayer = null,
        onRemoveLayer = null,
        registry = createDefaultRegistry(),
        initialStack = null,
    } = callbacks;

    let activeStack = normalizeStack(initialStack || getPresetById(DEFAULT_PRESET_ID));

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

    const maskOp = registry.get("mask.select");
    const blendOp = registry.get("blend.layer");

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

    function renderShapersList(layerKey, shapersState) {
        return SHAPER_IDS.map((shaperId) => {
            const op = registry.get(shaperId);
            if (!op) return "";
            const stateObj = shapersState?.[shaperId] || { enabled: false, ...op.defaultParams };
            const scope = `${layerKey}.shaper:${shaperId}`;
            const visibleParams = op.paramSchema.filter((p) => p.tier === "primary" || p.tier === "advanced");
            return `
                <details class="ui-subdrawer shaper-item" data-shaper="${shaperId}">
                    <summary class="ui-subsummary">
                        <span>${op.label}</span>
                        <span class="summary-badge" data-shaper-badge="${layerKey}:${shaperId}">${stateObj.enabled ? "On" : "Off"}</span>
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

    function renderOverlayLayersMarkup() {
        const layers = activeStack.layers || [];
        let html = "";
        for (let i = 1; i < layers.length; i++) {
            const layer = layers[i];
            const layerNum = i + 1;
            const layerKey = `layer${layerNum}`;
            const sectionId = layerNum === 2 ? "sectionLayer2" : `sectionLayer${layerNum}`;
            const badgeId = layerNum === 2 ? "layer2Badge" : `${layerKey}Badge`;
            const enabledId = layerNum === 2 ? "layer2Enabled" : `${layerKey}Enabled`;
            const genSelectId = layerNum === 2 ? "layer2GeneratorSelect" : `${layerKey}GeneratorSelect`;
            const genControlsId = layerNum === 2 ? "layer2GenControls" : `${layerKey}GenControls`;

            html += `
            <details class="ui-section ui-accordion overlay-layer-section" id="${sectionId}" data-layer-index="${i}">
                <summary class="ui-summary">
                    <span class="summary-title">${layer.name || `Layer ${layerNum}: Biome Overlay`}</span>
                    <span class="summary-badge" id="${badgeId}">${layer.enabled ? "On" : "Off"}</span>
                </summary>
                <div class="ui-section-body">
                    <label class="pass-toggle">
                        <input type="checkbox" id="${enabledId}" class="overlay-enable-cb" data-layer-index="${i}" data-scope="${layerKey}" data-param="enabled"${layer.enabled ? " checked" : ""}>
                        Enable Layer ${layerNum}
                    </label>
                    <label>Overlay generator
                        <select id="${genSelectId}" class="overlay-gen-select" data-layer-index="${i}" data-scope="${layerKey}.gen" data-param="generatorId">
                            ${GENERATOR_IDS.map((gid) => {
                                const op = registry.get(gid);
                                return `<option value="${gid}"${layer.generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                            }).join("")}
                        </select>
                    </label>
                    <div id="${genControlsId}">
                        ${renderGeneratorExtraParams(`${layerKey}.gen`, layer.generatorId, layer.generatorParams, false)}
                    </div>

                    <details class="ui-subdrawer" id="${layerKey}MaskDrawer">
                        <summary class="ui-subsummary">
                            <span>Mask &amp; Placement (Alt, Slope, Warp)</span>
                            <span class="summary-badge">Mask</span>
                        </summary>
                        <div class="ui-subdrawer-body">
                            ${maskOp ? maskOp.paramSchema.filter((p) => p.tier !== "hidden").map((p) => renderScopedParamControl(`${layerKey}.mask`, p, layer.maskParams?.[p.key])).join("") : ""}
                        </div>
                    </details>

                    <details class="ui-subdrawer" id="${layerKey}BlendDrawer">
                        <summary class="ui-subsummary">
                            <span>Seam-Free Layer Blending</span>
                            <span class="summary-badge">Height-Fill</span>
                        </summary>
                        <div class="ui-subdrawer-body">
                            ${blendOp ? blendOp.paramSchema.filter((p) => p.tier !== "hidden").map((p) => renderScopedParamControl(`${layerKey}.blend`, p, layer.blendParams?.[p.key])).join("") : ""}
                        </div>
                    </details>
                    ${
                        i >= 2
                            ? `<button type="button" class="remove-layer-btn" data-remove-layer="${i}">Remove Layer ${layerNum}</button>`
                            : ""
                    }
                </div>
            </details>`;
        }
        return html;
    }

    function countActiveShapers() {
        let count = 0;
        for (const id of SHAPER_IDS) {
            if (activeStack.layers[0]?.shapers?.[id]?.enabled) count++;
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

    const panel = document.createElement("div");
    panel.id = "webgpu-ui";
    panel.innerHTML = `
            <div class="ui-section preset-bar" id="sectionPresets">
                <label for="presetSelect">Biome Preset
                    <select id="presetSelect">
                        ${renderPresetOptGroups(activeStack.id)}
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
                                return `<option value="${gid}"${activeStack.layers[0].generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                            }).join("")}
                        </select>
                    </label>
                    <label>Base height (m)
                        <input type="range" id="baseHeight" min="25" max="${MAX_HEIGHT_M}" step="5" value="${DEFAULT_PARAMS.baseHeight}">
                        <span class="value" id="baseHeightVal">${DEFAULT_PARAMS.baseHeight}</span>
                    </label>
                    <div id="layer1GenControls">
                        ${renderGeneratorExtraParams("layer1.gen", activeStack.layers[0].generatorId, activeStack.layers[0].generatorParams, true)}
                    </div>

                    <details class="ui-subdrawer" id="layer1ShapersDrawer">
                        <summary class="ui-subsummary">
                            <span>Shapers, Strata &amp; Boulder Detail</span>
                            <span class="summary-badge" id="shapersCountBadge">${countActiveShapers()} on</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="layer1ShapersBody">
                            ${renderShapersList("layer1", activeStack.layers[0].shapers)}
                        </div>
                    </details>

                    <label>Seed value
                        <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                    </label>
                    <button id="regenerateBtn">Regenerate Terrain</button>
                </div>
            </details>

            <div id="overlayLayersContainer">
                ${renderOverlayLayersMarkup()}
            </div>

            <div class="ui-section layer-stack-actions" id="layerStackActions">
                <button type="button" id="addLayerBtn">${activeStack.layers.length >= MAX_BIOME_LAYERS ? `Max ${MAX_BIOME_LAYERS} Layers Reached` : `+ Add Biome Layer (${activeStack.layers.length}/${MAX_BIOME_LAYERS})`}</button>
            </div>

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
                    <label><input type="radio" name="renderMode" value="${RENDER_MASK_INSPECTOR}"> Active layer placement mask</label>
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
    const shapersCountBadge = panel.querySelector("#shapersCountBadge");
    const extraSimsBadge = panel.querySelector("#extraSimsBadge");
    const overlayLayersContainer = panel.querySelector("#overlayLayersContainer");
    const addLayerBtn = panel.querySelector("#addLayerBtn");

    let erosionPending = false;

    function updateAddLayerButtonState() {
        const count = activeStack.layers.length;
        if (count >= MAX_BIOME_LAYERS) {
            addLayerBtn.disabled = true;
            addLayerBtn.textContent = `Max ${MAX_BIOME_LAYERS} Layers Reached`;
        } else {
            addLayerBtn.disabled = false;
            addLayerBtn.textContent = `+ Add Biome Layer (${count}/${MAX_BIOME_LAYERS})`;
        }
    }

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

    function applyLocalScopedUpdate(scope, param, val) {
        const layerMatch = /^layer(\d+)(?:\.(.+))?$/.exec(scope);
        if (layerMatch) {
            const idx = Number.parseInt(layerMatch[1], 10) - 1;
            const sub = layerMatch[2] || "";
            const layer = activeStack.layers[idx];
            if (!layer) return;
            if (sub === "") {
                layer[param] = val;
            } else if (sub === "gen") {
                layer.generatorParams[param] = val;
            } else if (sub.startsWith("shaper:")) {
                const sid = sub.slice("shaper:".length);
                if (layer.shapers?.[sid]) layer.shapers[sid][param] = val;
            } else if (sub === "mask" && layer.maskParams) {
                layer.maskParams[param] = val;
            } else if (sub === "blend" && layer.blendParams) {
                layer.blendParams[param] = val;
            }
            return;
        }
        if (scope.startsWith("sim:")) {
            const simId = scope.slice("sim:".length);
            if (activeStack.simulations[simId]) {
                activeStack.simulations[simId][param] = val;
            }
        }
    }

    function bindScopedControls(rootEl) {
        rootEl.querySelectorAll(".scoped-slider").forEach((slider) => {
            slider.addEventListener("input", () => {
                const scope = slider.dataset.scope;
                const param = slider.dataset.param;
                const val = Number.parseFloat(slider.value);
                const span = panel.querySelector(`[data-val-for="${scope}:${param}"]`);
                if (span) span.textContent = val;

                applyLocalScopedUpdate(scope, param, val);
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

                applyLocalScopedUpdate(scope, param, val);
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

                applyLocalScopedUpdate(scope, param, checked);
                const shaperMatch = /^(layer\d+)\.shaper:(.+)$/.exec(scope);
                if (shaperMatch) {
                    const lKey = shaperMatch[1];
                    const sid = shaperMatch[2];
                    const badge = panel.querySelector(`[data-shaper-badge="${lKey}:${sid}"]`);
                    if (badge) badge.textContent = checked ? "On" : "Off";
                    shapersCountBadge.textContent = `${countActiveShapers()} on`;
                } else if (scope.startsWith("sim:")) {
                    const simId = scope.slice("sim:".length);
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

    function bindOverlayLayerEvents(containerEl) {
        containerEl.querySelectorAll(".overlay-enable-cb").forEach((cb) => {
            cb.addEventListener("change", () => {
                const idx = Number.parseInt(cb.dataset.layerIndex, 10);
                const layerNum = idx + 1;
                const layerKey = `layer${layerNum}`;
                const badgeId = layerNum === 2 ? "layer2Badge" : `${layerKey}Badge`;
                if (activeStack.layers[idx]) {
                    activeStack.layers[idx].enabled = cb.checked;
                }
                const badgeEl = panel.querySelector(`#${badgeId}`);
                if (badgeEl) badgeEl.textContent = cb.checked ? "On" : "Off";

                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(layerKey, "enabled", cb.checked);
                }
                onRegenerate();
            });
        });

        containerEl.querySelectorAll(".overlay-gen-select").forEach((sel) => {
            sel.addEventListener("change", () => {
                const idx = Number.parseInt(sel.dataset.layerIndex, 10);
                const layerNum = idx + 1;
                const layerKey = `layer${layerNum}`;
                const genId = sel.value;
                const layer = activeStack.layers[idx];
                if (!layer) return;

                layer.generatorId = genId;
                const op = registry.get(genId);
                if (op) {
                    layer.generatorParams = { ...op.defaultParams, ...layer.generatorParams };
                }
                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(`${layerKey}.gen`, "generatorId", genId);
                }
                const controlsId = layerNum === 2 ? "layer2GenControls" : `${layerKey}GenControls`;
                const genControls = panel.querySelector(`#${controlsId}`);
                if (genControls) {
                    genControls.innerHTML = renderGeneratorExtraParams(
                        `${layerKey}.gen`,
                        genId,
                        layer.generatorParams,
                        false,
                    );
                    bindScopedControls(genControls);
                }
                onRegenerate();
            });
        });

        containerEl.querySelectorAll(".remove-layer-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number.parseInt(btn.dataset.removeLayer, 10);
                if (typeof onRemoveLayer === "function") {
                    onRemoveLayer(idx);
                } else if (idx >= 2 && idx < activeStack.layers.length) {
                    activeStack.layers.splice(idx, 1);
                    normalizeStack(activeStack);
                }
                rebuildOverlayLayersUI();
                onRegenerate();
            });
        });
    }

    function rebuildOverlayLayersUI() {
        overlayLayersContainer.innerHTML = renderOverlayLayersMarkup();
        bindScopedControls(overlayLayersContainer);
        bindOverlayLayerEvents(overlayLayersContainer);
        updateAddLayerButtonState();
    }

    bindScopedControls(panel);
    bindOverlayLayerEvents(overlayLayersContainer);
    updateAddLayerButtonState();

    // Add Biome Layer button (capped at MAX_BIOME_LAYERS = 8)
    addLayerBtn.addEventListener("click", () => {
        if (activeStack.layers.length >= MAX_BIOME_LAYERS) return;
        if (typeof onAddLayer === "function") {
            const added = onAddLayer();
            if (added && !activeStack.layers.includes(added)) {
                activeStack.layers.push(added);
                normalizeStack(activeStack);
            }
        } else {
            const nextIdx = activeStack.layers.length + 1;
            activeStack.layers.push(createDefaultOverlayLayer(nextIdx, { enabled: true }));
            normalizeStack(activeStack);
        }
        rebuildOverlayLayersUI();
        onRegenerate();
    });

    // Preset selector
    presetSelect.addEventListener("change", () => {
        const presetId = presetSelect.value;
        activeStack = getPresetById(presetId);
        if (typeof onPresetChange === "function") {
            const returned = onPresetChange(presetId);
            if (returned) activeStack = normalizeStack(returned);
        }
        presetDesc.textContent = activeStack.description || "";

        const baseGenParams = activeStack.layers[0].generatorParams;
        const newBaseH = baseGenParams.baseHeight ?? baseGenParams.duneHeight ?? 1200;
        baseHeightInput.value = String(newBaseH);
        baseHeightVal.textContent = String(newBaseH);
        seedInput.value = String(activeStack.seed ?? 42);
        updateTerrainBadge();

        panel.querySelector("#layer1GeneratorSelect").value = activeStack.layers[0].generatorId;
        panel.querySelector("#layer1GenControls").innerHTML = renderGeneratorExtraParams(
            "layer1.gen",
            activeStack.layers[0].generatorId,
            activeStack.layers[0].generatorParams,
            true,
        );
        panel.querySelector("#layer1ShapersBody").innerHTML = renderShapersList("layer1", activeStack.layers[0].shapers);
        shapersCountBadge.textContent = `${countActiveShapers()} on`;

        panel.querySelector("#extraSimsBody").innerHTML = renderExtraSimulationsList(activeStack.simulations);
        extraSimsBadge.textContent = `${countActiveExtraSims()} on`;

        bindScopedControls(panel.querySelector("#sectionTerrain"));
        bindScopedControls(panel.querySelector("#sectionErosion"));
        rebuildOverlayLayersUI();

        setErosionPending(false);
        onRegenerate();
    });

    // Layer 1 Generator type change
    const layer1GenSelect = panel.querySelector("#layer1GeneratorSelect");
    layer1GenSelect.addEventListener("change", () => {
        const genId = layer1GenSelect.value;
        activeStack.layers[0].generatorId = genId;
        const op = registry.get(genId);
        if (op) {
            activeStack.layers[0].generatorParams = { ...op.defaultParams, ...activeStack.layers[0].generatorParams };
        }
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer1.gen", "generatorId", genId);
        }
        const genControls = panel.querySelector("#layer1GenControls");
        genControls.innerHTML = renderGeneratorExtraParams(
            "layer1.gen",
            genId,
            activeStack.layers[0].generatorParams,
            true,
        );
        bindScopedControls(genControls);
        onRegenerate();
    });

    // Wire up droplet erosion slider events
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

    // Base noise height
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

    // Grid resolution
    panel.querySelectorAll(".grid-size-btn[data-size]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const size = Number.parseInt(btn.dataset.size, 10);
            if (size === N) return;
            localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(size));
            window.location.reload();
        });
    });

    // World extent
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
