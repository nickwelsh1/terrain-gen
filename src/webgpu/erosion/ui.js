// UI module: native HTML/CSS slider panel, stage toggles, render mode selector.

import {
    DEFAULT_PARAMS,
    STAGE_BASE_HEIGHT,
    STAGE_CELL_STRIPES,
    STAGE_MULTI_OCTAVE,
    STAGE_FADE_TARGET,
    STAGE_ADVANCED_NOISE,
    STAGE_SECONDARY_FEATURES,
    RENDER_HEIGHTMAP,
    RENDER_LIT,
    RENDER_NORMALS,
    RENDER_RIDGE_MAP,
    RENDER_STREAM_MAP,
    RENDER_SLOPE_HEATMAP,
    RENDER_CONTOURS,
    AREA_KM,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    N,
} from "./constants.js";

// [id, label, min, max, step]
const STAGES = [
    {
        title: "Stage 1: Base Height & Gradient",
        toggleId: "stageBaseHeight",
        flag: STAGE_BASE_HEIGHT,
        sliders: [
            ["heightFrequency", "Height frequency", 0.5, 8, 0.1],
            ["heightAmp", "Height amplitude", 0.02, 0.4, 0.005],
            ["heightOctaves", "Height octaves", 1, 6, 1],
            ["heightLacunarity", "Height lacunarity", 1.5, 3, 0.1],
            ["heightGain", "Height gain", 0.05, 0.7, 0.05],
        ],
    },
    {
        title: "Stage 2: Phacelle Cell Blending",
        toggleId: "stageCellStripes",
        flag: STAGE_CELL_STRIPES,
        note: "Off = single cell (no 4×4 blend) → chaotic, seamed gullies.",
        sliders: [
            ["cellScale", "Cell scale", 0.3, 1.5, 0.05],
        ],
    },
    {
        title: "Stage 3: Multi-Octave Branching",
        toggleId: "stageMultiOctave",
        flag: STAGE_MULTI_OCTAVE,
        note: "Off = single octave only.",
        sliders: [
            ["erosionOctaves", "Erosion octaves", 1, 7, 1],
            ["lacunarity", "Lacunarity", 1.5, 3, 0.1],
            ["gain", "Gain", 0.3, 0.7, 0.05],
        ],
    },
    {
        title: "Stage 4: Fade Target Masking",
        toggleId: "stageFadeTarget",
        flag: STAGE_FADE_TARGET,
        note: "Off = no fading → valley bulges and rounded peaks.",
        sliders: [
            ["erosionStrength", "Erosion strength", 0.01, 0.6, 0.01],
            ["gullyWeight", "Gully weight", 0, 1, 0.05],
            ["detail", "Detail", 0.5, 3, 0.1],
        ],
    },
    {
        title: "Stage 5: Normalization & Slope",
        toggleId: "stageAdvancedNoise",
        flag: STAGE_ADVANCED_NOISE,
        note: "Off = raw terrain gradient drives gullies → chaotic mess.",
        sliders: [
            ["normalization", "Normalization", 0, 1, 0.05],
            ["assumedSlope", "Assumed slope", 0.1, 2, 0.05],
            ["assumedSlopeAmount", "Assumed slope amount", 0, 1, 0.05],
            ["onsetInitial", "Onset (initial)", 0.2, 4, 0.05],
            ["onsetOctave", "Onset (per octave)", 0.2, 4, 0.05],
        ],
    },
    {
        title: "Stage 6: Ridge & Crease Rounding",
        toggleId: "stageSecondaryFeatures",
        flag: STAGE_SECONDARY_FEATURES,
        sliders: [
            ["ridgeRounding", "Ridge rounding", 0, 1, 0.05],
            ["creaseRounding", "Crease rounding", 0, 1, 0.05],
            ["roundingInputMult", "Rounding input mult", 0, 1, 0.05],
            ["roundingOctaveMult", "Rounding octave mult", 0.5, 3, 0.1],
            ["onsetRidgeInitial", "Ridge onset (initial)", 0.2, 5, 0.05],
            ["onsetRidgeOctave", "Ridge onset (octave)", 0.2, 5, 0.05],
        ],
    },
];

const GLOBAL_SLIDERS = [
    ["erosionScale", "Erosion scale", 0.03, 0.4, 0.01],
    ["heightOffset", "Height offset", -1, 1, 0.05],
    ["heightOffsetFadeAmount", "Offset fade amount", 0, 1, 0.05],
];

const RENDER_MODES = [
    [RENDER_LIT, "Lit terrain"],
    [RENDER_HEIGHTMAP, "Heightmap"],
    [RENDER_NORMALS, "Normals"],
    [RENDER_RIDGE_MAP, "Ridge map"],
    [RENDER_STREAM_MAP, "Stream / drainage"],
    [RENDER_SLOPE_HEATMAP, "Slope heatmap"],
    [RENDER_CONTOURS, "Contours"],
];

function sliderMarkup([id, label, min, max, step]) {
    return `
        <label>${label}
            <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${DEFAULT_PARAMS[id]}">
            <span class="value" id="${id}Val">${DEFAULT_PARAMS[id]}</span>
        </label>`;
}

