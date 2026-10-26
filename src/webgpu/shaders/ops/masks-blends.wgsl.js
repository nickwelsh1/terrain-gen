// WGSL compute shaders for Stage 3 Detailers, Masks & Seamless Biome Blending:
// 1. mask.select  — Altitude band + slope band + curvature + domain-warped noise breakup
// 2. mask.blur    — Ping-pong 5x5 Gaussian feathering on aux.z (maskA)
// 3. blend.layer  — Seam-free biome layer compositor (Height-Fill, SmoothMax, Mix, Additive)

import { COMMON_WGSL } from "../common.wgsl.js";

// =============================================================================
// 1. mask.select — Geological Mask Selector with Domain-Warped Thresholds
// =============================================================================
export const MASK_SELECT_SHADER = /* wgsl */`
${COMMON_WGSL}

struct MaskSelectParams {
    minAltM: f32,
    maxAltM: f32,
    featherAltM: f32,
    minSlopeDeg: f32,
    maxSlopeDeg: f32,
    featherSlopeDeg: f32,
    curvatureBias: f32,    // -1 = concave basins, 0 = all, +1 = convex ridges
    warpAmpM: f32,         // domain-warped altitude threshold perturbation (m)
    warpFreq: f32,
    invertMask: u32,
    seed: f32,
    _pad0: f32,
};

@group(0) @binding(0) var<uniform> params: MaskSelectParams;
@group(0) @binding(1) var<storage, read> heights: array<i32>;
@group(0) @binding(2) var<storage, read> slopes: array<u32>;
@group(0) @binding(3) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn selectMask(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let h = fromFixedHeight(heights[idx]);
    let packedS = unpackRGBA(slopes[idx]);
    let slopeDeg = packedS.r * 90.0;
    let curvatureSigned = (packedS.g - 0.5) * 2.0; // [-1, 1]

    // Perturb elevation & slope lookup using domain-warped fBm BEFORE smoothstep
    // so the biome boundary follows organic spurs and gullies rather than flat contour lines.
    let uv = vec2f(f32(x) / N_F, f32(y) / N_F);
    let wf = max(params.warpFreq, 0.25);
    let nWarp = fbmEx(uv.x * wf * 4.0 + 13.0, uv.y * wf * 4.0 + 29.0, params.seed + 71.0, 4, 2.0, 0.5) - 0.5;
    let hWarped = h + nWarp * 2.0 * params.warpAmpM;

    let fAlt = max(params.featherAltM, 2.0);
    let altLow = smoothstep(params.minAltM - fAlt, params.minAltM + fAlt, hWarped);
    let altHigh = 1.0 - smoothstep(params.maxAltM - fAlt, params.maxAltM + fAlt, hWarped);
    let mAlt = altLow * altHigh;

    let fSlope = max(params.featherSlopeDeg, 1.0);
    let sLow = smoothstep(params.minSlopeDeg - fSlope, params.minSlopeDeg + fSlope, slopeDeg);
    let sHigh = 1.0 - smoothstep(params.maxSlopeDeg - fSlope, params.maxSlopeDeg + fSlope, slopeDeg);
    let mSlope = sLow * sHigh;

    var mCurv = 1.0;
    if (abs(params.curvatureBias) > 0.01) {
        if (params.curvatureBias < 0.0) {
            // Favor concave basins/valleys
            let basin = smoothstep(-0.05, 0.35, -curvatureSigned);
            mCurv = mix(1.0, basin, clamp01(-params.curvatureBias));
        } else {
            // Favor convex ridges/peaks
            let ridge = smoothstep(-0.05, 0.35, curvatureSigned);
            mCurv = mix(1.0, ridge, clamp01(params.curvatureBias));
        }
    }

    var mask = clamp01(mAlt * mSlope * mCurv);
    if (params.invertMask != 0u) {
        mask = 1.0 - mask;
    }

    let prev = aux[idx];
    aux[idx] = vec4f(prev.x, prev.y, mask, prev.w);
}
`;

