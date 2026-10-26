// WGSL render shader for Babylon Lite ShaderMaterial.
// Supports 8 visualization modes and 10 Landscape Material / Season Palettes
// with 4 distinct geological cliff rock archetypes:
//   rockType 0 = Warped 4-Color Variable-Thickness Sedimentary Strata + Desert Varnish
//   rockType 1 = Mottled Granite / Gneiss / Quartzite + Uneven Fractures & Mineral Veins
//   rockType 2 = Water-Streaked Vertical Karst + Diagonal Tectonic Fissures & Moss/Frost Ledges
//   rockType 3 = Columnar Basalt / Schist + Cross-Cutting Mineral Dikes

import { N, FIXED_POINT_SCALE, SCENE_SCALE, SCENE_MAX_HEIGHT } from "../constants.js";

export const RENDER_VERTEX_SOURCE = /* wgsl */`
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};
const SCENE_MAX_H : f32 = ${SCENE_MAX_HEIGHT};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    let gridX = input.uv.x * (N_F - 1.0);
    let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    let idx = iy * N_U + ix;

    let heightMeters = f32(heights[idx]) / FIXED_SCALE;
    let waterDepth = aux[idx].x;
    let surfaceMeters = heightMeters + max(0.0, waterDepth);
    let heightScene = surfaceMeters * SCENE_SCALE_F;

    let worldPos = vec3f(input.position.x, heightScene, input.position.z);

    output.position = shaderSystem.viewProjection * vec4f(worldPos, 1.0);
    output.uv = input.uv;
    output.worldPos = worldPos;
    output.height = heightMeters;

    return output;
}
`;

