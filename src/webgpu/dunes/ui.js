// UI module: native HTML/CSS slider panel generated from PARAM_SCHEMA.
// Sections are shown/hidden according to the active generator mode.

import {
    PARAM_SCHEMA,
    DEFAULT_PARAMS,
    MODE_LABELS,
    RENDER_LABELS,
    RENDER_LIT,
    AREA_KM,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    N,
} from "./constants.js";

const MODE_HINTS = [
    "Warped Voronoi edges are the crests, cells are pans, vertices become star peaks. Generations stack smaller networks on the flanks.",
    "Runevision stacked-fade Phacelle stripes follow each sand dome's downslope, so arms radiate from summits and branch per octave.",
    "Voronoi crest network as the base, with Phacelle arms branching on its windward flanks.",
];

export function createUI(container, callbacks) {
    const { onParamChange, onRenderModeChange } = callbacks;
    const params = { ...DEFAULT_PARAMS };

    const groups = [];
    for (const p of PARAM_SCHEMA) {
        if (p.ui === "none") continue;
        let g = groups.find((x) => x.name === p.group);
        if (!g) {
            g = { name: p.group, items: [] };
            groups.push(g);
        }
        g.items.push(p);
    }

    const slider = (p) => `
        <label data-modes="${p.modes.join(",")}">${p.label}
            <input type="range" id="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}">
            <span class="value" id="${p.key}Val">${p.value}</span>
        </label>`;

    const panel = document.createElement("div");
    panel.id = "dunes-ui";
    panel.innerHTML = `
        <div class="ui-section">
            <h3>Namib Star Dunes — Prototype</h3>
            <div class="info-line">Grid ${N} × ${N} · ${AREA_KM} km · ${CELL_SPACING_M} m cells · 0–${MAX_HEIGHT_M} m</div>
        </div>
        <div class="ui-section">
            <h3>Generator</h3>
            ${MODE_LABELS.map((m) => `<label class="pass-toggle"><input type="radio" name="genMode" value="${m.value}" ${m.value === params.mode ? "checked" : ""}> ${m.label}</label>`).join("")}
            <div class="info-line" id="modeHint">${MODE_HINTS[params.mode]}</div>
        </div>
        ${groups.map((g) => `
        <div class="ui-section" data-group="${g.name}">
            <h3>${g.name}</h3>
            ${g.items.map(slider).join("")}
        </div>`).join("")}
        <div class="ui-section">
            <h3>View</h3>
            ${RENDER_LABELS.map((r) => `<label class="pass-toggle"><input type="radio" name="renderMode" value="${r.value}" ${r.value === RENDER_LIT ? "checked" : ""}> ${r.label}</label>`).join("")}
        </div>
        <div class="ui-section">
            <h3>Seed</h3>
            <label>Seed value
                <input type="number" id="seed" min="0" max="999999" value="${params.seed}">
            </label>
            <div class="btn-group">
                <button id="randomSeedBtn">Random seed</button>
                <button id="resetBtn">Reset defaults</button>
            </div>
        </div>
    `;
    container.appendChild(panel);

    const applyModeVisibility = () => {
        const mode = String(params.mode);
        panel.querySelectorAll("label[data-modes]").forEach((el) => {
            el.style.display = el.dataset.modes.split(",").includes(mode) ? "" : "none";
        });
        panel.querySelectorAll(".ui-section[data-group]").forEach((sec) => {
            const visible = [...sec.querySelectorAll("label[data-modes]")].some((el) => el.style.display !== "none");
            sec.style.display = visible ? "" : "none";
        });
        panel.querySelector("#modeHint").textContent = MODE_HINTS[params.mode];
    };

    const set = (patch) => {
        Object.assign(params, patch);
        onParamChange(patch);
    };

    for (const g of groups) {
        for (const p of g.items) {
            const input = panel.querySelector(`#${p.key}`);
            const valueSpan = panel.querySelector(`#${p.key}Val`);
            input.addEventListener("input", () => {
                valueSpan.textContent = input.value;
                set({ [p.key]: parseFloat(input.value) });
            });
        }
    }

    panel.querySelectorAll('input[name="genMode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            set({ mode: parseInt(radio.value, 10) });
            applyModeVisibility();
        });
    });

    panel.querySelectorAll('input[name="renderMode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            if (radio.checked) onRenderModeChange(parseInt(radio.value, 10));
        });
    });

    const seedInput = panel.querySelector("#seed");
    seedInput.addEventListener("change", () => set({ seed: parseInt(seedInput.value, 10) || 0 }));
    panel.querySelector("#randomSeedBtn").addEventListener("click", () => {
        seedInput.value = Math.floor(Math.random() * 1000000);
        set({ seed: parseInt(seedInput.value, 10) });
    });

    panel.querySelector("#resetBtn").addEventListener("click", () => {
        const mode = params.mode;
        const patch = { ...DEFAULT_PARAMS, mode, seed: params.seed };
        for (const g of groups) {
            for (const p of g.items) {
                panel.querySelector(`#${p.key}`).value = p.value;
                panel.querySelector(`#${p.key}Val`).textContent = p.value;
            }
        }
        set(patch);
    });

    applyModeVisibility();
}
