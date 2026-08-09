// UI module: native HTML/CSS slider panel, stage toggles, render mode selector.
// Binds directly to pipeline params — no virtual DOM.

import {
    DEFAULT_PARAMS,
    STAGE_BASE_WAVEFORM,
    STAGE_CREST_WARPING,
    STAGE_PROFILE_MODIFIER,
    STAGE_ANGLE_REPOSE,
    STAGE_MICRO_DETAIL,
    RENDER_HEIGHTMAP,
    RENDER_LIT,
    RENDER_NORMALS,
    RENDER_STAGE_ISOLATION,
    RENDER_SLOPE_HEATMAP,
    RENDER_CURVATURE,
    RENDER_WIREFRAME,
    RENDER_DEBUG_NOISE,
    AREA_KM,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    N,
} from "./constants.js";

export function createUI(container, callbacks) {
    const {
        onParamChange,
        onRegenerate,
        onRenderModeChange,
        onPassToggle,
    } = callbacks;

    const panel = document.createElement("div");
    panel.id = "dunes-ui";
    panel.innerHTML = `
            <div class="ui-section">
                <h3>Scale Info</h3>
                <div class="info-line">Grid: ${N} × ${N}</div>
                <div class="info-line">Area: ${AREA_KM} km × ${AREA_KM} km</div>
                <div class="info-line">Height: 0–${MAX_HEIGHT_M} m</div>
                <div class="info-line">Cell: ${CELL_SPACING_M} m</div>
            </div>

            <div class="ui-section">
                <h3>Stage 1: Base Waveform & Orientation</h3>
                <label class="pass-toggle" data-pass="baseWaveform">
                    <input type="checkbox" id="stageBaseWaveform" checked> Enable
                </label>
                <label>Wind direction (degrees)
                    <input type="range" id="windDirection" min="0" max="360" step="1" value="${DEFAULT_PARAMS.windDirection}">
                    <span class="value" id="windDirectionVal">${DEFAULT_PARAMS.windDirection}</span>
                </label>
                <label>Ridge spacing
                    <input type="range" id="ridgeSpacing" min="0.1" max="2.0" step="0.1" value="${DEFAULT_PARAMS.ridgeSpacing}">
                    <span class="value" id="ridgeSpacingVal">${DEFAULT_PARAMS.ridgeSpacing}</span>
                </label>
                <label>Ridge sharpness
                    <input type="range" id="ridgeSharpness" min="0.5" max="2.0" step="0.1" value="${DEFAULT_PARAMS.ridgeSharpness}">
                    <span class="value" id="ridgeSharpnessVal">${DEFAULT_PARAMS.ridgeSharpness}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Stage 2: Sinuous Crest Warping</h3>
                <label class="pass-toggle" data-pass="crestWarping">
                    <input type="checkbox" id="stageCrestWarping" checked> Enable
                </label>
                <label>Warp frequency
                    <input type="range" id="warpFrequency" min="0.5" max="5.0" step="0.1" value="${DEFAULT_PARAMS.warpFrequency}">
                    <span class="value" id="warpFrequencyVal">${DEFAULT_PARAMS.warpFrequency}</span>
                </label>
                <label>Warp amplitude
                    <input type="range" id="warpAmplitude" min="0.0" max="1.0" step="0.05" value="${DEFAULT_PARAMS.warpAmplitude}">
                    <span class="value" id="warpAmplitudeVal">${DEFAULT_PARAMS.warpAmplitude}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Stage 3: Directional Profile Modifier</h3>
                <label class="pass-toggle" data-pass="profileModifier">
                    <input type="checkbox" id="stageProfileModifier" checked> Enable
                </label>
                <label>Windward power (gentle)
                    <input type="range" id="windwardPower" min="0.5" max="0.9" step="0.05" value="${DEFAULT_PARAMS.windwardPower}">
                    <span class="value" id="windwardPowerVal">${DEFAULT_PARAMS.windwardPower}</span>
                </label>
                <label>Leeward power (steep)
                    <input type="range" id="leewardPower" min="2.0" max="3.0" step="0.1" value="${DEFAULT_PARAMS.leewardPower}">
                    <span class="value" id="leewardPowerVal">${DEFAULT_PARAMS.leewardPower}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Stage 4: Angle of Repose & Talus</h3>
                <label class="pass-toggle" data-pass="angleRepose">
                    <input type="checkbox" id="stageAngleRepose" checked> Enable
                </label>
                <label>Angle of repose (degrees)
                    <input type="range" id="angleOfRepose" min="30" max="35" step="0.5" value="${DEFAULT_PARAMS.angleOfRepose}">
                    <span class="value" id="angleOfReposeVal">${DEFAULT_PARAMS.angleOfRepose}</span>
                </label>
                <label>Talus strength
                    <input type="range" id="talusStrength" min="0.1" max="1.0" step="0.05" value="${DEFAULT_PARAMS.talusStrength}">
                    <span class="value" id="talusStrengthVal">${DEFAULT_PARAMS.talusStrength}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Stage 5: Micro-Surface Detail</h3>
                <label class="pass-toggle" data-pass="microDetail">
                    <input type="checkbox" id="stageMicroDetail" checked> Enable
                </label>
                <label>Ripple frequency
                    <input type="range" id="rippleFrequency" min="5.0" max="50.0" step="1.0" value="${DEFAULT_PARAMS.rippleFrequency}">
                    <span class="value" id="rippleFrequencyVal">${DEFAULT_PARAMS.rippleFrequency}</span>
                </label>
                <label>Ripple amplitude
                    <input type="range" id="rippleAmplitude" min="0.01" max="0.1" step="0.005" value="${DEFAULT_PARAMS.rippleAmplitude}">
                    <span class="value" id="rippleAmplitudeVal">${DEFAULT_PARAMS.rippleAmplitude}</span>
                </label>
                <label>Slope mask threshold
                    <input type="range" id="slopeMaskThreshold" min="0.1" max="0.5" step="0.05" value="${DEFAULT_PARAMS.slopeMaskThreshold}">
                    <span class="value" id="slopeMaskThresholdVal">${DEFAULT_PARAMS.slopeMaskThreshold}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Global Parameters</h3>
                <label>Overall scale
                    <input type="range" id="overallScale" min="0.5" max="2.0" step="0.1" value="${DEFAULT_PARAMS.overallScale}">
                    <span class="value" id="overallScaleVal">${DEFAULT_PARAMS.overallScale}</span>
                </label>
                <label>Height scale
                    <input type="range" id="heightScale" min="0.1" max="5.0" step="0.1" value="${DEFAULT_PARAMS.heightScale}">
                    <span class="value" id="heightScaleVal">${DEFAULT_PARAMS.heightScale}</span>
                </label>
            </div>

            <div class="ui-section">
                <h3>Visualization Mode</h3>
                <label><input type="radio" name="renderMode" value="${RENDER_HEIGHTMAP}" > Heightmap (grayscale)</label>
                <label><input type="radio" name="renderMode" value="${RENDER_LIT}" checked> Lit terrain (sand)</label>
                <label><input type="radio" name="renderMode" value="${RENDER_NORMALS}"> Normals (slope)</label>
                <label><input type="radio" name="renderMode" value="${RENDER_STAGE_ISOLATION}"> Stage isolation</label>
                <label><input type="radio" name="renderMode" value="${RENDER_SLOPE_HEATMAP}"> Slope heatmap</label>
                <label><input type="radio" name="renderMode" value="${RENDER_CURVATURE}"> Curvature</label>
                <label><input type="radio" name="renderMode" value="${RENDER_WIREFRAME}"> Wireframe</label>
                <label><input type="radio" name="renderMode" value="${RENDER_DEBUG_NOISE}"> Debug noise</label>
            </div>

            <div class="ui-section">
                <h3>Seed</h3>
                <label>Seed value
                    <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                </label>
                <button id="regenerateBtn">Regenerate Dunes</button>
            </div>
    `;
    container.appendChild(panel);

    // Add styles
    const style = document.createElement("style");
    style.textContent = `
        #dunes-ui {
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
        #dunes-ui .ui-section {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        #dunes-ui .ui-section:last-child {
            border-bottom: none;
        }
        #dunes-ui h3 {
            margin: 0 0 8px 0;
            font-size: 0.9rem;
            color: #50ff9e;
        }
        #dunes-ui .info-line {
            font-size: 0.8rem;
            color: #aaa;
            margin: 2px 0;
        }
        #dunes-ui label {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 6px 0;
            font-size: 0.8rem;
        }
        #dunes-ui input[type="range"] {
            width: 140px;
        }
        #dunes-ui input[type="number"] {
            width: 80px;
            background: rgba(50, 50, 50, 0.9);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            padding: 2px 6px;
        }
        #dunes-ui .value {
            min-width: 40px;
            text-align: right;
            color: #50ff9e;
            font-size: 0.75rem;
        }
        #dunes-ui button {
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
        #dunes-ui button:hover {
            background: rgba(80, 255, 158, 0.25);
            border-color: #50ff9e;
        }
        #dunes-ui .pass-toggle {
            justify-content: flex-start;
            gap: 8px;
        }
        #dunes-ui .pass-toggle input[type="checkbox"] {
            width: auto;
        }
        #dunes-ui input[type="radio"] {
            width: auto;
            margin-right: 8px;
        }
    `;
    container.appendChild(style);

    // Bind slider events
    const sliderIds = [
        'windDirection', 'ridgeSpacing', 'ridgeSharpness',
        'warpFrequency', 'warpAmplitude',
        'windwardPower', 'leewardPower',
        'angleOfRepose', 'talusStrength',
        'rippleFrequency', 'rippleAmplitude', 'slopeMaskThreshold',
        'overallScale', 'heightScale'
    ];

    sliderIds.forEach(id => {
        const slider = document.getElementById(id);
        const valueSpan = document.getElementById(id + 'Val');
        slider.addEventListener('input', () => {
            valueSpan.textContent = slider.value;
            onParamChange({ [id]: parseFloat(slider.value) });
        });
    });

    // Bind seed input
    const seedInput = document.getElementById('seed');
    seedInput.addEventListener('change', () => {
        onParamChange({ seed: parseInt(seedInput.value, 10) });
    });

    // Bind regenerate button
    document.getElementById('regenerateBtn').addEventListener('click', () => {
        onRegenerate();
    });

    // Bind stage toggles
    const stageToggles = [
        { id: 'stageBaseWaveform', flag: STAGE_BASE_WAVEFORM },
        { id: 'stageCrestWarping', flag: STAGE_CREST_WARPING },
        { id: 'stageProfileModifier', flag: STAGE_PROFILE_MODIFIER },
        { id: 'stageAngleRepose', flag: STAGE_ANGLE_REPOSE },
        { id: 'stageMicroDetail', flag: STAGE_MICRO_DETAIL },
    ];

    let currentPassFlags = DEFAULT_PARAMS.passFlags;

    stageToggles.forEach(({ id, flag }) => {
        const checkbox = document.getElementById(id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                currentPassFlags |= flag;
            } else {
                currentPassFlags &= ~flag;
            }
            onPassToggle(currentPassFlags);
        });
    });

    // Bind render mode radio buttons
    const renderModeRadios = document.querySelectorAll('input[name="renderMode"]');
    renderModeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                onRenderModeChange(parseInt(radio.value, 10));
            }
        });
    });
}
