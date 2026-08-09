// Shared constants for the WebGPU sand dunes generator.
// All modules import from here — do not add runtime logic.

// Grid dimensions — use same resolution as existing terrain
export const N = 256;          // grid cells per side
export const GRID_CELLS = N * N;                        // 65,536

// World extent — same as existing terrain for consistency
export const AREA_M = 2560;               // 2.56 km per side
export const CELL_SPACING_M = AREA_M / N; // meters between cells
export const AREA_KM = AREA_M / 1000;

// Height range — adjusted for sand dunes (typically lower than mountains)
export const MIN_HEIGHT_M = 0;
export const MAX_HEIGHT_M = 100;         // Dunes are typically 0-100m tall
export const HEIGHT_RANGE_M = MAX_HEIGHT_M - MIN_HEIGHT_M;

// Scene scale: Babylon Lite camera/projection works best with small units.
// All render-side dimensions are scaled down by this factor (100:1).
export const SCENE_SCALE = 0.01;
export const SCENE_AREA = AREA_M * SCENE_SCALE;
export const SCENE_MAX_HEIGHT = MAX_HEIGHT_M * SCENE_SCALE;

// Depth of bedrock below y = 0 that the side walls extend to
export const BASE_DEPTH_M = 20;
export const SCENE_BASE_DEPTH = BASE_DEPTH_M * SCENE_SCALE;

// Fixed-point encoding: float_meters * FIXED_POINT_SCALE → i32
export const FIXED_POINT_SCALE = 10000;
export const MAX_FIXED_POINT = MAX_HEIGHT_M * FIXED_POINT_SCALE; // 1,000,000

// Buffer sizes (bytes)
export const HEIGHT_BUFFER_BYTES = GRID_CELLS * 4;      // i32 per cell

// Compute shader workgroup size
export const WORKGROUP_SIZE = 8;

// Uniform buffer: dunes parameters (all f32/u32, 16-byte aligned struct)
// Stage 1: windDirection, ridgeSpacing, ridgeSharpness (12 bytes)
// Stage 2: warpFrequency, warpAmplitude (8 bytes)
// Stage 3: windwardPower, leewardPower (8 bytes)
// Stage 4: angleOfRepose, talusStrength (8 bytes)
// Stage 5: rippleFrequency, rippleAmplitude, slopeMaskThreshold (12 bytes)
// Global: seed, overallScale, heightScale (12 bytes)
// Flags: passFlags, renderMode (8 bytes)
// Total: 68 bytes, rounded up to a multiple of 16
export const UNIFORM_BUFFER_BYTES = 80;

// Stage toggle bitmask values
export const STAGE_BASE_WAVEFORM = 1;      // Stage 1: Base Waveform & Orientation
export const STAGE_CREST_WARPING = 2;      // Stage 2: Sinuous Crest Warping
export const STAGE_PROFILE_MODIFIER = 4;    // Stage 3: Directional Profile Modifier
export const STAGE_ANGLE_REPOSE = 8;        // Stage 4: Angle of Repose & Talus Limiter
export const STAGE_MICRO_DETAIL = 16;      // Stage 5: Micro-Surface Detail

// Render modes
export const RENDER_HEIGHTMAP = 0;          // Grayscale heightmap
export const RENDER_LIT = 1;               // Lit terrain with sand coloring
export const RENDER_NORMALS = 2;           // Slope/normal visualization
export const RENDER_STAGE_ISOLATION = 3;   // View individual stage outputs
export const RENDER_SLOPE_HEATMAP = 4;     // Slope steepness heatmap
export const RENDER_CURVATURE = 5;         // Surface curvature
export const RENDER_WIREFRAME = 6;         // Wireframe view
export const RENDER_DEBUG_NOISE = 7;        // Individual noise layer visualization

// Default dunes parameters
export const DEFAULT_PARAMS = {
    // Stage 1: Base Waveform & Orientation
    windDirection: 45.0,          // degrees (0-360)
    ridgeSpacing: 1.0,            // 0.1-2.0
    ridgeSharpness: 1.0,          // 0.5-2.0

    // Stage 2: Sinuous Crest Warping
    warpFrequency: 1.0,           // 0.5-5.0
    warpAmplitude: 0.3,           // 0.0-1.0

    // Stage 3: Directional Profile Modifier
    windwardPower: 0.7,           // 0.5-0.9 (gentle slope)
    leewardPower: 2.5,            // 2.0-3.0 (steep slope)

    // Stage 4: Angle of Repose & Talus Limiter
    angleOfRepose: 32.0,          // degrees (30-35)
    talusStrength: 0.5,           // 0.1-1.0

    // Stage 5: Micro-Surface Detail
    rippleFrequency: 20.0,        // 5.0-50.0
    rippleAmplitude: 0.05,        // 0.01-0.1
    slopeMaskThreshold: 0.3,     // 0.1-0.5

    // Global parameters
    seed: 42,                     // 0-999999
    overallScale: 1.0,           // 0.5-2.0
    heightScale: 1.0,            // 0.1-2.0

    // Stage toggles (all enabled by default)
    passFlags: STAGE_BASE_WAVEFORM | STAGE_CREST_WARPING | STAGE_PROFILE_MODIFIER | STAGE_ANGLE_REPOSE | STAGE_MICRO_DETAIL,

    // Render mode
    renderMode: RENDER_LIT,
};
