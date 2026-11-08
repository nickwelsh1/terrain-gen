// UI module: Causal Layer -> Mask -> Detail / Erosion / Material 1 & 2 Composer Panel for webgpu.html.
// Supports:
//   - Causal pipeline order: Broad Terrain -> Detail Mask -> Detail Terrain -> Layer 2 Mask -> Layer 2 Terrain -> Layer 2 Detail Mask -> Layer 2 Detail -> Erosion Mask -> Erosion -> Material 1 (Mask, Palette, Shader) -> Material 2 (Mask, Palette, Shader)
//   - Inline On/Off checkboxes in .ui-summary & .ui-subsummary (toggle without expanding)
//   - Seed at top of Layer 1 with immediate live application (no Regenerate button needed)
//   - Floating (i) shader info popovers below each control (absolute positioned, zero layout shift, no math formulas)
//   - Compact 64x64 2D Mask Preview canvas thumbnails for every mask
//   - Default Neutral Clay (Geometry Only) shade + colours.html JSON palette import & custom palette deletion

import {
    DEFAULT_PARAMS,
    DEFAULT_PALETTE_SWATCHES,
    PALETTE_NEUTRAL_CLAY,
    CUSTOM_PALETTES_STORAGE_KEY,
    MAX_BIOME_LAYERS,
    MATERIAL_PALETTES,
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
    serializeStack,
    deserializeStack,
} from "./presets.js";
import { createDefaultRegistry } from "./operators/index.js";

const LAYER_OPERATOR_IDS = [
    "gen.ridgeFbm",
    "gen.voronoiBlock",
    "gen.duneField",
    "gen.islandCaldera",
    "shape.surfaceDetail",
];

const MACRO_SHAPER_IDS = [
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

const SWATCH_LABELS = ["Floor", "Mid", "Upper", "Cliff", "Peak"];

const MATERIAL_SHADER_SCHEMA = [
    {
        key: "rockType",
        label: "Rock archetype",
        type: "select",
        options: [
            { value: 0, label: "Folded Stratigraphy" },
            { value: 1, label: "Granite & Quartz Veins" },
            { value: 2, label: "Vertical Karst Shafts" },
            { value: 3, label: "Columnar Basalt & Dikes" },
        ],
        default: 0,
        shaderInfo: {
            uniform: "materials[slot + 1].x (rockType)",
            shaderTerm: "proceduralRockArchetype",
            hint: "Selects the 3D procedural cliff and bedrock shader branch evaluated on steep slopes and outcrops.",
        },
    },
    {
        key: "cliffScale",
        label: "Strata frequency",
        min: 0.3,
        max: 2.5,
        step: 0.05,
        default: 1.0,
        shaderInfo: {
            uniform: "materials[slot + 1].y (cliffScale)",
            shaderTerm: "triplanarUvScale",
            hint: "Scales the vertical and horizontal frequency of rock beds, fractures, and mineral veins.",
        },
    },
    {
        key: "foldStrength",
        label: "Strata fold & fault",
        min: 0.0,
        max: 2.5,
        step: 0.05,
        default: 1.2,
        shaderInfo: {
            uniform: "materials[slot + 1].z (foldStrength)",
            shaderTerm: "strataWarpAmplitude",
            hint: "Controls how strongly 3D rock beds tilt, fold, and offset across fault lines in the surface shader.",
        },
    },
    {
        key: "outcropExposure",
        label: "Outcrop exposure",
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 0.55,
        shaderInfo: {
            uniform: "materials[slot + 1].w (outcropExposure)",
            shaderTerm: "bedrockBlendMask",
            hint: "Controls how strongly contoured 3D bedrock strata show through on flat benches and convex ridges.",
        },
    },
    {
        key: "snowLineM",
        label: "Snow / frost line (m)",
        min: 50,
        max: 2500,
        step: 25,
        default: 1800,
        shaderInfo: {
            uniform: "materials[slot + 2].x (snowLineM)",
            shaderTerm: "snowElevationThreshold",
            hint: "Elevation in meters above which gentle slopes transition to high-summit snow or frost.",
        },
    },
];

let hintCounter = 0;

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function rgb01ToHex(r, g, b) {
    const toByte = (v) =>
        Math.round(clamp01(v) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/**
 * Converts a color string or object from colours.html (HEX, rgb(), oklch(), lch(), or {color:{r,g,b}})
 * into a standard 6-digit #rrggbb hex string.
 */
export function normalizeImportedColorToHex(input) {
    if (!input) return "#808080";
    if (typeof input === "object") {
        const c = input.color || input;
        if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
            const scale = c.r > 1 || c.g > 1 || c.b > 1 ? 1 / 255 : 1;
            return rgb01ToHex(c.r * scale, c.g * scale, c.b * scale);
        }
    }
    if (typeof input !== "string") return "#808080";
    const s = input.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
    }
    const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (rgbMatch) {
        return rgb01ToHex(
            Number(rgbMatch[1]) / 255,
            Number(rgbMatch[2]) / 255,
            Number(rgbMatch[3]) / 255,
        );
    }
    const oklchMatch = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(s);
    if (oklchMatch) {
        const L = Number(oklchMatch[1]) / (s.includes("%") || Number(oklchMatch[1]) > 1 ? 100 : 1);
        const C = Number(oklchMatch[2]);
        const H = (Number(oklchMatch[3]) * Math.PI) / 180;
        const a = C * Math.cos(H);
        const b = C * Math.sin(H);
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.291485548 * b;
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const sc = s_ * s_ * s_;
        const linToSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
        const r = linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sc);
        const g = linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sc);
        const bl = linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * sc);
        return rgb01ToHex(r, g, bl);
    }
    const lchMatch = /^lch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(s);
    if (lchMatch) {
        const L = Number(lchMatch[1]) / 100;
        const C = Number(lchMatch[2]) / 150;
        const H = (Number(lchMatch[3]) * Math.PI) / 180;
        return rgb01ToHex(L + C * Math.cos(H) * 0.5, L - C * 0.2, L + C * Math.sin(H) * 0.5);
    }
    return "#808080";
}

function mapColorsTo5Swatches(hexColors) {
    if (!Array.isArray(hexColors) || hexColors.length === 0) {
        return [...DEFAULT_PALETTE_SWATCHES[PALETTE_NEUTRAL_CLAY].colors];
    }
    const result = [];
    for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const idx = Math.min(hexColors.length - 1, Math.round(t * (hexColors.length - 1)));
        result.push(hexColors[idx]);
    }
    return result;
}

/**
 * Parses a colours.html JSON export string into normalized 5-swatch custom palette entries.
 */
export function parseColoursHtmlJson(jsonString, startValue = 100) {
    const data = JSON.parse(jsonString);
    const rawEntries = [];
    const looseColors = [];

    for (const item of Array.isArray(data) ? data : [data]) {
        if (typeof item === "string") {
            looseColors.push(item);
            continue;
        }
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item.palettes) && !Array.isArray(item.colors)) {
            for (const p of item.palettes) {
                if (p && typeof p === "object") {
                    rawEntries.push({
                        ...p,
                        source: p.source ?? item.imageName ?? item.name ?? null,
                    });
                }
            }
        } else {
            rawEntries.push(item);
        }
    }
    if (looseColors.length > 0) {
        rawEntries.push({ name: "Imported Palette", colors: looseColors });
    }

    let nextId = startValue;
    return rawEntries
        .filter((e) => Array.isArray(e.colors) && e.colors.length > 0)
        .map((e) => {
            const hexList = e.colors.map(normalizeImportedColorToHex);
            const swatches = mapColorsTo5Swatches(hexList);
            const value = nextId++;
            return {
                value,
                custom: true,
                group: "Imported & Custom Palettes",
                label: e.name || `Imported Palette #${value - 99}`,
                source: e.source || null,
                colors: swatches,
                rockType: 0,
                cliffScale: 1.0,
                foldStrength: 1.2,
                outcropExposure: 0.6,
                snowLineM: 2100,
            };
        });
}

