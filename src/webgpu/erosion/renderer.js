// Renderer module: Babylon Lite scene setup, custom shader material, render loop.
// The vertex shader reads heights from a storage buffer — no CPU readback.

import {
    createSceneContext,
    createDefaultCamera,
    createHemisphericLight,
    createGround,
    createShaderMaterial,
    attachControl,
    addToScene,
    registerScene,
    startEngine,
    setShaderUniform,
    setShaderStorageBuffer,
} from "@babylonjs/lite";

import {
    N,
    SCENE_AREA,
    SCENE_MAX_HEIGHT,
    SCENE_SCALE,
    FIXED_POINT_SCALE,
    MAX_HEIGHT_M,
    CELL_SPACING_M,
    RENDER_HEIGHTMAP,
    RENDER_LIT,
    RENDER_NORMALS,
    RENDER_RIDGE_MAP,
    RENDER_STREAM_MAP,
    RENDER_SLOPE_HEATMAP,
    RENDER_CONTOURS,
} from "./constants.js";

// Shared WGSL prelude: grid sampling helpers used by both stages.
const SHARED_PRELUDE = /* wgsl */`
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};
const MAX_HEIGHT_M : f32 = ${MAX_HEIGHT_M}.0;
const CELL_SPACING : f32 = ${CELL_SPACING_M};

fn gridIndex(uv: vec2f) -> u32 {
    let gridX = uv.x * (N_F - 1.0);
    let gridY = (1.0 - uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
    return iy * N_U + ix;
}
`;

const EROSION_VERTEX_SOURCE = /* wgsl */`
${SHARED_PRELUDE}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    let idx = gridIndex(input.uv);
    let heightMeters = f32(heights[idx]) / FIXED_SCALE;
    let heightScene = heightMeters * SCENE_SCALE_F;

    let worldPos = vec3f(input.position.x, heightScene, input.position.z);

    output.position = shaderSystem.viewProjection * vec4f(worldPos, 1.0);
    output.uv = input.uv;
    output.worldPos = worldPos;
    output.height = heightMeters;

    return output;
}
`;

