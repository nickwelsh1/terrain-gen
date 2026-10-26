// Shared constants for the WebGPU erosion simulator.
// All modules import from here — do not add runtime logic.

// Grid dimensions — resolution is user-selectable and persisted between loads.
// Shader sources bake N in as a WGSL const, so the choice is read once at load.
export const GRID_SIZES = [256, 512, 1024];
export const DEFAULT_GRID_SIZE = 256;
export const GRID_SIZE_STORAGE_KEY = "terrain-gen.webgpu.gridSize";

// World extent — user-selectable (1.28 km to 10.24 km) so mega-dunes and broad
// mountain ranges fit cleanly in the tile.
export const AREA_SIZES = [1280, 2560, 5120, 10240];
export const DEFAULT_AREA_M = 2560;
export const AREA_SIZE_STORAGE_KEY = "terrain-gen.webgpu.areaM";

function readGridSize() {
    if (typeof localStorage === "undefined") return DEFAULT_GRID_SIZE;
    const stored = Number.parseInt(localStorage.getItem(GRID_SIZE_STORAGE_KEY), 10);
    return GRID_SIZES.includes(stored) ? stored : DEFAULT_GRID_SIZE;
}

function readAreaSize() {
    if (typeof localStorage === "undefined") return DEFAULT_AREA_M;
    const stored = Number.parseInt(localStorage.getItem(AREA_SIZE_STORAGE_KEY), 10);
    return AREA_SIZES.includes(stored) ? stored : DEFAULT_AREA_M;
}

export const N = readGridSize();          // grid cells per side
export const AREA_M = readAreaSize();     // meters per side (default 2.56 km)
export const CELL_SPACING_M = AREA_M / N; // meters between cells
export const AREA_KM = AREA_M / 1000;

// Height range — 2500m supports tall Alpine Dolomites, Himalayan massifs, and Tepuis
export const MIN_HEIGHT_M = 10;
export const MAX_HEIGHT_M = 2500;
export const HEIGHT_RANGE_M = MAX_HEIGHT_M - MIN_HEIGHT_M;
// Maximum number of composable biome layers in the stack to keep GPU dispatch fast on mid-range devices
export const MAX_BIOME_LAYERS = 8;
// Exponent applied to the normalized heightmap. Raw noise averages ~0.5, which
// left the terrain sitting halfway up the height range; 2.585 maps 0.5 to 0.167,
// i.e. roughly a third of its former elevation, while peaks stay at full height.
export const HEIGHT_CURVE = 2.585;

// Scene scale: Babylon Lite camera/projection works best with small units.
// Normalize scene width to ~25.6 units regardless of AREA_M so camera frustum
// and orbit controls stay well-behaved across 1.28 km – 10.24 km tiles.
export const SCENE_SCALE = 25.6 / AREA_M;
export const SCENE_AREA = AREA_M * SCENE_SCALE;
export const SCENE_MAX_HEIGHT = MAX_HEIGHT_M * SCENE_SCALE;

// Depth of bedrock below y = 0 that the side walls extend to, so the tile looks
// like a solid slice of ground rather than a shell with open edges.
export const BASE_DEPTH_M = 150;
export const SCENE_BASE_DEPTH = BASE_DEPTH_M * SCENE_SCALE;

// Fixed-point encoding: float_meters * FIXED_POINT_SCALE → i32
export const FIXED_POINT_SCALE = 10000;
export const MAX_FIXED_POINT = MAX_HEIGHT_M * FIXED_POINT_SCALE; // 15,000,000

// Buffer sizes (bytes)
export const GRID_CELLS = N * N;
export const HEIGHT_BUFFER_BYTES = GRID_CELLS * 4;      // i32 per cell
export const HARDNESS_BUFFER_BYTES = GRID_CELLS * 4;    // i32 per cell
export const AUX_BUFFER_BYTES = GRID_CELLS * 16;        // vec4<f32> per cell: [water, sediment, maskA, maskB]