function loadCustomPalettes() {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(CUSTOM_PALETTES_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        for (const p of parsed) {
            if (p && typeof p.value === "number" && Array.isArray(p.colors)) {
                DEFAULT_PALETTE_SWATCHES[p.value] = {
                    colors: [...p.colors],
                    rockType: p.rockType ?? 0,
                    cliffScale: p.cliffScale ?? 1.0,
                    foldStrength: p.foldStrength ?? 1.2,
                    outcropExposure: p.outcropExposure ?? 0.6,
                    snowLineM: p.snowLineM ?? 2100,
                };
            }
        }
        return parsed;
    } catch {
        return [];
    }
}

function saveCustomPalettes(customList) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(CUSTOM_PALETTES_STORAGE_KEY, JSON.stringify(customList));
    } catch {
        // Ignore storage quota errors
    }
}

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

function renderMaterialPaletteOptGroups(selectedPalette, customPalettes = []) {
    const allPalettes = [...MATERIAL_PALETTES, ...customPalettes];
    const groups = new Map();
    for (const pal of allPalettes) {
        const g = pal.group || "Materials";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(pal);
    }
    let html = "";
    for (const [groupName, items] of groups.entries()) {
        html += `<optgroup label="${groupName}">`;
        for (const pal of items) {
            html += `<option value="${pal.value}"${Number(pal.value) === Number(selectedPalette) ? " selected" : ""}>${pal.label}</option>`;
        }
        html += `</optgroup>`;
    }
    return html;
}

function renderShaderHintPopover(paramDef) {
    const info = paramDef.shaderInfo || {
        uniform: `params.${paramDef.key}`,
        shaderTerm: paramDef.key,
        hint: `Adjusts ${paramDef.label.toLowerCase()} in the compute or surface shader pass.`,
    };
    const popId = `shader-hint-${++hintCounter}`;
    return {
        buttonHtml: `<button type="button" class="info-btn" data-hint-target="${popId}" aria-label="Shader info for ${paramDef.label}" aria-expanded="false" title="Shader code info">i</button>`,
        popoverHtml: `
            <div class="shader-hint-popover" id="${popId}" role="tooltip" hidden>
                <div class="hint-row"><span class="hint-key">Shader Uniform:</span> <code>${info.uniform}</code></div>
                <div class="hint-row"><span class="hint-key">Common Shader Term:</span> <code>${info.shaderTerm}</code></div>
                <div class="hint-desc">${info.hint}</div>
            </div>`,
    };
}

function renderScopedParamControl(scope, paramDef, currentValue) {
    const val = currentValue !== undefined ? currentValue : paramDef.default;
    const { buttonHtml, popoverHtml } = renderShaderHintPopover(paramDef);

    if (paramDef.type === "select" && Array.isArray(paramDef.options)) {
        return `
            <div class="control-row">
                <label>
                    <span class="label-title">${paramDef.label} ${buttonHtml}</span>
                    <select class="scoped-select" data-scope="${scope}" data-param="${paramDef.key}">
                        ${paramDef.options
                            .map(
                                (opt) =>
                                    `<option value="${opt.value}"${Number(val) === Number(opt.value) ? " selected" : ""}>${opt.label}</option>`,
                            )
                            .join("")}
                    </select>
                </label>
                ${popoverHtml}
            </div>`;
    }
    return `
        <div class="control-row">
            <label>
                <span class="label-title">${paramDef.label} ${buttonHtml}</span>
                <input type="range" class="scoped-slider" data-scope="${scope}" data-param="${paramDef.key}"
                    min="${paramDef.min}" max="${paramDef.max}" step="${paramDef.step}" value="${val}">
                <span class="value" data-val-for="${scope}:${paramDef.key}">${val}</span>
            </label>
            ${popoverHtml}
        </div>`;
}

// Fast 64x64 deterministic 2D mask preview evaluator for each Mask block
function hash2D(ix, iy, seed) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(Math.trunc(seed), 1442695041);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2D(ix, iy, seed);
    const b = hash2D(ix + 1, iy, seed);
    const c = hash2D(ix, iy + 1, seed);
    const d = hash2D(ix + 1, iy + 1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmPreview(x, y, seed, octaves = 3) {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
        v += amp * valueNoise2D(x * freq, y * freq, seed + i * 31);
        freq *= 2.02;
        amp *= 0.5;
    }
    return v;
}

function smoothstepJS(edge0, edge1, x) {
    const span = edge1 - edge0;
    if (Math.abs(span) < 1e-6) return x >= edge1 ? 1 : 0;
    const t = clamp01((x - edge0) / span);
    return t * t * (3 - 2 * t);
}

