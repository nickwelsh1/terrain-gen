// WGSL render shader for Babylon Lite ShaderMaterial.
// Babylon Lite auto-generates the preamble: scene uniforms (@group(0)),
// shaderSystem (@group(1) binding 0), shaderUniforms (@group(1) binding 1),
// and storage buffers (@group(1) binding 2+).
// User source must contain: VertexOutput struct + mainVertex + FragmentInput struct + mainFragment.
// Available auto-injected vars (based on uniforms/storageBuffers declared in createShaderMaterial):
//   shaderSystem.viewProjection (mat4x4) — pre-multiplied worldViewProjection
//   shaderUniforms.renderMode (u32) — custom uniform
//   heights, hardness, normals, slopes — storage buffers (read-only, @group(1))

import { N, FIXED_POINT_SCALE, SCENE_SCALE, SCENE_MAX_HEIGHT } from "../constants.js";

export const RENDER_VERTEX_SOURCE = /* wgsl */`
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};
const SCENE_MAX_H : f32 = ${SCENE_MAX_HEIGHT}.0;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

fn unpackRGBA(packed: u32) -> vec4f {
    let r = f32(packed & 0xFFu) / 255.0;
    let g = f32((packed >> 8u) & 0xFFu) / 255.0;
    let b = f32((packed >> 16u) & 0xFFu) / 255.0;
    let a = f32((packed >> 24u) & 0xFFu) / 255.0;
    return vec4f(r, g, b, a);
}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Map UV to grid cell
    let gridX = input.uv.x * (N_F - 1.0);
    let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    let idx = iy * N_U + ix;

    // Read height from storage buffer, convert to meters then to scene units
    let heightMeters = f32(heights[idx]) / FIXED_SCALE;
    let heightScene = heightMeters * SCENE_SCALE_F;

    // Displace the ground plane vertex (ground mesh is already in scene units)
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

    // Height-based grayscale (B&W heightmap mode)
    let h = clamp(input.height / 500.0, 0.0, 1.0);

    if (renderMode == 1u) {
        // Hardness — read from storage buffer via UV mapping
        let gridX = input.uv.x * (N_F - 1.0);
        let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
        let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
        let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
        let idx = iy * N_U + ix;
        let hard = f32(hardness[idx]) / ${FIXED_POINT_SCALE}.0;
        return vec4f(hard, hard, hard, 1.0);
    }

    if (renderMode == 2u) {
        // Normal arrows — draw arrows on terrain surface pointing downhill
        let gridX = input.uv.x * (N_F - 1.0);
        let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
        let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
        let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
        let idx = iy * N_U + ix;

        // Look up normal at this fragment
        let packedN = normals[idx];
        let nr = f32(packedN & 0xFFu) / 255.0 * 2.0 - 1.0;
        let ng = f32((packedN >> 8u) & 0xFFu) / 255.0 * 2.0 - 1.0;
        let nb = f32((packedN >> 16u) & 0xFFu) / 255.0 * 2.0 - 1.0;
        let normal = normalize(vec3f(nr, ng, nb));

        // Lit terrain as background
        let sunDir = normalize(vec3f(0.5, 0.7, 0.3));
        let diffuse = max(dot(normal, sunDir), 0.0);
        let light = 0.3 + diffuse * 0.7;
        let sandColor = vec3f(0.76, 0.70, 0.50);
        let grassColor = vec3f(0.30, 0.45, 0.18);
        let rockColor = vec3f(0.45, 0.42, 0.38);
        let snowColor = vec3f(0.92, 0.92, 0.95);
        var bgColor: vec3f;
        if (input.height < 50.0) {
            bgColor = sandColor;
        } else if (input.height < 200.0) {
            bgColor = mix(sandColor, grassColor, (input.height - 50.0) / 150.0);
        } else if (input.height < 350.0) {
            bgColor = mix(grassColor, rockColor, (input.height - 200.0) / 150.0);
        } else {
            bgColor = mix(rockColor, snowColor, clamp((input.height - 350.0) / 150.0, 0.0, 1.0));
        }
        bgColor = bgColor * light;

        // Arrow grid: 32×32 arrows across the terrain
        let arrowGrid = 32.0;
        let cellUv = input.uv * arrowGrid;
        let cellId = vec2u(u32(cellUv.x), u32(cellUv.y));
        let cellCenterUv = (vec2f(f32(cellId.x), f32(cellId.y)) + 0.5) / arrowGrid;

        // Look up normal at cell center for arrow direction
        let cgx = cellCenterUv.x * (N_F - 1.0);
        let cgy = (1.0 - cellCenterUv.y) * (N_F - 1.0);
        let cix = u32(clamp(cgx, 0.0, N_F - 1.0));
        let ciy = u32(clamp(cgy, 0.0, N_F - 1.0));
        let cidx = ciy * N_U + cix;
        let cpn = normals[cidx];
        let cnr = f32(cpn & 0xFFu) / 255.0 * 2.0 - 1.0;
        let cng = f32((cpn >> 8u) & 0xFFu) / 255.0 * 2.0 - 1.0;
        let cnb = f32((cpn >> 16u) & 0xFFu) / 255.0 * 2.0 - 1.0;

        // Downhill direction in world XZ: (-cnr, -cnb)
        // Convert to UV space (UV.y is flipped from world Z): (-cnr, cnb)
        let slopeLen = length(vec2f(cnr, cnb));
        if (slopeLen < 0.001) {
            return vec4f(bgColor, 1.0);  // flat area — no arrow
        }
        let dir = vec2f(-cnr, cnb) / slopeLen;

        // Local coordinates within cell, centered at 0.5
        let localUv = fract(cellUv) - 0.5;
        // Project onto arrow direction and perpendicular
        let proj = localUv.x * dir.x + localUv.y * dir.y;
        let perp = localUv.x * (-dir.y) + localUv.y * dir.x;

        // Arrow shaft: line from -0.25 to 0.15 along dir
        let shaftHalfW = 0.03;
        let onShaft = proj > -0.25 && proj < 0.15 && abs(perp) < shaftHalfW;

        // Arrowhead: triangle from 0.15 to 0.30, widening then narrowing
        let headT = (proj - 0.15) / 0.15;
        let onHead = headT > 0.0 && headT < 1.0 && abs(perp) < 0.08 * (1.0 - abs(headT - 0.5) * 2.0);

        if (onShaft || onHead) {
            // Color arrows by slope steepness: yellow (gentle) → red (steep)
            let steepness = slopeLen;
            let arrowColor = mix(vec3f(1.0, 0.9, 0.2), vec3f(1.0, 0.2, 0.1), clamp(steepness * 3.0, 0.0, 1.0));
            return vec4f(arrowColor, 1.0);
        }

        return vec4f(bgColor, 1.0);
    }

    if (renderMode == 3u) {
        // Slope heatmap
        let gridX = input.uv.x * (N_F - 1.0);
        let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
        let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
        let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
        let idx = iy * N_U + ix;
        let packed = slopes[idx];
        let s = f32(packed & 0xFFu) / 255.0;
        return vec4f(s * 2.0, (1.0 - s) * 0.5, 0.2, 1.0);
    }

    // Default: lit terrain with height-based coloring
    let sunDir = normalize(vec3f(0.5, 0.7, 0.3));

    // Compute normal from height derivatives
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

    let diffuse = max(dot(normal, sunDir), 0.0);
    let light = 0.3 + diffuse * 0.7;

    // Color palette by elevation
    let sandColor = vec3f(0.76, 0.70, 0.50);
    let grassColor = vec3f(0.30, 0.45, 0.18);
    let rockColor = vec3f(0.45, 0.42, 0.38);
    let snowColor = vec3f(0.92, 0.92, 0.95);

    var color: vec3f;
    if (input.height < 50.0) {
        color = sandColor;
    } else if (input.height < 200.0) {
        let t = (input.height - 50.0) / 150.0;
        color = mix(sandColor, grassColor, t);
    } else if (input.height < 350.0) {
        let t = (input.height - 200.0) / 150.0;
        color = mix(grassColor, rockColor, t);
    } else {
        let t = clamp((input.height - 350.0) / 150.0, 0.0, 1.0);
        color = mix(rockColor, snowColor, t);
    }

    return vec4f(color * light, 1.0);
}
`;
