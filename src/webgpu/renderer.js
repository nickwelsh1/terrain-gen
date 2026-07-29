// Renderer module: Babylon Lite scene setup, custom shader material, render loop.
// The vertex shader reads heights from a storage buffer — no CPU readback.

import {
    createSceneContext,
    createDefaultCamera,
    createHemisphericLight,
    createGround,
    createMeshFromData,
    createShaderMaterial,
    attachControl,
    addToScene,
    registerScene,
    startEngine,
    setShaderUniform,
    setShaderStorageBuffer,
} from "@babylonjs/lite";

import { N, SCENE_AREA, SCENE_MAX_HEIGHT } from "./constants.js";
import { RENDER_VERTEX_SOURCE as VS_SRC } from "./shaders/render.wgsl.js";
import { RENDER_FRAGMENT_SOURCE as FS_SRC } from "./shaders/render.wgsl.js";
import { WALL_VERTEX_SOURCE, WALL_FRAGMENT_SOURCE } from "./shaders/wall.wgsl.js";
import { buildSkirtGeometry } from "./skirt.js";

export async function createRenderer(canvas, pipeline, engine) {
    const scene = createSceneContext(engine);

    // Camera — orbit around terrain center (scene-scaled units)
    const camera = createDefaultCamera(scene);
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 3;
    camera.radius = SCENE_AREA * 1.5;
    camera.target = { x: 0, y: SCENE_MAX_HEIGHT * 0.3, z: 0 };
    attachControl(camera, canvas, scene);

    // Light
    addToScene(scene, createHemisphericLight([0, 1, 0], 1.0));

    // Ground mesh — 256×256 vertices in scene-scaled units
    const ground = createGround(engine, {
        width: SCENE_AREA,
        height: SCENE_AREA,
        subdivisions: N - 1,
    });

    // Custom shader material — reads from storage buffers in vertex shader
    const renderMaterial = createShaderMaterial({
        name: "terrainRender",
        vertexSource: VS_SRC,
        fragmentSource: FS_SRC,
        attributes: ["position", "uv"],
        uniforms: [
            "viewProjection",
            { name: "renderMode", type: "u32" },
        ],
        storageBuffers: [
            { name: "heights", type: "array<i32>" },
            { name: "hardness", type: "array<i32>" },
            { name: "normals", type: "array<u32>" },
            { name: "slopes", type: "array<u32>" },
        ],
        backFaceCulling: false,
        depthWrite: true,
    });

    ground.material = renderMaterial;
    addToScene(scene, ground);

    // Side walls + bottom cap — makes the tile a solid slice of ground.
    // Top wall vertices follow the terrain surface, read from the same buffer.
    const skirt = buildSkirtGeometry();
    const walls = createMeshFromData(
        engine,
        "terrainWalls",
        skirt.positions,
        skirt.normals,
        skirt.indices,
        skirt.uvs,
    );

    const wallMaterial = createShaderMaterial({
        name: "terrainWalls",
        vertexSource: WALL_VERTEX_SOURCE,
        fragmentSource: WALL_FRAGMENT_SOURCE,
        attributes: ["position", "normal", "uv"],
        uniforms: ["viewProjection"],
        storageBuffers: [{ name: "heights", type: "array<i32>" }],
        backFaceCulling: false,
        depthWrite: true,
    });

    walls.material = wallMaterial;
    addToScene(scene, walls);

    // Bind storage buffers to the materials
    const sbs = pipeline.getStorageBuffers();
    setShaderStorageBuffer(renderMaterial, "heights", sbs.erodedHeight);
    setShaderStorageBuffer(renderMaterial, "hardness", sbs.hardness);
    setShaderStorageBuffer(renderMaterial, "normals", sbs.normals);
    setShaderStorageBuffer(renderMaterial, "slopes", sbs.slopes);
    setShaderStorageBuffer(wallMaterial, "heights", sbs.erodedHeight);

    // Set initial render mode
    setShaderUniform(renderMaterial, "renderMode", 0);

    // Register and start
    await registerScene(scene);

    return {
        engine,
        scene,
        camera,
        ground,
        walls,
        renderMaterial,
        wallMaterial,
        setRenderMode(mode) {
            setShaderUniform(renderMaterial, "renderMode", mode);
        },
        async start() {
            await startEngine(engine);
        },
    };
}
