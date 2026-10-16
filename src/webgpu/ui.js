// UI module: native HTML/CSS slider panel, pass toggles, render mode selector.
// Binds directly to pipeline params — no virtual DOM.

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
    AREA_KM,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    N,
    GRID_SIZES,
    GRID_SIZE_STORAGE_KEY,
} from "./constants.js";

export function createUI(container, callbacks) {
    const {
        onParamChange,
        onErode,
        onResetToBase,
        onRegenerate,
        onRenderModeChange,
        onPassToggle,
    } = callbacks;

    const RENDER_MODE_LABELS = {
        [RENDER_LIT]: "Lit",
        [RENDER_HARDNESS]: "Hardness",
        [RENDER_NORMALS]: "Slopes",
        [RENDER_EROSION_HEATMAP]: "Erosion",
    };

    const panel = document.createElement("div");
    panel.id = "webgpu-ui";
    panel.innerHTML = `
            <details class="ui-section ui-accordion" id="sectionScale">
                <summary class="ui-summary">
                    <span class="summary-title">Scale &amp; Detail</span>
                    <span class="summary-badge" id="scaleBadge">${N} × ${N}</span>
                </summary>
                <div class="ui-section-body">
                    <div class="btn-group">
                        ${GRID_SIZES.map(
        (size) =>
            `<button class="grid-size-btn${size === N ? " active" : ""}" data-size="${size}">${size}</button>`,
    ).join("")}
                    </div>
                    <div class="info-line">Changing resolution reloads the simulator.</div>
                    <div class="info-grid">
                        <div class="info-line">Grid: ${N} × ${N}</div>
                        <div class="info-line">Area: ${AREA_KM} × ${AREA_KM} km</div>
                        <div class="info-line">Height: 0–${MAX_HEIGHT_M} m</div>
                        <div class="info-line">Cell: ${CELL_SPACING_M} m</div>
                    </div>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionTerrain" open>
                <summary class="ui-summary">
                    <span class="summary-title">Base Terrain</span>
                    <span class="summary-badge" id="terrainBadge">${DEFAULT_PARAMS.baseHeight}m · #${DEFAULT_PARAMS.seed}</span>
                </summary>
                <div class="ui-section-body">
                    <label>Base height (m)
                        <input type="range" id="baseHeight" min="25" max="${MAX_HEIGHT_M}" step="5" value="${DEFAULT_PARAMS.baseHeight}">
                        <span class="value" id="baseHeightVal">${DEFAULT_PARAMS.baseHeight}</span>
                    </label>
                    <label>Seed value
                        <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                    </label>
                    <button id="regenerateBtn">Regenerate Terrain</button>
                </div>
            </details>

            <details class="ui-section ui-accordion" id="sectionErosion" open>
                <summary class="ui-summary">
                    <span class="summary-title">Hydraulic Erosion</span>
                    <span class="summary-badge" id="erosionBadge">${DEFAULT_PARAMS.stepCount} batches</span>
                </summary>
                <div class="ui-section-body">
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
                    <label><input type="radio" name="renderMode" value="${RENDER_LIT}" checked> Lit terrain</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_HARDNESS}"> Hardness map</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_NORMALS}"> Slope arrows (flow direction)</label>
                    <label><input type="radio" name="renderMode" value="${RENDER_EROSION_HEATMAP}"> Erosion/deposition</label>
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

    const erodeBtn = document.getElementById("erodeBtn");
    const erodeHint = document.getElementById("erodeHint");
    const erosionBadge = document.getElementById("erosionBadge");
    const terrainBadge = document.getElementById("terrainBadge");
    const renderBadge = document.getElementById("renderBadge");
    const passesBadge = document.getElementById("passesBadge");
    const stepCountInput = document.getElementById("stepCount");
    const baseHeightInput = document.getElementById("baseHeight");
    const baseHeightVal = document.getElementById("baseHeightVal");
    const seedInput = document.getElementById("seed");
    const regenerateBtn = document.getElementById("regenerateBtn");

    let erosionPending = false;

    function updateErosionBadge() {
        const steps = parseInt(stepCountInput.value, 10) || DEFAULT_PARAMS.stepCount;
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

    // Wire up slider events
    const sliders = ["rainRate", "erosionRate", "depositionRate", "evaporation", "sedimentCapacity"];
    for (const name of sliders) {
        const input = document.getElementById(name);
        const valSpan = document.getElementById(`${name}Val`);
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
        const val = parseFloat(baseHeightInput.value);
        baseHeightVal.textContent = val;
        updateTerrainBadge();
        onParamChange({ baseHeight: val });
        onRegenerate();
    });

    // Terrain detail (grid resolution) — persisted, requires a reload
    document.querySelectorAll(".grid-size-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const size = parseInt(btn.dataset.size, 10);
            if (size === N) return;
            localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(size));
            window.location.reload();
        });
    });

    // Step count
    stepCountInput.addEventListener("input", (e) => {
        const steps = parseInt(e.target.value, 10);
        if (!Number.isNaN(steps)) {
            onParamChange({ stepCount: steps });
            setErosionPending(true);
        }
    });
    stepCountInput.addEventListener("change", (e) => {
        const steps = parseInt(e.target.value, 10);
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
        onParamChange({ seed: parseFloat(e.target.value) });
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
        const steps = parseInt(stepCountInput.value, 10);
        setErosionPending(false);
        onErode(steps);
    });

    // Reset button
    document.getElementById("resetBtn").addEventListener("click", () => {
        setErosionPending(false);
        onResetToBase();
    });

    // Regenerate button
    regenerateBtn.addEventListener("click", () => {
        onParamChange({ seed: parseFloat(seedInput.value) });
        updateTerrainBadge();
        setErosionPending(false);
        onRegenerate();
    });

    // Render mode radios
    document.querySelectorAll('input[name="renderMode"]').forEach((radio) => {
        radio.addEventListener("change", (e) => {
            const mode = parseInt(e.target.value, 10);
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
            const cb = document.getElementById(info.checkbox);
            if (cb.checked) {
                currentFlags |= info.flag;
            } else {
                currentFlags &= ~info.flag;
            }
        }

        // Apply hierarchical disabling
        let activeCount = 0;
        for (const [key, info] of Object.entries(passMap)) {
            const label = document.querySelector(`.pass-toggle[data-pass="${key}"]`);
            const cb = document.getElementById(info.checkbox);

            // Check if any parent is unchecked
            let parentOff = false;
            for (const parentInfo of Object.values(passMap)) {
                if (parentInfo.deps.includes(key) && !document.getElementById(parentInfo.checkbox).checked) {
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
        document.getElementById(info.checkbox).addEventListener("change", () => {
            const isErosionRelated = key === "erosion" || key === "deposition" || key === "hardness";
            updatePassToggles(isErosionRelated);
        });
    }

    return { updatePassToggles, setErosionPending };
}
