// Shared constants for the WebGPU erosion simulator.
// All modules import from here — do not add runtime logic.

// Grid dimensions
export const N = 256;                  // grid cells per side
export const CELL_SPACING_M = 10;      // meters between cells
export const AREA_M = N * CELL_SPACING_M; // 2560 m = 2.56 km
export const AREA_KM = AREA_M / 1000;  // 2.56

// Height range
export const MIN_HEIGHT_M = 0;
export const MAX_HEIGHT_M = 500;
export const HEIGHT_RANGE_M = MAX_HEIGHT_M - MIN_HEIGHT_M;

// Scene scale: Babylon Lite camera/projection works best with small units.
// All render-side dimensions are scaled down by this factor (100:1).
export const SCENE_SCALE = 0.01;
export const SCENE_AREA = AREA_M * SCENE_SCALE;
export const SCENE_MAX_HEIGHT = MAX_HEIGHT_M * SCENE_SCALE;

// Fixed-point encoding: float_meters * FIXED_POINT_SCALE → i32
export const FIXED_POINT_SCALE = 10000;
export const MAX_FIXED_POINT = MAX_HEIGHT_M * FIXED_POINT_SCALE; // 5,000,000

// Buffer sizes (bytes)
export const GRID_CELLS = N * N;                        // 65,536
export const HEIGHT_BUFFER_BYTES = GRID_CELLS * 4;      // i32 per cell
export const HARDNESS_BUFFER_BYTES = GRID_CELLS * 4;    // i32 per cell

// Droplet simulation
export const DROPLET_COUNT = 10000;
export const WORKGROUP_SIZE = 64;
export const DROPLET_WORKGROUPS = Math.ceil(DROPLET_COUNT / WORKGROUP_SIZE); // 157
export const DROPLET_STRUCT_BYTES = 24; // pos.xy (8) + dir.xy (8) + speed (4) + water (4) + sediment (4) = 28, padded to 28
// vec2<f32> = 8 bytes, f32 = 4 bytes → 8+8+4+4+4 = 28, WGSL aligns to 16 → 32? No, struct align is max member align = 8, size rounds to 8 → 32
// Actually: vec2<f32> align=8, f32 align=4. Struct align = 8. Size = 28, round up to 8 → 32.
export const DROPLET_BUFFER_BYTES = DROPLET_COUNT * 32;

// Uniform buffer: simulation params (all f32, 16-byte aligned struct)
// rainRate, erosionRate, depositionRate, evaporation, sedimentCapacity, stepCount, passFlags, seed
// 8 × f32 = 32 bytes (aligned to 16)
export const UNIFORM_BUFFER_BYTES = 32;

// Pass toggle bitmask values
export const PASS_HEIGHTMAP = 1;
export const PASS_HARDNESS = 2;
export const PASS_NORMALS = 4;
export const PASS_EROSION = 8;
export const PASS_DEPOSITION = 16;

// Render modes
export const RENDER_LIT = 0;
export const RENDER_HARDNESS = 1;
export const RENDER_NORMALS = 2;
export const RENDER_EROSION_HEATMAP = 3;

// Default simulation parameters (real-world units)
export const DEFAULT_PARAMS = {
    rainRate: 2.0,           // litres per step
    erosionRate: 0.5,        // mm per step
    depositionRate: 0.01,    // m³ per step
    evaporation: 0.05,       // litres per step
    sedimentCapacity: 0.5,   // m³
    stepCount: 100,          // number of erosion steps per "Erode" click
    passFlags: PASS_HEIGHTMAP | PASS_HARDNESS | PASS_NORMALS | PASS_EROSION | PASS_DEPOSITION,
    seed: 42,
    renderMode: RENDER_LIT,
};