// =============================================================================
// 2. mask.blur — 5x5 Separable-Weight Spatial Feathering on aux.z (Ping-Pong)
// =============================================================================
export const MASK_BLUR_SHADER = /* wgsl */`
${COMMON_WGSL}

struct MaskBlurParams {
    radius: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: MaskBlurParams;
@group(0) @binding(1) var<storage, read> srcAux: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dstAux: array<vec4f>;

fn sampleMask(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return srcAux[u32(cy) * N + u32(cx)].z;
}

@compute @workgroup_size(8, 8)
fn blurMask(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= N_I || y >= N_I) { return; }

    let idx = gid.y * N + gid.x;
    let r = clamp(i32(params.radius), 1, 3);
    var sum = 0.0;
    var wSum = 0.0;

    for (var dy: i32 = -r; dy <= r; dy = dy + 1) {
        for (var dx: i32 = -r; dx <= r; dx = dx + 1) {
            let d2 = f32(dx * dx + dy * dy);
            let w = exp(-d2 / max(f32(r * r), 1.0));
            sum = sum + sampleMask(x + dx, y + dy) * w;
            wSum = wSum + w;
        }
    }

    let prev = srcAux[idx];
    dstAux[idx] = vec4f(prev.x, prev.y, sum / max(wSum, 1e-5), prev.w);
}
`;

// =============================================================================
// 3. blend.layer — Seam-Free Biome Layer Compositor
// =============================================================================
export const BLEND_LAYER_SHADER = /* wgsl */`
${COMMON_WGSL}

struct BlendLayerParams {
    blendMode: u32,       // 0 = Height-Fill, 1 = SmoothMax, 2 = Feather Mix, 3 = Additive
    opacity: f32,         // [0..1]
    blendDepthM: f32,     // height-fill transition depth in meters
    blendSmoothM: f32,    // fillet / smoothness in meters
    heightOffsetM: f32,   // vertical shift applied to overlay layer before blending
    markSediment: u32,    // if 1, deposited thickness is added to aux.y (sediment)
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> params: BlendLayerParams;
@group(0) @binding(1) var<storage, read_write> baseHeights: array<i32>;
@group(0) @binding(2) var<storage, read> overlayHeights: array<i32>;
@group(0) @binding(3) var<storage, read_write> aux: array<vec4f>;

@compute @workgroup_size(8, 8)
fn blendLayers(@builtin(global_invocation_id) gid: vec3u) {
    let x = gid.x;
    let y = gid.y;
    if (x >= N || y >= N) { return; }

    let idx = y * N + x;
    let hBase = fromFixedHeight(baseHeights[idx]);
    let hOverlayRaw = fromFixedHeight(overlayHeights[idx]) + params.heightOffsetM;
    let curAux = aux[idx];
    let mask = clamp01(curAux.z * params.opacity);

    if (mask <= 0.0001) {
        return;
    }

    var hOut = hBase;
    if (params.blendMode == 0u) {
        // Mode 0: Geological Height-Fill (sand/alluvium fills low valleys first, zero edge seams)
        let hCandidate = hBase * 0.25 + hOverlayRaw;
        hOut = heightBlend(hBase, hCandidate, mask, params.blendDepthM, params.blendSmoothM);
    } else if (params.blendMode == 1u) {
        // Mode 1: Smooth Maximum with fillet radius blendSmoothM
        let hMasked = mix(hBase - params.blendDepthM, hOverlayRaw, mask);
        hOut = smoothMax(hBase, hMasked, params.blendSmoothM);
    } else if (params.blendMode == 2u) {
        // Mode 2: Feathered Linear Replace
        hOut = mix(hBase, max(0.0, hOverlayRaw), smoothstep01(mask));
    } else {
        // Mode 3: Masked Additive Relief (attenuated near mask=0 so no step wall forms)
        let env = smoothstep01(mask);
        hOut = hBase + env * hOverlayRaw;
    }

    baseHeights[idx] = toFixedHeight(hOut);

    if (params.markSediment != 0u) {
        let addedSand = max(0.0, hOut - hBase);
        aux[idx] = vec4f(curAux.x, curAux.y + addedSand, curAux.z, curAux.w);
    }
}
`;
