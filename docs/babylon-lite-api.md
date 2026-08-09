# @babylonjs/lite — API Reference for This Project

Notes on the internal API surface, discovered from reading `index.d.ts` and the
compiled `dist/index.js`. Focuses on what we need for the WebGPU erosion simulator.

There are also excellent docs at the following URL's
https://doc.babylonjs.com/lite/ 
https://doc.babylonjs.com/lite/architecture/08-standard-material/
https://doc.babylonjs.com/lite/architecture/24-shader-material/
https://doc.babylonjs.com/lite/architecture/29-post-process/
https://doc.babylonjs.com/lite/04-playground/
https://doc.babylonjs.com/lite/02-feature-comparison/
https://doc.babylonjs.com/lite/03-porting-guide/


## Core Lifecycle

```js
import { createEngine, createSceneContext, registerScene, startEngine } from "@babylonjs/lite";

const engine = await createEngine(canvas);  // EngineContext (also a SurfaceContext)
const scene = createSceneContext(engine);   // SceneContext
// ... add meshes, lights, cameras ...
await registerScene(scene);                 // builds GPU pipelines
await startEngine(engine);                  // starts RAF render loop
```

### EngineContext

- `engine._device` — the raw `GPUDevice`. Use for compute shaders, custom buffers, etc.
- `engine.surfaces` — array of rendering surfaces (index 0 is the engine itself)
- `engine.drawCallCount` — draw calls in last frame
- `engine.gpuFrameTimeMs` — GPU time (enable with `setGpuTimingEnabled`)

### SceneContext

- `scene.surface` — the surface this scene renders into (usually the engine)
- Created via `createSceneContext(engine)` or `createSceneContext(auxSurface)`
- Optional: `createSceneContext(engine, { defaultRenderTask: false })` for headless

## Camera

**Preferred:** Use `createDefaultCamera(scene)` — registers the camera with the scene automatically.

```js
import { createDefaultCamera, attachControl } from "@babylonjs/lite";

const camera = createDefaultCamera(scene);
camera.alpha = -Math.PI / 2;   // rotation around Y
camera.beta = Math.PI / 3;    // elevation
camera.radius = 38;           // distance from target
camera.target = { x: 0, y: 1.5, z: 0 };  // Vec3 object, NOT array
attachControl(camera, canvas, scene);
```

**Alternative:** `createArcRotateCamera(alpha, beta, radius, target)` — returns a camera
not yet attached to a scene. Must assign `scene.camera = camera` manually.

- Left-drag: rotate, right-drag: pan, wheel: zoom (with inertia)
- `setCameraLimits(camera, limits)` for orbit bounds
- **IMPORTANT:** Keep scene units small (≤ ~100). Large units (thousands of meters)
  cause camera frustum/projection issues — use `SCENE_SCALE` (100:1) to scale down.

## Lights

```js
import { createHemisphericLight, createDirectionalLight, addToScene } from "@babylonjs/lite";

addToScene(scene, createHemisphericLight([0, 1, 0], 1.0));
// or
addToScene(scene, createDirectionalLight([dx, dy, dz], intensity));
```

## Meshes

```js
import { createGround, addToScene } from "@babylonjs/lite";

const ground = createGround(engine, {
    width: 2560,       // world units
    height: 2560,
    subdivisions: 255, // N-1 for 256×256 vertices
    minHeight: 0,
    maxHeight: 500,
    uvScale: [1, 1],
});
ground.material = myMaterial;
addToScene(scene, ground);
```

- `createMeshFromData(engine, name, positions, normals, indices, uvs?, ...)` — raw geometry
- `Mesh` interface: plain data object with `.material`, `.receiveShadows`, `.worldMatrix`, etc.
- `MeshGPU` (internal): `.positionBuffer`, `.normalBuffer`, `.indexBuffer` — raw GPUBuffers

## ShaderMaterial (custom WGSL)

```js
import { createShaderMaterial, setShaderUniform, setShaderStorageBuffer } from "@babylonjs/lite";

const mat = createShaderMaterial({
    name: "myMaterial",
    vertexSource: wgslString,
    fragmentSource: wgslString,
    attributes: ["position", "uv", "normal"],  // ShaderAttributeName[]
    uniforms: ["world", "viewProjection", "cameraPosition", { name: "myFloat", type: "f32" }],
    storageBuffers: [{ name: "heights", type: "array<i32>" }],
    // needAlphaBlending?: false,
    // backFaceCulling?: true,
    // depthWrite?: true,
});
```

### System Uniforms (auto-populated each frame)

`"world"`, `"viewProjection"`, `"view"`, `"projection"`, `"worldView"`,
`"worldViewProjection"`, `"cameraPosition"`, `"screenSize"`, `"alphaCutoff"`

### Custom Uniform Types

`"f32"`, `"u32"`, `"i32"`, `"vec2<f32>"`, `"vec3<f32>"`, `"vec4<f32>"`, `"mat4x4<f32>"`

### Setting Values

```js
setShaderUniform(material, "myFloat", 42.0);
setShaderFloat(material, "myFloat", 42.0);  // convenience
setShaderVector3(material, "myVec3", [1, 2, 3]);
setShaderMatrix(material, "world", float32ArrayOrMat4);
setShaderStorageBuffer(material, "heights", storageBuffer);
setShaderTexture(material, "mySampler", texture2D);
```

### Storage Buffer Binding — IMPORTANT

`setShaderStorageBuffer` **only accepts `StorageBuffer` objects created by
`createStorageBuffer`** — raw `GPUBuffer` is NOT supported.

The WGSL is auto-generated with storage buffers at `@group(1) @binding(N)` where
N starts after samplers. The binding is `var<storage, read>` (read-only).

