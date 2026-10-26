# 00 — Architecture, Buffer Contracts & Pass Graph

## Overview

`src/webgpu/` is a Gaea-style multi-pass GPU terrain compositor. Instead of one monolithic uber-shader, terrain synthesis is decomposed into composable GPU compute operators running over a shared `TerrainState` buffer set.

Every pass follows the five WebGPU contracts:
1. **Capability contract**: Standard WebGPU compute (`@workgroup_size(8, 8)` for 2D grid passes, `@workgroup_size(64)` for 1D particle passes). No optional extensions required.
2. **Data contract**: Host-shareable WGSL structs packed via `DataView` with calculated `AlignOf` and `SizeOf` (16-byte total size rounding for uniform buffers).
3. **Pass contract**: Explicit read/write buffer bindings and ping-pong ownership (`heightA` ↔ `heightB`, `auxA` ↔ `auxB`).
4. **Presentation contract**: Babylon Lite `ShaderMaterial` reading `StorageBuffer`s directly in vertex/fragment shaders (zero CPU readback).
5. **Lifecycle contract**: Persistent `GPUBuffer` and `GPUComputePipeline` instances; bind groups rebuilt or chosen by ping-pong index without per-frame allocation.

---

## Persistent Resources (`TerrainState` in `src/webgpu/state.js`)

For a grid of `N × N` cells (`GRID_CELLS = N * N`):

| Buffer Name | WGSL Type | Bytes / Cell | Usage | Purpose |
|---|---|---:|---|---|
| `heightA`, `heightB` | `array<i32>` | 4 | `STORAGE \| COPY_DST` | Fixed-point elevation (`meters * 10000`). Ping-pong pair for neighborhood shapers/sims; atomic target for droplet erosion. |
| `baseHeight` | `array<i32>` | 4 | `STORAGE \| COPY_DST` | Pre-simulation snapshot of the composited base terrain so "Reset to Base" restores without re-running generators if desired, and for erosion delta heatmaps. |
| `layerScratch` | `array<i32>` | 4 | `STORAGE \| COPY_DST` | Scratch height buffer holding a secondary Biome Layer's generated/shaped height before `blend.layer` merges it into the active height buffer. |
| `auxA`, `auxB` | `array<vec4f>` | 16 | `STORAGE \| COPY_DST` | Ping-pong 4-channel float state per cell: `.x = water (m)`, `.y = sediment (m)`, `.z = maskA [0..1]`, `.w = maskB [0..1]`. |
| `hardness` | `array<i32>` | 4 | `STORAGE \| COPY_DST` | Fixed-point rock hardness `[0..10000]` (`[0..1]`). Modulates hydraulic erosion and bedrock repose angle. |
| `normals` | `array<u32>` | 4 | `STORAGE \| COPY_DST` | Packed `rgba8unorm` surface normal `(nx, ny, nz, 1)`. |
| `slopes` | `array<u32>` | 4 | `STORAGE \| COPY_DST` | Packed `rgba8unorm`: `.r = slope (acos(ny)/(pi/2))`, `.g = meanCurvature (0.5 + 0.5*laplacian)`, `.b = ambientOcclusion [0..1]`, `.a = 1`. |
| `aspects` | `array<u32>` | 4 | `STORAGE \| COPY_DST` | Packed `rgba8unorm` downhill 2D unit direction `(ax*0.5+0.5, az*0.5+0.5, 0, 1)`. |
| `droplets` | `array<Droplet>` | 32 | `STORAGE \| COPY_DST` | Private buffer for `sim.dropletErosion` (`DROPLET_COUNT * 32` bytes). |

### Ping-Pong Ownership Rules

