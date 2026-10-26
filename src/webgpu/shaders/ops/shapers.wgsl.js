// WGSL compute shaders for Stage 2 Shapers / Filters:
// 1. shape.terrace      — Pointwise tilted/warped 3D geological strata & canyon benches
// 2. shape.fold         — Ping-pong asymmetric scarp/dip slope folding (ported from CPU)
// 3. shape.warp         — Ping-pong heightfield domain warp & swirl resampling
// 4. shape.curveRemap   — Pointwise valley-floor flatten, gamma & plateau ceiling remap
// 5. shape.glacialCarve — Ping-pong U-valley parabolic trough carving + Apex peak sharpener

import { COMMON_WGSL } from "../common.wgsl.js";

// =============================================================================
// 1. shape.terrace — Geological Strata & Terrace Steps (Pointwise)
// =============================================================================
export const SHAPE_TERRACE_SHADER = /* wgsl */`
${COMMON_WGSL}

struct TerraceParams {
    stepHeightM: f32,
    sharpness: f32,
    strataTiltM: f32,
    strataAngleDeg: f32,
    strataWarpM: f32,
    strength: f32,
    seed: f32,
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: TerraceParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;

@compute @workgroup_size(8, 8)
fn applyTerrace(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let h = fromFixedHeight(heights[idx]);
    let stepM = max(params.stepHeightM, 4.0);
    let sharp = clamp(params.sharpness, 0.05, 0.95);
    let str = clamp01(params.strength);

    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let ang = params.strataAngleDeg * PI / 180.0;
    let tiltPlane = ((uv.x - 0.5) * cos(ang) + (uv.y - 0.5) * sin(ang)) * params.strataTiltM;
    let warpBed = (fbmEx(uv.x * 3.0, uv.y * 3.0, params.seed + 19.0, 3, 2.0, 0.5) - 0.5) * 2.0 * params.strataWarpM;

    let strataH = h + tiltPlane + warpBed;
    let stepIdx = floor(strataH / stepM);
    let frac = fract(strataH / stepM);

    // Flat bench for [0, 1-sharp], steep riser for [1-sharp, 1]
    let flatSpan = 1.0 - sharp;
    var remapped: f32;
    if (frac < flatSpan) {
        remapped = (frac / max(flatSpan, 0.02)) * (1.0 - sharp);
    } else {
        let riserT = (frac - flatSpan) / max(sharp, 0.02);
        remapped = (1.0 - sharp) + sharp * smoothstep01(riserT);
    }

    let terracedH = (stepIdx + remapped) * stepM - tiltPlane - warpBed;
    let outH = mix(h, terracedH, str);
    heights[idx] = toFixedHeight(outH);
}
`;

// =============================================================================
// 2. shape.fold — Asymmetric Scarp / Dip Folded Strata (Ping-Pong)
// =============================================================================
export const SHAPE_FOLD_SHADER = /* wgsl */`
${COMMON_WGSL}

struct FoldParams {
    directionDeg: f32,
    steepen: f32,
    gentle: f32,
    minAltM: f32,
    maxAltM: f32,
    strength: f32,
    seed: f32,
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: FoldParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;

fn sampleSrc(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]);
}

@compute @workgroup_size(8, 8)
fn applyFold(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let h = sampleSrc(x, y);

    let hL = sampleSrc(x - 1, y);
    let hR = sampleSrc(x + 1, y);
    let hU = sampleSrc(x, y - 1);
    let hD = sampleSrc(x, y + 1);
    let avgNeighbor = 0.25 * (hL + hR + hU + hD);

    let gx = (hR - hL) * 0.5;
    let gy = (hD - hU) * 0.5;
    let gradLen = length(vec2f(gx, gy));

    let rad = params.directionDeg * PI / 180.0;
    let dipDir = vec2f(cos(rad), sin(rad));

    var alignment = 0.0;
    if (gradLen > 1e-4) {
        alignment = dot(vec2f(gx, gy) / gradLen, dipDir);
    }

    // Altitude band gate
    let feather = 80.0;
    let bandGate = smoothstep(params.minAltM - feather, params.minAltM + feather, h)
                 * (1.0 - smoothstep(params.maxAltM - feather, params.maxAltM + feather, h));

    // Local relief relative to neighborhood + directional scarp/dip shift
    let localRelief = h - avgNeighbor;
    var delta = 0.0;
    if (alignment < 0.0) {
        // Scarp-facing slope: steepen local relief & push crest forward
        delta = (-alignment) * params.steepen * (localRelief * 1.4 + gradLen * 0.65);
    } else {
        // Dip-facing slope: gentle / smooth toward neighborhood mean
        delta = -alignment * params.gentle * (localRelief * 0.75 + gradLen * 0.35);
    }

    let outH = h + delta * bandGate * clamp01(params.strength);
    dstHeights[idx] = toFixedHeight(outH);
}
`;