// Droplet simulation
export const DROPLET_COUNT = 10000;
export const DROPLET_LIFETIME = 64;    // simulation steps per droplet
export const WORKGROUP_SIZE = 64;
export const DROPLET_WORKGROUPS = Math.ceil(DROPLET_COUNT / WORKGROUP_SIZE); // 157
export const DROPLET_STRUCT_BYTES = 24; // pos.xy (8) + dir.xy (8) + speed (4) + water (4) + sediment (4) = 28, padded to 28
// vec2<f32> = 8 bytes, f32 = 4 bytes → 8+8+4+4+4 = 28, WGSL aligns to 16 → 32? No, struct align is max member align = 8, size rounds to 8 → 32
// Actually: vec2<f32> align=8, f32 align=4. Struct align = 8. Size = 28, round up to 8 → 32.
export const DROPLET_BUFFER_BYTES = DROPLET_COUNT * 32;

// Uniform buffer: simulation params (all f32/u32, 16-byte aligned struct)
// rainRate, erosionRate, depositionRate, evaporation, sedimentCapacity, stepCount,
// passFlags, seed, baseHeight, batchSeed
// 10 × 4 = 40 bytes, rounded up to a multiple of 16
export const UNIFORM_BUFFER_BYTES = 48;

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
export const RENDER_HEIGHTMAP = 4;
export const RENDER_MASK_INSPECTOR = 5;
export const RENDER_SEDIMENT = 6;
export const RENDER_CURVATURE_AO = 7;

// Landscape Material / Season Palettes for Lit Biome Terrain
export const PALETTE_ALPINE_SUMMER = 0;
export const PALETTE_ALPINE_WINTER = 1;
export const PALETTE_ARIZONA_SUMMER = 2;
export const PALETTE_ZHANGJIAJIE_SUMMER = 3;
export const PALETTE_ZHANGJIAJIE_WINTER = 4;
export const PALETTE_TROPICAL_TEPUIS = 5;
export const PALETTE_SAHARA_DESERT = 6;
export const PALETTE_NAMIB_RED = 7;
export const PALETTE_OUTBACK_PURNULULU = 8;
export const PALETTE_POLAR_FJORD = 9;

export const MATERIAL_PALETTES = [
    { value: PALETTE_ALPINE_SUMMER, group: "Alpine & Mountain", label: "Alpine Dolomites (Summer)" },
    { value: PALETTE_ALPINE_WINTER, group: "Alpine & Mountain", label: "Alpine & Himalayan (Winter Snow)" },
    { value: PALETTE_POLAR_FJORD, group: "Alpine & Mountain", label: "Subpolar Basalt & Glaciers" },
    { value: PALETTE_ZHANGJIAJIE_SUMMER, group: "Karst & Subtropical", label: "Zhangjiajie Karst (Lush Summer)" },
    { value: PALETTE_ZHANGJIAJIE_WINTER, group: "Karst & Subtropical", label: "Zhangjiajie Karst (Winter Frost)" },
    { value: PALETTE_TROPICAL_TEPUIS, group: "Karst & Subtropical", label: "Tropical Island & Guiana Tepui" },
    { value: PALETTE_ARIZONA_SUMMER, group: "Arid, Canyon & Outback", label: "Dry Summer Arizona (Red Rock)" },
    { value: PALETTE_OUTBACK_PURNULULU, group: "Arid, Canyon & Outback", label: "Australian Outback (Purnululu)" },
    { value: PALETTE_SAHARA_DESERT, group: "Arid, Canyon & Outback", label: "Golden Sahara & Sudan Dunes" },
    { value: PALETTE_NAMIB_RED, group: "Arid, Canyon & Outback", label: "Namib Red Oxide Dunes & Pans" },
];

// Default simulation parameters (real-world units)
export const DEFAULT_PARAMS = {
    rainRate: 2.0,           // litres of water a droplet starts with
    erosionRate: 0.5,        // erosion strength (fraction of spare capacity/step)
    depositionRate: 0.3,     // deposition strength (fraction of excess/step)
    evaporation: 0.05,       // fraction of remaining water lost per step
    sedimentCapacity: 0.5,   // capacity multiplier (m³ per unit slope·speed·water)
    stepCount: 10,           // droplet batches per "Erode" click
    passFlags: PASS_HEIGHTMAP | PASS_HARDNESS | PASS_NORMALS | PASS_EROSION | PASS_DEPOSITION,
    seed: 42,
    baseHeight: 800,          // metres of relief in the generated base noise
    batchSeed: 0,            // varies per erosion batch so droplets take new paths
    renderMode: RENDER_LIT,
    materialPalette: PALETTE_ALPINE_SUMMER,
};