export function renderMaskPreviewToCanvas(canvas, maskParams = {}, stack = {}) {
    if (!canvas) return;
    const W = canvas.width || 200;
    const H = canvas.height || 200;
    const gridW = 100;
    const gridH = 100;
    const seed = Number(stack.seed ?? 42);
    const baseLayer = stack.layers?.[0] || {};
    const genId = baseLayer.generatorId || "gen.ridgeFbm";
    const baseGen = baseLayer.generatorParams || {};
    const baseH = Number(baseGen.baseHeight ?? baseGen.duneHeight ?? 1200);
    const freq = Number(baseGen.frequency ?? baseGen.cellScale ?? 2.6);
    const orientRad = (Number(baseGen.orientationDeg ?? baseGen.windDirection ?? 0) * Math.PI) / 180;
    const cosO = Math.cos(orientRad);
    const sinO = Math.sin(orientRad);

    const heights = new Float32Array(gridW * gridH);
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const u = x / (gridW - 1) - 0.5;
            const v = y / (gridH - 1) - 0.5;
            const ru = u * cosO - v * sinO;
            const rv = u * sinO + v * cosO;
            let h01 = 0;
            if (genId === "gen.islandCaldera") {
                const r = Math.hypot(ru * 1.8, rv * 2.2);
                const rimR = Number(baseGen.islandRadius ?? 0.8) * 0.72;
                const n = (fbmPreview((ru + 0.5) * 2.5, (rv + 0.5) * 2.5, seed, 2) - 0.5) * 0.12;
                const rn = r + n;
                h01 = rn < rimR ? 0.14 + 0.8 * clamp01(rn / rimR) ** 2.0 : 0.1 + 0.82 * Math.exp(-(rn - rimR) * 9.0);
            } else if (genId === "gen.duneField") {
                const phase = ((ru + 0.5) * freq * 6.0 + fbmPreview(ru * 3, rv * 3, seed, 2) * 0.6) % 1;
                const p = phase < 0 ? phase + 1 : phase;
                h01 = p < 0.74 ? (p / 0.74) ** 1.2 : (1 - (p - 0.74) / 0.26) ** 1.8;
            } else {
                const sx = (ru + 0.5) * freq;
                const sy = (rv + 0.5) * freq;
                const n = fbmPreview(sx, sy, seed, 3);
                const ridge = 1 - Math.abs(n * 2 - 1);
                h01 = clamp01(n * 0.55 + ridge * 0.45);
            }
            heights[y * gridW + x] = clamp01(h01) * baseH;
        }
    }

    const gridMask = new Uint8Array(gridW * gridH);
    const minAltM = Number(maskParams.minAltM ?? -20);
    const maxAltM = Number(maskParams.maxAltM ?? 600);
    const fAlt = Math.max(2, Number(maskParams.featherAltM ?? 60));
    const minSlopeDeg = Number(maskParams.minSlopeDeg ?? 0);
    const maxSlopeDeg = Number(maskParams.maxSlopeDeg ?? 35);
    const fSlope = Math.max(1, Number(maskParams.featherSlopeDeg ?? 8));
    const curvBias = Number(maskParams.curvatureBias ?? 0);
    const warpAmpM = Number(maskParams.warpAmpM ?? 50);
    const warpFreq = Math.max(0.25, Number(maskParams.warpFreq ?? 1.25));
    const maskSource = Number(maskParams.maskSource ?? 0);
    const contrast = Math.max(0.1, Number(maskParams.contrast ?? 1.0));
    const bias = Number(maskParams.bias ?? 0.0);
    const invert = Boolean(maskParams.invertMask) && Number(maskParams.invertMask) !== 0;

    const cellM = (AREA_M || 2560) / gridW;

    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const idx = y * gridW + x;
            const h = heights[idx];
            const hL = heights[y * gridW + Math.max(0, x - 1)];
            const hR = heights[y * gridW + Math.min(gridW - 1, x + 1)];
            const hU = heights[Math.max(0, y - 1) * gridW + x];
            const hD = heights[Math.min(gridH - 1, y + 1) * gridW + x];

            const gx = (hR - hL) / (2 * cellM);
            const gy = (hD - hU) / (2 * cellM);
            const slopeDeg = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
            const lap = (hL + hR + hU + hD) * 0.25 - h;
            const curvSigned = Math.max(-1, Math.min(1, -lap / 35));
            const curv01 = curvSigned * 0.5 + 0.5;

            const nw = fbmPreview((x / gridW) * warpFreq * 4 + 7, (y / gridH) * warpFreq * 4 + 13, seed + 71, 2) - 0.5;
            const hWarped = h + nw * 2 * warpAmpM;

            const mAlt =
                smoothstepJS(minAltM - fAlt, minAltM + fAlt, hWarped) *
                (1 - smoothstepJS(maxAltM - fAlt, maxAltM + fAlt, hWarped));
            const mSlope =
                smoothstepJS(minSlopeDeg - fSlope, minSlopeDeg + fSlope, slopeDeg) *
                (1 - smoothstepJS(maxSlopeDeg - fSlope, maxSlopeDeg + fSlope, slopeDeg));

            let mCurv = 1;
            if (Math.abs(curvBias) > 0.01) {
                if (curvBias < 0) {
                    mCurv = 1 + (-curvBias) * (smoothstepJS(-0.05, 0.35, -curvSigned) - 1);
                } else {
                    mCurv = 1 + curvBias * (smoothstepJS(-0.05, 0.35, curvSigned) - 1);
                }
            }

            let m = clamp01(mAlt * mSlope * mCurv);
            if (maskSource === 1) {
                m = clamp01((hWarped - minAltM) / Math.max(10, maxAltM - minAltM));
            } else if (maskSource === 2) {
                m = clamp01((slopeDeg - minSlopeDeg) / Math.max(1, maxSlopeDeg - minSlopeDeg)) * mAlt;
            } else if (maskSource === 4) {
                m = clamp01(curv01) * mAlt;
            } else if (maskSource === 5) {
                const sedEst = clamp01((1 - slopeDeg / 45) * (1 - h / Math.max(200, baseH)));
                m = sedEst * mAlt;
            }

            m = clamp01((m - 0.5) * contrast + 0.5 + bias);
            if (invert) m = 1 - m;

            gridMask[idx] = Math.round(m * 255);
        }
    }

    const maskValues = new Uint8ClampedArray(W * H * 4);
    for (let py = 0; py < H; py++) {
        const gy = Math.min(gridH - 1, Math.floor((py * gridH) / H));
        for (let px = 0; px < W; px++) {
            const gx = Math.min(gridW - 1, Math.floor((px * gridW) / W));
            const byte = gridMask[gy * gridW + gx];
            const p = (py * W + px) * 4;
            maskValues[p + 0] = byte;
            maskValues[p + 1] = byte;
            maskValues[p + 2] = Math.min(255, Math.round(byte * 0.92 + 12));
            maskValues[p + 3] = 255;
        }
    }

    canvas.dataset.previewRendered = "true";
    try {
        const ctx = canvas.getContext("2d");
        if (ctx && typeof ctx.putImageData === "function") {
            const imgData =
                typeof ImageData !== "undefined"
                    ? new ImageData(maskValues, W, H)
                    : ctx.createImageData(W, H);
            if (typeof ImageData === "undefined") {
                imgData.data.set(maskValues);
            }
            ctx.putImageData(imgData, 0, 0);
        }
    } catch {
        // Headless test environments without 2D canvas context implementation
    }
}

