// Shared constants for the Namib star-dune prototype (dunes.html).
// All modules import from here — do not add runtime logic beyond schema helpers.

// Grid dimensions
export const N = 512;                     // grid cells per side
export const GRID_CELLS = N * N;

// World extent — large enough for several 1–2 km Namib dune networks
export const AREA_M = 8192;               // 8.192 km per side
export const CELL_SPACING_M = AREA_M / N; // 16 m between cells
export const AREA_KM = AREA_M / 1000;

// Height range — Namib star dunes reach 300+ m
export const MIN_HEIGHT_M = 0;
export const MAX_HEIGHT_M = 400;
export const HEIGHT_RANGE_M = MAX_HEIGHT_M - MIN_HEIGHT_M;

// Scene scale: Babylon Lite camera/projection works best with small units.
export const SCENE_SCALE = 0.01;
export const SCENE_AREA = AREA_M * SCENE_SCALE;
export const SCENE_MAX_HEIGHT = MAX_HEIGHT_M * SCENE_SCALE;

// Fixed-point encoding: float_meters * FIXED_POINT_SCALE → i32
export const FIXED_POINT_SCALE = 10000;
export const MAX_FIXED_POINT = MAX_HEIGHT_M * FIXED_POINT_SCALE; // 4,000,000

export const HEIGHT_BUFFER_BYTES = GRID_CELLS * 4;
export const WORKGROUP_SIZE = 8;

// Generator modes
export const MODE_VORONOI = 0;   // A: warped Voronoi crest network
export const MODE_PHACELLE = 1;  // B: Phacelle star arms on a dome field
export const MODE_HYBRID = 2;    // C: Voronoi network + Phacelle arms

export const MODE_LABELS = [
    { value: MODE_VORONOI, label: "A · Voronoi crest network" },
    { value: MODE_PHACELLE, label: "B · Phacelle star arms" },
    { value: MODE_HYBRID, label: "C · Hybrid (A + B arms)" },
];

// Render modes
export const RENDER_LIT = 0;
export const RENDER_HEIGHTMAP = 1;
export const RENDER_SLOPE = 2;
export const RENDER_DETAIL = 3;

export const RENDER_LABELS = [
    { value: RENDER_LIT, label: "Lit sand" },
    { value: RENDER_HEIGHTMAP, label: "Heightmap (grayscale)" },
    { value: RENDER_SLOPE, label: "Slope (red ≥ 30°)" },
    { value: RENDER_DETAIL, label: "Detail layer (arms / child dunes)" },
];

// Parameter schema — single source of truth for the uniform layout, the WGSL
// struct, defaults and the UI. `modes` lists the generator modes that use it.
// Every uniform is an f32 (mode/octaves are cast in WGSL) so packing is trivial.
const ALL = [MODE_VORONOI, MODE_PHACELLE, MODE_HYBRID];
const NET = [MODE_VORONOI, MODE_HYBRID];
const ARMS = [MODE_PHACELLE, MODE_HYBRID];