const EROSION_FRAGMENT_SOURCE = /* wgsl */`
${SHARED_PRELUDE}

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

fn heightAt(ix: u32, iy: u32) -> f32 {
    let cx = min(ix, N_U - 1u);
    let cy = min(iy, N_U - 1u);
    return f32(heights[cy * N_U + cx]) / FIXED_SCALE;
}

// Surface normal from central differences on the height buffer, in metres.
fn surfaceNormal(uv: vec2f) -> vec3f {
    let gridX = clamp(uv.x * (N_F - 1.0), 1.0, N_F - 2.0);
    let gridY = clamp((1.0 - uv.y) * (N_F - 1.0), 1.0, N_F - 2.0);
    let ix = u32(gridX);
    let iy = u32(gridY);

    let hL = heightAt(ix - 1u, iy);
    let hR = heightAt(ix + 1u, iy);
    let hD = heightAt(ix, iy - 1u);
    let hU = heightAt(ix, iy + 1u);

    let dx = (hR - hL) / (2.0 * CELL_SPACING);
    let dz = (hU - hD) / (2.0 * CELL_SPACING);

    return normalize(vec3f(-dx, 1.0, dz));
}

// Multi-stop elevation ramp: water, sand, grass, forest, dirt, rock, scree, snow.
fn elevationColor(t: f32) -> vec3f {
    let shallowWater = vec3f(0.10, 0.28, 0.38);
    let sand         = vec3f(0.76, 0.70, 0.52);
    let grass        = vec3f(0.31, 0.45, 0.20);
    let forest       = vec3f(0.17, 0.31, 0.15);
    let dirt         = vec3f(0.42, 0.35, 0.25);
    let rock         = vec3f(0.44, 0.42, 0.40);
    let scree        = vec3f(0.60, 0.58, 0.56);
    let snow         = vec3f(0.97, 0.97, 1.00);

    var color = shallowWater;
    color = mix(color, sand,   smoothstep(0.03, 0.09, t));
    color = mix(color, grass,  smoothstep(0.09, 0.20, t));
    color = mix(color, forest, smoothstep(0.20, 0.36, t));
    color = mix(color, dirt,   smoothstep(0.36, 0.50, t));
    color = mix(color, rock,   smoothstep(0.50, 0.64, t));
    color = mix(color, scree,  smoothstep(0.64, 0.78, t));
    color = mix(color, snow,   smoothstep(0.80, 0.92, t));
    return color;
}

// Blue-green-yellow-red ramp for scalar analysis views.
fn heatmapColor(t: f32) -> vec3f {
    let c = clamp(t, 0.0, 1.0);
    var color = vec3f(0.05, 0.05, 0.30);
    color = mix(color, vec3f(0.0, 0.55, 0.75), smoothstep(0.0, 0.35, c));
    color = mix(color, vec3f(0.35, 0.80, 0.25), smoothstep(0.30, 0.55, c));
    color = mix(color, vec3f(0.95, 0.85, 0.20), smoothstep(0.55, 0.78, c));
    color = mix(color, vec3f(0.85, 0.20, 0.15), smoothstep(0.78, 1.0, c));
    return color;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let renderMode = shaderUniforms.renderMode;
    let idx = gridIndex(input.uv);
    let normal = surfaceNormal(input.uv);
    let t = clamp(input.height / MAX_HEIGHT_M, 0.0, 1.0);

    // Two-light setup: a warm key light plus cool sky fill and a rim term.
    let keyDir = normalize(vec3f(-0.45, 0.72, 0.52));
    let key = max(dot(normal, keyDir), 0.0);
    let sky = 0.5 + 0.5 * normal.y;

    if (renderMode == ${RENDER_HEIGHTMAP}u) {
        return vec4f(vec3f(t), 1.0);
    }

    if (renderMode == ${RENDER_LIT}u) {
        var albedo = elevationColor(t);

        // Steep faces expose rock regardless of elevation.
        let slope = clamp(1.0 - normal.y, 0.0, 1.0);
        let rockFace = smoothstep(0.25, 0.6, slope);
        albedo = mix(albedo, vec3f(0.34, 0.32, 0.31), rockFace * 0.85);

        // Gully beds read damper via the ridge map (-1 crease, +1 ridge).
        let ridge = ridgeMaps[idx];
        let wetness = smoothstep(0.0, -0.7, ridge);
        albedo = mix(albedo, albedo * vec3f(0.62, 0.68, 0.72), wetness * 0.6);

        // Snow prefers flatter, higher ground.
        let snowMask = smoothstep(0.72, 0.9, t) * smoothstep(0.45, 0.85, normal.y);
        albedo = mix(albedo, vec3f(0.97, 0.97, 1.0), snowMask);

        let keyColor = vec3f(1.0, 0.95, 0.86) * key * 1.15;
        let skyColor = vec3f(0.42, 0.55, 0.72) * sky * 0.45;
        var lit = albedo * (keyColor + skyColor);

        // Mild aerial perspective so distant relief separates.
        let fog = smoothstep(0.0, 1.0, length(input.worldPos.xz) / (${SCENE_AREA.toFixed(4)} * 0.85));
        lit = mix(lit, vec3f(0.62, 0.70, 0.80), fog * 0.25);

        return vec4f(pow(clamp(lit, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 1.15)), 1.0);
    }

    if (renderMode == ${RENDER_NORMALS}u) {
        return vec4f(normal * 0.5 + 0.5, 1.0);
    }

    if (renderMode == ${RENDER_RIDGE_MAP}u) {
        let ridge = ridgeMaps[idx];
        return vec4f(heatmapColor(ridge * 0.5 + 0.5), 1.0);
    }

    if (renderMode == ${RENDER_STREAM_MAP}u) {
        // Creases (negative ridge map) trace the drainage network.
        let ridge = ridgeMaps[idx];
        let stream = smoothstep(-0.15, -0.75, ridge);
        let land = elevationColor(t) * (0.35 + 0.65 * key);
        return vec4f(mix(land, vec3f(0.15, 0.45, 0.85), stream), 1.0);
    }

    if (renderMode == ${RENDER_SLOPE_HEATMAP}u) {
        let slopeAngle = acos(clamp(normal.y, -1.0, 1.0));
        return vec4f(heatmapColor(slopeAngle / 1.2), 1.0);
    }

    if (renderMode == ${RENDER_CONTOURS}u) {
        let spacing = 50.0; // metres between contour lines
        let band = fract(input.height / spacing);
        let line = 1.0 - smoothstep(0.0, 0.08, min(band, 1.0 - band));
        let base = elevationColor(t) * (0.4 + 0.6 * key);
        return vec4f(mix(base, vec3f(0.08, 0.08, 0.10), line * 0.8), 1.0);
    }

    return vec4f(vec3f(t), 1.0);
}
`;

export async function createRenderer(canvas, pipeline, engine) {
    const scene = createSceneContext(engine);

    const camera = createDefaultCamera(scene);
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3;
    camera.radius = SCENE_AREA * 1.5;
    camera.target = { x: 0, y: SCENE_MAX_HEIGHT * 0.3, z: 0 };
    attachControl(camera, canvas, scene);

    addToScene(scene, createHemisphericLight([0, 1, 0], 1.0));

    const ground = createGround(engine, {
        width: SCENE_AREA,
        height: SCENE_AREA,
        subdivisions: N - 1,
    });

    const erosionMaterial = createShaderMaterial({
        name: "erosionRender",
        vertexSource: EROSION_VERTEX_SOURCE,
        fragmentSource: EROSION_FRAGMENT_SOURCE,
        attributes: ["position", "uv"],
        uniforms: [
            "viewProjection",
            { name: "renderMode", type: "u32" },
        ],
        storageBuffers: [
            { name: "heights", type: "array<i32>" },
            { name: "ridgeMaps", type: "array<f32>" },
        ],
        backFaceCulling: false,
        depthWrite: true,
    });

    ground.material = erosionMaterial;
    addToScene(scene, ground);

    const sbs = pipeline.getStorageBuffers();
    setShaderStorageBuffer(erosionMaterial, "heights", sbs.heights);
    setShaderStorageBuffer(erosionMaterial, "ridgeMaps", sbs.ridgeMaps);

    setShaderUniform(erosionMaterial, "renderMode", RENDER_LIT);

    await registerScene(scene);

    return {
        engine,
        scene,
        camera,
        ground,
        erosionMaterial,
        setRenderMode(mode) {
            setShaderUniform(erosionMaterial, "renderMode", mode);
        },
        async start() {
            await startEngine(engine);
        },
    };
}