- `state.activeHeight` returns the current authoritative height `StorageBuffer` (`heightA` or `heightB`).
- `state.inactiveHeight` returns the write target for neighborhood passes.
- `state.swapHeight()` flips the active height index.
- `state.activeAux` / `state.inactiveAux` / `state.swapAux()` do the same for `auxA` and `auxB`.
- **Pointwise passes** (`pingPong: false`) bind `state.activeHeight` as `read_write` (or write into `layerScratch` when evaluating a secondary layer).
- **Neighborhood passes** (`pingPong: true`) bind `state.activeHeight` as `var<storage, read>` and `state.inactiveHeight` as `var<storage, read_write>`, then the graph runner calls `state.swapHeight()` immediately after `pass.end()`.
- After any pass chain that swaps height or aux buffers, `renderer.syncBuffers(state)` updates the `ShaderMaterial` storage buffer references (`setShaderStorageBuffer`) so the 3D mesh and skirt walls always render from `state.activeHeight` and `state.activeAux`.

---

## Uniform Buffer Layout & Auto-Packer (`src/webgpu/operators/registry.js`)

Every operator declares its `uniformLayout` as an ordered array of `{ key, type }` where `type` is `"f32"`, `"i32"`, or `"u32"` (all 4-byte scalars; `vec2f`/`vec4f` can also be expressed or expanded to scalars).

- `computeUniformSchema(uniformLayout)`:
  - Assigns each field a byte offset using natural WGSL alignment (`4` for `f32`/`i32`/`u32`, `8` for `vec2f`, `16` for `vec3f`/`vec4f`).
  - Rounds total byte length up to a multiple of `16` bytes (minimum `16` bytes) to satisfy WebGPU uniform binding size rules.
- `packUniforms(schema, params)`:
  - Allocates `new ArrayBuffer(schema.byteLength)` and writes each field via `DataView` (`setFloat32`, `setInt32`, `setUint32` with `littleEndian = true`).
  - Never uses `Float32Array` for `u32`/`i32` fields.
- Each operator owns a dedicated `GPUBuffer` (`GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST`) so operators never clobber each other's uniforms inside a single command encoder.

---

## Layer-Stack Execution Model (`src/webgpu/operators/graph.js`)

A terrain preset or user configuration consists of:
1. **Biome Layers (`layers[]`)**:
   - **Layer 0 (Base Layer)**:
     - Runs its `generator` (`gen.ridgeFbm`, `gen.duneField`, `gen.voronoiBlock`, or `gen.islandCaldera`) directly into `state.activeHeight` (and clears/initializes `state.activeAux`).
     - Runs any enabled per-layer `shapers[]` (`shape.terrace`, `shape.fold`, `shape.warp`, `shape.curveRemap`, `shape.glacialCarve`).
   - **Layer $k \ge 1$ (Overlay Biome Layers, e.g., Basin Sand Dunes, Caldera Rim, Alpine Cap)**:
     - Evaluates its `mask` (`mask.select` + optional `mask.blur` iterations) using the current `state.activeHeight` + `slopes`/`normals` into `aux.z` (`maskA`).
     - Runs its `generator` and per-layer `shapers[]` on `layerScratch` (using `heightB` as ping-pong partner before restoring).
     - Runs `blend.layer` (`heightLerp`, `smin`, `additive`, or `mix`) combining `state.activeHeight` and `layerScratch` weighted by `maskA`, plus updating `aux.y` (`sediment`) where sand/talus layers deposit material.
2. **Global Modifiers & Simulations (`simulations[]`)**:
   - Snapshot `state.activeHeight` → `state.baseHeight` (so erosion heatmaps and "Reset to Base" work on the full multi-layer composite).
   - Run `mask.hardness` (if enabled).
   - Run one-shot analytic erosion (`sim.phacelleErosion`), iterative thermal talus (`sim.thermalTalus`), iterative wind/snow drift (`sim.windDrift`), water flooding (`sim.waterLevel`), and/or interactive droplet batches (`sim.dropletErosion`).
3. **Final Analysis (`detail.analysis`)**:
   - Always runs last on `state.activeHeight` to populate `normals`, `slopes` (slope + curvature + AO), and `aspects` for the 3D lit shader and mask inspector views.
