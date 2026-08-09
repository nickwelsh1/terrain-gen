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

import { N, SCENE_AREA, SCENE_MAX_HEIGHT, RENDER_HEIGHTMAP, RENDER_LIT, RENDER_NORMALS } from "./constants.js";

// Vertex shader: displaces ground vertices based on height from storage buffer
const DUNES_VERTEX_SOURCE = `
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) height: f32,
};

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Read height from storage buffer
    let idx = u32(input.uv.x * f32(${N - 1}.0)) + u32(input.uv.y * f32(${N - 1}.0)) * ${N}u;
    let heightFixed = heights[idx];
    let height = f32(heightFixed) / 10000.0; // Convert from fixed-point

    // Displace vertex position
    let worldPos = shaderSystem.world * vec4f(input.position.x, height, input.position.z, 1.0);
    out.position = scene.viewProjection * worldPos;

    out.uv = input.uv;
    out.height = height;

    return out;
}
`;

// Fragment shader: renders dunes with sand coloring and lighting
const DUNES_FRAGMENT_SOURCE = `
struct FragmentInput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) height: f32,
};

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4f {
    let renderMode = shaderUniforms.renderMode;

    // Heightmap mode (grayscale)
    if (renderMode == ${RENDER_HEIGHTMAP}u) {
        let normalizedHeight = input.height / ${SCENE_MAX_HEIGHT.toFixed(3)};
        return vec4f(vec3f(normalizedHeight), 1.0);
    }

    // Lit terrain mode (sand coloring)
    if (renderMode == ${RENDER_LIT}u) {
        // Simple sand color based on height
        let normalizedHeight = clamp(input.height / ${SCENE_MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);

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
        let idx = u32(input.uv.x * f32(${N - 1}.0)) + u32(input.uv.y * f32(${N - 1}.0)) * ${N}u;

        let h_center = f32(heights[idx]) / 10000.0;

        // Sample neighbors (with boundary checks)
        var h_right = h_center;
        var h_left = h_center;
        var h_up = h_center;
        var h_down = h_center;

        let x_idx = u32(input.uv.x * f32(${N - 1}.0));
        let y_idx = u32(input.uv.y * f32(${N - 1}.0));

        if (x_idx < ${N - 1}u) {
            h_right = f32(heights[idx + 1u]) / 10000.0;
        }
        if (x_idx > 0u) {
            h_left = f32(heights[idx - 1u]) / 10000.0;
        }
        if (y_idx < ${N - 1}u) {
            h_up = f32(heights[idx + ${N}u]) / 10000.0;
        }
        if (y_idx > 0u) {
            h_down = f32(heights[idx - ${N}u]) / 10000.0;
        }

        let dx = (h_right - h_left) / (2.0 * eps);
        let dy = (h_up - h_down) / (2.0 * eps);

        let normal = normalize(vec3f(-dx, 1.0, -dy));
        return vec4f(normal * 0.5 + 0.5, 1.0);
    }

    // Default: heightmap
    let normalizedHeight = clamp(input.height / ${SCENE_MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);
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