export const PARAM_SCHEMA = [
    // Global
    { key: "mode", group: "Generator", value: MODE_VORONOI, ui: "none", modes: ALL },
    { key: "seed", group: "Global", value: 7, ui: "none", modes: ALL },
    { key: "windDirection", group: "Global", label: "Resultant wind (°)", min: 0, max: 360, step: 1, value: 40, modes: ALL },
    { key: "duneHeight", group: "Global", label: "Main dune height (m)", min: 40, max: 360, step: 5, value: 240, modes: ALL },
    { key: "leeAngle", group: "Global", label: "Slip face angle (°)", min: 20, max: 34, step: 0.5, value: 32, modes: ALL },
    { key: "crestRounding", group: "Global", label: "Crest rounding (m)", min: 0, max: 120, step: 1, value: 40, modes: ALL },
    { key: "panLevel", group: "Global", label: "Pan level (m)", min: 0, max: 60, step: 1, value: 6, modes: ALL },

    // A: Voronoi crest network
    { key: "netSpacing", group: "Crest network", label: "Network spacing (m)", min: 500, max: 3000, step: 25, value: 1500, modes: NET },
    { key: "netWarp", group: "Crest network", label: "Crest curvature (warp)", min: 0, max: 0.8, step: 0.01, value: 0.32, modes: NET },
    { key: "netWarpFreq", group: "Crest network", label: "Curvature frequency", min: 0.3, max: 3, step: 0.05, value: 0.9, modes: NET },
    { key: "netStretch", group: "Crest network", label: "Along-wind stretch", min: 0.6, max: 3, step: 0.05, value: 1.4, modes: NET },
    { key: "junctionBoost", group: "Crest network", label: "Star peak boost", min: 0, max: 1.5, step: 0.05, value: 0.55, modes: NET },
    { key: "junctionRadius", group: "Crest network", label: "Star peak radius", min: 0.05, max: 0.6, step: 0.01, value: 0.25, modes: NET },
    { key: "saddleDepth", group: "Crest network", label: "Saddle depth", min: 0, max: 0.9, step: 0.01, value: 0.45, modes: NET },
    { key: "edgeVariation", group: "Crest network", label: "Crest height variation", min: 0, max: 1, step: 0.01, value: 0.55, modes: NET },
    { key: "stossAngle", group: "Crest network", label: "Windward angle (°)", min: 5, max: 25, step: 0.5, value: 10, modes: NET },
    { key: "crestReversal", group: "Crest network", label: "Crest reversal", min: 0, max: 1, step: 0.01, value: 0.35, modes: NET },
    { key: "netOctaves", group: "Crest network", label: "Dune generations", min: 1, max: 3, step: 1, value: 2, modes: NET },
    { key: "netLacunarity", group: "Crest network", label: "Generation spacing ratio", min: 2, max: 5, step: 0.1, value: 3.2, modes: NET },
    { key: "netGain", group: "Crest network", label: "Generation height ratio", min: 0.1, max: 0.6, step: 0.01, value: 0.3, modes: NET },
    { key: "sandFill", group: "Crest network", label: "Sand-filled cells", min: 0, max: 1, step: 0.01, value: 0.45, modes: NET },

    // B: dome field (mode B only)
    { key: "domeSpacing", group: "Sand swell", label: "Swell spacing (m)", min: 1000, max: 8000, step: 50, value: 3500, modes: [MODE_PHACELLE] },
    { key: "domeDetail", group: "Sand swell", label: "Swell detail", min: 0, max: 0.6, step: 0.01, value: 0.2, modes: [MODE_PHACELLE] },
    { key: "domeCoverage", group: "Sand swell", label: "Sand coverage", min: 0, max: 1, step: 0.01, value: 0.6, modes: [MODE_PHACELLE] },
    { key: "megaSpacing", group: "Sand swell", label: "Mega-ridge spacing (m)", min: 800, max: 5000, step: 25, value: 2200, modes: [MODE_PHACELLE] },
    { key: "megaHeight", group: "Sand swell", label: "Mega-ridge height (m)", min: 0, max: 320, step: 1, value: 140, modes: [MODE_PHACELLE] },
    { key: "megaCoverage", group: "Sand swell", label: "Mega-ridge coverage", min: 0, max: 1, step: 0.01, value: 0.7, modes: [MODE_PHACELLE] },

    // B/C: Phacelle arms (Runevision stacked faded gullies, dune profile)
    { key: "armSpacing", group: "Phacelle arms", label: "Arm spacing (m)", min: 80, max: 1500, step: 10, value: 520, modes: ARMS },
    { key: "armHeight", group: "Phacelle arms", label: "Arm height (m)", min: 0, max: 150, step: 1, value: 45, modes: ARMS },
    { key: "armCellScale", group: "Phacelle arms", label: "Cell scale", min: 0.4, max: 2, step: 0.05, value: 0.9, modes: ARMS },
    { key: "armOctaves", group: "Phacelle arms", label: "Branch octaves", min: 1, max: 5, step: 1, value: 3, modes: ARMS },
    { key: "armLacunarity", group: "Phacelle arms", label: "Branch lacunarity", min: 1.5, max: 3.5, step: 0.05, value: 2.2, modes: ARMS },
    { key: "heightVariation", group: "Phacelle arms", label: "Height variation", min: 0, max: 1, step: 0.01, value: 0.6, modes: ARMS },
    { key: "armBranching", group: "Phacelle arms", label: "Branch steering", min: 0, max: 1, step: 0.01, value: 0.3, modes: ARMS },
    { key: "armGain", group: "Phacelle arms", label: "Branch gain", min: 0.2, max: 0.8, step: 0.01, value: 0.45, modes: ARMS },
    { key: "armSharpness", group: "Phacelle arms", label: "Crest sharpness", min: 1, max: 3, step: 0.05, value: 1.9, modes: ARMS },
    { key: "armAsymmetry", group: "Phacelle arms", label: "Slip-face asymmetry", min: 0, max: 1, step: 0.01, value: 0.6, modes: ARMS },
    { key: "armNormalization", group: "Phacelle arms", label: "Normalization", min: 0, max: 1, step: 0.01, value: 0.5, modes: ARMS },
    { key: "armAssumedSlope", group: "Phacelle arms", label: "Assumed slope amount", min: 0, max: 1, step: 0.01, value: 0.7, modes: ARMS },
    { key: "armOnset", group: "Phacelle arms", label: "Slope onset", min: 1, max: 40, step: 0.5, value: 10, modes: ARMS },
    { key: "armOnsetOctave", group: "Phacelle arms", label: "Branch onset", min: 0.2, max: 4, step: 0.05, value: 2.5, modes: ARMS },
    { key: "armDetail", group: "Phacelle arms", label: "Detail", min: 0.5, max: 3, step: 0.05, value: 1.5, modes: ARMS },
    { key: "slipProtect", group: "Phacelle arms", label: "Protect slip faces", min: 0, max: 1, step: 0.01, value: 0.5, modes: ARMS },

    // All modes: fine transverse bedforms steered by the final slope field
    { key: "rippleSpacing", group: "Surface ripples", label: "Ripple spacing (m)", min: 64, max: 400, step: 4, value: 140, modes: ALL },
    { key: "rippleHeight", group: "Surface ripples", label: "Ripple height (m)", min: 0, max: 8, step: 0.1, value: 0, modes: ALL },
    { key: "rippleWind", group: "Surface ripples", label: "Ripple wind alignment", min: 0, max: 1, step: 0.01, value: 0.5, modes: ALL },
];

export const PARAM_KEYS = PARAM_SCHEMA.map((p) => p.key);

// Pad to a multiple of 4 floats (16-byte uniform alignment)
export const UNIFORM_FLOATS = Math.ceil(PARAM_KEYS.length / 4) * 4;
export const UNIFORM_BUFFER_BYTES = UNIFORM_FLOATS * 4;

// WGSL struct generated from the schema so JS packing and WGSL never drift.
export const PARAMS_STRUCT_WGSL = `struct DuneParams {
${PARAM_KEYS.map((k) => `    ${k}: f32,`).join("\n")}
${Array.from({ length: UNIFORM_FLOATS - PARAM_KEYS.length }, (_, i) => `    _pad${i}: f32,`).join("\n")}
};`;

export const DEFAULT_PARAMS = Object.fromEntries(PARAM_SCHEMA.map((p) => [p.key, p.value]));
