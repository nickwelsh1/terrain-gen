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
    @location(2) uv: vec2f,
    @location(3) elevM: f32,
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
    // Metres below the local surface — drives the weathered regolith transition
    output.depthM = (surfaceScene - y) / SCENE_SCALE_F;
    output.uv = input.uv;
    output.elevM = y / SCENE_SCALE_F;

    return output;
}
`;

export const WALL_FRAGMENT_SOURCE = /* wgsl */ `
const BASE_DEPTH_M_F : f32 = ${BASE_DEPTH_M}.0;

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) depthM: f32,
    @location(2) uv: vec2f,
    @location(3) elevM: f32,
};

fn hash21w(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn noise2Dw(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21w(i);
    let b = hash21w(i + vec2f(1.0, 0.0));
    let c = hash21w(i + vec2f(0.0, 1.0));
    let d = hash21w(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn sfbm2Dw(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.54;
    var q = p;
    for (var i: i32 = 0; i < 4; i = i + 1) {
        v = v + a * (noise2Dw(q) * 2.0 - 1.0);
        q = vec2f(q.x * 1.64 - q.y * 1.21, q.x * 1.21 + q.y * 1.64) + vec2f(19.3, 37.1);
        a = a * 0.52;
    }
    return clamp(v * 1.35, -1.0, 1.0);
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    // 3D folded, tilted & non-linear geological cross-section on the cut-away side walls
    let dipM = (input.uv.x - 0.5) * 220.0 + (input.uv.y - 0.5) * 155.0;
    let foldM = sfbm2Dw(input.uv * 2.2 + vec2f(4.1, 8.7)) * 165.0
              + sfbm2Dw(input.uv * 5.8 + vec2f(input.elevM * 0.003, -input.elevM * 0.002)) * 68.0;
    let deformedM = input.elevM + dipM + foldM;

    let rawCoord = deformedM * 0.022;
    let nonLinear = rawCoord + sin(rawCoord * 0.55 + foldM * 0.015) * 0.9 + sin(rawCoord * 1.4) * 0.45;
    let bedIdx = floor(nonLinear);
    let h = hash21w(vec2f(bedIdx * 1.73, 9.1));

    let soilColor = vec3f(0.42, 0.31, 0.22);
    let bedDark = vec3f(0.28, 0.21, 0.19);
    let bedTerracotta = vec3f(0.54, 0.34, 0.25);
    let bedOchre = vec3f(0.62, 0.48, 0.34);
    let bedSlate = vec3f(0.38, 0.36, 0.35);
    let deepBasement = vec3f(0.18, 0.17, 0.19);

    var rockCol = bedSlate;
    if (h < 0.25) { rockCol = bedDark; }
    else if (h < 0.52) { rockCol = bedTerracotta; }
    else if (h < 0.78) { rockCol = bedOchre; }

    let microLamina = noise2Dw(vec2f(nonLinear * 4.5, (input.uv.x + input.uv.y) * 18.0));
    rockCol = rockCol * (0.85 + 0.30 * microLamina);

    var color = rockCol;
    if (input.depthM < 14.0) {
        color = mix(soilColor, rockCol, clamp(input.depthM / 14.0, 0.0, 1.0));
    }
    let basementGate = clamp((input.depthM - 120.0) / (BASE_DEPTH_M_F * 1.5), 0.0, 0.75);
    color = mix(color, deepBasement, basementGate);

    let sunDir = normalize(vec3f(0.5, 0.7, 0.3));
    let normal = normalize(input.normal);
    let diffuse = max(dot(normal, sunDir), 0.0);
    let light = 0.35 + diffuse * 0.65;

    return vec4f(color * light, 1.0);
}
`;
