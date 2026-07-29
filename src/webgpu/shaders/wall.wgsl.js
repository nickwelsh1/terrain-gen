// WGSL render shader for the terrain tile's side walls and bottom cap.
// Top vertices are flagged with position.y = TOP_FLAG (see skirt.js) and are
// displaced to the terrain surface height read from the height buffer, so the
// walls stay welded to the terrain as erosion changes it.

import {
    N,
    FIXED_POINT_SCALE,
    SCENE_SCALE,
    SCENE_BASE_DEPTH,
    BASE_DEPTH_M,
} from "../constants.js";
import { TOP_FLAG } from "../skirt.js";

export const WALL_VERTEX_SOURCE = /* wgsl */ `
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};
const BASE_DEPTH : f32 = ${SCENE_BASE_DEPTH};
const TOP_FLAG_MIN : f32 = ${TOP_FLAG * 0.5};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) depthM: f32,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Same UV → cell mapping as the ground mesh
    let gridX = input.uv.x * (N_F - 1.0);
    let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    let idx = iy * N_U + ix;

    let surfaceM = f32(heights[idx]) / FIXED_SCALE;
    let surfaceScene = surfaceM * SCENE_SCALE_F;

    var y = -BASE_DEPTH;
    if (input.position.y > TOP_FLAG_MIN) {
        y = surfaceScene;
    }

    let worldPos = vec3f(input.position.x, y, input.position.z);
    output.position = shaderSystem.viewProjection * vec4f(worldPos, 1.0);
    output.normal = input.normal;
    // Metres below the local surface — drives the strata banding
    output.depthM = (surfaceScene - y) / SCENE_SCALE_F;

    return output;
}
`;

export const WALL_FRAGMENT_SOURCE = /* wgsl */ `
const BASE_DEPTH_M_F : f32 = ${BASE_DEPTH_M}.0;

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) depthM: f32,
};

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let soilColor = vec3f(0.34, 0.25, 0.17);
    let rockColor = vec3f(0.42, 0.39, 0.35);
    let deepRockColor = vec3f(0.26, 0.25, 0.26);

    // Thin soil layer at the top, rock below, darkening with depth
    var color: vec3f;
    if (input.depthM < 12.0) {
        color = mix(soilColor, rockColor, clamp(input.depthM / 12.0, 0.0, 1.0));
    } else {
        let t = clamp((input.depthM - 12.0) / (BASE_DEPTH_M_F * 0.8), 0.0, 1.0);
        color = mix(rockColor, deepRockColor, t);
    }

    // Sedimentary banding so the cut face reads as layered rock
    let band = sin(input.depthM * 0.45) * 0.5 + 0.5;
    color = color * (0.88 + band * 0.12);

    let sunDir = normalize(vec3f(0.5, 0.7, 0.3));
    let normal = normalize(input.normal);
    let diffuse = max(dot(normal, sunDir), 0.0);
    let light = 0.35 + diffuse * 0.65;

    return vec4f(color * light, 1.0);
}
`;