export const RENDER_FRAGMENT_SOURCE = /* wgsl */`
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

struct BiomeMaterial {
    rockType: u32,        // 0=Warped Sedimentary, 1=Granite/Quartzite+Veins, 2=Vertical Karst, 3=Columnar Basalt
    lowFloor: vec3f,
    midVeg: vec3f,
    upperSlope: vec3f,
    highSummit: vec3f,
    cliffDark: vec3f,
    cliffMid1: vec3f,
    cliffMid2: vec3f,
    cliffLight: vec3f,
    veinColor: vec3f,
    cliffScale: f32,
    talusColor: vec3f,
    sandWindward: vec3f,
    sandLeeward: vec3f,
    sandMineral: vec3f,
    snowColor: vec3f,
    snowLineM: f32,
    waterShallow: vec3f,
    waterDeep: vec3f,
};

// Bounded fract-first hashes for procedural rock, strata, and mineral vein textures
fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return fract((p3.xx + p3.yz) * p3.zy);
}

fn noise2D(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2f(1.0, 0.0));
    let c = hash21(i + vec2f(0.0, 1.0));
    let d = hash21(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm2D(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var q = p;
    for (var i: i32 = 0; i < 4; i = i + 1) {
        v = v + a * noise2D(q);
        q = q * 2.03 + vec2f(17.1, 31.7);
        a = a * 0.5;
    }
    return v;
}

// Returns vec3f(F1_dist, F2_minus_F1_edgeDist, cellIdHash) for rock fractures & mineral veins
fn voronoiCrack(p: vec2f) -> vec3f {
    let n = floor(p);
    let f = fract(p);
    var d1 = 8.0;
    var d2 = 8.0;
    var idHash = 0.0;
    for (var j: i32 = -1; j <= 1; j = j + 1) {
        for (var i: i32 = -1; i <= 1; i = i + 1) {
            let g = vec2f(f32(i), f32(j));
            let o = hash22(n + g);
            let r = g + o * 0.85 - f;
            let d = sqrt(dot(r, r));
            if (d < d1) {
                d2 = d1;
                d1 = d;
                idHash = o.x;
            } else if (d < d2) {
                d2 = d;
            }
        }
    }
    return vec3f(d1, max(0.0, d2 - d1), idHash);
}

fn getMaterialPalette(paletteId: u32) -> BiomeMaterial {
    var m: BiomeMaterial;

    if (paletteId == 1u) {
        // 1: Alpine & Himalayan (Winter Snow) — Fractured Granite & Gneiss with Quartz Veins
        m.rockType = 1u;
        m.lowFloor = vec3f(0.74, 0.79, 0.86);
        m.midVeg = vec3f(0.83, 0.88, 0.94);
        m.upperSlope = vec3f(0.90, 0.94, 0.98);
        m.highSummit = vec3f(0.96, 0.98, 1.00);
        m.cliffDark = vec3f(0.18, 0.20, 0.25);     // Dark biotite-rich gneiss
        m.cliffMid1 = vec3f(0.30, 0.33, 0.39);     // Grey Himalayan granite
        m.cliffMid2 = vec3f(0.42, 0.44, 0.49);     // Lighter leucogranite patches
        m.cliffLight = vec3f(0.58, 0.62, 0.68);    // Frosted granite ledges
        m.veinColor = vec3f(0.88, 0.90, 0.94);     // Bright white quartz/pegmatite dike veins
        m.cliffScale = 1.0;
        m.talusColor = vec3f(0.66, 0.72, 0.80);
        m.sandWindward = vec3f(0.90, 0.94, 0.98);
        m.sandLeeward = vec3f(0.76, 0.83, 0.92);
        m.sandMineral = vec3f(0.55, 0.62, 0.72);
        m.snowColor = vec3f(0.97, 0.98, 1.00);
        m.snowLineM = 120.0;
        m.waterShallow = vec3f(0.20, 0.46, 0.62);
        m.waterDeep = vec3f(0.05, 0.14, 0.28);
    } else if (paletteId == 2u) {
        // 2: Dry Summer Arizona (Red Rock) — Multi-Bed Warped Sandstone, Limestone & Shale
        m.rockType = 0u;
        m.lowFloor = vec3f(0.74, 0.54, 0.38);      // Sandy ochre desert wash
        m.midVeg = vec3f(0.58, 0.46, 0.33);        // Arid sage/juniper & caliche pediment
        m.upperSlope = vec3f(0.78, 0.44, 0.28);    // Vermilion Supai/Wingate bench
        m.highSummit = vec3f(0.86, 0.70, 0.52);    // Pale buff Coconino/Kaibab caprock
        m.cliffDark = vec3f(0.44, 0.18, 0.12);     // Deep maroon Hermit shale & desert varnish
        m.cliffMid1 = vec3f(0.72, 0.33, 0.20);     // Redwall / Navajo terracotta sandstone
        m.cliffMid2 = vec3f(0.82, 0.52, 0.34);     // Warm salmon-ochre cross-bedded unit
        m.cliffLight = vec3f(0.90, 0.76, 0.58);    // Cream/buff Coconino sandstone band
        m.veinColor = vec3f(0.92, 0.84, 0.70);     // Calcite joint infill
        m.cliffScale = 1.0;
        m.talusColor = vec3f(0.68, 0.39, 0.25);
        m.sandWindward = vec3f(0.86, 0.60, 0.40);
        m.sandLeeward = vec3f(0.68, 0.42, 0.26);
        m.sandMineral = vec3f(0.48, 0.32, 0.24);
        m.snowColor = vec3f(0.90, 0.78, 0.62);
        m.snowLineM = 1950.0;
        m.waterShallow = vec3f(0.36, 0.52, 0.44);
        m.waterDeep = vec3f(0.14, 0.28, 0.26);
    } else if (paletteId == 3u) {
        // 3: Zhangjiajie Karst (Lush Summer) — Water-Streaked Vertical Quartz-Sandstone & Moss Fissures
        m.rockType = 2u;
        m.lowFloor = vec3f(0.15, 0.31, 0.14);      // Deep subtropical ravine forest
        m.midVeg = vec3f(0.21, 0.43, 0.18);        // Lush emerald canopy
        m.upperSlope = vec3f(0.28, 0.50, 0.21);    // Subtropical pine & fern slope
        m.highSummit = vec3f(0.23, 0.46, 0.18);    // Vegetated pillar top crowns
        m.cliffDark = vec3f(0.26, 0.23, 0.21);     // Dark manganese water-drip streaks
        m.cliffMid1 = vec3f(0.48, 0.42, 0.36);     // Weathered grey-tan quartz sandstone
        m.cliffMid2 = vec3f(0.64, 0.54, 0.43);     // Warm buff/ochre iron-stained rock face
        m.cliffLight = vec3f(0.76, 0.67, 0.55);    // Sunlit pale sandstone ribs
        m.veinColor = vec3f(0.22, 0.44, 0.17);     // Clinging emerald moss & shrubs in joint crevices
        m.cliffScale = 1.25;
        m.talusColor = vec3f(0.30, 0.38, 0.24);
        m.sandWindward = vec3f(0.54, 0.49, 0.40);
        m.sandLeeward = vec3f(0.40, 0.36, 0.30);
        m.sandMineral = vec3f(0.28, 0.32, 0.22);
        m.snowColor = vec3f(0.28, 0.50, 0.20);
        m.snowLineM = 2400.0;
        m.waterShallow = vec3f(0.18, 0.52, 0.48);
        m.waterDeep = vec3f(0.06, 0.24, 0.26);
    } else if (paletteId == 4u) {
        // 4: Zhangjiajie Karst (Misty Winter Frost) — Slate Pillars with Rime-Ice Fissures
        m.rockType = 2u;
        m.lowFloor = vec3f(0.52, 0.57, 0.64);
        m.midVeg = vec3f(0.70, 0.76, 0.82);
        m.upperSlope = vec3f(0.86, 0.91, 0.96);
        m.highSummit = vec3f(0.95, 0.97, 1.00);
        m.cliffDark = vec3f(0.24, 0.25, 0.30);     // Wet dark charcoal pillar shaft
        m.cliffMid1 = vec3f(0.38, 0.40, 0.45);     // Cold slate-taupe quartzite
        m.cliffMid2 = vec3f(0.52, 0.54, 0.60);     // Pale grey sandstone face
        m.cliffLight = vec3f(0.72, 0.76, 0.82);    // Frosted rock ribs
        m.veinColor = vec3f(0.94, 0.97, 1.00);     // White rime-ice & snow packed into cliff fractures
        m.cliffScale = 1.25;
        m.talusColor = vec3f(0.66, 0.71, 0.78);
        m.sandWindward = vec3f(0.86, 0.90, 0.95);
        m.sandLeeward = vec3f(0.72, 0.77, 0.84);
        m.sandMineral = vec3f(0.50, 0.55, 0.62);
        m.snowColor = vec3f(0.96, 0.98, 1.00);
        m.snowLineM = 280.0;
        m.waterShallow = vec3f(0.28, 0.48, 0.58);
        m.waterDeep = vec3f(0.10, 0.20, 0.30);
    } else if (paletteId == 5u) {
        // 5: Tropical Island & Guiana Tepui — Fractured Precambrian Quartzite & Rose-Gold Veins
        m.rockType = 1u;
        m.lowFloor = vec3f(0.82, 0.75, 0.55);      // Coral sand / Gran Sabana margin
        m.midVeg = vec3f(0.14, 0.37, 0.15);        // Dense lowland tropical rainforest
        m.upperSlope = vec3f(0.21, 0.45, 0.19);    // Cloud-forest highland talus slope
        m.highSummit = vec3f(0.32, 0.29, 0.31);    // Weathered dark Precambrian Roraima summit labyrinth
        m.cliffDark = vec3f(0.22, 0.18, 0.20);     // Black-patinated algae & silica crust
        m.cliffMid1 = vec3f(0.44, 0.31, 0.30);     // Deep rose-umber Roraima quartzite
        m.cliffMid2 = vec3f(0.62, 0.44, 0.39);     // Warm salmon-pink orthoquartzite face
        m.cliffLight = vec3f(0.78, 0.62, 0.54);    // Freshly fractured pale pink cliff scars
        m.veinColor = vec3f(0.88, 0.74, 0.64);     // Hydrothermal crystal & quartz fracture veins
        m.cliffScale = 0.95;
        m.talusColor = vec3f(0.22, 0.39, 0.18);
        m.sandWindward = vec3f(0.86, 0.78, 0.58);
        m.sandLeeward = vec3f(0.70, 0.62, 0.44);
        m.sandMineral = vec3f(0.45, 0.42, 0.35);
        m.snowColor = vec3f(0.40, 0.36, 0.37);
        m.snowLineM = 2400.0;
        m.waterShallow = vec3f(0.12, 0.68, 0.66);
        m.waterDeep = vec3f(0.03, 0.22, 0.38);
    } else if (paletteId == 6u) {
        // 6: Golden Sahara & Sudan Dunes — Multi-Tone Erg Sand, Reg Gravel & Fractured Desert Outcrops
        m.rockType = 3u;
        m.lowFloor = vec3f(0.44, 0.39, 0.33);      // Dark basalt/gravel reg interdune corridor
        m.midVeg = vec3f(0.76, 0.63, 0.43);        // Pale golden plinth sand
        m.upperSlope = vec3f(0.88, 0.72, 0.47);    // Warm amber stoss dune slope
        m.highSummit = vec3f(0.94, 0.81, 0.56);    // Sun-bleached crest sand
        m.cliffDark = vec3f(0.28, 0.23, 0.20);     // Black-brown desert varnish outcrop
        m.cliffMid1 = vec3f(0.48, 0.39, 0.31);     // Weathered Nubian sandstone/basalt
        m.cliffMid2 = vec3f(0.64, 0.52, 0.40);     // Ochre caliche rock
        m.cliffLight = vec3f(0.78, 0.66, 0.50);    // Wind-abraded rock ribs
        m.veinColor = vec3f(0.85, 0.74, 0.56);     // Sand-filled rock joints
        m.cliffScale = 1.1;
        m.talusColor = vec3f(0.72, 0.58, 0.39);
        m.sandWindward = vec3f(0.91, 0.76, 0.51);  // Bright golden windward sand
        m.sandLeeward = vec3f(0.71, 0.53, 0.33);   // Deep sienna-ochre slip face
        m.sandMineral = vec3f(0.52, 0.43, 0.33);   // Coarse dark gravel & magnetite ripple troughs
        m.snowColor = vec3f(0.95, 0.83, 0.60);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.18, 0.58, 0.54);
        m.waterDeep = vec3f(0.06, 0.26, 0.30);
    } else if (paletteId == 7u) {
        // 7: Namib Red Oxide Dunes & Salt Pans — Bleached Clay Vlei, Golden Plinths, Magnetite Streaks & Terracotta Crests
        m.rockType = 3u;
        m.lowFloor = vec3f(0.82, 0.79, 0.71);      // Sun-bleached white/cream Deadvlei clay pan
        m.midVeg = vec3f(0.78, 0.58, 0.38);        // Golden-apricot lower dune apron & dry grass
        m.upperSlope = vec3f(0.86, 0.46, 0.26);    // Warm terracotta-orange mid dune
        m.highSummit = vec3f(0.92, 0.42, 0.22);    // Oxidized iron-rich star-dune peak
        m.cliffDark = vec3f(0.26, 0.22, 0.22);     // Dark Damara schist bedrock
        m.cliffMid1 = vec3f(0.45, 0.34, 0.29);     // Weathered grey-brown gneiss
        m.cliffMid2 = vec3f(0.64, 0.45, 0.34);     // Quartz-feldspar rock
        m.cliffLight = vec3f(0.80, 0.64, 0.48);    // Calcrete crust
        m.veinColor = vec3f(0.88, 0.78, 0.65);     // White quartz veins in schist
        m.cliffScale = 1.1;
        m.talusColor = vec3f(0.76, 0.52, 0.34);
        m.sandWindward = vec3f(0.89, 0.52, 0.30);  // Luminous apricot-terracotta windward slope
        m.sandLeeward = vec3f(0.64, 0.28, 0.16);   // Deep violet-umber shadowed slip face
        m.sandMineral = vec3f(0.42, 0.26, 0.22);   // Dark heavy-mineral magnetite & garnet streaks!
        m.snowColor = vec3f(0.93, 0.56, 0.34);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.22, 0.52, 0.56);
        m.waterDeep = vec3f(0.06, 0.18, 0.32);
    } else if (paletteId == 8u) {
        // 8: Australian Outback (Purnululu Beehive & Wilpena Pound) — Warped Zebra Sandstone & Ochre Spinifex
        m.rockType = 0u;
        m.lowFloor = vec3f(0.60, 0.37, 0.23);      // Red-ochre Outback creek & plain
        m.midVeg = vec3f(0.44, 0.47, 0.27);        // Spinifex & eucalyptus olive-green bush
        m.upperSlope = vec3f(0.72, 0.44, 0.25);    // Ochre quartzite/sandstone slope
        m.highSummit = vec3f(0.78, 0.54, 0.34);    // Weathered sandstone dome crown
        m.cliffDark = vec3f(0.19, 0.18, 0.19);     // Dark charcoal cyanobacterial crust band
        m.cliffMid1 = vec3f(0.48, 0.30, 0.20);     // Deep rust-brown ferruginous bed
        m.cliffMid2 = vec3f(0.84, 0.46, 0.20);     // Vibrant orange Purnululu sandstone bed
        m.cliffLight = vec3f(0.90, 0.66, 0.42);    // Pale golden leached sandstone rib
        m.veinColor = vec3f(0.25, 0.22, 0.20);     // Dark joint fissures
        m.cliffScale = 1.65;
        m.talusColor = vec3f(0.62, 0.38, 0.23);
        m.sandWindward = vec3f(0.78, 0.48, 0.28);
        m.sandLeeward = vec3f(0.60, 0.34, 0.19);
        m.sandMineral = vec3f(0.42, 0.36, 0.24);
        m.snowColor = vec3f(0.82, 0.56, 0.36);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.32, 0.48, 0.36);
        m.waterDeep = vec3f(0.12, 0.24, 0.20);
    } else if (paletteId == 9u) {
        // 9: Subpolar Basalt & Glaciers (Iceland / Fjords) — Columnar Basalt & Rhyolite Dikes
        m.rockType = 3u;
        m.lowFloor = vec3f(0.16, 0.17, 0.19);      // Black volcanic basalt outwash sand
        m.midVeg = vec3f(0.35, 0.46, 0.21);        // Bright subpolar moss & lichen tundra
        m.upperSlope = vec3f(0.28, 0.30, 0.33);    // Dark basaltic tableland
        m.highSummit = vec3f(0.88, 0.94, 0.99);    // Ice cap
        m.cliffDark = vec3f(0.13, 0.14, 0.16);     // Deep black columnar basalt
        m.cliffMid1 = vec3f(0.24, 0.26, 0.29);     // Charcoal flood basalt
        m.cliffMid2 = vec3f(0.36, 0.38, 0.42);     // Grey andesite/hyaloclastite tuff
        m.cliffLight = vec3f(0.54, 0.48, 0.38);    // Palagonite ochre-brown weathering rind
        m.veinColor = vec3f(0.72, 0.78, 0.84);     // Ice/zeolite-filled cooling fractures
        m.cliffScale = 1.2;
        m.talusColor = vec3f(0.22, 0.23, 0.26);
        m.sandWindward = vec3f(0.22, 0.23, 0.25);
        m.sandLeeward = vec3f(0.15, 0.16, 0.18);
        m.sandMineral = vec3f(0.32, 0.38, 0.22);
        m.snowColor = vec3f(0.90, 0.96, 1.00);
        m.snowLineM = 620.0;
        m.waterShallow = vec3f(0.18, 0.50, 0.64);
        m.waterDeep = vec3f(0.04, 0.14, 0.26);
    } else {
        // 0: Alpine Dolomites (Summer — Default) — Warped Carbonate Reef Beds, Vertical Fissures & Pale Scree
        m.rockType = 0u;
        m.lowFloor = vec3f(0.22, 0.36, 0.17);      // Deep conifer valley forest
        m.midVeg = vec3f(0.33, 0.50, 0.23);        // Bright alpine pasture (Alpe di Siusi)
        m.upperSlope = vec3f(0.60, 0.56, 0.51);    // Dolomitic limestone & scree bench
        m.highSummit = vec3f(0.78, 0.73, 0.68);    // Pale pinkish-grey Dolomite massif
        m.cliffDark = vec3f(0.34, 0.31, 0.30);     // Dark marl/bituminous bedding seams & wet streaks
        m.cliffMid1 = vec3f(0.56, 0.52, 0.48);     // Weathered grey carbonate rock
        m.cliffMid2 = vec3f(0.74, 0.67, 0.60);     // Warm enrosadira rose-beige dolomite
        m.cliffLight = vec3f(0.86, 0.81, 0.76);    // Bright bleached reef limestone
        m.veinColor = vec3f(0.28, 0.25, 0.24);     // Deep vertical chimney fissures
        m.cliffScale = 0.85;
        m.talusColor = vec3f(0.68, 0.65, 0.60);
        m.sandWindward = vec3f(0.76, 0.72, 0.66);
        m.sandLeeward = vec3f(0.58, 0.54, 0.49);
        m.sandMineral = vec3f(0.44, 0.42, 0.38);
        m.snowColor = vec3f(0.95, 0.97, 1.00);
        m.snowLineM = 1150.0;
        m.waterShallow = vec3f(0.16, 0.58, 0.64);
        m.waterDeep = vec3f(0.05, 0.20, 0.34);
    }

    return m;
}

// Evaluates rich, non-uniform cliff rock texture according to mat.rockType:
// - 0u: 3D-warped variable-thickness multi-color sedimentary strata + vertical varnish streaks + cross cracks
// - 1u: Mottled crystalline granite/gneiss/quartzite + uneven conjugate fractures & mineral-filled veins
// - 2u: Vertical water-streaked karst shafts + uneven tectonic cracks + moss/frost ledges
// - 3u: Columnar volcanic basalt/schist + diagonal dike intrusions & weathering rinds
fn evaluateCliffTexture(mat: BiomeMaterial, uv: vec2f, heightM: f32, normal: vec3f, curvature01: f32) -> vec3f {
    // Project 3D triplanar-style rock coordinates using UV and elevation
    let worldXY = uv * 18.0 * mat.cliffScale;
    let hCoord = heightM * 0.045 * mat.cliffScale;

    if (mat.rockType == 1u) {
        // TYPE 1: Igneous Granite / Gneiss / Quartzite (No horizontal stripes!)
        // 1. Multi-scale mottled crystalline patches
        let grainCoarse = fbm2D(worldXY * 1.4 + vec2f(hCoord * 0.7, -hCoord * 0.5));
        let grainFine = noise2D(worldXY * 7.5 + vec2f(hCoord * 2.1, hCoord * 1.7));
        var rockCol = mix(mat.cliffDark, mat.cliffMid1, smoothstep(0.22, 0.55, grainCoarse));
        rockCol = mix(rockCol, mat.cliffMid2, smoothstep(0.48, 0.76, grainCoarse * 0.7 + grainFine * 0.3));
        rockCol = mix(rockCol, mat.cliffLight, smoothstep(0.68, 0.90, grainFine));

        // 2. Uneven diagonal conjugate fracture planes cutting across the rock face
        let warpP = vec2f(
            fbm2D(worldXY * 1.8 + vec2f(3.1, 7.4)) - 0.5,
            fbm2D(worldXY * 1.8 + vec2f(11.3, 2.9)) - 0.5
        ) * 0.65;
        let diagCoord1 = vec2f(worldXY.x * 0.85 + hCoord * 1.35, worldXY.y * 0.85 - hCoord * 1.1) + warpP;
        let diagCoord2 = vec2f(worldXY.x * 1.4 - hCoord * 1.6, worldXY.y * 1.4 + hCoord * 0.9) - warpP * 0.8;

        let crack1 = voronoiCrack(diagCoord1 * 1.3);
        let crack2 = voronoiCrack(diagCoord2 * 2.1 + vec2f(19.3, 7.1));

        // Dark recessed fracture lines
        let darkFissure = (1.0 - smoothstep(0.01, 0.065, crack1.y)) * 0.75
                        + (1.0 - smoothstep(0.01, 0.055, crack2.y)) * 0.5;
        rockCol = mix(rockCol, mat.cliffDark * 0.65, clamp(darkFissure, 0.0, 0.85));

        // 3. Mineral-filled veins (quartz / pegmatite / iron-oxide) inside selected fractures
        let veinSelect1 = step(0.45, crack1.z) * (1.0 - smoothstep(0.0, 0.045, crack1.y));
        let veinSelect2 = step(0.58, crack2.z) * (1.0 - smoothstep(0.0, 0.038, crack2.y));
        let veinMask = clamp(veinSelect1 + veinSelect2 * 0.8, 0.0, 1.0);
        rockCol = mix(rockCol, mat.veinColor, veinMask * 0.88);

        return rockCol;
    } else if (mat.rockType == 2u) {
        // TYPE 2: Vertical Water-Streaked Karst & Tectonic Fissures (Zhangjiajie Summer / Winter)
        // 1. Vertical dissolution streaks (rillenkarren & dark rainwater / manganese drip lines)
        let angleAround = atan2(normal.z, normal.x);
        let horizCoord = (uv.x * 14.0 + uv.y * 14.0 + angleAround * 1.5) * mat.cliffScale;
        let streakNoise = fbm2D(vec2f(horizCoord * 3.2, hCoord * 0.25));
        let fineStreaks = noise2D(vec2f(horizCoord * 11.0, hCoord * 0.5));

        // 2. Warped irregular bedding notches (not uniform stripes)
        let bedWarp = (fbm2D(worldXY * 1.2) - 0.5) * 2.4;
        let warpedH = hCoord + bedWarp;
        let bedHash = noise2D(vec2f(warpedH * 1.7, floor(warpedH * 0.6) * 3.1));

        var rockCol = mix(mat.cliffMid1, mat.cliffMid2, smoothstep(0.25, 0.75, bedHash));
        rockCol = mix(rockCol, mat.cliffLight, smoothstep(0.62, 0.88, fineStreaks * 0.6 + bedHash * 0.4));
        // Apply dark vertical water-staining streaks in concave flutes
        let stainStrength = smoothstep(0.38, 0.72, streakNoise) * (1.2 - curvature01 * 0.6);
        rockCol = mix(rockCol, mat.cliffDark, clamp(stainStrength * 0.78, 0.0, 0.85));

        // 3. Uneven cross-cutting tectonic joint cracks filled with moss (Summer) or rime frost (Winter)
        let crackCoord = vec2f(horizCoord * 0.7 + bedWarp * 0.5, warpedH * 0.9);
        let vCrack = voronoiCrack(crackCoord);
        let ledgeMask = (1.0 - smoothstep(0.0, 0.06, vCrack.y)) * smoothstep(0.15, 0.65, normal.y + 0.35);
        rockCol = mix(rockCol, mat.veinColor, clamp(ledgeMask * 0.9, 0.0, 1.0));

        return rockCol;
    } else if (mat.rockType == 3u) {
        // TYPE 3: Columnar Basalt / Metamorphic Schist with Dike Intrusions
        let colCoord = worldXY * 3.5;
        let vCol = voronoiCrack(colCoord);
        let colJoint = 1.0 - smoothstep(0.0, 0.08, vCol.y);

        // Diagonal intrusive dike / quartz vein network
        let dikeWarp = fbm2D(worldXY * 1.6) * 1.4;
        let vDike = voronoiCrack(vec2f(worldXY.x * 0.9 + hCoord * 1.4 + dikeWarp, worldXY.y * 0.9 - hCoord));
        let dikeMask = step(0.52, vDike.z) * (1.0 - smoothstep(0.0, 0.045, vDike.y));

        let patina = fbm2D(worldXY * 2.2 + vec2f(0.0, hCoord * 0.8));
        var rockCol = mix(mat.cliffDark, mat.cliffMid1, vCol.z);
        rockCol = mix(rockCol, mat.cliffMid2, smoothstep(0.45, 0.75, patina));
        rockCol = mix(rockCol, mat.cliffLight, smoothstep(0.72, 0.92, patina) * 0.7);
        rockCol = mix(rockCol, mat.cliffDark * 0.6, colJoint * 0.75);
        rockCol = mix(rockCol, mat.veinColor, dikeMask * 0.85);

        return rockCol;
    } else {
        // TYPE 0: Warped Multi-Bed Sedimentary Strata (Variable thickness + 4 mineral shades + vertical varnish + fractures)
        // 1. 3D structural dip & multi-scale folding warp so strata never run in flat straight lines
        let dipTilt = (uv.x - 0.5) * 42.0 + (uv.y - 0.5) * 28.0;
        let macroFold = (fbm2D(uv * 3.2 + vec2f(5.1, 9.3)) - 0.5) * 65.0;
        let mesoUndulation = (noise2D(worldXY * 1.8) - 0.5) * 18.0;
        let warpedElevM = heightM + dipTilt + macroFold + mesoUndulation;

        // 2. Non-uniform bed thickness lookup: combine a coarse bed index with a variable-frequency inner bed
        let coarseBed = warpedElevM * 0.022 * mat.cliffScale;
        let bedThicknessMod = noise2D(vec2f(floor(coarseBed) * 1.7, 3.1));
        let variablePhase = coarseBed * (1.4 + 2.2 * bedThicknessMod) + sin(coarseBed * 2.7) * 0.65;

        // Sample two independent 1D geological hashes along variablePhase to select among 4 distinct mineral shades
        let s1 = noise2D(vec2f(variablePhase * 1.9, 11.7));
        let s2 = noise2D(vec2f(variablePhase * 4.3 + 7.1, 23.4));
        let thinSeam = 1.0 - smoothstep(0.0, 0.09, abs(fract(variablePhase * 1.3) - 0.5));

        var strataCol = mix(mat.cliffMid1, mat.cliffMid2, smoothstep(0.22, 0.68, s1));
        strataCol = mix(strataCol, mat.cliffLight, smoothstep(0.58, 0.86, s2));
        strataCol = mix(strataCol, mat.cliffDark, clamp(thinSeam * 0.85 + smoothstep(0.75, 0.95, 1.0 - s1) * 0.6, 0.0, 0.92));

        // 3. Vertical desert-varnish rainwater streaks & cross-cutting vertical joint cracks
        let streak = smoothstep(0.52, 0.84, fbm2D(vec2f((uv.x + uv.y) * 28.0, heightM * 0.008)));
        strataCol = mix(strataCol, mat.cliffDark, streak * 0.42);

        let vJoint = voronoiCrack(vec2f((uv.x - uv.y) * 16.0 + mesoUndulation * 0.04, warpedElevM * 0.015));
        let jointCrack = 1.0 - smoothstep(0.0, 0.04, vJoint.y);
        let filledCrack = step(0.65, vJoint.z) * jointCrack;
        strataCol = mix(strataCol, mat.cliffDark * 0.65, jointCrack * (1.0 - filledCrack) * 0.7);
        strataCol = mix(strataCol, mat.veinColor, filledCrack * 0.75);

        return strataCol;
    }
}

// Bilinearly unpacks normal and (slope, curvature, ao) across the 2x2 cell footprint
// so diagonal cliffs and dune brinks don't show square texel facets.
fn sampleSurfaceAnalysis(uv: vec2f) -> mat2x3f {
    let gx = clamp(uv.x * (N_F - 1.0), 0.0, N_F - 1.001);
    let gy = clamp((1.0 - uv.y) * (N_F - 1.0), 0.0, N_F - 1.001);
    let ix = u32(floor(gx));
    let iy = u32(floor(gy));
    let fx = gx - f32(ix);
    let fy = gy - f32(iy);

    let i00 = iy * N_U + ix;
    let i10 = iy * N_U + ix + 1u;
    let i01 = (iy + 1u) * N_U + ix;
    let i11 = (iy + 1u) * N_U + ix + 1u;

    let n00 = normals[i00];
    let n10 = normals[i10];
    let n01 = normals[i01];
    let n11 = normals[i11];

    let v00 = vec3f(f32(n00 & 0xFFu), f32((n00 >> 8u) & 0xFFu), f32((n00 >> 16u) & 0xFFu)) / 255.0 * 2.0 - 1.0;
    let v10 = vec3f(f32(n10 & 0xFFu), f32((n10 >> 8u) & 0xFFu), f32((n10 >> 16u) & 0xFFu)) / 255.0 * 2.0 - 1.0;
    let v01 = vec3f(f32(n01 & 0xFFu), f32((n01 >> 8u) & 0xFFu), f32((n01 >> 16u) & 0xFFu)) / 255.0 * 2.0 - 1.0;
    let v11 = vec3f(f32(n11 & 0xFFu), f32((n11 >> 8u) & 0xFFu), f32((n11 >> 16u) & 0xFFu)) / 255.0 * 2.0 - 1.0;
    let interpN = normalize(mix(mix(v00, v10, fx), mix(v01, v11, fx), fy));

    let s00 = slopes[i00];
    let s10 = slopes[i10];
    let s01 = slopes[i01];
    let s11 = slopes[i11];

    let sv00 = vec3f(f32(s00 & 0xFFu), f32((s00 >> 8u) & 0xFFu), f32((s00 >> 16u) & 0xFFu)) / 255.0;
    let sv10 = vec3f(f32(s10 & 0xFFu), f32((s10 >> 8u) & 0xFFu), f32((s10 >> 16u) & 0xFFu)) / 255.0;
    let sv01 = vec3f(f32(s01 & 0xFFu), f32((s01 >> 8u) & 0xFFu), f32((s01 >> 16u) & 0xFFu)) / 255.0;
    let sv11 = vec3f(f32(s11 & 0xFFu), f32((s11 >> 8u) & 0xFFu), f32((s11 >> 16u) & 0xFFu)) / 255.0;
    let interpS = mix(mix(sv00, sv10, fx), mix(sv01, sv11, fx), fy);

    return mat2x3f(interpN, interpS);
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let renderMode = shaderUniforms.renderMode;
    let paletteId = shaderUniforms.materialPalette;

    let gridX = input.uv.x * (N_F - 1.0);
    let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    let idx = iy * N_U + ix;

    let surf = sampleSurfaceAnalysis(input.uv);
    let normal = surf[0];
    let slope01 = surf[1].x;
    let curvature01 = surf[1].y;
    let ao01 = max(0.35, surf[1].z);

    let auxVal = aux[idx];
    let waterDepth = auxVal.x;
    let sedimentDepth = auxVal.y;
    let maskA = clamp(auxVal.z, 0.0, 1.0);
    let maskB = clamp(auxVal.w, 0.0, 1.0);

    let sunDir = normalize(vec3f(0.55, 0.68, 0.35));
    let diffuse = max(dot(normal, sunDir), 0.0);
    let light = (0.28 + diffuse * 0.72) * mix(0.65, 1.0, ao01);

    // Mode 1: Hardness map
    if (renderMode == 1u) {
        let hard = f32(hardness[idx]) / ${FIXED_POINT_SCALE}.0;
        return vec4f(hard, hard, hard, 1.0);
    }

    // Mode 4: Grayscale Heightmap
    if (renderMode == 4u) {
        let hGray = clamp(input.height / 1600.0, 0.0, 1.0);
        return vec4f(hGray, hGray, hGray, 1.0);
    }

    // Mode 5: Active Layer Mask Inspector (aux.z = maskA)
    if (renderMode == 5u) {
        let baseGray = clamp(input.height / 1600.0, 0.0, 1.0) * light;
        let bg = vec3f(baseGray * 0.55);
        let maskColor = mix(vec3f(0.12, 0.15, 0.22), vec3f(1.0, 0.82, 0.22), maskA);
        return vec4f(mix(bg, maskColor, 0.78), 1.0);
    }

    // Mode 6: Loose Sediment / Sand / Talus Depth Inspector (aux.y)
    if (renderMode == 6u) {
        let sedNorm = clamp(sedimentDepth / 80.0, 0.0, 1.0);
        let rockBg = vec3f(0.22, 0.22, 0.25) * light;
        let sandHeat = mix(vec3f(0.85, 0.65, 0.30), vec3f(1.0, 0.92, 0.55), sedNorm) * light;
        return vec4f(mix(rockBg, sandHeat, clamp(sedimentDepth / 12.0, 0.0, 1.0)), 1.0);
    }

    // Mode 7: Curvature (ridge/valley) & Horizon AO
    if (renderMode == 7u) {
        let ridge = clamp((curvature01 - 0.5) * 3.0, 0.0, 1.0);
        let valley = clamp((0.5 - curvature01) * 3.0, 0.0, 1.0);
        var cCol = vec3f(0.45, 0.45, 0.48);
        cCol = mix(cCol, vec3f(0.95, 0.62, 0.22), ridge);
        cCol = mix(cCol, vec3f(0.18, 0.68, 0.88), valley);
        return vec4f(cCol * ao01, 1.0);
    }

    // Mode 3: Slope / Erosion Heatmap
    if (renderMode == 3u) {
        return vec4f(slope01 * 2.0, (1.0 - slope01) * 0.5, 0.2 + maskB * 0.5, 1.0);
    }

    // Evaluate selected Landscape Material / Season Palette
    let mat = getMaterialPalette(paletteId);

    // Organic spatial perturbation of elevation zones so color transitions don't form flat rings
    let patchNoise = fbm2D(input.uv * 9.5 + vec2f(3.7, 8.1)) - 0.5;
    let microPatch = noise2D(input.uv * 38.0) - 0.5;
    let hPerturbed = input.height + patchNoise * 85.0 + microPatch * 22.0;

    var color: vec3f;
    if (hPerturbed < 110.0) {
        color = mix(mat.lowFloor, mat.midVeg, clamp(hPerturbed / 110.0, 0.0, 1.0));
    } else if (hPerturbed < 480.0) {
        let t = (hPerturbed - 110.0) / 370.0;
        color = mix(mat.midVeg, mat.upperSlope, t);
    } else if (hPerturbed < mat.snowLineM) {
        let span = max(mat.snowLineM - 480.0, 100.0);
        let t = clamp((hPerturbed - 480.0) / span, 0.0, 1.0);
        color = mix(mat.upperSlope, mat.highSummit, t);
    } else {
        let t = clamp((hPerturbed - mat.snowLineM) / 450.0, 0.0, 1.0);
        let snowSlopeGate = 1.0 - smoothstep(0.34, 0.58, slope01);
        color = mix(mat.highSummit, mat.snowColor, clamp(0.35 + t * 0.65, 0.0, 1.0) * snowSlopeGate);
    }

    // Subtle foliage / soil / reg patch variety on gentle slopes
    color = color * (0.94 + 0.12 * (patchNoise + 0.5));

    // Evaluate archetype-specific cliff rock texture on moderate-to-steep faces
    let cliffMask = smoothstep(0.24, 0.50, slope01);
    if (cliffMask > 0.001) {
        let cliffRock = evaluateCliffTexture(mat, input.uv, input.height, normal, curvature01);
        color = mix(color, cliffRock, cliffMask * 0.92);
    }

    // Loose sediment / dune sand / scree apron / alpine snow drift tinting from aux.y
    if (sedimentDepth > 0.15) {
        let sedWeight = clamp(sedimentDepth / 14.0, 0.0, 1.0);
        // Vary sand mineral tone across interdune plinths, stoss ripples, leeward slip faces, and oxidized crests
        let plinthBlend = smoothstep(15.0, 140.0, input.height);
        let mineralStreak = smoothstep(0.45, 0.78, fbm2D(input.uv * 24.0 + vec2f(normal.x * 2.0, normal.z * 2.0)))
                          * (1.0 - maskB) * (1.0 - plinthBlend * 0.5);
        var warmSand = mix(mat.midVeg, mat.sandWindward, clamp(0.35 + plinthBlend * 0.65, 0.0, 1.0));
        warmSand = mix(warmSand, mat.sandMineral, mineralStreak * 0.65);
        warmSand = mix(warmSand, mat.sandLeeward, maskB * 0.72);
        // Bleached clay pans (vlei) where sediment is thin in flat low interdune hollows
        let panGate = (1.0 - smoothstep(4.0, 22.0, sedimentDepth)) * (1.0 - smoothstep(0.0, 55.0, input.height)) * (1.0 - slope01 * 3.0);
        warmSand = mix(warmSand, mat.lowFloor, clamp(panGate, 0.0, 0.85));

        let sedBiomeColor = select(
            mix(mat.talusColor, warmSand, clamp(1.0 - slope01 * 1.35, 0.0, 1.0)),
            mat.snowColor,
            input.height > mat.snowLineM
        );
        color = mix(color, sedBiomeColor, sedWeight * (1.0 - cliffMask * 0.65));
    }

    // Convex ridge, brink & boulder highlight from curvature
    let ridgeCrest = clamp((curvature01 - 0.52) * 2.6, 0.0, 1.0);
    color = mix(color, color * 1.16, ridgeCrest * 0.5);

    var litColor = color * light;

    // Water flooding (ocean / crater lake / river) when aux.x > 0
    if (waterDepth > 0.05) {
        let waterNormal = vec3f(0.0, 1.0, 0.0);
        let waterDiff = max(dot(waterNormal, sunDir), 0.0);
        let depthT = clamp(waterDepth / 45.0, 0.0, 1.0);
        let waterCol = mix(mat.waterShallow, mat.waterDeep, depthT) * (0.4 + 0.6 * waterDiff);
        let shoreBlend = clamp(waterDepth / 2.5, 0.0, 1.0);
        litColor = mix(litColor, waterCol, shoreBlend * 0.92);
    }

    // Mode 2: Slope arrows overlaid on lit terrain
    if (renderMode == 2u) {
        let arrowGrid = 32.0;
        let cellUv = input.uv * arrowGrid;
        let cellId = vec2u(u32(cellUv.x), u32(cellUv.y));
        let cellCenterUv = (vec2f(f32(cellId.x), f32(cellId.y)) + 0.5) / arrowGrid;

        let cgx = cellCenterUv.x * (N_F - 1.0);
        let cgy = (1.0 - cellCenterUv.y) * (N_F - 1.0);
        let cix = u32(clamp(cgx, 0.0, N_F - 1.0));
        let ciy = u32(clamp(cgy, 0.0, N_F - 1.0));
        let cidx = ciy * N_U + cix;
        let cpn = normals[cidx];
        let cnr = f32(cpn & 0xFFu) / 255.0 * 2.0 - 1.0;
        let cnb = f32((cpn >> 16u) & 0xFFu) / 255.0 * 2.0 - 1.0;

        let slopeLen = length(vec2f(cnr, cnb));
        if (slopeLen < 0.001) {
            return vec4f(litColor, 1.0);
        }
        let dir = vec2f(-cnr, cnb) / slopeLen;
        let localUv = fract(cellUv) - 0.5;
        let proj = localUv.x * dir.x + localUv.y * dir.y;
        let perp = localUv.x * (-dir.y) + localUv.y * dir.x;

        let shaftHalfW = 0.03;
        let onShaft = proj > -0.25 && proj < 0.15 && abs(perp) < shaftHalfW;
        let headT = (proj - 0.15) / 0.15;
        let onHead = headT > 0.0 && headT < 1.0 && abs(perp) < 0.08 * (1.0 - abs(headT - 0.5) * 2.0);

        if (onShaft || onHead) {
            let arrowColor = mix(vec3f(1.0, 0.9, 0.2), vec3f(1.0, 0.2, 0.1), clamp(slopeLen * 3.0, 0.0, 1.0));
            return vec4f(arrowColor, 1.0);
        }
    }

    return vec4f(litColor, 1.0);
}
`;
