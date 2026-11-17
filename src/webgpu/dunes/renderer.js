// Renderer module: Babylon Lite scene setup, custom shader material, render loop.
// The vertex shader reads heights from a storage buffer — no CPU readback.
// Lighting matches erodemountains.html (warm key + cool sky fill).

import {
    createSceneContext,
    createDefaultCamera,
    createHemisphericLight,
    createGround,
    createShaderMaterial,
    attachControl,
    setCameraLimits,
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
    RENDER_LIT,
    RENDER_HEIGHTMAP,
    RENDER_SLOPE,
    RENDER_DETAIL,
} from "./constants.js";

const SHARED_PRELUDE = /* wgsl */`
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};
const MAX_HEIGHT_M : f32 = ${MAX_HEIGHT_M}.0;
const CELL_SPACING : f32 = ${CELL_SPACING_M.toFixed(4)};

fn gridIndex(uv: vec2f) -> u32 {
    let gridX = uv.x * (N_F - 1.0);
    let gridY = (1.0 - uv.y) * (N_F - 1.0);
    let ix = u32(clamp(gridX + 0.5, 0.0, N_F - 1.0));
    let iy = u32(clamp(gridY + 0.5, 0.0, N_F - 1.0));
    return iy * N_U + ix;
}

fn heightAt(ix: u32, iy: u32) -> f32 {
    let cx = min(ix, N_U - 1u);
    let cy = min(iy, N_U - 1u);
    return f32(heights[cy * N_U + cx]) / FIXED_SCALE;
}

// Surface normal from central differences on the height buffer, in metres.
fn surfaceNormal(uv: vec2f) -> vec3f {
    let gridX = clamp(uv.x * (N_F - 1.0), 1.0, N_F - 2.0);
    let gridY = clamp((1.0 - uv.y) * (N_F - 1.0), 1.0, N_F - 2.0);
    let ix = u32(gridX + 0.5);
    let iy = u32(gridY + 0.5);
    let dx = (heightAt(ix + 1u, iy) - heightAt(ix - 1u, iy)) / (2.0 * CELL_SPACING);
    let dz = (heightAt(ix, iy + 1u) - heightAt(ix, iy - 1u)) / (2.0 * CELL_SPACING);
    return normalize(vec3f(-dx, 1.0, dz));
}
`;

const DUNES_VERTEX_SOURCE = /* wgsl */`
${SHARED_PRELUDE}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
    @location(3) normal: vec3f,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let idx = gridIndex(input.uv);
    let heightMeters = f32(heights[idx]) / FIXED_SCALE;
    let worldPos = vec3f(input.position.x, heightMeters * SCENE_SCALE_F, input.position.z);
    output.position = shaderSystem.viewProjection * vec4f(worldPos, 1.0);
    output.uv = input.uv;
    output.worldPos = worldPos;
    output.height = heightMeters;
    // Per-vertex normal, interpolated across triangles -> smooth shading.
    output.normal = surfaceNormal(input.uv);
    return output;
}
`;

const DUNES_FRAGMENT_SOURCE = /* wgsl */`
${SHARED_PRELUDE}

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
    @location(3) normal: vec3f,
};

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
    let normal = normalize(input.normal);
    let t = clamp(input.height / MAX_HEIGHT_M, 0.0, 1.0);

    let keyDir = normalize(vec3f(-0.45, 0.72, 0.52));
    let key = max(dot(normal, keyDir), 0.0);
    let sky = 0.5 + 0.5 * normal.y;
    let lighting = vec3f(1.0, 0.95, 0.86) * key * 1.15 + vec3f(0.42, 0.55, 0.72) * sky * 0.45;

    if (renderMode == ${RENDER_HEIGHTMAP}u) {
        return vec4f(vec3f(t), 1.0);
    }

    if (renderMode == ${RENDER_SLOPE}u) {
        // 0° → blue, 30°+ → red (angle of repose check)
        let slopeDeg = acos(clamp(normal.y, -1.0, 1.0)) * 57.2958;
        return vec4f(heatmapColor(slopeDeg / 32.0) * (0.55 + 0.45 * key), 1.0);
    }

    if (renderMode == ${RENDER_DETAIL}u) {
        // Arms / child-dune contribution in metres: blue = removed, red = added
        let d = detail[idx];
        return vec4f(heatmapColor(0.5 + d / 80.0) * (0.55 + 0.45 * key), 1.0);
    }

    // Lit Namib sand with pale clay pans
    let sandLow = vec3f(0.74, 0.42, 0.24);
    let sandHigh = vec3f(0.86, 0.56, 0.32);
    let pan = vec3f(0.86, 0.84, 0.78);
    var albedo = mix(sandLow, sandHigh, smoothstep(0.0, 0.6, t));
    albedo = mix(albedo, pan, 1.0 - smoothstep(0.05, 1.5, input.height));

    var lit = albedo * lighting;
    let fog = smoothstep(0.0, 1.0, length(input.worldPos.xz) / (${SCENE_AREA.toFixed(4)} * 0.85));
    lit = mix(lit, vec3f(0.80, 0.74, 0.66), fog * 0.2);
    return vec4f(pow(clamp(lit, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 1.15)), 1.0);
}
`;

export async function createRenderer(canvas, pipeline, engine) {
    const scene = createSceneContext(engine);

    const camera = createDefaultCamera(scene);
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3.2;
    camera.radius = SCENE_AREA * 1.3;
    camera.target = { x: 0, y: SCENE_MAX_HEIGHT * 0.15, z: 0 };
    setCameraLimits(camera, {
        lowerRadiusLimit: SCENE_AREA * 0.08,
        upperRadiusLimit: SCENE_AREA * 4.0,
        lowerBetaLimit: 0.05,
        upperBetaLimit: Math.PI * 0.49,
    });
    attachControl(camera, canvas, scene);
    canvas.addEventListener("wheel", (e) => {
        if ((e.deltaY < 0 && camera.inertialRadiusOffset < 0) || (e.deltaY > 0 && camera.inertialRadiusOffset > 0)) {
            camera.inertialRadiusOffset = 0;
        }
        if (e.deltaY < 0 && camera.radius <= camera.lowerRadiusLimit + 1e-3) {
            camera.inertialRadiusOffset = 0;
        }
    });

    addToScene(scene, createHemisphericLight([0, 1, 0], 1.0));

    const ground = createGround(engine, {
        width: SCENE_AREA,
        height: SCENE_AREA,
        subdivisions: N - 1,
    });

    const dunesMaterial = createShaderMaterial({
        name: "dunesRender",
        vertexSource: DUNES_VERTEX_SOURCE,
        fragmentSource: DUNES_FRAGMENT_SOURCE,
        attributes: ["position", "uv"],
        uniforms: [
            "viewProjection",
            { name: "renderMode", type: "u32" },
        ],
        storageBuffers: [
            { name: "heights", type: "array<i32>" },
            { name: "detail", type: "array<f32>" },
        ],
        backFaceCulling: false,
        depthWrite: true,
    });

    ground.material = dunesMaterial;
    addToScene(scene, ground);

    const sbs = pipeline.getStorageBuffers();
    setShaderStorageBuffer(dunesMaterial, "heights", sbs.heights);
    setShaderStorageBuffer(dunesMaterial, "detail", sbs.detail);
    setShaderUniform(dunesMaterial, "renderMode", RENDER_LIT);

    await registerScene(scene);

    return {
        engine,
        scene,
        camera,
        ground,
        dunesMaterial,
        setRenderMode(mode) {
            setShaderUniform(dunesMaterial, "renderMode", mode);
        },
        async start() {
            await startEngine(engine);
        },
    };
}