// =============================================================================
// 3. shape.warp — Heightfield Domain Warp & Swirl Resampler (Ping-Pong)
// =============================================================================
export const SHAPE_WARP_SHADER = /* wgsl */`
${COMMON_WGSL}

struct WarpParams {
    warpAmplitudeM: f32,
    warpFrequency: f32,
    swirlStrength: f32,
    octaves: f32,
    seed: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: WarpParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;

fn sampleBilinear(px: f32, py: f32) -> f32 {
    let cx = clamp(px, 0.0, N_F - 1.001);
    let cy = clamp(py, 0.0, N_F - 1.001);
    let ix = u32(floor(cx));
    let iy = u32(floor(cy));
    let fx = cx - f32(ix);
    let fy = cy - f32(iy);

    let h00 = fromFixedHeight(srcHeights[iy * N + ix]);
    let h10 = fromFixedHeight(srcHeights[iy * N + ix + 1u]);
    let h01 = fromFixedHeight(srcHeights[(iy + 1u) * N + ix]);
    let h11 = fromFixedHeight(srcHeights[(iy + 1u) * N + ix + 1u]);

    return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

@compute @workgroup_size(8, 8)
fn applyWarp(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let freq = max(params.warpFrequency, 0.25);
    let oct = clamp(i32(params.octaves), 1, 6);

    let nX = fbmEx(uv.x * freq + 31.0, uv.y * freq, params.seed + 13.0, oct, 2.0, 0.5) - 0.5;
    let nY = fbmEx(uv.x * freq, uv.y * freq + 67.0, params.seed + 29.0, oct, 2.0, 0.5) - 0.5;

    let shiftCells = (params.warpAmplitudeM / CELL_M) * 2.0;

    // Optional curl/swirl around tile center
    let centered = uv - vec2f(0.5, 0.5);
    let dist = length(centered);
    let swirlAngle = params.swirlStrength * exp(-dist * 3.0);
    let cs = cos(swirlAngle);
    let ss = sin(swirlAngle);
    let swirledUv = vec2f(
        centered.x * cs - centered.y * ss + 0.5,
        centered.x * ss + centered.y * cs + 0.5
    );

    let srcX = swirledUv.x * N_F + nX * shiftCells;
    let srcY = swirledUv.y * N_F + nY * shiftCells;

    dstHeights[idx] = toFixedHeight(sampleBilinear(srcX, srcY));
}
`;

// =============================================================================
// 4. shape.curveRemap — Altitude & Valley-Floor Curve Remap (Pointwise)
// =============================================================================
export const SHAPE_CURVE_REMAP_SHADER = /* wgsl */`
${COMMON_WGSL}

struct CurveRemapParams {
    gamma: f32,
    valleyFloorM: f32,
    valleySmoothM: f32,
    plateauCeilingM: f32,
    strength: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: CurveRemapParams;
@group(0) @binding(1) var<storage, read_write> heights: array<i32>;

@compute @workgroup_size(8, 8)
fn applyCurveRemap(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let h = fromFixedHeight(heights[idx]);

    let ceiling = clamp(params.plateauCeilingM, 50.0, MAX_HEIGHT);
    let normH = clamp01(h / ceiling);
    let curvedH = pow(normH, max(params.gamma, 0.25)) * ceiling;

    // Smooth maximum against valley floor elevation
    let floorH = smoothMax(curvedH, params.valleyFloorM, max(params.valleySmoothM, 2.0));
    let cappedH = min(floorH, ceiling);

    let outH = mix(h, cappedH, clamp01(params.strength));
    heights[idx] = toFixedHeight(outH);
}
`;

// =============================================================================
// 5. shape.glacialCarve — Parabolic U-Valleys & Apex Peak Sharpener (Ping-Pong)
// =============================================================================
export const SHAPE_GLACIAL_CARVE_SHADER = /* wgsl */`
${COMMON_WGSL}

struct GlacialCarveParams {
    carveDepthM: f32,
    valleyWidth: f32,
    apexSharpen: f32,
    altitudeGateM: f32,
    strength: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: GlacialCarveParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;

fn sampleSrc(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]);
}

@compute @workgroup_size(8, 8)
fn applyGlacialCarve(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let h = sampleSrc(x, y);

    let rad = clamp(i32(params.valleyWidth), 1, 4);
    var sum = 0.0;
    var minNeighbor = h;
    var count = 0.0;

    for (var dy: i32 = -rad; dy <= rad; dy = dy + 1) {
        for (var dx: i32 = -rad; dx <= rad; dx = dx + 1) {
            if (dx == 0 && dy == 0) { continue; }
            let nh = sampleSrc(x + dx, y + dy);
            sum = sum + nh;
            minNeighbor = min(minNeighbor, nh);
            count = count + 1.0;
        }
    }

    let meanH = sum / max(count, 1.0);
    // Positive curvature = ridge/peak, negative = valley/trough
    let curvature = h - meanH;

    var delta = 0.0;
    if (curvature > 0.0) {
        // Apex sharpener: accentuate arêtes and pyramidal horns above altitudeGateM
        let highGate = smoothstep(params.altitudeGateM * 0.5, params.altitudeGateM + 200.0, h);
        delta = curvature * params.apexSharpen * highGate;
    } else {
        // Concave valley: widen V-incision into a flat-bottomed parabolic U-trough
        let valleyConcavity = clamp01(-curvature / max(CELL_M * 3.0, 10.0));
        let parabolicFloor = minNeighbor + (h - minNeighbor) * (h - minNeighbor) / max(params.carveDepthM + 20.0, 20.0);
        let uCarve = (parabolicFloor - h) * valleyConcavity - valleyConcavity * params.carveDepthM * 0.45;
        delta = uCarve;
    }

    let outH = h + delta * clamp01(params.strength);
    dstHeights[idx] = toFixedHeight(outH);
}
`;

