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

    const panel = document.createElement("div");
    panel.id = "webgpu-ui";
    panel.innerHTML = `
            <div class="ui-section">
                <h3>Scale Info</h3>
                <div class="info-line">Grid: ${N} × ${N}</div>
                <div class="info-line">Area: ${AREA_KM} km × ${AREA_KM} km</div>
                <div class="info-line">Height: 0–${MAX_HEIGHT_M} m</div>
                <div class="info-line">Cell: ${CELL_SPACING_M} m</div>
            </div>

            <div class="ui-section">
                <h3>Terrain Detail</h3>
                <div class="btn-group">
                    ${GRID_SIZES.map(
        (size) =>
            `<button class="grid-size-btn${size === N ? " active" : ""}" data-size="${size}">${size}</button>`,
    ).join("")}
                </div>
                <div class="info-line">Changing resolution reloads the simulator.</div>
            </div>

            <div class="ui-section">
                <h3>Base Noise</h3>
                <label>Base height (m)
                    <input type="range" id="baseHeight" min="25" max="${MAX_HEIGHT_M}" step="5" value="${DEFAULT_PARAMS.baseHeight}">
                    <span class="value" id="baseHeightVal">${DEFAULT_PARAMS.baseHeight}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Simulation Parameters</h3>
                <label>Water per droplet (L)
                    <input type="range" id="rainRate" min="0.1" max="10" step="0.1" value="${DEFAULT_PARAMS.rainRate}">
                    <span class="value" id="rainRateVal">${DEFAULT_PARAMS.rainRate}</span>
                </label>
                <label>Erosion strength
                    <input type="range" id="erosionRate" min="0.1" max="5" step="0.1" value="${DEFAULT_PARAMS.erosionRate}">
                    <span class="value" id="erosionRateVal">${DEFAULT_PARAMS.erosionRate}</span>
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

            <div class="ui-section">
                <h3>Erosion Control</h3>
                <label>Droplet batches per erosion run
                    <input type="number" id="stepCount" min="1" max="10000" value="${DEFAULT_PARAMS.stepCount}">
                </label>
                <button id="erodeBtn">Erode</button>
                <button id="resetBtn">Reset to Base</button>
            </div>

            <div class="ui-section">
                <h3>Visualization Mode</h3>
                <label><input type="radio" name="renderMode" value="${RENDER_LIT}" checked> Lit terrain</label>
                <label><input type="radio" name="renderMode" value="${RENDER_HARDNESS}"> Hardness map</label>
                <label><input type="radio" name="renderMode" value="${RENDER_NORMALS}"> Slope arrows (flow direction)</label>
                <label><input type="radio" name="renderMode" value="${RENDER_EROSION_HEATMAP}"> Erosion/deposition</label>
            </div>

            <div class="ui-section">
                <h3>Pass Toggles</h3>
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

            <div class="ui-section">
                <h3>Seed</h3>
                <label>Seed value
                    <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                </label>
                <button id="regenerateBtn">Regenerate Terrain</button>
            </div>
    `;
    container.appendChild(panel);

    // Wire up slider events
    const sliders = ["rainRate", "erosionRate", "depositionRate", "evaporation", "sedimentCapacity"];
    for (const name of sliders) {
        const input = document.getElementById(name);
        const valSpan = document.getElementById(name + "Val");
        input.addEventListener("input", () => {
            const val = parseFloat(input.value);
            valSpan.textContent = val;
            onParamChange({ [name]: val });
        });
    }

    // Base noise height — regenerate so the new relief is visible immediately
    const baseHeightInput = document.getElementById("baseHeight");
    const baseHeightVal = document.getElementById("baseHeightVal");
    baseHeightInput.addEventListener("input", () => {
        const val = parseFloat(baseHeightInput.value);
        baseHeightVal.textContent = val;
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
    document.getElementById("stepCount").addEventListener("change", (e) => {
        onParamChange({ stepCount: parseInt(e.target.value, 10) });
    });

    const seedInput = document.getElementById("seed");
    const regenerateBtn = document.getElementById("regenerateBtn");

    // Seed
    seedInput.addEventListener("change", (e) => {
        onParamChange({ seed: parseFloat(e.target.value) });
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
    document.getElementById("erodeBtn").addEventListener("click", () => {
        const steps = parseInt(document.getElementById("stepCount").value, 10);
        onErode(steps);
    });

    // Reset button
    document.getElementById("resetBtn").addEventListener("click", () => {
        onResetToBase();
    });

    // Regenerate button
    document.getElementById("regenerateBtn").addEventListener("click", () => {
        onParamChange({ seed: parseFloat(document.getElementById("seed").value) });
        onRegenerate();
    });

    // Render mode radios
    document.querySelectorAll('input[name="renderMode"]').forEach((radio) => {
        radio.addEventListener("change", (e) => {
            onRenderModeChange(parseInt(e.target.value, 10));
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

    function updatePassToggles() {
        let currentFlags = DEFAULT_PARAMS.passFlags;
        for (const [key, info] of Object.entries(passMap)) {
            const cb = document.getElementById(info.checkbox);
            if (cb.checked) {
                currentFlags |= info.flag;
            } else {
                currentFlags &= ~info.flag;
            }
        }

        // Apply hierarchical disabling
        for (const [key, info] of Object.entries(passMap)) {
            const label = document.querySelector(`.pass-toggle[data-pass="${key}"]`);
            const cb = document.getElementById(info.checkbox);

            // Check if any parent is unchecked
            let parentOff = false;
            for (const [parentKey, parentInfo] of Object.entries(passMap)) {
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
            }
        }

        onPassToggle(currentFlags);
    }

    for (const [key, info] of Object.entries(passMap)) {
        document.getElementById(info.checkbox).addEventListener("change", updatePassToggles);
    }

    return { updatePassToggles };
}
