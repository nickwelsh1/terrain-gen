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
    rockType: u32,        // 0=Folded/Faulted Multi-Era Stratigraphy, 1=Granite/Quartzite+Veins, 2=Vertical Karst, 3=Columnar Basalt/Schist
    lowFloor: vec3f,
    midVeg: vec3f,
    upperSlope: vec3f,
    highSummit: vec3f,
    cliffDark: vec3f,
    cliffMid1: vec3f,
    cliffMid2: vec3f,
    cliffLight: vec3f,
    strataBasement: vec3f, // Deepest ancient Precambrian / basement / mudstone unit
    strataAccent1: vec3f,  // Mineral accent bed 1 (e.g. glauconitic sage-green shale / Cassian ochre)
    strataAccent2: vec3f,  // Mineral accent bed 2 (e.g. lavender-purple Chinle bentonite / haematite)
    strataAccent3: vec3f,  // Mineral accent bed 3 (e.g. mustard-gold / coral-peach sandstone)
    vegPatchDark: vec3f,   // Clumped forest / pinyon-juniper / eucalyptus canopy tone
    vegPatchLight: vec3f,  // Dry scrub / sagebrush / spinifex / alpine larch tone
    veinColor: vec3f,
    cliffScale: f32,
    foldStrength: f32,     // Intensity of multi-billion-year tectonic folding, tilting & faulting
    outcropExposure: f32,  // How strongly 3D strata bands show through on benches/plateaus in satellite view
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
        // Rotate each octave by ~37 deg so noise never aligns with horizontal/vertical grid axes
        q = vec2f(q.x * 1.62 - q.y * 1.22, q.x * 1.22 + q.y * 1.62) + vec2f(17.1, 31.7);
        a = a * 0.5;
    }
    return v;
}

// Contrast-normalized signed FBM spanning full [-1.0, +1.0] with octave rotation
fn sfbm2D(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.54;
    var q = p;
    for (var i: i32 = 0; i < 4; i = i + 1) {
        v = v + a * (noise2D(q) * 2.0 - 1.0);
        q = vec2f(q.x * 1.64 - q.y * 1.21, q.x * 1.21 + q.y * 1.64) + vec2f(23.7, 41.3);
        a = a * 0.52;
    }
    return clamp(v * 1.35, -1.0, 1.0);
}

