// WGSL render shader for Babylon Lite ShaderMaterial.
// Supports 8 visualization modes:
//   0 = Lit Biome Terrain (rock, grass, sand/sediment, snow, water level + AO)
//   1 = Hardness Map
//   2 = Slope Arrows (downhill flow vectors)
//   3 = Erosion / Slope Heatmap
//   4 = Grayscale Heightmap
//   5 = Active Layer Mask Inspector (aux.z = maskA overlaid on terrain)
//   6 = Sediment & Scree Depth Map (aux.y = loose sand/talus thickness)
//   7 = Curvature & Horizon AO Inspector (slopes.g = curvature, slopes.b = AO)

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
    // Render surface at water level when flooded
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

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let renderMode = shaderUniforms.renderMode;

    let gridX = input.uv.x * (N_F - 1.0);
    let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    let idx = iy * N_U + ix;

    let packedN = normals[idx];
    let nr = f32(packedN & 0xFFu) / 255.0 * 2.0 - 1.0;
    let ng = f32((packedN >> 8u) & 0xFFu) / 255.0 * 2.0 - 1.0;
    let nb = f32((packedN >> 16u) & 0xFFu) / 255.0 * 2.0 - 1.0;
    let normal = normalize(vec3f(nr, ng, nb));

    let packedS = slopes[idx];
    let slope01 = f32(packedS & 0xFFu) / 255.0;
    let curvature01 = f32((packedS >> 8u) & 0xFFu) / 255.0;
    let ao01 = max(0.35, f32((packedS >> 16u) & 0xFFu) / 255.0);

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
        let hGray = clamp(input.height / 950.0, 0.0, 1.0);
        return vec4f(hGray, hGray, hGray, 1.0);
    }

    // Mode 5: Active Layer Mask Inspector (aux.z = maskA)
    if (renderMode == 5u) {
        let baseGray = clamp(input.height / 950.0, 0.0, 1.0) * light;
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
        // Warm orange on convex ridges (>0.5), cool cyan in concave gullies (<0.5), modulated by AO
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

    // Compute natural biome surface color (used by Mode 0 Lit and Mode 2 Slope Arrows)
    let duneSandColor = vec3f(0.84, 0.72, 0.50);
    let leeSandColor = vec3f(0.74, 0.61, 0.41);
    let screeColor = vec3f(0.56, 0.52, 0.47);
    let grassColor = vec3f(0.32, 0.46, 0.22);
    let rockColor = vec3f(0.46, 0.43, 0.39);
    let steepCliffColor = vec3f(0.35, 0.32, 0.30);
    let snowColor = vec3f(0.93, 0.95, 0.98);

    var color: vec3f;
    if (input.height < 60.0) {
        color = mix(duneSandColor, grassColor, clamp(input.height / 60.0, 0.0, 1.0));
    } else if (input.height < 240.0) {
        let t = (input.height - 60.0) / 180.0;
        color = mix(grassColor, rockColor, t);
    } else if (input.height < 520.0) {
        let t = (input.height - 240.0) / 280.0;
        color = mix(rockColor, snowColor, t * 0.65);
    } else {
        let t = clamp((input.height - 520.0) / 220.0, 0.0, 1.0);
        color = mix(rockColor, snowColor, 0.65 + t * 0.35);
    }

    // Steep slopes expose bare stratified cliff rock even at high or low altitude
    let cliffMask = smoothstep(0.32, 0.58, slope01);
    color = mix(color, steepCliffColor, cliffMask * 0.85);

    // Convex ridge highlight from curvature
    let ridgeCrest = clamp((curvature01 - 0.52) * 2.5, 0.0, 1.0);
    color = mix(color, color * 1.16, ridgeCrest * 0.5);

    // Loose sediment / dune sand / alpine snow drift tinting from aux.y
    if (sedimentDepth > 0.15) {
        let sedWeight = clamp(sedimentDepth / 18.0, 0.0, 1.0);
        let warmSand = mix(duneSandColor, leeSandColor, maskB * 0.6);
        let highSnow = snowColor;
        let sedBiomeColor = select(
            mix(screeColor, warmSand, clamp(1.0 - slope01 * 1.6, 0.0, 1.0)),
            highSnow,
            input.height > 340.0
        );
        color = mix(color, sedBiomeColor, sedWeight * 0.9);
    }

    var litColor = color * light;

    // Water flooding (ocean / crater lake / river) when aux.x > 0
    if (waterDepth > 0.05) {
        let waterNormal = vec3f(0.0, 1.0, 0.0);
        let waterDiff = max(dot(waterNormal, sunDir), 0.0);
        let shallowWater = vec3f(0.16, 0.54, 0.62);
        let deepWater = vec3f(0.05, 0.18, 0.34);
        let depthT = clamp(waterDepth / 45.0, 0.0, 1.0);
        let waterCol = mix(shallowWater, deepWater, depthT) * (0.4 + 0.6 * waterDiff);
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
