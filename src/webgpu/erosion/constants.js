// Shared constants for the WebGPU eroded mountains generator.
// All modules import from here — do not add runtime logic.

// Grid dimensions — use same resolution as existing terrain
export const N = 256;          // grid cells per side
export const GRID_CELLS = N * N;                        // 65,536

// World extent — same as existing terrain for consistency
export const AREA_M = 2560;               // 2.56 km per side
export const CELL_SPACING_M = AREA_M / N; // meters between cells
export const AREA_KM = AREA_M / 1000;

// Height range
export const MIN_HEIGHT_M = 0;
export const MAX_HEIGHT_M = 1500;          // 1500m max mountain height
export const HEIGHT_RANGE_M = MAX_HEIGHT_M - MIN_HEIGHT_M;

// Scene scale: Babylon Lite camera/projection works best with small units.
export const SCENE_SCALE = 0.01;
export const SCENE_AREA = AREA_M * SCENE_SCALE;
export const SCENE_MAX_HEIGHT = MAX_HEIGHT_M * SCENE_SCALE;

// Fixed-point encoding: float_meters * FIXED_POINT_SCALE → i32
export const FIXED_POINT_SCALE = 10000;
export const MAX_FIXED_POINT = MAX_HEIGHT_M * FIXED_POINT_SCALE;

// Buffer sizes (bytes)
export const HEIGHT_BUFFER_BYTES = GRID_CELLS * 4;      // i32 per cell
export const RIDGE_BUFFER_BYTES = GRID_CELLS * 4;       // f32 per cell

// Compute shader workgroup size
export const WORKGROUP_SIZE = 8;

// Uniform buffer: 29 scalars (27 f32 + 2 u32) = 116 bytes, padded to 128.
export const UNIFORM_BUFFER_BYTES = 128;

// Stage toggle bitmask values
export const STAGE_BASE_HEIGHT = 1;         // Stage 1: Base height + analytical gradient
export const STAGE_CELL_STRIPES = 2;        // Stage 2: Phacelle 4x4 cell blending
export const STAGE_MULTI_OCTAVE = 4;        // Stage 3: Multi-octave composite branching
export const STAGE_FADE_TARGET = 8;         // Stage 4: Altitude fade target masking
export const STAGE_ADVANCED_NOISE = 16;     // Stage 5: Normalization + assumed slope
export const STAGE_SECONDARY_FEATURES = 32; // Stage 6: Ridge/crease rounding

// Render modes
export const RENDER_HEIGHTMAP = 0;
export const RENDER_LIT = 1;
export const RENDER_NORMALS = 2;
export const RENDER_RIDGE_MAP = 3;
export const RENDER_STREAM_MAP = 4;
export const RENDER_SLOPE_HEATMAP = 5;
export const RENDER_CONTOURS = 6;

// Default erosion parameters — mirrors the reference GLSL defaults.
export const DEFAULT_PARAMS = {
    // Stage 1: base height function
    heightFrequency: 3.0,          // 0.5-8.0  inverse horizontal scale
    heightAmp: 0.125,              // 0.02-0.4 vertical scale
    heightOctaves: 3,              // 1-6
    heightLacunarity: 2.0,         // 1.5-3.0
    heightGain: 0.1,               // 0.05-0.7

    // Stage 2: Phacelle cell settings
    cellScale: 0.7,                // 0.3-1.5 cell size relative to erosion scale
    normalization: 0.5,            // 0.0-1.0 phasor normalization degree

    // Stage 3: erosion octaves
    erosionOctaves: 5,             // 1-7
    lacunarity: 2.0,               // 1.5-3.0
    gain: 0.5,                     // 0.3-0.7

    // Stage 4: strength / fade masking
    erosionStrength: 0.22,         // 0.01-0.6
    gullyWeight: 0.5,              // 0.0-1.0
    detail: 1.5,                   // 0.5-3.0

    // Stage 5: onset + assumed slope
    onsetInitial: 1.25,            // 0.2-4.0
    onsetOctave: 1.25,             // 0.2-4.0
    onsetRidgeInitial: 2.8,        // 0.2-5.0
    onsetRidgeOctave: 1.5,         // 0.2-5.0
    assumedSlope: 0.7,             // 0.1-2.0
    assumedSlopeAmount: 1.0,       // 0.0-1.0 (1.0 = fully assumed — avoids chaos)

    // Stage 6: rounding
    ridgeRounding: 0.1,            // 0.0-1.0
    creaseRounding: 0.0,           // 0.0-1.0
    roundingInputMult: 0.1,        // 0.0-1.0
    roundingOctaveMult: 2.0,       // 0.5-3.0

    // Global
    erosionScale: 0.15,            // 0.03-0.4
    heightOffset: -0.65,           // -1.0-1.0
    heightOffsetFadeAmount: 0.0,   // 0.0-1.0
    seed: 42,                      // 0-999999

    passFlags: STAGE_BASE_HEIGHT | STAGE_CELL_STRIPES | STAGE_MULTI_OCTAVE
        | STAGE_FADE_TARGET | STAGE_ADVANCED_NOISE | STAGE_SECONDARY_FEATURES,

    renderMode: RENDER_LIT,
};