// Returns vec3f(F1_dist, F2_minus_F1_edgeDist, cellIdHash) for rock fractures, faults & mineral veins
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
        // 1: Alpine & Himalayan (Winter Snow) — Fractured Leucogranite, Biotite Gneiss & Pegmatite Veins
        m.rockType = 1u;
        m.lowFloor = vec3f(0.68, 0.74, 0.82);
        m.midVeg = vec3f(0.80, 0.86, 0.93);
        m.upperSlope = vec3f(0.89, 0.93, 0.98);
        m.highSummit = vec3f(0.96, 0.98, 1.00);
        m.cliffDark = vec3f(0.16, 0.18, 0.23);     // Dark biotite-rich Tethyan gneiss
        m.cliffMid1 = vec3f(0.29, 0.32, 0.38);     // Grey Himalayan granite
        m.cliffMid2 = vec3f(0.45, 0.47, 0.52);     // Pale muscovite leucogranite
        m.cliffLight = vec3f(0.64, 0.68, 0.74);    // Frosted quartzite & snow ledges
        m.strataBasement = vec3f(0.12, 0.14, 0.18);
        m.strataAccent1 = vec3f(0.38, 0.35, 0.33); // Iron-stained metamorphic band
        m.strataAccent2 = vec3f(0.50, 0.44, 0.39); // Warm rusty gneiss foliation
        m.strataAccent3 = vec3f(0.74, 0.78, 0.84); // Rime-frosted rock band
        m.vegPatchDark = vec3f(0.18, 0.26, 0.22);  // Subalpine snow-dusted pine
        m.vegPatchLight = vec3f(0.55, 0.60, 0.66); // Cold boulder moraine
        m.veinColor = vec3f(0.90, 0.92, 0.96);     // Bright white quartz/pegmatite dike veins
        m.cliffScale = 1.0;
        m.foldStrength = 1.15;
        m.outcropExposure = 0.45;
        m.talusColor = vec3f(0.62, 0.68, 0.76);
        m.sandWindward = vec3f(0.90, 0.94, 0.98);
        m.sandLeeward = vec3f(0.76, 0.83, 0.92);
        m.sandMineral = vec3f(0.52, 0.59, 0.69);
        m.snowColor = vec3f(0.97, 0.98, 1.00);
        m.snowLineM = 120.0;
        m.waterShallow = vec3f(0.20, 0.46, 0.62);
        m.waterDeep = vec3f(0.05, 0.14, 0.28);
    } else if (paletteId == 2u) {
        // 2: Grand Canyon & Red Rock (2-Billion-Year Stratigraphy: Vishnu Schist -> Unkar -> Bright Angel -> Redwall -> Supai -> Hermit -> Coconino -> Kaibab)
        m.rockType = 0u;
        m.lowFloor = vec3f(0.64, 0.45, 0.32);      // Alluvial red-sandy canyon wash & travertine
        m.midVeg = vec3f(0.52, 0.45, 0.33);        // Arid Tonto platform sage & desert pediment
        m.upperSlope = vec3f(0.74, 0.41, 0.25);    // Vermilion Supai / Wingate slope
        m.highSummit = vec3f(0.84, 0.71, 0.54);    // Pale buff Kaibab / Coconino plateau rim
        m.strataBasement = vec3f(0.23, 0.18, 0.22);// Deep charcoal-violet Precambrian Vishnu Schist & Zoroaster Granite
        m.cliffDark = vec3f(0.46, 0.15, 0.12);     // Deep oxblood-maroon Hermit Shale & Hakatai redbeds
        m.strataAccent1 = vec3f(0.48, 0.53, 0.39); // Celadon / glauconitic sage-green Bright Angel & Morrison Shale!
        m.strataAccent2 = vec3f(0.58, 0.41, 0.49); // Dusty lavender-mauve & plum Chinle / Unkar bentonitic mudstone!
        m.cliffMid1 = vec3f(0.75, 0.29, 0.17);     // Fiery vermilion-terracotta Redwall & Supai sandstone
        m.cliffMid2 = vec3f(0.85, 0.48, 0.27);     // Glowing Navajo salmon-apricot cross-bedded sandstone
        m.strataAccent3 = vec3f(0.84, 0.63, 0.33); // Warm mustard-ochre & limonite gold Toroweap / Kayenta bed!
        m.cliffLight = vec3f(0.92, 0.83, 0.67);    // Bleached ivory-cream Coconino & Kaibab limestone caprock
        m.vegPatchDark = vec3f(0.22, 0.32, 0.17);  // Clumped Pinyon-Juniper & Ponderosa pine dark olive-green
        m.vegPatchLight = vec3f(0.46, 0.51, 0.36); // Desert sagebrush, rabbitbrush & blackbrush scrub
        m.veinColor = vec3f(0.94, 0.87, 0.74);     // Calcite & gypsum fracture infill
        m.cliffScale = 1.05;
        m.foldStrength = 1.35;
        m.outcropExposure = 0.78;
        m.talusColor = vec3f(0.66, 0.36, 0.23);
        m.sandWindward = vec3f(0.86, 0.58, 0.38);
        m.sandLeeward = vec3f(0.66, 0.39, 0.24);
        m.sandMineral = vec3f(0.45, 0.30, 0.23);
        m.snowColor = vec3f(0.93, 0.84, 0.70);
        m.snowLineM = 2050.0;
        m.waterShallow = vec3f(0.34, 0.52, 0.42);
        m.waterDeep = vec3f(0.12, 0.27, 0.24);
    } else if (paletteId == 10u) {
        // 10: Bryce Canyon & Painted Desert — Claron Pink Cliffs, White Limestone Hoodoos & Chinle Lavender Badlands
        m.rockType = 0u;
        m.lowFloor = vec3f(0.72, 0.54, 0.48);      // Pinkish-ochre calcareous wash & badland floor
        m.midVeg = vec3f(0.62, 0.48, 0.44);        // Rose-tan weathered marl & sparse manzanita
        m.upperSlope = vec3f(0.86, 0.52, 0.38);    // Glowing coral-salmon hoodoo amphitheater slope
        m.highSummit = vec3f(0.92, 0.84, 0.74);    // Cream-white Claron dolomitic caprock & Ponderosa rim
        m.strataBasement = vec3f(0.39, 0.23, 0.32);// Deep plum-purple & chocolate Chinle / Kaiparowits mudstone
        m.cliffDark = vec3f(0.62, 0.20, 0.21);     // Rich crimson-magenta ironstone & maroon siltstone
        m.strataAccent1 = vec3f(0.66, 0.56, 0.65); // Lilac-lavender & ash-grey Painted Desert bentonite clay!
        m.strataAccent2 = vec3f(0.87, 0.65, 0.31); // Brilliant mustard-ochre & golden limonite sandstone bed!
        m.cliffMid1 = vec3f(0.86, 0.37, 0.24);     // Vibrant tangerine-vermilion Bryce hoodoo cliff
        m.cliffMid2 = vec3f(0.92, 0.58, 0.47);     // Flamingo-pink & rose-coral Claron limestone
        m.strataAccent3 = vec3f(0.95, 0.74, 0.57); // Warm peach-apricot calcareous siltstone
        m.cliffLight = vec3f(0.97, 0.93, 0.86);    // Stark chalk-white & ivory dolomitic hoodoo caprock
        m.vegPatchDark = vec3f(0.17, 0.33, 0.16);  // Deep emerald Ponderosa pine & Douglas-fir groves
        m.vegPatchLight = vec3f(0.42, 0.52, 0.32); // Green-leaf manzanita & Utah juniper scrub
        m.veinColor = vec3f(0.98, 0.95, 0.90);     // White carbonate joint seams
        m.cliffScale = 1.35;
        m.foldStrength = 1.45;
        m.outcropExposure = 0.88;
        m.talusColor = vec3f(0.84, 0.50, 0.38);
        m.sandWindward = vec3f(0.90, 0.64, 0.48);
        m.sandLeeward = vec3f(0.74, 0.44, 0.34);
        m.sandMineral = vec3f(0.56, 0.38, 0.42);
        m.snowColor = vec3f(0.98, 0.96, 0.94);
        m.snowLineM = 2100.0;
        m.waterShallow = vec3f(0.32, 0.56, 0.52);
        m.waterDeep = vec3f(0.12, 0.28, 0.30);
    } else if (paletteId == 3u) {
        // 3: Zhangjiajie Karst (Lush Summer) — Water-Streaked Devonian Quartz-Sandstone & Subtropical Canopy
        m.rockType = 2u;
        m.lowFloor = vec3f(0.14, 0.29, 0.13);      // Deep subtropical ravine forest
        m.midVeg = vec3f(0.20, 0.42, 0.17);        // Lush emerald canopy
        m.upperSlope = vec3f(0.29, 0.50, 0.21);    // Subtropical pine & fern slope
        m.highSummit = vec3f(0.22, 0.45, 0.17);    // Vegetated pillar top crowns
        m.strataBasement = vec3f(0.19, 0.17, 0.16);
        m.cliffDark = vec3f(0.25, 0.22, 0.20);     // Dark manganese & lichen water-drip streaks
        m.cliffMid1 = vec3f(0.48, 0.41, 0.35);     // Weathered grey-tan quartz sandstone
        m.cliffMid2 = vec3f(0.66, 0.53, 0.41);     // Warm buff/ochre iron-stained rock face
        m.cliffLight = vec3f(0.80, 0.70, 0.57);    // Sunlit pale pinkish-cream quartz sandstone ribs
        m.strataAccent1 = vec3f(0.58, 0.36, 0.28); // Devonian reddish-purple haematite sandstone bed
        m.strataAccent2 = vec3f(0.38, 0.44, 0.32); // Moss-tinted damp rock ledge
        m.strataAccent3 = vec3f(0.74, 0.60, 0.44); // Golden-amber sandstone stratum
        m.vegPatchDark = vec3f(0.11, 0.25, 0.10);  // Dense old-growth ravine canopy
        m.vegPatchLight = vec3f(0.34, 0.55, 0.24); // Sunlit bamboo & fern clearings
        m.veinColor = vec3f(0.21, 0.44, 0.16);     // Clinging emerald moss & Wuling pines in joint crevices
        m.cliffScale = 1.25;
        m.foldStrength = 1.1;
        m.outcropExposure = 0.35;
        m.talusColor = vec3f(0.28, 0.37, 0.23);
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
        m.lowFloor = vec3f(0.48, 0.54, 0.61);
        m.midVeg = vec3f(0.68, 0.74, 0.81);
        m.upperSlope = vec3f(0.85, 0.90, 0.96);
        m.highSummit = vec3f(0.95, 0.97, 1.00);
        m.strataBasement = vec3f(0.18, 0.19, 0.24);
        m.cliffDark = vec3f(0.23, 0.24, 0.29);     // Wet dark charcoal pillar shaft
        m.cliffMid1 = vec3f(0.38, 0.40, 0.46);     // Cold slate-taupe quartzite
        m.cliffMid2 = vec3f(0.54, 0.55, 0.61);     // Pale grey sandstone face
        m.cliffLight = vec3f(0.75, 0.79, 0.85);    // Frosted rock ribs
        m.strataAccent1 = vec3f(0.46, 0.41, 0.43); // Muted plum-slate quartzite band
        m.strataAccent2 = vec3f(0.58, 0.54, 0.49); // Warm taupe sandstone bed
        m.strataAccent3 = vec3f(0.84, 0.88, 0.93); // Hoarfrost-coated ledge
        m.vegPatchDark = vec3f(0.26, 0.34, 0.32);  // Frosted dark evergreen pines
        m.vegPatchLight = vec3f(0.78, 0.83, 0.89); // Rime-covered branches
        m.veinColor = vec3f(0.94, 0.97, 1.00);     // White rime-ice & snow packed into cliff fractures
        m.cliffScale = 1.25;
        m.foldStrength = 1.1;
        m.outcropExposure = 0.40;
        m.talusColor = vec3f(0.66, 0.71, 0.78);
        m.sandWindward = vec3f(0.86, 0.90, 0.95);
        m.sandLeeward = vec3f(0.72, 0.77, 0.84);
        m.sandMineral = vec3f(0.50, 0.55, 0.62);
        m.snowColor = vec3f(0.96, 0.98, 1.00);
        m.snowLineM = 280.0;
        m.waterShallow = vec3f(0.28, 0.48, 0.58);
        m.waterDeep = vec3f(0.10, 0.20, 0.30);
    } else if (paletteId == 5u) {
        // 5: Tropical Island & Guiana Tepui — 2-Billion-Year Roraima Orthoquartzite, Rose Jasper & Black Algae Crust
        m.rockType = 0u;
        m.lowFloor = vec3f(0.76, 0.69, 0.50);      // Gran Sabana golden savanna / coral sand margin
        m.midVeg = vec3f(0.15, 0.38, 0.15);        // Dense lowland Amazonian rainforest
        m.upperSlope = vec3f(0.22, 0.46, 0.19);    // Cloud-forest highland talus slope
        m.highSummit = vec3f(0.28, 0.26, 0.28);    // Dark algal-patinated Precambrian Roraima summit labyrinth
        m.strataBasement = vec3f(0.18, 0.15, 0.17);// Black-charcoal silica & cyanobacteria crust
        m.cliffDark = vec3f(0.26, 0.19, 0.21);     // Dark purple-umber wet quartzite
        m.cliffMid1 = vec3f(0.48, 0.31, 0.29);     // Deep rose-umber Roraima quartzite
        m.cliffMid2 = vec3f(0.68, 0.45, 0.38);     // Warm salmon-pink orthoquartzite cliff
        m.cliffLight = vec3f(0.86, 0.71, 0.61);    // Freshly fractured pale rose-gold cliff scars
        m.strataAccent1 = vec3f(0.58, 0.24, 0.22); // Crimson jasper & ironstone bed (Quebrada de Jaspe)
        m.strataAccent2 = vec3f(0.76, 0.56, 0.38); // Golden-ochre arkosic sandstone bed
        m.strataAccent3 = vec3f(0.34, 0.42, 0.26); // Hanging bromeliad & cloud-moss ledge
        m.vegPatchDark = vec3f(0.09, 0.26, 0.10);  // Deep emerald jungle canopy
        m.vegPatchLight = vec3f(0.38, 0.54, 0.22); // Gran Sabana moriche palm & savanna grass
        m.veinColor = vec3f(0.92, 0.80, 0.70);     // Hydrothermal quartz crystal fracture veins
        m.cliffScale = 1.0;
        m.foldStrength = 1.05;
        m.outcropExposure = 0.55;
        m.talusColor = vec3f(0.24, 0.40, 0.19);
        m.sandWindward = vec3f(0.86, 0.78, 0.58);
        m.sandLeeward = vec3f(0.70, 0.62, 0.44);
        m.sandMineral = vec3f(0.45, 0.42, 0.35);
        m.snowColor = vec3f(0.36, 0.32, 0.34);
        m.snowLineM = 2400.0;
        m.waterShallow = vec3f(0.12, 0.68, 0.66);
        m.waterDeep = vec3f(0.03, 0.22, 0.38);
    } else if (paletteId == 6u) {
        // 6: Golden Sahara & Sudan Dunes — Multi-Tone Erg Sand, Reg Gravel & Nubian Sandstone Outcrops
        m.rockType = 0u;
        m.lowFloor = vec3f(0.42, 0.37, 0.31);      // Dark basalt/gravel reg interdune corridor
        m.midVeg = vec3f(0.76, 0.62, 0.42);        // Pale golden plinth sand
        m.upperSlope = vec3f(0.88, 0.72, 0.47);    // Warm amber stoss dune slope
        m.highSummit = vec3f(0.95, 0.82, 0.57);    // Sun-bleached crest sand
        m.strataBasement = vec3f(0.24, 0.20, 0.18);// Black desert-varnished Nubian basement
        m.cliffDark = vec3f(0.36, 0.26, 0.20);     // Dark ferruginous Nubian sandstone
        m.cliffMid1 = vec3f(0.56, 0.42, 0.30);     // Weathered ochre-brown desert rock
        m.cliffMid2 = vec3f(0.72, 0.55, 0.39);     // Warm golden sandstone bed
        m.cliffLight = vec3f(0.86, 0.74, 0.56);    // Wind-abraded cream caliche rib
        m.strataAccent1 = vec3f(0.62, 0.36, 0.26); // Reddish iron-oxide desert bed
        m.strataAccent2 = vec3f(0.48, 0.44, 0.38); // Grey-taupe siltstone layer
        m.strataAccent3 = vec3f(0.82, 0.66, 0.44); // Buff aeolianite layer
        m.vegPatchDark = vec3f(0.36, 0.33, 0.26);  // Coarse dark desert pavement (hamada)
        m.vegPatchLight = vec3f(0.82, 0.74, 0.58); // Evaporite gypsum/salt crust patches
        m.veinColor = vec3f(0.88, 0.76, 0.58);     // Wind-blown sand in rock joints
        m.cliffScale = 1.1;
        m.foldStrength = 1.2;
        m.outcropExposure = 0.50;
        m.talusColor = vec3f(0.72, 0.58, 0.39);
        m.sandWindward = vec3f(0.91, 0.76, 0.51);
        m.sandLeeward = vec3f(0.71, 0.53, 0.33);
        m.sandMineral = vec3f(0.50, 0.41, 0.31);
        m.snowColor = vec3f(0.95, 0.83, 0.60);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.18, 0.58, 0.54);
        m.waterDeep = vec3f(0.06, 0.26, 0.30);
    } else if (paletteId == 7u) {
        // 7: Namib Red Oxide Dunes & Salt Pans — Bleached Clay Vlei, Golden Plinths, Magnetite Streaks & Terracotta Crests
        m.rockType = 3u;
        m.lowFloor = vec3f(0.84, 0.81, 0.73);      // Sun-bleached white/cream Deadvlei clay pan
        m.midVeg = vec3f(0.78, 0.58, 0.38);        // Golden-apricot lower dune apron & dry grass
        m.upperSlope = vec3f(0.86, 0.46, 0.26);    // Warm terracotta-orange mid dune
        m.highSummit = vec3f(0.92, 0.41, 0.21);    // Oxidized iron-rich star-dune peak
        m.strataBasement = vec3f(0.20, 0.18, 0.19);
        m.cliffDark = vec3f(0.26, 0.22, 0.22);     // Dark Damara schist bedrock
        m.cliffMid1 = vec3f(0.45, 0.34, 0.29);     // Weathered grey-brown gneiss
        m.cliffMid2 = vec3f(0.64, 0.45, 0.34);     // Quartz-feldspar rock
        m.cliffLight = vec3f(0.80, 0.64, 0.48);    // Calcrete crust
        m.strataAccent1 = vec3f(0.58, 0.32, 0.24); // Tsondab red sandstone
        m.strataAccent2 = vec3f(0.38, 0.36, 0.39); // Blue-grey dolomite marble
        m.strataAccent3 = vec3f(0.76, 0.56, 0.36); // Golden caliche
        m.vegPatchDark = vec3f(0.36, 0.38, 0.24);  // Camelthorn acacia & nara bush clumps
        m.vegPatchLight = vec3f(0.82, 0.72, 0.48); // Golden Bushman grass tufts
        m.veinColor = vec3f(0.88, 0.78, 0.65);     // White quartz veins in schist
        m.cliffScale = 1.1;
        m.foldStrength = 1.25;
        m.outcropExposure = 0.45;
        m.talusColor = vec3f(0.76, 0.52, 0.34);
        m.sandWindward = vec3f(0.89, 0.52, 0.30);
        m.sandLeeward = vec3f(0.64, 0.28, 0.16);
        m.sandMineral = vec3f(0.40, 0.24, 0.20);   // Dark heavy-mineral magnetite & garnet streaks
        m.snowColor = vec3f(0.93, 0.56, 0.34);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.22, 0.52, 0.56);
        m.waterDeep = vec3f(0.06, 0.18, 0.32);
    } else if (paletteId == 8u) {
        // 8: Australian Outback (Purnululu & Flinders Ranges) — Folded Quartzite, Tiger-Striped Sandstone & Spinifex
        m.rockType = 0u;
        m.lowFloor = vec3f(0.58, 0.35, 0.22);      // Red-ochre Outback creek bed & plain
        m.midVeg = vec3f(0.46, 0.47, 0.27);        // Spinifex & eucalyptus olive-sage bush
        m.upperSlope = vec3f(0.74, 0.43, 0.24);    // Ochre quartzite/sandstone slope
        m.highSummit = vec3f(0.82, 0.58, 0.38);    // Weathered sandstone dome & cuesta crown
        m.strataBasement = vec3f(0.18, 0.17, 0.19);// Dark charcoal cyanobacterial silica band
        m.cliffDark = vec3f(0.32, 0.20, 0.18);     // Deep ironstone & manganese band
        m.strataAccent1 = vec3f(0.49, 0.27, 0.31); // Flinders Ranges purple-maroon Bunyeroo shale & quartzite!
        m.strataAccent2 = vec3f(0.64, 0.56, 0.38); // Olive-buff Brachina siltstone bed!
        m.cliffMid1 = vec3f(0.62, 0.33, 0.20);     // Deep rust-sienna ferruginous bed
        m.cliffMid2 = vec3f(0.86, 0.47, 0.20);     // Vibrant tiger-orange Purnululu sandstone bed
        m.strataAccent3 = vec3f(0.88, 0.64, 0.32); // Golden yellow-ochre Outback sandstone
        m.cliffLight = vec3f(0.92, 0.76, 0.54);    // Pale leached cream Rawnsley quartzite rib
        m.vegPatchDark = vec3f(0.22, 0.31, 0.18);  // River red gum & Callitris pine creek lines
        m.vegPatchLight = vec3f(0.54, 0.56, 0.32); // Golden-green Triodia spinifex hummocks
        m.veinColor = vec3f(0.24, 0.21, 0.20);     // Dark joint fissures
        m.cliffScale = 1.55;
        m.foldStrength = 1.40;
        m.outcropExposure = 0.76;
        m.talusColor = vec3f(0.64, 0.38, 0.23);
        m.sandWindward = vec3f(0.78, 0.48, 0.28);
        m.sandLeeward = vec3f(0.60, 0.34, 0.19);
        m.sandMineral = vec3f(0.42, 0.36, 0.24);
        m.snowColor = vec3f(0.86, 0.62, 0.42);
        m.snowLineM = 2500.0;
        m.waterShallow = vec3f(0.32, 0.48, 0.36);
        m.waterDeep = vec3f(0.12, 0.24, 0.20);
    } else if (paletteId == 9u) {
        // 9: Subpolar Basalt & Glaciers (Iceland / Fjords) — Columnar Flood Basalt, Palagonite Tuff & Rhyolite
        m.rockType = 3u;
        m.lowFloor = vec3f(0.15, 0.16, 0.18);      // Black volcanic basalt outwash sand (sandur)
        m.midVeg = vec3f(0.36, 0.48, 0.20);        // Bright subpolar Racomitrium moss tundra
        m.upperSlope = vec3f(0.29, 0.31, 0.34);    // Dark basaltic tableland
        m.highSummit = vec3f(0.88, 0.94, 0.99);    // Vatnajokull-style ice cap
        m.strataBasement = vec3f(0.10, 0.11, 0.13);
        m.cliffDark = vec3f(0.14, 0.15, 0.17);     // Deep black columnar basalt
        m.cliffMid1 = vec3f(0.25, 0.27, 0.30);     // Charcoal flood basalt
        m.cliffMid2 = vec3f(0.38, 0.40, 0.44);     // Grey andesite/hyaloclastite tuff
        m.cliffLight = vec3f(0.58, 0.50, 0.38);    // Palagonite ochre-brown weathering rind
        m.strataAccent1 = vec3f(0.68, 0.46, 0.34); // Landmannalaugar rhyolite caramel-orange band
        m.strataAccent2 = vec3f(0.36, 0.48, 0.44); // Hydrothermal celadon-green altered obsidian/tuff
        m.strataAccent3 = vec3f(0.52, 0.32, 0.30); // Oxidized red scoria tephra interbed
        m.vegPatchDark = vec3f(0.22, 0.32, 0.14);  // Dwarf birch & crowberry heath
        m.vegPatchLight = vec3f(0.48, 0.58, 0.24); // Luminous chartreuse moss cushions
        m.veinColor = vec3f(0.76, 0.82, 0.88);     // Ice/zeolite-filled cooling fractures
        m.cliffScale = 1.2;
        m.foldStrength = 1.1;
        m.outcropExposure = 0.55;
        m.talusColor = vec3f(0.22, 0.23, 0.26);
        m.sandWindward = vec3f(0.22, 0.23, 0.25);
        m.sandLeeward = vec3f(0.15, 0.16, 0.18);
        m.sandMineral = vec3f(0.32, 0.38, 0.22);
        m.snowColor = vec3f(0.90, 0.96, 1.00);
        m.snowLineM = 620.0;
        m.waterShallow = vec3f(0.18, 0.50, 0.64);
        m.waterDeep = vec3f(0.04, 0.14, 0.26);
    } else {
        // 0: Alpine Dolomites (Summer — Default) — Folded Triassic Reef Carbonates, Raibl Marl, Cassian Ochre & Enrosadira
        m.rockType = 0u;
        m.lowFloor = vec3f(0.20, 0.34, 0.16);      // Deep spruce & fir valley forest
        m.midVeg = vec3f(0.32, 0.49, 0.22);        // Bright alpine pasture (Alpe di Siusi)
        m.upperSlope = vec3f(0.58, 0.54, 0.49);    // Dolomitic limestone & scree bench
        m.highSummit = vec3f(0.80, 0.75, 0.70);    // Pale pinkish-ivory Dolomite massif
        m.strataBasement = vec3f(0.26, 0.24, 0.25);// Dark Permian/Wengen volcanic-marl basement
        m.cliffDark = vec3f(0.33, 0.30, 0.29);     // Dark Raibl bituminous marl seams & wet streaks
        m.strataAccent1 = vec3f(0.66, 0.45, 0.35); // Reddish-ochre San Cassian & Raibl ferruginous beds!
        m.strataAccent2 = vec3f(0.52, 0.55, 0.58); // Cool silver-blue Buchenstein nodular limestone!
        m.cliffMid1 = vec3f(0.57, 0.53, 0.49);     // Weathered grey carbonate rock
        m.cliffMid2 = vec3f(0.78, 0.67, 0.60);     // Warm enrosadira rose-coral Schlern/Dachstein dolomite
        m.strataAccent3 = vec3f(0.83, 0.74, 0.63); // Buff-amber dolomitic calcarenite
        m.cliffLight = vec3f(0.90, 0.86, 0.81);    // Bright bleached reef limestone
        m.vegPatchDark = vec3f(0.14, 0.25, 0.12);  // Dense dark mugo pine & Norway spruce clumps
        m.vegPatchLight = vec3f(0.64, 0.52, 0.24); // Golden-amber alpine larch & dry meadow patches
        m.veinColor = vec3f(0.25, 0.23, 0.22);     // Deep vertical chimney fissures
        m.cliffScale = 0.90;
        m.foldStrength = 1.25;
        m.outcropExposure = 0.62;
        m.talusColor = vec3f(0.70, 0.66, 0.61);
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

// Selects a rich mineral bed color from the 8-formation stratigraphic column
// using non-repeating prime hashes of the bed index, lateral facies shifts, and micro-laminae.
fn sampleStratigraphicColumn(
    mat: BiomeMaterial,
    stratCoord: f32,
    lateralFacies: f32,
    unconformityMask: f32
) -> vec3f {
    // Non-linear cumulative bed mapping: stretches some intervals into thick 80-130m massive cliffs
    // and compresses others into rapid 4-12m interbedded shale/limestone ledges!
    let thicknessMod = sfbm2D(vec2f(stratCoord * 0.23 + 3.7, lateralFacies * 0.45));
    let nonLinearPhase = stratCoord
                       + sin(stratCoord * 0.52 + lateralFacies * 1.8) * 0.95
                       + sin(stratCoord * 1.37 - lateralFacies * 2.3) * 0.52
                       + thicknessMod * 1.45;

    let bedIdx = floor(nonLinearPhase);
    let bedFrac = fract(nonLinearPhase);
    // Variable transition sharpness per bed boundary (some gradational, some knife-sharp unconformities)
    let edgeSharp = 0.08 + 0.28 * hash21(vec2f(bedIdx * 1.91, 5.3));
    let blendNext = smoothstep(0.5 - edgeSharp, 0.5 + edgeSharp, bedFrac);

    // Deterministic mineral selector for bedIdx and bedIdx + 1
    let hA = fract(hash21(vec2f(bedIdx * 1.73 + 0.5, 11.3)) + lateralFacies * 0.18);
    let hB = fract(hash21(vec2f((bedIdx + 1.0) * 1.73 + 0.5, 11.3)) + lateralFacies * 0.18);

    // Map hash [0..1] across the 8 distinct geological formations
    var colA = mat.cliffMid1;
    if (hA < 0.13) { colA = mat.strataBasement; }
    else if (hA < 0.26) { colA = mat.cliffDark; }
    else if (hA < 0.39) { colA = mat.strataAccent1; }
    else if (hA < 0.52) { colA = mat.cliffMid1; }
    else if (hA < 0.65) { colA = mat.strataAccent2; }
    else if (hA < 0.78) { colA = mat.cliffMid2; }
    else if (hA < 0.90) { colA = mat.strataAccent3; }
    else { colA = mat.cliffLight; }

    var colB = mat.cliffMid2;
    if (hB < 0.13) { colB = mat.strataBasement; }
    else if (hB < 0.26) { colB = mat.cliffDark; }
    else if (hB < 0.39) { colB = mat.strataAccent1; }
    else if (hB < 0.52) { colB = mat.cliffMid1; }
    else if (hB < 0.65) { colB = mat.strataAccent2; }
    else if (hB < 0.78) { colB = mat.cliffMid2; }
    else if (hB < 0.90) { colB = mat.strataAccent3; }
    else { colB = mat.cliffLight; }

    var bedCol = mix(colA, colB, blendNext);

    // Sub-bed interbedding & fine varve laminae (thin contrasting limestone/shale/ironstone seams)
    let subPhase = nonLinearPhase * 3.7 + sin(nonLinearPhase * 2.1 + lateralFacies * 3.0) * 0.65;
    let microHash = noise2D(vec2f(subPhase * 1.8, bedIdx * 0.7 + lateralFacies * 1.4));
    let thinLedge = 1.0 - smoothstep(0.0, 0.11, abs(fract(subPhase) - 0.5));
    let isLightSeam = step(0.52, hash21(vec2f(floor(subPhase) * 2.3, 17.9)));
    let seamColor = select(mat.cliffDark * 0.82, mat.cliffLight, isLightSeam > 0.5);
    bedCol = mix(bedCol, seamColor, thinLedge * 0.58);
    bedCol = bedCol * (0.86 + 0.28 * microHash);

    // Bias ancient beds below the Great Unconformity toward darker metamorphic basement & tilted redbeds
    let basementTint = mix(mat.strataBasement, mat.cliffDark, noise2D(vec2f(stratCoord * 2.4, lateralFacies * 3.1)));
    bedCol = mix(bedCol, basementTint, unconformityMask * 0.62);

    return bedCol;
}

// Evaluates rich, non-uniform cliff & outcrop rock texture according to mat.rockType:
// - 0u: Multi-billion-year folded, tilted, faulted & cross-bedded 8-color stratigraphy + angular unconformity
// - 1u: Mottled crystalline granite/gneiss/quartzite + folded gneissic banding & pegmatite veins
// - 2u: Vertical water-streaked karst shafts + uneven wavy Devonian beds + moss/frost ledges
// - 3u: Columnar volcanic basalt/schist + rhyolite/palagonite bands & dike intrusions
fn evaluateCliffTexture(mat: BiomeMaterial, uv: vec2f, heightM: f32, normal: vec3f, curvature01: f32) -> vec3f {
    let worldXY = uv * 18.0 * mat.cliffScale;
    let hCoord = heightM * 0.045 * mat.cliffScale;

    if (mat.rockType == 1u) {
        // TYPE 1: Igneous Granite / Folded Metamorphic Gneiss / Quartzite
        let foldWarp = vec2f(
            sfbm2D(uv * 2.6 + vec2f(4.1, 8.3)),
            sfbm2D(uv * 2.6 + vec2f(15.7, 2.9))
        ) * 1.4;
        let gneissFlow = sfbm2D(worldXY * 0.95 + foldWarp + vec2f(hCoord * 0.85, -hCoord * 0.65));
        let grainCoarse = fbm2D(worldXY * 1.5 + foldWarp * 0.7 + vec2f(hCoord * 0.7, -hCoord * 0.5));
        let grainFine = noise2D(worldXY * 8.5 + vec2f(hCoord * 2.3, hCoord * 1.7));

        var rockCol = mix(mat.strataBasement, mat.cliffDark, smoothstep(-0.6, 0.1, gneissFlow));
        rockCol = mix(rockCol, mat.cliffMid1, smoothstep(0.20, 0.52, grainCoarse));
        rockCol = mix(rockCol, mat.strataAccent1, smoothstep(0.15, 0.65, gneissFlow) * 0.55);
        rockCol = mix(rockCol, mat.cliffMid2, smoothstep(0.46, 0.74, grainCoarse * 0.7 + grainFine * 0.3));
        rockCol = mix(rockCol, mat.strataAccent2, smoothstep(-0.2, 0.4, sfbm2D(worldXY * 2.2 + hCoord)) * 0.45);
        rockCol = mix(rockCol, mat.cliffLight, smoothstep(0.66, 0.88, grainFine));

        // Uneven diagonal conjugate fracture planes & ductile shear zones
        let diagCoord1 = vec2f(worldXY.x * 0.85 + hCoord * 1.35, worldXY.y * 0.85 - hCoord * 1.1) + foldWarp * 0.65;
        let diagCoord2 = vec2f(worldXY.x * 1.4 - hCoord * 1.6, worldXY.y * 1.4 + hCoord * 0.9) - foldWarp * 0.55;

        let crack1 = voronoiCrack(diagCoord1 * 1.3);
        let crack2 = voronoiCrack(diagCoord2 * 2.1 + vec2f(19.3, 7.1));

        let darkFissure = (1.0 - smoothstep(0.01, 0.065, crack1.y)) * 0.75
                        + (1.0 - smoothstep(0.01, 0.055, crack2.y)) * 0.5;
        rockCol = mix(rockCol, mat.cliffDark * 0.6, clamp(darkFissure, 0.0, 0.85));

        let veinSelect1 = step(0.42, crack1.z) * (1.0 - smoothstep(0.0, 0.048, crack1.y));
        let veinSelect2 = step(0.55, crack2.z) * (1.0 - smoothstep(0.0, 0.040, crack2.y));
        let veinMask = clamp(veinSelect1 + veinSelect2 * 0.8, 0.0, 1.0);
        rockCol = mix(rockCol, mat.veinColor, veinMask * 0.88);

        return rockCol;
    } else if (mat.rockType == 2u) {
        // TYPE 2: Vertical Water-Streaked Karst & Wavy Devonian Quartz-Sandstone (Zhangjiajie)
        let angleAround = atan2(normal.z, normal.x);
        let horizCoord = (uv.x * 14.0 + uv.y * 14.0 + angleAround * 1.5) * mat.cliffScale;
        let streakNoise = fbm2D(vec2f(horizCoord * 3.2, hCoord * 0.22));
        let fineStreaks = noise2D(vec2f(horizCoord * 11.5, hCoord * 0.45));

        // Strongly wavy, folded Devonian sandstone beds
        let bedWarp = sfbm2D(worldXY * 0.85 + vec2f(3.1, 9.7)) * 4.2
                    + sfbm2D(worldXY * 2.3) * 1.6;
        let warpedH = hCoord * 0.65 + bedWarp;
        let lateralFacies = sfbm2D(worldXY * 0.6 + vec2f(11.0, 4.0));

        var rockCol = sampleStratigraphicColumn(mat, warpedH, lateralFacies, 0.0);
        rockCol = mix(rockCol, mat.cliffLight, smoothstep(0.62, 0.88, fineStreaks) * 0.45);

        // Dark vertical rainwater & manganese drip streaks in concave flutes
        let stainStrength = smoothstep(0.36, 0.72, streakNoise) * (1.25 - curvature01 * 0.65);
        rockCol = mix(rockCol, mat.cliffDark, clamp(stainStrength * 0.80, 0.0, 0.86));

        // Cross-cutting tectonic joint cracks filled with clinging emerald moss (Summer) or rime frost (Winter)
        let crackCoord = vec2f(horizCoord * 0.7 + bedWarp * 0.35, warpedH * 0.85);
        let vCrack = voronoiCrack(crackCoord);
        let ledgeMask = (1.0 - smoothstep(0.0, 0.065, vCrack.y)) * smoothstep(0.12, 0.65, normal.y + 0.38);
        rockCol = mix(rockCol, mat.veinColor, clamp(ledgeMask * 0.92, 0.0, 1.0));

        return rockCol;
    } else if (mat.rockType == 3u) {
        // TYPE 3: Columnar Basalt / Folded Damara Schist / Rhyolite & Palagonite Bands
        let colCoord = worldXY * 3.4;
        let vCol = voronoiCrack(colCoord);
        let colJoint = 1.0 - smoothstep(0.0, 0.08, vCol.y);

        let dikeWarp = sfbm2D(worldXY * 1.4) * 2.2;
        let vDike = voronoiCrack(vec2f(worldXY.x * 0.9 + hCoord * 1.3 + dikeWarp, worldXY.y * 0.9 - hCoord));
        let dikeMask = step(0.50, vDike.z) * (1.0 - smoothstep(0.0, 0.048, vDike.y));

        // Warped volcanic tephra / metamorphic schist bands
        let flowWave = hCoord * 0.55 + dikeWarp * 1.4 + sfbm2D(uv * 3.5) * 3.2;
        let patina = fbm2D(worldXY * 2.1 + vec2f(dikeWarp, hCoord * 0.7));
        var rockCol = sampleStratigraphicColumn(mat, flowWave, patina, 0.0);
        rockCol = mix(rockCol, mat.cliffDark, vCol.z * 0.35);
        rockCol = mix(rockCol, mat.cliffDark * 0.55, colJoint * 0.75);
        rockCol = mix(rockCol, mat.veinColor, dikeMask * 0.85);

        return rockCol;
    } else {
        // TYPE 0: Multi-Billion-Year Tectonic Folded, Tilted, Faulted & Cross-Bedded Stratigraphy
        // (Grand Canyon, Bryce Canyon, Painted Desert, Monument Valley, Dolomites, Purnululu)
        let foldStr = mat.foldStrength;

        // 1. Domain-warped tectonic strike & dip + plunging anticline/syncline fold waves
        let tectonicWarp = vec2f(
            sfbm2D(uv * 1.9 + vec2f(2.7, 6.1)),
            sfbm2D(uv * 1.9 + vec2f(13.4, 9.8))
        );
        let warpedUv = uv + tectonicWarp * 0.24 * foldStr;

        // Regional structural tilt (240m across tile) along a curved strike axis
        let regionalDipM = ((warpedUv.x - 0.5) * 235.0 + (warpedUv.y - 0.5) * 165.0) * foldStr;

        // Macro plunging anticline/syncline wave (±190m vertical excursion)
        let macroFoldM = sfbm2D(warpedUv * 2.15 + vec2f(5.1, 9.3)) * 190.0 * foldStr;

        // Meso asymmetric drag-folds & monoclinal flexures (±85m vertical wave, varying with 3D height)
        let mesoFoldM = sfbm2D(uv * 5.2 - tectonicWarp * 0.65 + vec2f(heightM * 0.0022, -heightM * 0.0019)) * 85.0 * foldStr;

        // Local cliff-face wavy slumping & differential compaction (±36m undulation)
        let localWaveM = sfbm2D(worldXY * 1.35 + vec2f(heightM * 0.009, -heightM * 0.007)) * 36.0;

        // 2. Tectonic fault blocks with discrete vertical throw offsets & drag-folding
        let faultCell = voronoiCrack(uv * 2.9 + tectonicWarp * 0.35);
        let faultDrag = smoothstep(0.0, 0.065, faultCell.y);
        let faultThrowM = (faultCell.z - 0.5) * 92.0 * foldStr * faultDrag;
        let onFaultLine = 1.0 - smoothstep(0.0, 0.026, faultCell.y);

        // 3. Angular Unconformity ("Great Unconformity"):
        // Below a wavy erosion surface (~260m), ancient Proterozoic/Archean beds tilt at a steep oblique angle!
        let unconfHorizonM = 250.0 + macroFoldM * 0.45 + sfbm2D(uv * 3.4 + vec2f(8.2, 1.9)) * 95.0;
        let unconfMask = 1.0 - smoothstep(unconfHorizonM - 40.0, unconfHorizonM + 40.0, heightM);
        let ancientSteepDipM = ((uv.x - uv.y) * 420.0 + sfbm2D(uv * 6.8 + vec2f(3.3, 7.7)) * 135.0) * unconfMask;

        // 4. Lateral facies pinch-outs & channel lenses (beds thicken/thin laterally)
        let lateralFacies = sfbm2D(vec2f(warpedUv.x * 3.1 - warpedUv.y * 2.4, heightM * 0.006))
                          + 0.45 * sfbm2D(worldXY * 0.75);

        let deformedElevM = heightM + regionalDipM + macroFoldM + mesoFoldM + localWaveM + faultThrowM + ancientSteepDipM;
        let stratCoord = deformedElevM * 0.021 * mat.cliffScale;

        // 5. Evaluate the 8-color non-periodic stratigraphic column
        var strataCol = sampleStratigraphicColumn(mat, stratCoord, lateralFacies, unconfMask);

        // 6. Aeolian cross-bedding foreset laminae inside thick sandstone units (Navajo / Coconino / Wingate style)
        let crossBedGate = smoothstep(0.15, 0.65, sfbm2D(vec2f(stratCoord * 0.8, 4.2)));
        let foresetAngle = (uv.x * 42.0 - uv.y * 28.0) * mat.cliffScale + heightM * 0.14 + localWaveM * 0.18;
        let foresetWave = sin(foresetAngle) * 0.5 + 0.5;
        strataCol = mix(strataCol, strataCol * (0.90 + 0.20 * foresetWave), crossBedGate * 0.55);

        // 7. Vertical desert-varnish manganese drip streaks & cross-cutting fault/joint fissures
        let varnishStreak = smoothstep(0.48, 0.82, fbm2D(vec2f((uv.x * 1.3 + uv.y) * 26.0 + localWaveM * 0.05, heightM * 0.007)));
        strataCol = mix(strataCol, mat.strataBasement, varnishStreak * 0.45 * (1.1 - curvature01 * 0.5));

        let vJoint = voronoiCrack(vec2f((uv.x - uv.y) * 15.0 + localWaveM * 0.08, deformedElevM * 0.014));
        let jointCrack = max(onFaultLine * 0.85, 1.0 - smoothstep(0.0, 0.038, vJoint.y));
        let filledCrack = step(0.62, vJoint.z) * jointCrack;
        strataCol = mix(strataCol, mat.strataBasement * 0.65, jointCrack * (1.0 - filledCrack) * 0.72);
        strataCol = mix(strataCol, mat.veinColor, filledCrack * 0.78);

        return strataCol;
    }
}

fn buildSlotMaterial(slotOffset: u32, paletteId: u32, useSlotOverrides: bool) -> BiomeMaterial {
    var mat = getMaterialPalette(paletteId % 11u);
    if (!useSlotOverrides) {
        return mat;
    }
    let sh = materials[slotOffset + 1u];
    let m2 = materials[slotOffset + 2u];
    mat.rockType = u32(clamp(sh.x, 0.0, 3.0));
    mat.cliffScale = max(sh.y, 0.1);
    mat.foldStrength = max(sh.z, 0.0);
    mat.outcropExposure = clamp(sh.w, 0.0, 1.0);
    mat.snowLineM = max(m2.x, 50.0);

    let c0 = materials[slotOffset + 5u].xyz;
    let c1 = materials[slotOffset + 6u].xyz;
    let c2 = materials[slotOffset + 7u].xyz;
    let c3 = materials[slotOffset + 8u].xyz;
    let c4 = materials[slotOffset + 9u].xyz;
    if (length(c0) + length(c1) + length(c2) > 0.05) {
        mat.lowFloor = c0;
        mat.midVeg = c1;
        mat.upperSlope = c2;
        mat.cliffMid1 = c3;
        mat.cliffMid2 = mix(c3, c4, 0.45);
        mat.cliffDark = c3 * 0.55;
        mat.cliffLight = mix(c3, vec3f(1.0), 0.35);
        mat.talusColor = mix(c2, c3, 0.5);
        mat.sandWindward = mix(c2, c4, 0.6);
        mat.sandLeeward = c2 * 0.82;
        mat.highSummit = c4;
    }
    return mat;
}

fn evaluateSlotMask(
    slotOffset: u32,
    uv: vec2f,
    heightM: f32,
    slope01: f32,
    curvature01: f32,
    ao01: f32,
    auxVal: vec4f
) -> f32 {
    let m2 = materials[slotOffset + 2u];
    let m3 = materials[slotOffset + 3u];
    let m4 = materials[slotOffset + 4u];

    let maskSource = u32(max(0.0, m2.z));
    let invertMask = u32(max(0.0, m2.w));
    let contrast = select(max(m3.x, 0.1), 1.0, m3.x <= 0.001);
    let bias = m3.y;
    let minAltM = m3.z;
    let maxAltM = m3.w;
    let maxSlopeDeg = m4.x;
    let curvatureBias = m4.y;
    let warpAmpM = m4.z;
    let warpFreq = max(m4.w, 0.25);

    let nWarp = fbm2D(uv * warpFreq * 4.0 + vec2f(13.0, 29.0)) - 0.5;
    let hWarped = heightM + nWarp * 2.0 * warpAmpM;
    let fAlt = 55.0;
    let altLow = smoothstep(minAltM - fAlt, minAltM + fAlt, hWarped);
    let altHigh = 1.0 - smoothstep(maxAltM - fAlt, maxAltM + fAlt, hWarped);
    let mAlt = altLow * altHigh;

    let slopeDeg = slope01 * 90.0;
    let mSlope = 1.0 - smoothstep(maxSlopeDeg - 8.0, maxSlopeDeg + 8.0, slopeDeg);

    let curvatureSigned = (curvature01 - 0.5) * 2.0;
    var mCurv = 1.0;
    if (abs(curvatureBias) > 0.01) {
        if (curvatureBias < 0.0) {
            let basin = smoothstep(-0.05, 0.35, -curvatureSigned);
            mCurv = mix(1.0, basin, clamp(-curvatureBias, 0.0, 1.0));
        } else {
            let ridge = smoothstep(-0.05, 0.35, curvatureSigned);
            mCurv = mix(1.0, ridge, clamp(curvatureBias, 0.0, 1.0));
        }
    }

    var mask = clamp(mAlt * mSlope * mCurv, 0.0, 1.0);
    if (maskSource == 1u) {
        let span = max(maxAltM - minAltM, 10.0);
        mask = clamp((hWarped - minAltM) / span, 0.0, 1.0);
    } else if (maskSource == 2u) {
        mask = clamp(slopeDeg / max(maxSlopeDeg, 5.0), 0.0, 1.0) * mAlt;
    } else if (maskSource == 3u) {
        mask = clamp(auxVal.z, 0.0, 1.0);
    } else if (maskSource == 4u) {
        mask = clamp(curvature01 * ao01, 0.0, 1.0) * mAlt;
    } else if (maskSource == 5u) {
        mask = clamp((auxVal.y + auxVal.x * 2.0) / 35.0, 0.0, 1.0) * mAlt;
    }

    mask = clamp((mask - 0.5) * contrast + 0.5 + bias, 0.0, 1.0);
    if (invertMask != 0u) {
        mask = 1.0 - mask;
    }
    return mask;
}

fn evaluateBiomeSurface(
    mat: BiomeMaterial,
    uv: vec2f,
    heightM: f32,
    normal: vec3f,
    slope01: f32,
    curvature01: f32,
    ao01: f32,
    auxVal: vec4f
) -> vec3f {
    let sedimentDepth = auxVal.y;
    let maskB = clamp(auxVal.w, 0.0, 1.0);

    let macroBiomeNoise = sfbm2D(uv * 4.2 + vec2f(3.7, 8.1));
    let mesoPatchNoise = sfbm2D(uv * 15.5 + vec2f(macroBiomeNoise * 1.4, -macroBiomeNoise * 1.1));
    let microGrain = noise2D(uv * 54.0) - 0.5;
    let aspectBias = (normal.z * 0.65 - normal.x * 0.35) * 95.0;
    let hPerturbed = heightM + macroBiomeNoise * 165.0 + mesoPatchNoise * 58.0 + microGrain * 24.0 + aspectBias;

    var color: vec3f;
    if (hPerturbed < 130.0) {
        color = mix(mat.lowFloor, mat.midVeg, clamp(hPerturbed / 130.0, 0.0, 1.0));
    } else if (hPerturbed < 520.0) {
        let t = (hPerturbed - 130.0) / 390.0;
        color = mix(mat.midVeg, mat.upperSlope, t);
    } else if (hPerturbed < mat.snowLineM) {
        let span = max(mat.snowLineM - 520.0, 100.0);
        let t = clamp((hPerturbed - 520.0) / span, 0.0, 1.0);
        color = mix(mat.upperSlope, mat.highSummit, t);
    } else {
        let t = clamp((hPerturbed - mat.snowLineM) / 420.0, 0.0, 1.0);
        let snowSlopeGate = 1.0 - smoothstep(0.32, 0.56, slope01);
        color = mix(mat.highSummit, mat.snowColor, clamp(0.38 + t * 0.62, 0.0, 1.0) * snowSlopeGate);
    }

    let cliffRock = evaluateCliffTexture(mat, uv, heightM, normal, curvature01);
    let steepCliffMask = smoothstep(0.18, 0.44, slope01);
    let convexOutcrop = clamp((curvature01 - 0.50) * 3.4, 0.0, 1.0);
    let benchPatch = smoothstep(-0.15, 0.55, mesoPatchNoise + macroBiomeNoise * 0.5);
    let benchOutcropMask = mat.outcropExposure
                         * (0.32 * benchPatch + 0.68 * convexOutcrop)
                         * smoothstep(45.0, 260.0, heightM)
                         * (1.0 - smoothstep(mat.snowLineM - 60.0, mat.snowLineM + 80.0, heightM));
    let rockBlend = clamp(max(steepCliffMask * 0.94, benchOutcropMask), 0.0, 0.95);
    color = mix(color, cliffRock, rockBlend);

    let gentleGate = (1.0 - smoothstep(0.20, 0.44, slope01))
                   * (1.0 - smoothstep(mat.snowLineM - 80.0, mat.snowLineM + 40.0, heightM));
    if (gentleGate > 0.01) {
        let valleyMoisture = clamp((0.50 - curvature01) * 3.8, 0.0, 1.0);
        let shadeMoisture = clamp(0.5 + 0.5 * (normal.z * 0.7 - normal.x * 0.4), 0.0, 1.0);
        let canopyNoise = noise2D(uv * 68.0 + vec2f(mesoPatchNoise * 2.0, macroBiomeNoise * 2.0)) * 0.62
                        + (mesoPatchNoise * 0.5 + 0.5) * 0.38;
        let darkCanopyMask = smoothstep(0.48 - valleyMoisture * 0.16, 0.74 - valleyMoisture * 0.12, canopyNoise)
                           * (0.45 + 0.55 * max(valleyMoisture, shadeMoisture));
        let lightScrubMask = smoothstep(0.32, 0.62, noise2D(uv * 42.0 + vec2f(7.3, 2.9)))
                           * (1.0 - darkCanopyMask * 0.7);

        color = mix(color, mat.vegPatchLight, lightScrubMask * gentleGate * 0.48);
        color = mix(color, mat.vegPatchDark, darkCanopyMask * gentleGate * 0.68);
    }

    color = color * (0.92 + 0.16 * (microGrain + 0.5));

    if (sedimentDepth > 0.15) {
        let sedWeight = clamp(sedimentDepth / 14.0, 0.0, 1.0);
        let plinthBlend = smoothstep(15.0, 140.0, heightM);
        let mineralStreak = smoothstep(0.42, 0.76, fbm2D(uv * 24.0 + vec2f(normal.x * 2.0, normal.z * 2.0)))
                          * (1.0 - maskB) * (1.0 - plinthBlend * 0.5);
        var warmSand = mix(mat.midVeg, mat.sandWindward, clamp(0.35 + plinthBlend * 0.65, 0.0, 1.0));
        warmSand = mix(warmSand, mat.sandMineral, mineralStreak * 0.68);
        warmSand = mix(warmSand, mat.sandLeeward, maskB * 0.74);
        let panGate = (1.0 - smoothstep(4.0, 22.0, sedimentDepth)) * (1.0 - smoothstep(0.0, 55.0, heightM)) * (1.0 - slope01 * 3.0);
        warmSand = mix(warmSand, mat.lowFloor, clamp(panGate, 0.0, 0.85));

        let parentStrataRock = evaluateCliffTexture(mat, uv, heightM + 68.0, normal, curvature01);
        let chuteAngle = atan2(normal.z, normal.x);
        let screeChutes = fbm2D(vec2f(chuteAngle * 16.0 + uv.x * 18.0, heightM * 0.025));
        let variegatedTalus = mix(mat.talusColor, parentStrataRock, 0.42 + 0.35 * screeChutes)
                            * (0.88 + 0.24 * screeChutes);

        let sedBiomeColor = select(
            mix(variegatedTalus, warmSand, clamp(1.0 - slope01 * 1.45, 0.0, 1.0)),
            mat.snowColor,
            heightM > mat.snowLineM
        );
        color = mix(color, sedBiomeColor, sedWeight * (1.0 - steepCliffMask * 0.68));
    }

    let ridgeCrest = clamp((curvature01 - 0.52) * 2.6, 0.0, 1.0);
    color = mix(color, color * 1.16, ridgeCrest * 0.5);
    return color;
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

    // Pure geometric Neutral Clay studio shade (zero procedural texture noise)
    let key = max(dot(normal, sunDir), 0.0);
    let skyFill = 0.5 + 0.5 * normal.y;
    let backRim = max(dot(normal, normalize(vec3f(-sunDir.x, 0.25, -sunDir.z))), 0.0);
    let cavity = clamp((0.5 - curvature01) * 1.5, 0.0, 1.0);
    let crest = clamp((curvature01 - 0.5) * 1.35, 0.0, 1.0);
    let clayLight = (vec3f(1.00, 0.98, 0.94) * key * 0.76
                   + vec3f(0.56, 0.62, 0.70) * skyFill * 0.28
                   + vec3f(0.66, 0.66, 0.68) * backRim * 0.10)
                   * mix(0.45, 1.0, ao01);
    let baseClayTone = vec3f(0.74, 0.72, 0.69) * (1.0 - cavity * 0.18 + crest * 0.08);
    var litColor = baseClayTone * clayLight;

    let mat1Header = materials[0u];
    let hasMatBuffer = (mat1Header.x > 0.5) || (materials[16u].x > 0.5);
    let activePalette1 = select(paletteId, u32(max(0.0, mat1Header.y)), hasMatBuffer);

    // Evaluate Material 1 if not in Neutral Clay (11u)
    if (activePalette1 != 11u) {
        let mat1 = buildSlotMaterial(0u, activePalette1, hasMatBuffer);
        let col1 = evaluateBiomeSurface(mat1, input.uv, input.height, normal, slope01, curvature01, ao01, auxVal);
        let mask1 = select(1.0, evaluateSlotMask(0u, input.uv, input.height, slope01, curvature01, ao01, auxVal) * clamp(mat1Header.z, 0.0, 1.0), hasMatBuffer);
        litColor = mix(litColor, col1 * light, mask1);
    }

    // Evaluate Material 2 overlay if enabled
    let mat2Header = materials[16u];
    if (mat2Header.x > 0.5) {
        let activePalette2 = u32(max(0.0, mat2Header.y));
        let mask2 = evaluateSlotMask(16u, input.uv, input.height, slope01, curvature01, ao01, auxVal) * clamp(mat2Header.z, 0.0, 1.0);
        if (mask2 > 0.001) {
            if (activePalette2 == 11u) {
                let c2 = materials[23u].xyz * (1.0 - cavity * 0.18 + crest * 0.08) * clayLight;
                litColor = mix(litColor, c2, mask2);
            } else {
                let mat2 = buildSlotMaterial(16u, activePalette2, true);
                let col2 = evaluateBiomeSurface(mat2, input.uv, input.height, normal, slope01, curvature01, ao01, auxVal);
                litColor = mix(litColor, col2 * light, mask2);
            }
        }
    }

    // Water flooding (ocean / crater lake / river) when aux.x > 0
    if (waterDepth > 0.05) {
        let waterMat = getMaterialPalette(select(activePalette1, 0u, activePalette1 == 11u));
        let waterNormal = vec3f(0.0, 1.0, 0.0);
        let waterDiff = max(dot(waterNormal, sunDir), 0.0);
        let depthT = clamp(waterDepth / 45.0, 0.0, 1.0);
        let waterCol = mix(waterMat.waterShallow, waterMat.waterDeep, depthT) * (0.4 + 0.6 * waterDiff);
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