export function createUI(container, callbacks) {
    const { onParamChange, onRegenerate, onRenderModeChange, onPassToggle } = callbacks;

    const panel = document.createElement("div");
    panel.id = "erosion-ui";
    panel.innerHTML = `
        <div class="ui-section">
            <h3>Scale Info</h3>
            <div class="info-line">Grid: ${N} × ${N}</div>
            <div class="info-line">Area: ${AREA_KM} km × ${AREA_KM} km</div>
            <div class="info-line">Height: 0–${MAX_HEIGHT_M} m</div>
            <div class="info-line">Cell: ${CELL_SPACING_M} m</div>
        </div>

        ${STAGES.map((stage) => `
            <div class="ui-section">
                <h3>${stage.title}</h3>
                <label class="pass-toggle">
                    <input type="checkbox" id="${stage.toggleId}" checked> Enable
                </label>
                ${stage.note ? `<div class="info-line">${stage.note}</div>` : ""}
                ${stage.sliders.map(sliderMarkup).join("")}
            </div>
        `).join("")}

        <div class="ui-section">
            <h3>Global</h3>
            ${GLOBAL_SLIDERS.map(sliderMarkup).join("")}
        </div>

        <div class="ui-section">
            <h3>Visualization Mode</h3>
            ${RENDER_MODES.map(([value, label]) => `
                <label><input type="radio" name="renderMode" value="${value}"${value === DEFAULT_PARAMS.renderMode ? " checked" : ""}> ${label}</label>
            `).join("")}
        </div>

        <div class="ui-section">
            <h3>Seed</h3>
            <label>Seed value
                <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
            </label>
            <button id="regenerateBtn">Regenerate Mountains</button>
            <button id="resetBtn">Reset Defaults</button>
        </div>
    `;
    container.appendChild(panel);

    const style = document.createElement("style");
    style.textContent = `
        #erosion-ui {
            position: fixed;
            top: 16px;
            right: 16px;
            width: 320px;
            max-height: calc(100vh - 32px);
            overflow-y: auto;
            background: rgba(30, 30, 30, 0.95);
            color: #e0e0e0;
            padding: 12px;
            border-radius: 8px;
            font-family: 'Segoe UI', -apple-system, sans-serif;
            font-size: 0.85rem;
            z-index: 100;
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
        }
        #erosion-ui .ui-section {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        #erosion-ui .ui-section:last-child { border-bottom: none; }
        #erosion-ui h3 {
            margin: 0 0 8px 0;
            font-size: 0.9rem;
            color: #50ff9e;
        }
        #erosion-ui .info-line {
            font-size: 0.75rem;
            color: #aaa;
            margin: 2px 0 6px 0;
            line-height: 1.35;
        }
        #erosion-ui label {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin: 6px 0;
            font-size: 0.8rem;
        }
        #erosion-ui input[type="range"] { width: 120px; }
        #erosion-ui input[type="number"] {
            width: 80px;
            background: rgba(50, 50, 50, 0.9);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            padding: 2px 6px;
        }
        #erosion-ui .value {
            min-width: 42px;
            text-align: right;
            color: #50ff9e;
            font-size: 0.75rem;
        }
        #erosion-ui button {
            background: rgba(80, 255, 158, 0.15);
            color: #50ff9e;
            border: 1px solid rgba(80, 255, 158, 0.3);
            border-radius: 6px;
            padding: 6px 14px;
            cursor: pointer;
            font-size: 0.8rem;
            margin: 4px 4px 0 0;
            transition: all 0.25s ease;
        }
        #erosion-ui button:hover {
            background: rgba(80, 255, 158, 0.25);
            border-color: #50ff9e;
        }
        #erosion-ui .pass-toggle { justify-content: flex-start; }
        #erosion-ui .pass-toggle input[type="checkbox"],
        #erosion-ui input[type="radio"] { width: auto; }
        #erosion-ui input[type="radio"] { margin-right: 8px; }
    `;
    container.appendChild(style);

    const allSliders = [...STAGES.flatMap((s) => s.sliders), ...GLOBAL_SLIDERS];

    for (const [id] of allSliders) {
        const slider = panel.querySelector(`#${id}`);
        const valueSpan = panel.querySelector(`#${id}Val`);
        slider.addEventListener("input", () => {
            valueSpan.textContent = slider.value;
            onParamChange({ [id]: Number.parseFloat(slider.value) });
        });
    }

    const seedInput = panel.querySelector("#seed");
    seedInput.addEventListener("change", () => {
        onParamChange({ seed: Number.parseInt(seedInput.value, 10) });
    });

    panel.querySelector("#regenerateBtn").addEventListener("click", () => {
        seedInput.value = String(Math.floor(Math.random() * 1000000));
        onParamChange({ seed: Number.parseInt(seedInput.value, 10) });
        onRegenerate();
    });

    panel.querySelector("#resetBtn").addEventListener("click", () => {
        for (const [id] of allSliders) {
            const slider = panel.querySelector(`#${id}`);
            slider.value = DEFAULT_PARAMS[id];
            panel.querySelector(`#${id}Val`).textContent = DEFAULT_PARAMS[id];
        }
        seedInput.value = DEFAULT_PARAMS.seed;
        onParamChange({ ...DEFAULT_PARAMS });
    });

    let currentPassFlags = DEFAULT_PARAMS.passFlags;

    for (const stage of STAGES) {
        const checkbox = panel.querySelector(`#${stage.toggleId}`);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                currentPassFlags |= stage.flag;
            } else {
                currentPassFlags &= ~stage.flag;
            }
            onPassToggle(currentPassFlags);
        });
    }

    for (const radio of panel.querySelectorAll('input[name="renderMode"]')) {
        radio.addEventListener("change", () => {
            if (radio.checked) {
                onRenderModeChange(Number.parseInt(radio.value, 10));
            }
        });
    }
}