### WGSL Template System — CRITICAL

Babylon Lite does **not** use the user's `vertexSource`/`fragmentSource` as-is.
It generates a preamble via `YJ()` and **prepends** it to the user source.

**Auto-generated preamble** (before user source):
```wgsl
// @group(0) — scene uniforms (always present)
struct a { viewProjection: mat4x4<f32>, view: mat4x4<f32>, vEyePosition: vec4<f32>, ... }
@group(0) @binding(0) var<uniform> scene: a;

// @group(1) — shader system + custom uniforms + samplers + storage buffers
struct ShaderSystemUniforms { <fields from declared system uniforms> }
@group(1) @binding(0) var<uniform> shaderSystem: ShaderSystemUniforms;

// Only if custom uniforms declared:
struct ShaderUniforms { <fields from declared custom uniforms> }
@group(1) @binding(1) var<uniform> shaderUniforms: ShaderUniforms;

// Samplers at @group(1) @binding(2+), then storage buffers after samplers
@group(1) @binding(N) var<storage, read> heights: array<i32>;
...

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
    // user source is appended here, then struct is closed with };
};
```

**User vertex source** should contain:
- `struct VertexOutput { @builtin(position) position: vec4f, @location(N) ... }`
- `@vertex fn mainVertex(input: VertexInput) -> VertexOutput { ... }`

**User fragment source** should contain:
- `struct FragmentInput { @builtin(position) position: vec4f, @location(N) ... }`
- `@fragment fn mainFragment(input: FragmentInput) -> @location(0) vec4f { ... }`

**Entry point names MUST be `mainVertex` and `mainFragment`** — hardcoded in pipeline creation.

**Available auto-injected variables in shader code:**
- `scene.viewProjection` (mat4x4) — always (at `@group(0)`)
- `scene.view` (mat4x4) — always
- `scene.vEyePosition` (vec4) — always (camera position)
- `shaderSystem.viewProjection` (mat4x4) — pre-multiplied worldViewProjection, if `"viewProjection"` declared
- `shaderSystem.world` (mat4x4) — if `"world"` declared
- `shaderSystem.cameraPosition` (vec3) — if `"cameraPosition"` declared
- `shaderUniforms.<name>` — custom uniforms declared as `{ name, type }`
- Storage buffers by name — read-only (`var<storage, read>`)

**System uniform names** (auto-populated each frame):
`"world"`, `"viewProjection"`, `"view"`, `"projection"`, `"worldView"`,
`"worldViewProjection"`, `"cameraPosition"`, `"screenSize"`, `"alphaCutoff"`

**Custom uniform types**: `"f32"`, `"u32"`, `"i32"`, `"vec2<f32>"`, `"vec3<f32>"`, `"vec4<f32>"`, `"mat4x4<f32>"`

## StorageBuffer (internal API)

```js
import { createStorageBuffer, updateStorageBuffer, disposeStorageBuffer } from "@babylonjs/lite";

const buf = createStorageBuffer(engine, dataArrayView, "label");
// buf._buffer     → raw GPUBuffer (STORAGE | COPY_DST usage)
// buf._data       → ArrayBufferView (CPU mirror)
// buf._engine     → EngineContext
// buf._destroyed  → boolean
// buf.byteLength  → writable capacity (4-byte aligned)

updateStorageBuffer(engine, buf, newDataView, byteOffset?);
disposeStorageBuffer(buf);
```

### Accessing the raw GPUBuffer

`StorageBuffer._buffer` is the underlying `GPUBuffer` (not in public types but
stable — used internally by `w1A(engine, buf)` which returns `buf._buffer`).

Usage: create `StorageBuffer` via `createStorageBuffer`, then use `buf._buffer`
for compute shader bind groups. Use `setShaderStorageBuffer(mat, name, buf)` for
render-side binding.

### Buffer creation internals

`createStorageBuffer(engine, data, label)` creates a `GPUBuffer` with:
- `usage: STORAGE | COPY_DST`
- `mappedAtCreation: true` (copies data on creation)
- Size padded to 4-byte alignment

**Limitation:** No way to add `COPY_SRC` or `VERTEX` usage flags. For buffer-to-buffer
copies, use `device.queue.writeBuffer` with CPU readback, or create a separate raw
`GPUBuffer` for the copy source.

## Frame Loop

```js
import { onBeforeRender, renderFrame, stepScene } from "@babylonjs/lite";

onBeforeRender(scene, (deltaMs) => { /* per-frame logic */ });
// startEngine() runs the RAF loop automatically
// For manual control: renderFrame(engine, deltaMs)
// For headless: stepScene(engine, scene, deltaMs)
```

## Compute Shader Integration

Babylon Lite does not provide a compute shader API. Use raw WebGPU via `engine._device`:

```js
const device = engine._device;
const module = device.createShaderModule({ code: wgslString });
const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint: "main" },
});
// Bind groups can use StorageBuffer._buffer or raw GPUBuffers
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storageBuffer._buffer } }],
});

// In onBeforeRender or manual command:
const encoder = device.createCommandEncoder();
const pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.dispatchWorkgroups(...);
pass.end();
device.queue.submit([encoder.finish()]);
```

## Key Patterns for This Project

1. **Shared buffers**: Create via `createStorageBuffer(engine, data)` → use `._buffer`
   for compute bind groups → use `setShaderStorageBuffer(mat, name, buf)` for render
2. **Compute passes**: Use `engine._device` directly — no Babylon Lite compute API
3. **Render material**: `ShaderMaterial` with `storageBuffers` declaration for height/hardness
4. **Per-frame updates**: `onBeforeRender(scene, cb)` for uniform updates
5. **No CPU readback**: Compute writes to `StorageBuffer._buffer`, render reads from same buffer
