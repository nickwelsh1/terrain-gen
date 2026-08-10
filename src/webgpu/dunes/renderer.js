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

import { N, SCENE_AREA, SCENE_MAX_HEIGHT, SCENE_SCALE, FIXED_POINT_SCALE, MAX_HEIGHT_M, RENDER_HEIGHTMAP, RENDER_LIT, RENDER_NORMALS, RENDER_STAGE_ISOLATION, RENDER_SLOPE_HEATMAP, RENDER_CURVATURE, RENDER_WIREFRAME, RENDER_DEBUG_NOISE } from "./constants.js";

// Vertex shader: displaces ground vertices based on height from storage buffer
const DUNES_VERTEX_SOURCE = `
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_SCALE_F : f32 = ${SCENE_SCALE};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Map UV to grid cell (following existing terrain pattern)
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

// Fragment shader: renders dunes with sand coloring and lighting
const DUNES_FRAGMENT_SOURCE = `
const N_F : f32 = ${N}.0;
const N_U : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const SCENE_MAX_H : f32 = ${SCENE_MAX_HEIGHT};
const MAX_HEIGHT_M : f32 = ${MAX_HEIGHT_M}.0;

struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos: vec3f,
    @location(2) height: f32,
};

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let renderMode = shaderUniforms.renderMode;

    // Heightmap mode (grayscale)
    if (renderMode == ${RENDER_HEIGHTMAP}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Lit terrain mode (sand coloring)
    if (renderMode == ${RENDER_LIT}u) {
        // Simple sand color based on height
        let normalizedHeight = clamp(input.height / MAX_HEIGHT_M, 0.0, 1.0);

        // Sand color palette: from light yellow to darker orange
        let lightSand = vec3f(0.96, 0.87, 0.70);
        let darkSand = vec3f(0.76, 0.60, 0.42);
        let sandColor = mix(lightSand, darkSand, normalizedHeight);

        // Simple directional lighting
        let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
        let normal = normalize(vec3f(0.0, 1.0, 0.0)); // Simplified normal
        let diffuse = max(dot(normal, lightDir), 0.0);

        let finalColor = sandColor * (0.4 + 0.6 * diffuse);
        return vec4f(finalColor, 1.0);
    }

    // Normals mode (slope visualization)
    if (renderMode == ${RENDER_NORMALS}u) {
        // Compute normal from height gradient
        let eps = 0.01;
        let gridX = input.uv.x * (N_F - 1.0);
        let gridY = (1.0 - input.uv.y) * (N_F - 1.0);
        let ix = u32(clamp(gridX, 0.0, N_F - 1.0));
        let iy = u32(clamp(gridY, 0.0, N_F - 1.0));
        let idx = iy * N_U + ix;

        let h_center = f32(heights[idx]) / FIXED_SCALE;

        // Sample neighbors (with boundary checks)
        var h_right = h_center;
        var h_left = h_center;
        var h_up = h_center;
        var h_down = h_center;

        if (ix < N_U - 1u) {
            h_right = f32(heights[idx + 1u]) / FIXED_SCALE;
        }
        if (ix > 0u) {
            h_left = f32(heights[idx - 1u]) / FIXED_SCALE;
        }
        if (iy < N_U - 1u) {
            h_up = f32(heights[idx + N_U]) / FIXED_SCALE;
        }
        if (iy > 0u) {
            h_down = f32(heights[idx - N_U]) / FIXED_SCALE;
        }

        let dx = (h_right - h_left) / (2.0 * eps);
        let dy = (h_up - h_down) / (2.0 * eps);

        let normal = normalize(vec3f(-dx, 1.0, -dy));
        return vec4f(normal * 0.5 + 0.5, 1.0);
    }

    // Stage isolation mode - same as heightmap for now
    if (renderMode == ${RENDER_STAGE_ISOLATION}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Slope heatmap - same as normals for now
    if (renderMode == ${RENDER_SLOPE_HEATMAP}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Curvature - same as heightmap for now
    if (renderMode == ${RENDER_CURVATURE}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Wireframe - same as heightmap for now
    if (renderMode == ${RENDER_WIREFRAME}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Debug noise - same as heightmap for now
    if (renderMode == ${RENDER_DEBUG_NOISE}u) {
        let normalizedHeight = input.height / MAX_HEIGHT_M;
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Default: heightmap
    let normalizedHeight = clamp(input.height / MAX_HEIGHT_M, 0.0, 1.0);
    return vec4f(vec3f(normalizedHeight), 1.0);
}
`;

export async function createRenderer(canvas, pipeline, engine) {
    const scene = createSceneContext(engine);

    // Camera — orbit around dunes center (scene-scaled units)
    const camera = createDefaultCamera(scene);
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3;
    camera.radius = SCENE_AREA * 2.0;
    camera.target = { x: 0, y: SCENE_MAX_HEIGHT * 0.5, z: 0 };
    attachControl(camera, canvas, scene);

    // Light
    addToScene(scene, createHemisphericLight([0, 1, 0], 1.0));

    // Ground mesh — 256×256 vertices in scene-scaled units
    const ground = createGround(engine, {
        width: SCENE_AREA,
        height: SCENE_AREA,
        subdivisions: N - 1,
    });

    // Custom shader material — reads from storage buffer in vertex shader
    const dunesMaterial = createShaderMaterial({
        name: "dunesRender",
        vertexSource: DUNES_VERTEX_SOURCE,
        fragmentSource: DUNES_FRAGMENT_SOURCE,
        attributes: ["position", "uv"],
        uniforms: [
            "world",
            "viewProjection",
            { name: "renderMode", type: "u32" },
        ],
        storageBuffers: [
            { name: "heights", type: "array<i32>" },
        ],
        backFaceCulling: false,
        depthWrite: true,
    });

    ground.material = dunesMaterial;
    addToScene(scene, ground);

    // Bind storage buffer to the material
    const sbs = pipeline.getStorageBuffers();
    setShaderStorageBuffer(dunesMaterial, "heights", sbs.heights);

    // Set initial render mode
    setShaderUniform(dunesMaterial, "renderMode", RENDER_LIT); // Lit terrain

    // Register and start
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