export function createUI(container, callbacks = {}) {
    const {
        onParamChange = () => {},
        onErode = () => {},
        onResetToBase = () => {},
        onRegenerate = () => {},
        onRenderModeChange = () => {},
        onMaterialPaletteChange = () => {},
        onPassToggle = () => {},
        onPresetChange = null,
        onLoadStack = null,
        onScopedParamChange = null,
        onAddLayer = null,
        onRemoveLayer = null,
        registry = createDefaultRegistry(),
        initialStack = null,
    } = callbacks;

    const customPalettes = loadCustomPalettes();
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
    const detailOp = registry.get("shape.surfaceDetail");

    function renderMaskInspectorCard(maskScope, title, maskParams = {}, openByDefault = false, extraBodyHtml = "") {
        if (!maskOp) return "";
        const topKeys = ["sourceStep", "maskSource", "contrast", "bias"];
        const topDefs = topKeys.map((k) => maskOp.paramSchema.find((p) => p.key === k)).filter(Boolean);
        const invertDef = maskOp.paramSchema.find((p) => p.key === "invertMask");
        const invertHint = invertDef ? renderShaderHintPopover(invertDef) : { buttonHtml: "", popoverHtml: "" };
        const isInverted = Boolean(maskParams?.invertMask) && Number(maskParams?.invertMask) !== 0;
        const rangeDefs = maskOp.paramSchema.filter(
            (p) => p.tier !== "hidden" && !topKeys.includes(p.key) && p.key !== "invertMask",
        );

        return `
            <details class="ui-subdrawer mask-step-drawer" data-mask-scope="${maskScope}"${openByDefault ? " open" : ""}>
                <summary class="ui-subsummary">
                    <span>${title}</span>
                    <span class="summary-badge">Mask</span>
                </summary>
                <div class="ui-subdrawer-body">
                    <div class="mask-preview-box" title="Live 2D mask preview (white = active)">
                        <canvas class="mask-preview-canvas" data-mask-preview="${maskScope}" width="200" height="200"></canvas>
                        <span class="mask-preview-caption">Mask 2D Preview (200 × 200)</span>
                    </div>
                    <div class="mask-primary-controls">
                        ${topDefs.map((p) => renderScopedParamControl(maskScope, p, maskParams?.[p.key])).join("")}
                        <div class="control-row">
                            <label class="pass-toggle mask-invert-toggle">
                                <span class="label-title">Invert mask ${invertHint.buttonHtml}</span>
                                <input type="checkbox" class="scoped-checkbox mask-invert-cb" data-scope="${maskScope}" data-param="invertMask"${isInverted ? " checked" : ""}>
                            </label>
                            ${invertHint.popoverHtml}
                        </div>
                    </div>
                    <details class="ui-subdrawer mask-range-subdrawer">
                        <summary class="ui-subsummary">
                            <span>Altitude, Slope, Curvature &amp; Warp Filters</span>
                            <span class="summary-badge">${rangeDefs.length}</span>
                        </summary>
                        <div class="ui-subdrawer-body">
                            ${rangeDefs.map((p) => renderScopedParamControl(maskScope, p, maskParams?.[p.key])).join("")}
                        </div>
                    </details>
                    ${extraBodyHtml}
                </div>
            </details>`;
    }

    function renderGeneratorExtraParams(scope, genId, paramsMap, excludeBaseHeight = false) {
        const op = registry.get(genId);
        if (!op) return "";
        const primary = op.paramSchema.filter(
            (p) =>
                p.tier === "primary" &&
                !(excludeBaseHeight && (p.key === "baseHeight" || p.key === "duneHeight")),
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

    function renderMacroShapersList(layerKey, shapersState) {
        return MACRO_SHAPER_IDS.map((shaperId) => {
            const op = registry.get(shaperId);
            if (!op) return "";
            const stateObj = shapersState?.[shaperId] || { enabled: false, ...op.defaultParams };
            const scope = `${layerKey}.shaper:${shaperId}`;
            const visibleParams = op.paramSchema.filter((p) => p.tier === "primary" || p.tier === "advanced");
            return `
                <details class="ui-subdrawer shaper-item" data-shaper="${shaperId}">
                    <summary class="ui-subsummary">
                        <span>${op.label}</span>
                        <label class="summary-toggle" title="Toggle ${op.label}">
                            <input type="checkbox" class="scoped-checkbox" data-scope="${scope}" data-param="enabled"${stateObj.enabled ? " checked" : ""}>
                            <span class="summary-badge" data-shaper-badge="${layerKey}:${shaperId}">${stateObj.enabled ? "On" : "Off"}</span>
                        </label>
                    </summary>
                    <div class="ui-subdrawer-body">
                        ${visibleParams.map((p) => renderScopedParamControl(scope, p, stateObj[p.key])).join("")}
                    </div>
                </details>`;
        }).join("");
    }

    function renderDetailTerrainStep(layerKey, layerLabel, layerObj) {
        const detailState = layerObj.shapers?.["shape.surfaceDetail"] || {
            enabled: true,
            ...(detailOp ? detailOp.defaultParams : {}),
        };
        const detailScope = `${layerKey}.shaper:shape.surfaceDetail`;
        const detailGenId = layerObj.detailGeneratorId || "shape.surfaceDetail";
        const visibleParams = detailOp
            ? detailOp.paramSchema.filter((p) => p.tier === "primary" || p.tier === "advanced")
            : [];

        return `
            ${renderMaskInspectorCard(
                `${layerKey}.detailMask`,
                `Mask for ${layerLabel} Detail`,
                layerObj.detailMaskParams,
                false,
            )}
            <details class="ui-subdrawer detail-terrain-drawer" id="${layerKey}DetailDrawer">
                <summary class="ui-subsummary">
                    <span>${layerLabel} Detail Terrain</span>
                    <label class="summary-toggle" title="Toggle ${layerLabel} Detail">
                        <input type="checkbox" class="scoped-checkbox" data-scope="${detailScope}" data-param="enabled"${detailState.enabled ? " checked" : ""}>
                        <span class="summary-badge" data-shaper-badge="${layerKey}:shape.surfaceDetail">${detailState.enabled ? "On" : "Off"}</span>
                    </label>
                </summary>
                <div class="ui-subdrawer-body" id="${layerKey}DetailBody">
                    <div class="control-row">
                        <label>
                            <span class="label-title">Detail operator</span>
                            <select class="scoped-select" data-scope="${layerKey}.detail" data-param="generatorId">
                                ${LAYER_OPERATOR_IDS.map((gid) => {
                                    const op = registry.get(gid);
                                    return `<option value="${gid}"${detailGenId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                                }).join("")}
                            </select>
                        </label>
                    </div>
                    ${visibleParams.map((p) => renderScopedParamControl(detailScope, p, detailState[p.key])).join("")}
                </div>
            </details>`;
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
                        <label class="summary-toggle" title="Toggle ${op.label}">
                            <input type="checkbox" class="scoped-checkbox" data-scope="${scope}" data-param="enabled"${stateObj.enabled ? " checked" : ""}>
                            <span class="summary-badge" data-sim-badge="${simId}">${stateObj.enabled ? "On" : "Off"}</span>
                        </label>
                    </summary>
                    <div class="ui-subdrawer-body">
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

            const blendSubdrawerHtml = `
                <details class="ui-subdrawer" id="${layerKey}BlendDrawer">
                    <summary class="ui-subsummary">
                        <span>Seam-Free Layer Blending</span>
                        <span class="summary-badge">Height-Fill</span>
                    </summary>
                    <div class="ui-subdrawer-body">
                        ${blendOp ? blendOp.paramSchema.filter((p) => p.tier !== "hidden").map((p) => renderScopedParamControl(`${layerKey}.blend`, p, layer.blendParams?.[p.key])).join("") : ""}
                    </div>
                </details>`;

            html += `
            <details class="ui-section ui-accordion overlay-layer-section" id="${sectionId}" data-layer-index="${i}">
                <summary class="ui-summary">
                    <span class="summary-title">${layer.name || `Layer ${layerNum}: Secondary Terrain`}</span>
                    <label class="summary-toggle" title="Toggle Layer ${layerNum}">
                        <input type="checkbox" id="${enabledId}" class="overlay-enable-cb" data-layer-index="${i}" data-scope="${layerKey}" data-param="enabled"${layer.enabled ? " checked" : ""}>
                        <span class="summary-badge" id="${badgeId}">${layer.enabled ? "On" : "Off"}</span>
                    </label>
                </summary>
                <div class="ui-section-body">
                    <div class="step-label">1. Mask for Layer ${layerNum}</div>
                    ${renderMaskInspectorCard(
                        `${layerKey}.mask`,
                        `Mask for Layer ${layerNum} Placement`,
                        layer.maskParams,
                        true,
                        blendSubdrawerHtml,
                    )}

                    <div class="step-label">2. Layer ${layerNum} Terrain</div>
                    <div class="control-row">
                        <label>
                            <span class="label-title">Layer ${layerNum} operator</span>
                            <select id="${genSelectId}" class="overlay-gen-select" data-layer-index="${i}" data-scope="${layerKey}.gen" data-param="generatorId">
                                ${LAYER_OPERATOR_IDS.map((gid) => {
                                    const op = registry.get(gid);
                                    return `<option value="${gid}"${layer.generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                                }).join("")}
                            </select>
                        </label>
                    </div>
                    <div id="${genControlsId}">
                        ${renderGeneratorExtraParams(`${layerKey}.gen`, layer.generatorId, layer.generatorParams, false)}
                    </div>

                    <div class="step-label">3. Layer ${layerNum} Detail Mask &amp; Detail Terrain</div>
                    ${renderDetailTerrainStep(layerKey, `Layer ${layerNum}`, layer)}

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

    function renderMaterialSlotMarkup(slotNum) {
        const slotKey = `material${slotNum}`;
        const matObj = activeStack.materials?.[slotKey] || {};
        const selectId = slotNum === 1 ? "materialPaletteSelect" : "material2PaletteSelect";
        const isCustom = Number(matObj.paletteId) >= 100;
        const colors = Array.isArray(matObj.colors) && matObj.colors.length >= 5
            ? matObj.colors
            : DEFAULT_PALETTE_SWATCHES[PALETTE_NEUTRAL_CLAY].colors;

        return `
            <details class="ui-subdrawer material-slot-drawer" id="${slotKey}Drawer"${slotNum === 1 ? " open" : ""}>
                <summary class="ui-subsummary">
                    <span>Material ${slotNum}: ${slotNum === 1 ? "Primary Surface" : "Secondary Overlay"}</span>
                    <label class="summary-toggle" title="Toggle Material ${slotNum}">
                        <input type="checkbox" class="scoped-checkbox" id="${slotKey}Enabled" data-scope="${slotKey}" data-param="enabled"${matObj.enabled !== false ? " checked" : ""}>
                        <span class="summary-badge" id="${slotKey}Badge">${matObj.enabled !== false ? "On" : "Off"}</span>
                    </label>
                </summary>
                <div class="ui-subdrawer-body">
                    <div class="step-label">Material ${slotNum} Mask</div>
                    ${renderMaskInspectorCard(
                        `${slotKey}.mask`,
                        `Material ${slotNum} Mask`,
                        matObj.maskParams,
                        false,
                    )}

                    <div class="step-label">Material ${slotNum} Colour Palette</div>
                    <div class="palette-card" data-mat-slot="${slotKey}">
                        <div class="control-row">
                            <label for="${selectId}">
                                <span class="label-title">Colour palette</span>
                                <select id="${selectId}" class="material-palette-select" data-mat-slot="${slotKey}">
                                    ${renderMaterialPaletteOptGroups(matObj.paletteId ?? PALETTE_NEUTRAL_CLAY, customPalettes)}
                                </select>
                            </label>
                        </div>
                        <div class="swatch-strip" data-swatch-strip="${slotKey}">
                            ${SWATCH_LABELS.map(
                                (lbl, idx) => `
                                <label class="swatch-item" title="${lbl} colour">
                                    <input type="color" class="material-color-input" data-mat-slot="${slotKey}" data-color-index="${idx}" value="${colors[idx] || "#888888"}">
                                    <span>${lbl}</span>
                                </label>`,
                            ).join("")}
                        </div>
                        <div class="palette-actions btn-group">
                            <label class="btn-like import-palette-label" title="Import colours.html JSON export">
                                Import JSON
                                <input type="file" class="import-palette-input" data-mat-slot="${slotKey}" accept=".json,application/json" hidden>
                            </label>
                            <button type="button" class="delete-palette-btn" data-mat-slot="${slotKey}"${isCustom ? "" : " disabled"}>Delete Palette</button>
                        </div>
                    </div>

                    <div class="step-label">Material ${slotNum} Shader</div>
                    <details class="ui-subdrawer" id="${slotKey}ShaderDrawer">
                        <summary class="ui-subsummary">
                            <span>Material ${slotNum} Rock &amp; Biome Shader</span>
                            <span class="summary-badge">Shader</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="${slotKey}ShaderBody">
                            ${MATERIAL_SHADER_SCHEMA.map((p) => renderScopedParamControl(`${slotKey}.shader`, p, matObj.shader?.[p.key])).join("")}
                        </div>
                    </details>
                </div>
            </details>`;
    }

    function countActiveShapers() {
        let count = 0;
        for (const id of MACRO_SHAPER_IDS) {
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

    const baseHeightHint = renderShaderHintPopover({
        key: "baseHeight",
        label: "Relief height (m)",
        shaderInfo: {
            uniform: "params.baseHeight / params.duneHeight",
            shaderTerm: "amplitude / displacementScale",
            hint: "Primary vertical scale in meters mapping normalized [0..1] generator output into terrain elevation.",
        },
    });

    const seedHint = renderShaderHintPopover({
        key: "seed",
        label: "Seed value",
        shaderInfo: {
            uniform: "params.seed",
            shaderTerm: "hashSeed / randomOffset",
            hint: "Deterministic integer offset fed into spatial hash functions to generate a unique landscape layout immediately.",
        },
    });

    const erosionRateHint = renderShaderHintPopover({
        key: "erosionRate",
        label: "Erosion strength",
        shaderInfo: {
            uniform: "params.erosionRate",
            shaderTerm: "scourRate / dissolveFactor",
            hint: "Fraction of spare sediment capacity scoured from the heightfield per droplet step.",
        },
    });

    const stepCountHint = renderShaderHintPopover({
        key: "stepCount",
        label: "Droplet batches per run",
        shaderInfo: {
            uniform: "params.stepCount",
            shaderTerm: "dispatchBatchCount",
            hint: "Number of 10,000-particle hydraulic compute dispatches executed when Erode is clicked.",
        },
    });

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
                <div class="preset-file-actions btn-group">
                    <button type="button" id="saveTerrainJsonBtn" title="Save all terrain &amp; material settings to a JSON file">Save JSON</button>
                    <label class="btn-like import-palette-label" id="openTerrainJsonBtn" title="Open terrain settings from a JSON file">
                        Open JSON
                        <input type="file" id="openTerrainJsonInput" accept=".json,application/json" hidden>
                    </label>
                </div>
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
                    <span class="summary-title">Layer 1: Broad &amp; Detail Terrain</span>
                    <span class="summary-badge" id="terrainBadge">${DEFAULT_PARAMS.baseHeight}m · #${DEFAULT_PARAMS.seed}</span>
                </summary>
                <div class="ui-section-body">
                    <div class="step-label">1. Broad Terrain Layer</div>
                    <div class="control-row">
                        <label>
                            <span class="label-title">Seed value ${seedHint.buttonHtml}</span>
                            <input type="number" id="seed" min="0" max="999999" value="${DEFAULT_PARAMS.seed}">
                        </label>
                        ${seedHint.popoverHtml}
                    </div>
                    <div class="control-row">
                        <label>
                            <span class="label-title">Layer 1 operator</span>
                            <select id="layer1GeneratorSelect" data-scope="layer1.gen" data-param="generatorId">
                                ${LAYER_OPERATOR_IDS.map((gid) => {
                                    const op = registry.get(gid);
                                    return `<option value="${gid}"${activeStack.layers[0].generatorId === gid ? " selected" : ""}>${op ? op.label : gid}</option>`;
                                }).join("")}
                            </select>
                        </label>
                    </div>
                    <div class="control-row">
                        <label>
                            <span class="label-title">Relief height (m) ${baseHeightHint.buttonHtml}</span>
                            <input type="range" id="baseHeight" min="25" max="${MAX_HEIGHT_M}" step="5" value="${DEFAULT_PARAMS.baseHeight}">
                            <span class="value" id="baseHeightVal">${DEFAULT_PARAMS.baseHeight}</span>
                        </label>
                        ${baseHeightHint.popoverHtml}
                    </div>
                    <div id="layer1GenControls">
                        ${renderGeneratorExtraParams("layer1.gen", activeStack.layers[0].generatorId, activeStack.layers[0].generatorParams, true)}
                    </div>

                    <details class="ui-subdrawer" id="layer1ShapersDrawer">
                        <summary class="ui-subsummary">
                            <span>Macro Shapers (Strata, Fold, Glacial)</span>
                            <span class="summary-badge" id="shapersCountBadge">${countActiveShapers()} on</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="layer1ShapersBody">
                            ${renderMacroShapersList("layer1", activeStack.layers[0].shapers)}
                        </div>
                    </details>

                    <div class="step-label">2. Layer 1 Detail Mask &amp; Detail Terrain</div>
                    <div id="layer1DetailContainer">
                        ${renderDetailTerrainStep("layer1", "Layer 1", activeStack.layers[0])}
                    </div>
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
                    <span class="summary-title">Erosion &amp; Weathering</span>
                    <span class="summary-badge" id="erosionBadge">${DEFAULT_PARAMS.stepCount} batches</span>
                </summary>
                <div class="ui-section-body">
                    <div class="step-label">1. Mask for Erosion Influence</div>
                    <div id="erosionMaskContainer">
                        ${renderMaskInspectorCard("erosion.mask", "Mask for Erosion Influence", activeStack.erosionMask, false)}
                    </div>

                    <div class="step-label">2. Erosion Layer</div>
                    <details class="ui-subdrawer" id="simPassesDrawer">
                        <summary class="ui-subsummary">
                            <span>Talus, Gullies, Wind &amp; Water Sims</span>
                            <span class="summary-badge" id="extraSimsBadge">${countActiveExtraSims()} on</span>
                        </summary>
                        <div class="ui-subdrawer-body" id="extraSimsBody">
                            ${renderExtraSimulationsList(activeStack.simulations)}
                        </div>
                    </details>

                    <div class="control-row">
                        <label>
                            <span class="label-title">Erosion strength ${erosionRateHint.buttonHtml}</span>
                            <input type="range" id="erosionRate" min="0.1" max="5" step="0.1" value="${DEFAULT_PARAMS.erosionRate}">
                            <span class="value" id="erosionRateVal">${DEFAULT_PARAMS.erosionRate}</span>
                        </label>
                        ${erosionRateHint.popoverHtml}
                    </div>
                    <div class="control-row">
                        <label>
                            <span class="label-title">Droplet batches per run ${stepCountHint.buttonHtml}</span>
                            <input type="number" id="stepCount" min="1" max="10000" value="${DEFAULT_PARAMS.stepCount}">
                        </label>
                        ${stepCountHint.popoverHtml}
                    </div>

                    <details class="ui-subdrawer" id="fineTuneDrawer">
                        <summary class="ui-subsummary">
                            <span>Fine-tune droplet parameters</span>
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

            <details class="ui-section ui-accordion" id="sectionMaterials" open>
                <summary class="ui-summary">
                    <span class="summary-title">Apply Materials (Material 1 &amp; 2)</span>
                    <span class="summary-badge" id="materialsBadge">Neutral Clay</span>
                </summary>
                <div class="ui-section-body" id="materialsBody">
                    ${renderMaterialSlotMarkup(1)}
                    ${renderMaterialSlotMarkup(2)}
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
    const materialsBadge = panel.querySelector("#materialsBadge");
    const stepCountInput = panel.querySelector("#stepCount");
    const baseHeightInput = panel.querySelector("#baseHeight");
    const baseHeightVal = panel.querySelector("#baseHeightVal");
    const seedInput = panel.querySelector("#seed");
    const presetSelect = panel.querySelector("#presetSelect");
    const presetDesc = panel.querySelector("#presetDesc");
    const shapersCountBadge = panel.querySelector("#shapersCountBadge");
    const extraSimsBadge = panel.querySelector("#extraSimsBadge");
    const overlayLayersContainer = panel.querySelector("#overlayLayersContainer");
    const addLayerBtn = panel.querySelector("#addLayerBtn");

    let erosionPending = false;

    function resolveMaskParamsByScope(maskScope) {
        if (maskScope === "erosion.mask") return activeStack.erosionMask || {};
        if (maskScope === "material1.mask") return activeStack.materials?.material1?.maskParams || {};
        if (maskScope === "material2.mask") return activeStack.materials?.material2?.maskParams || {};
        const m = /^layer(\d+)\.(mask|detailMask)$/.exec(maskScope);
        if (m) {
            const idx = Number.parseInt(m[1], 10) - 1;
            const layer = activeStack.layers?.[idx];
            if (!layer) return {};
            return m[2] === "detailMask" ? layer.detailMaskParams || {} : layer.maskParams || {};
        }
        return {};
    }

    function updateAllMaskPreviews() {
        panel.querySelectorAll("canvas.mask-preview-canvas").forEach((canvas) => {
            const scope = canvas.dataset.maskPreview;
            renderMaskPreviewToCanvas(canvas, resolveMaskParamsByScope(scope), activeStack);
        });
    }

    function updateMaterialsSummaryBadge() {
        if (!materialsBadge) return;
        const m1 = activeStack.materials?.material1;
        const m2 = activeStack.materials?.material2;
        const allPals = [...MATERIAL_PALETTES, ...customPalettes];
        const p1 = allPals.find((p) => Number(p.value) === Number(m1?.paletteId));
        const p1Short =
            Number(m1?.paletteId) === PALETTE_NEUTRAL_CLAY
                ? "Neutral Clay"
                : (p1?.label || "Custom").split("(")[0].trim();
        materialsBadge.textContent = m2?.enabled ? `${p1Short} + M2` : p1Short;
    }

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
        const maskVal = param === "invertMask" ? (val ? 1 : 0) : val;
        if (scope === "erosion.mask") {
            if (!activeStack.erosionMask) activeStack.erosionMask = {};
            activeStack.erosionMask[param] = maskVal;
            return;
        }
        const matMatch = /^(material[12])(?:\.(.+))?$/.exec(scope);
        if (matMatch) {
            const matKey = matMatch[1];
            const sub = matMatch[2] || "";
            const slotObj = activeStack.materials?.[matKey];
            if (!slotObj) return;
            if (sub === "") {
                slotObj[param] = val;
            } else if (sub === "mask") {
                slotObj.maskParams[param] = maskVal;
            } else if (sub === "shader") {
                slotObj.shader[param] = val;
            } else if (sub === "palette") {
                slotObj[param] = val;
            }
            return;
        }
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
                if (param === "baseHeight") layer.generatorParams.duneHeight = Number(val);
                if (param === "duneHeight") layer.generatorParams.baseHeight = Number(val);
            } else if (sub === "detailMask") {
                if (!layer.detailMaskParams) layer.detailMaskParams = {};
                layer.detailMaskParams[param] = maskVal;
            } else if (sub === "detail") {
                if (param === "generatorId") {
                    layer.detailGeneratorId = String(val);
                } else if (layer.shapers?.["shape.surfaceDetail"]) {
                    layer.shapers["shape.surfaceDetail"][param] = val;
                }
            } else if (sub.startsWith("shaper:")) {
                const sid = sub.slice("shaper:".length);
                if (layer.shapers?.[sid]) layer.shapers[sid][param] = val;
            } else if (sub === "mask" && layer.maskParams) {
                layer.maskParams[param] = maskVal;
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

    function bindSummaryTogglesAndHints(rootEl) {
        // Prevent summary toggle checkboxes from expanding/collapsing <details>
        rootEl.querySelectorAll(".summary-toggle").forEach((lbl) => {
            if (lbl.dataset.boundToggleStop) return;
            lbl.dataset.boundToggleStop = "true";
            lbl.addEventListener("click", (e) => {
                e.stopPropagation();
            });
        });

        // Floating (i) shader info popovers
        rootEl.querySelectorAll(".info-btn").forEach((btn) => {
            if (btn.dataset.boundHint) return;
            btn.dataset.boundHint = "true";
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetId = btn.dataset.hintTarget;
                const popover = targetId ? panel.querySelector(`#${targetId}`) : null;
                if (!popover) return;
                const willOpen = popover.hidden;
                panel.querySelectorAll(".shader-hint-popover").forEach((p) => {
                    p.hidden = true;
                });
                panel.querySelectorAll(".info-btn").forEach((b) => {
                    b.setAttribute("aria-expanded", "false");
                });
                popover.hidden = !willOpen;
                btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
            });
        });
    }

    // Close open shader info popovers when clicking outside
    document.addEventListener("click", (e) => {
        if (!e.target.closest?.(".shader-hint-popover, .info-btn")) {
            panel.querySelectorAll(".shader-hint-popover").forEach((p) => {
                p.hidden = true;
            });
            panel.querySelectorAll(".info-btn").forEach((b) => {
                b.setAttribute("aria-expanded", "false");
            });
        }
    });

    function bindScopedControls(rootEl) {
        bindSummaryTogglesAndHints(rootEl);

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
                updateAllMaskPreviews();
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
                updateAllMaskPreviews();
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
                } else if (scope === "material1" || scope === "material2") {
                    const badge = panel.querySelector(`#${scope}Badge`);
                    if (badge) badge.textContent = checked ? "On" : "Off";
                    updateMaterialsSummaryBadge();
                }

                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(scope, param, checked);
                }
                updateAllMaskPreviews();
                onRegenerate();
            });
        });
    }

    function bindMaterialControls(rootEl) {
        rootEl.querySelectorAll(".material-palette-select").forEach((sel) => {
            sel.addEventListener("change", () => {
                const slotKey = sel.dataset.matSlot;
                const paletteId = Number.parseInt(sel.value, 10);
                const slotObj = activeStack.materials?.[slotKey];
                if (!slotObj) return;

                slotObj.paletteId = paletteId;
                const swatchPreset =
                    DEFAULT_PALETTE_SWATCHES[paletteId] || DEFAULT_PALETTE_SWATCHES[PALETTE_NEUTRAL_CLAY];
                slotObj.colors = [...swatchPreset.colors];
                slotObj.shader = {
                    ...slotObj.shader,
                    rockType: swatchPreset.rockType,
                    cliffScale: swatchPreset.cliffScale,
                    foldStrength: swatchPreset.foldStrength,
                    outcropExposure: swatchPreset.outcropExposure,
                    snowLineM: swatchPreset.snowLineM,
                };

                // Sync UI swatches, shader controls, and Delete button state
                const strip = panel.querySelector(`[data-swatch-strip="${slotKey}"]`);
                if (strip) {
                    strip.querySelectorAll(".material-color-input").forEach((inp, idx) => {
                        inp.value = slotObj.colors[idx] || "#888888";
                    });
                }
                const shaderBody = panel.querySelector(`#${slotKey}ShaderBody`);
                if (shaderBody) {
                    shaderBody.innerHTML = MATERIAL_SHADER_SCHEMA.map((p) =>
                        renderScopedParamControl(`${slotKey}.shader`, p, slotObj.shader[p.key]),
                    ).join("");
                    bindScopedControls(shaderBody);
                }
                const delBtn = panel.querySelector(`.delete-palette-btn[data-mat-slot="${slotKey}"]`);
                if (delBtn) delBtn.disabled = paletteId < 100;

                if (slotKey === "material1") {
                    activeStack.materialPalette = paletteId;
                    onMaterialPaletteChange(paletteId);
                }
                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(`${slotKey}.palette`, "paletteId", paletteId);
                }
                updateMaterialsSummaryBadge();
            });
        });

        rootEl.querySelectorAll(".material-color-input").forEach((inp) => {
            inp.addEventListener("input", () => {
                const slotKey = inp.dataset.matSlot;
                const cIdx = Number.parseInt(inp.dataset.colorIndex, 10);
                const hex = inp.value;
                const slotObj = activeStack.materials?.[slotKey];
                if (!slotObj) return;
                slotObj.colors[cIdx] = hex;
                if (typeof onScopedParamChange === "function") {
                    onScopedParamChange(`${slotKey}.palette`, `color${cIdx}`, hex);
                }
            });
        });

        rootEl.querySelectorAll(".import-palette-input").forEach((fileInp) => {
            fileInp.addEventListener("change", () => {
                const file = fileInp.files?.[0];
                if (!file) return;
                const slotKey = fileInp.dataset.matSlot;
                const reader = new FileReader();
                reader.onload = () => {
                    importPalettesFromJsonString(String(reader.result || ""), slotKey);
                    fileInp.value = "";
                };
                reader.readAsText(file);
            });
        });

        rootEl.querySelectorAll(".delete-palette-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const slotKey = btn.dataset.matSlot;
                const slotObj = activeStack.materials?.[slotKey];
                if (!slotObj || Number(slotObj.paletteId) < 100) return;
                deleteCustomPalette(Number(slotObj.paletteId));
            });
        });
    }

    function refreshPaletteSelectOptions() {
        for (const slotKey of ["material1", "material2"]) {
            const selId = slotKey === "material1" ? "#materialPaletteSelect" : "#material2PaletteSelect";
            const sel = panel.querySelector(selId);
            const slotObj = activeStack.materials?.[slotKey];
            if (sel && slotObj) {
                sel.innerHTML = renderMaterialPaletteOptGroups(slotObj.paletteId, customPalettes);
                const delBtn = panel.querySelector(`.delete-palette-btn[data-mat-slot="${slotKey}"]`);
                if (delBtn) delBtn.disabled = Number(slotObj.paletteId) < 100;
            }
        }
        updateMaterialsSummaryBadge();
    }

    function importPalettesFromJsonString(jsonStr, targetSlotKey = "material1") {
        try {
            const maxExisting = customPalettes.reduce((m, p) => Math.max(m, Number(p.value) || 99), 99);
            const imported = parseColoursHtmlJson(jsonStr, maxExisting + 1);
            if (!imported.length) return [];
            for (const p of imported) {
                DEFAULT_PALETTE_SWATCHES[p.value] = {
                    colors: [...p.colors],
                    rockType: p.rockType,
                    cliffScale: p.cliffScale,
                    foldStrength: p.foldStrength,
                    outcropExposure: p.outcropExposure,
                    snowLineM: p.snowLineM,
                };
                customPalettes.push(p);
            }
            saveCustomPalettes(customPalettes);

            const firstNew = imported[0];
            const slotObj = activeStack.materials?.[targetSlotKey];
            if (slotObj) {
                slotObj.paletteId = firstNew.value;
                slotObj.colors = [...firstNew.colors];
                refreshPaletteSelectOptions();
                const selId = targetSlotKey === "material1" ? "#materialPaletteSelect" : "#material2PaletteSelect";
                const sel = panel.querySelector(selId);
                if (sel) {
                    sel.value = String(firstNew.value);
                    sel.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            return imported;
        } catch {
            return [];
        }
    }

    function deleteCustomPalette(paletteId) {
        const idx = customPalettes.findIndex((p) => Number(p.value) === Number(paletteId));
        if (idx === -1) return false;
        customPalettes.splice(idx, 1);
        delete DEFAULT_PALETTE_SWATCHES[paletteId];
        saveCustomPalettes(customPalettes);

        for (const slotKey of ["material1", "material2"]) {
            const slotObj = activeStack.materials?.[slotKey];
            if (slotObj && Number(slotObj.paletteId) === Number(paletteId)) {
                slotObj.paletteId = PALETTE_NEUTRAL_CLAY;
                slotObj.colors = [...DEFAULT_PALETTE_SWATCHES[PALETTE_NEUTRAL_CLAY].colors];
                refreshPaletteSelectOptions();
                const selId = slotKey === "material1" ? "#materialPaletteSelect" : "#material2PaletteSelect";
                const sel = panel.querySelector(selId);
                if (sel) {
                    sel.value = String(PALETTE_NEUTRAL_CLAY);
                    sel.dispatchEvent(new Event("change", { bubbles: true }));
                }
            } else {
                refreshPaletteSelectOptions();
            }
        }
        return true;
    }

    function bindOverlayLayerEvents(containerEl) {
        bindSummaryTogglesAndHints(containerEl);

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
                updateAllMaskPreviews();
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
                updateAllMaskPreviews();
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
        updateAllMaskPreviews();
    }

    bindScopedControls(panel);
    bindOverlayLayerEvents(overlayLayersContainer);
    bindMaterialControls(panel.querySelector("#sectionMaterials"));
    updateAddLayerButtonState();
    updateMaterialsSummaryBadge();
    updateAllMaskPreviews();

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

    function refreshAllUIFromActiveStack() {
        if (activeStack.id && presetSelect.querySelector(`option[value="${activeStack.id}"]`)) {
            presetSelect.value = activeStack.id;
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
        panel.querySelector("#layer1ShapersBody").innerHTML = renderMacroShapersList("layer1", activeStack.layers[0].shapers);
        shapersCountBadge.textContent = `${countActiveShapers()} on`;

        panel.querySelector("#layer1DetailContainer").innerHTML = renderDetailTerrainStep(
            "layer1",
            "Layer 1",
            activeStack.layers[0],
        );

        panel.querySelector("#erosionMaskContainer").innerHTML = renderMaskInspectorCard(
            "erosion.mask",
            "Mask for Erosion Influence",
            activeStack.erosionMask,
            false,
        );
        panel.querySelector("#extraSimsBody").innerHTML = renderExtraSimulationsList(activeStack.simulations);
        extraSimsBadge.textContent = `${countActiveExtraSims()} on`;

        const dropSim = activeStack.simulations?.["sim.dropletErosion"];
        if (dropSim) {
            for (const k of ["rainRate", "erosionRate", "depositionRate", "evaporation", "sedimentCapacity"]) {
                if (dropSim[k] !== undefined) {
                    const inp = panel.querySelector(`#${k}`);
                    const sp = panel.querySelector(`#${k}Val`);
                    if (inp) inp.value = String(dropSim[k]);
                    if (sp) sp.textContent = String(dropSim[k]);
                }
            }
            if (dropSim.stepCount !== undefined) {
                stepCountInput.value = String(dropSim.stepCount);
            }
        }

        for (const slotKey of ["material1", "material2"]) {
            const slotObj = activeStack.materials?.[slotKey];
            if (!slotObj) continue;
            const enabledCb = panel.querySelector(`#${slotKey}Enabled`);
            const badgeEl = panel.querySelector(`#${slotKey}Badge`);
            if (enabledCb) enabledCb.checked = slotObj.enabled !== false;
            if (badgeEl) badgeEl.textContent = slotObj.enabled !== false ? "On" : "Off";

            const selId = slotKey === "material1" ? "#materialPaletteSelect" : "#material2PaletteSelect";
            const sel = panel.querySelector(selId);
            if (sel) {
                sel.innerHTML = renderMaterialPaletteOptGroups(slotObj.paletteId, customPalettes);
                sel.value = String(slotObj.paletteId ?? PALETTE_NEUTRAL_CLAY);
            }
            const strip = panel.querySelector(`[data-swatch-strip="${slotKey}"]`);
            if (strip && Array.isArray(slotObj.colors)) {
                strip.querySelectorAll(".material-color-input").forEach((inp, idx) => {
                    if (slotObj.colors[idx]) inp.value = slotObj.colors[idx];
                });
            }
            const shaderBody = panel.querySelector(`#${slotKey}ShaderBody`);
            if (shaderBody && slotObj.shader) {
                shaderBody.innerHTML = MATERIAL_SHADER_SCHEMA.map((p) =>
                    renderScopedParamControl(`${slotKey}.shader`, p, slotObj.shader[p.key]),
                ).join("");
                bindScopedControls(shaderBody);
            }
            const delBtn = panel.querySelector(`.delete-palette-btn[data-mat-slot="${slotKey}"]`);
            if (delBtn) delBtn.disabled = Number(slotObj.paletteId) < 100;
        }
        updateMaterialsSummaryBadge();

        bindScopedControls(panel.querySelector("#sectionTerrain"));
        bindScopedControls(panel.querySelector("#sectionErosion"));
        rebuildOverlayLayersUI();

        setErosionPending(false);
        updateAllMaskPreviews();
    }

    function exportTerrainSettingsToJsonString() {
        return serializeStack(activeStack);
    }

    function loadTerrainSettingsFromJsonString(jsonStr) {
        const restored = deserializeStack(jsonStr);
        activeStack = restored;
        if (typeof onLoadStack === "function") {
            const pipeStack = onLoadStack(restored);
            if (pipeStack) activeStack = normalizeStack(pipeStack);
        }
        onParamChange({
            seed: activeStack.seed ?? 42,
            baseHeight: activeStack.layers[0]?.generatorParams?.baseHeight ?? 1200,
            ...(activeStack.simulations?.["sim.dropletErosion"] || {}),
        });
        if (activeStack.materialPalette !== undefined) {
            onMaterialPaletteChange(activeStack.materialPalette);
        }
        refreshAllUIFromActiveStack();
        onRegenerate();
        return activeStack;
    }

    const saveTerrainJsonBtn = panel.querySelector("#saveTerrainJsonBtn");
    const openTerrainJsonInput = panel.querySelector("#openTerrainJsonInput");

    if (saveTerrainJsonBtn) {
        saveTerrainJsonBtn.addEventListener("click", () => {
            const jsonStr = exportTerrainSettingsToJsonString();
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${activeStack.id || "terrain"}-settings.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }

    if (openTerrainJsonInput) {
        openTerrainJsonInput.addEventListener("change", () => {
            const file = openTerrainJsonInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    loadTerrainSettingsFromJsonString(String(reader.result || ""));
                } catch {
                    // Ignore malformed file
                }
                openTerrainJsonInput.value = "";
            };
            reader.readAsText(file);
        });
    }

    // Preset selector (preserves current Material 1 & Material 2 selection so Neutral Clay stays active until user chooses a material)
    presetSelect.addEventListener("change", () => {
        const presetId = presetSelect.value;
        const prevMaterials = activeStack.materials ? JSON.parse(JSON.stringify(activeStack.materials)) : null;
        const prevPalette = activeStack.materialPalette;

        activeStack = getPresetById(presetId);
        if (typeof onPresetChange === "function") {
            const returned = onPresetChange(presetId);
            if (returned) activeStack = normalizeStack(returned);
        }
        if (prevMaterials) {
            activeStack.materials = prevMaterials;
        }
        if (prevPalette !== undefined) {
            activeStack.materialPalette = prevPalette;
        }
        refreshAllUIFromActiveStack();
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
        updateAllMaskPreviews();
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

    // Relief height (works across Mountains, Canyons, Dunes & Caldera)
    baseHeightInput.addEventListener("input", () => {
        const val = Number.parseFloat(baseHeightInput.value);
        baseHeightVal.textContent = val;
        activeStack.layers[0].generatorParams.baseHeight = val;
        activeStack.layers[0].generatorParams.duneHeight = val;
        updateTerrainBadge();
        onParamChange({ baseHeight: val });
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("layer1.gen", "baseHeight", val);
            onScopedParamChange("layer1.gen", "duneHeight", val);
        }
        updateAllMaskPreviews();
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

    // Seed (at top of Layer 1 — applies immediately on input/change)
    function applySeedImmediate() {
        const seedVal = Number.parseFloat(seedInput.value);
        if (Number.isNaN(seedVal)) return;
        activeStack.seed = seedVal;
        updateTerrainBadge();
        onParamChange({ seed: seedVal });
        if (typeof onScopedParamChange === "function") {
            onScopedParamChange("global", "seed", seedVal);
        }
        setErosionPending(false);
        updateAllMaskPreviews();
        onRegenerate();
    }

    seedInput.addEventListener("input", applySeedImmediate);
    seedInput.addEventListener("change", applySeedImmediate);

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

    return {
        updatePassToggles,
        setErosionPending,
        importPalettesFromJsonString,
        deleteCustomPalette,
        updateAllMaskPreviews,
        exportTerrainSettingsToJsonString,
        loadTerrainSettingsFromJsonString,
    };
}