// =============================================================================
// 6. shape.surfaceDetail — Post-Terrace Boulder, Caprock & Valley Micro-Relief
// =============================================================================
export const SHAPE_SURFACE_DETAIL_SHADER = /* wgsl */`
${COMMON_WGSL}

struct SurfaceDetailParams {
    boulderHeightM: f32,     // Height of cellular boulder & talus mounds (m)
    boulderScale: f32,       // Spatial frequency of boulder clusters
    caprockRoughnessM: f32,  // Fractured rock ledges on mesa tops & steep cliffs (m)
    basinHummocksM: f32,     // Hummocky shrub/alluvial mounds & rills on flat valley floors (m)
    strength: f32,
    seed: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> params: SurfaceDetailParams;
@group(0) @binding(1) var<storage, read> srcHeights: array<i32>;
@group(0) @binding(2) var<storage, read_write> dstHeights: array<i32>;

fn sampleSrcH(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return fromFixedHeight(srcHeights[u32(cy) * N + u32(cx)]);
}

@compute @workgroup_size(8, 8)
fn applySurfaceDetail(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let h = sampleSrcH(x, y);

    let hL = sampleSrcH(x - 1, y);
    let hR = sampleSrcH(x + 1, y);
    let hU = sampleSrcH(x, y - 1);
    let hD = sampleSrcH(x, y + 1);
    let gx = (hR - hL) / (2.0 * CELL_M);
    let gy = (hD - hU) / (2.0 * CELL_M);
    let slopeMag = length(vec2f(gx, gy));

    // Gates for flat/gentle surfaces (mesa tops & valley floors) vs steep talus/cliff transitions
    let flatGate = 1.0 - smoothstep(0.18, 0.65, slopeMag);
    let talusFootGate = smoothstep(0.06, 0.28, slopeMag) * (1.0 - smoothstep(0.45, 0.95, slopeMag));
    let highPlateauGate = smoothstep(140.0, 380.0, h);
    let lowBasinGate = 1.0 - smoothstep(80.0, 320.0, h);

    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let bScale = max(params.boulderScale, 4.0);

    // 1. Multi-scale cellular boulders & talus blocks (clustered at cliff bases & mesa rims)
    let vB1 = voronoi2D(uv * bScale, 0.9, params.seed + 19.0);
    let vB2 = voronoi2D(uv * bScale * 2.3 + vec2f(11.3, 27.9), 0.9, params.seed + 47.0);
    // Sparse boulder mask so only ~30% of cells form protruding rock mounds
    let clusterGate1 = smoothstep(0.58, 0.88, vB1.z);
    let clusterGate2 = smoothstep(0.62, 0.92, vB2.z);
    let mound1 = max(0.0, 1.0 - vB1.x * vB1.x * 2.2) * clusterGate1;
    let mound2 = max(0.0, 1.0 - vB2.x * vB2.x * 2.5) * clusterGate2 * 0.55;
    let boulders = (mound1 + mound2) * params.boulderHeightM * max(flatGate * 0.65, talusFootGate * 1.25);

    // 2. Caprock fracture ledges, jointing & erosion pits on high plateau/mesa tops
    let capCracks = ridgedEx(uv.x * 16.0, uv.y * 16.0, params.seed + 73.0, 4, 2.1, 0.5, 2.2) - 0.45;
    let capDetail = capCracks * params.caprockRoughnessM * (0.35 + 0.65 * highPlateauGate) * (0.4 + 0.6 * flatGate);

    // 3. Basin floor hummocks, coppice mounds & dendritic drainage rills on valley floors
    let hummockNoise = fbmEx(uv.x * 18.0 + 7.0, uv.y * 18.0 + 13.0, params.seed + 109.0, 4, 2.0, 0.55) - 0.45;
    let rills = (1.0 - abs(fbmEx(uv.x * 11.0, uv.y * 11.0, params.seed + 137.0, 3, 2.0, 0.5) * 2.0 - 1.0)) - 0.65;
    let basinDetail = (hummockNoise * 0.8 + rills * 0.45) * params.basinHummocksM * lowBasinGate * flatGate;

    let outH = max(0.0, h + (boulders + capDetail + basinDetail) * clamp01(params.strength));
    dstHeights[idx] = toFixedHeight(outH);
}
`;

