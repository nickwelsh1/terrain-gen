# WebGPU Terrain Erosion Simulator — Progress Tracker

Target: `webgpu.html` — a browser-based hydraulic erosion simulator using WebGPU compute + `@babylonjs/lite` 3D rendering. Build step via Vite.js if needed.

## Decisions

- **Grid size**: N = 256
- **Droplet count**: 10,000 total, `workgroup_size(64)` → 157 workgroups
- **Render engine**: `@babylonjs/lite` — WebGPU-exclusive, data-oriented, no CPU readback needed (storage buffer → vertex buffer via `VertexBuffer(engine, storageBuffer.getBuffer(), ...)` + `mesh.setVerticesBuffer()`)
- **Build step**: Vite.js (required for `@babylonjs/lite` imports and tree-shaking)
- **Simulation mode**: user enters step count, clicks "Erode", runs for that many steps then stops
- **Coexistence**: `webgpu.html` coexists with `index.html` for now; add cross-link in `index.html`
- **`webgpu-utils`**: used where appropriate, especially for Module 3 simulation loop helpers

### Real-world units

- **Grid area**: 2.56 km × 2.56 km (10 m cell spacing)
- **Height range**: 0–500 m (valleys at ~0 m, peaks up to 500 m)
- **Fixed-point scale**: `float_height_meters * 10000` → max value = 5,000,000 (well within i32)
- **Droplet water volume**: litres (e.g., 1–10 L per droplet)
- **Erosion rate**: metres per step (display as mm/step for fine control)
- **Sediment capacity**: cubic metres (m³)
- **Evaporation rate**: litres per step
- **UI labels**: all sliders show real-world units (m, L, mm, m³) with descriptive tooltips

### Pass toggle behaviour (hierarchical)

- Each compute pass has an on/off checkbox in the UI
- **Dependency chain**: heightmap → hardness → normals → erosion → deposition
- Toggling off a parent pass automatically disables (greys out) all dependent passes
  - Heightmap off → hardness, normals, erosion, deposition all disabled
  - Hardness off → erosion uses uniform hardness (no spatial variation), normals/deposition still work
  - Normals off → erosion uses raw gradient instead of precomputed slope/aspect, deposition still works
  - Erosion off → deposition disabled (nothing to deposit)
- **Toggling a pass off**: renderer switches to reading from the **base heightmap buffer** (un-eroded), visually hiding that pass's effect and all downstream effects
- **Toggling a pass back on**: renderer switches back to the **eroded heightmap buffer** — no recalculation needed, the eroded state is preserved in memory
- Requires two height buffers: `baseHeightBuffer` (immutable after generation) and `erodedHeightBuffer` (modified by simulation)
- Renderer's vertex buffer binding swaps between the two based on the deepest enabled pass in the chain

## 0. Shared Contract (blocks all other modules)

- [ ] Define GPUBuffer layout for heights: fixed-point i32 (`height_meters * 10000`), row-major 256×256 grid, max value 5,000,000 (500 m)
- [ ] Define **two height buffers**: `baseHeightBuffer` (immutable after generation) + `erodedHeightBuffer` (modified by simulation) — both with `GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX`
- [ ] Define GPUBuffer layout for hardness map: same fixed-point encoding, 256×256
- [ ] Define uniform buffer struct for live-tunable params with real-world units: rain rate (L/step), erosion rate (mm/step), deposition rate (m³/step), evaporation (L/step), sediment capacity (m³), step count
- [ ] Define pass toggle flags in uniform buffer (u32 bitmask: heightmap gen, hardness gen, normals, erosion, deposition)
- [ ] Document buffer sizes, binding indices, and grid dimension constant `N = 256`, cell spacing `10 m`, area `2.56 km × 2.56 km`
- [ ] Add WebGPU feature-detection + fallback message in `webgpu.html`

## 1. Module 1 — Map Generation (no dependencies, parallel)

- [ ] Write WGSL fBm heightmap compute shader (layered Perlin/Simplex noise) → shared height buffer
- [ ] Write WGSL hardness map compute shader (ridged multifractal → threshold → hardness buffer)
- [ ] Implement `generateMaps(seed, params) → { heightBuffer, hardnessBuffer }`
- [ ] Test: verify buffers are populated with valid fixed-point values for a given seed
- [ ] Test: determinism — same seed produces same buffer contents

## 2. Module 2 — Analysis Engine (depends on Module 1 buffer layout, parallel with stubs)

- [ ] Write WGSL Sobel/Scharr compute pass over height buffer → normal map (RGB texture)
- [ ] Derive slope (vertical deviation of normal) → slope texture
- [ ] Derive aspect (flipped horizontal vector = flow direction) → aspect texture
- [ ] Implement `computeNormals(heightBuffer) → { normalTexture, slopeTexture, aspectTexture }`
- [ ] Stub with placeholder heightmap for early development
- [ ] Test: normal map values in valid range, slope in [0, 1]

## 3. Module 3 — Simulation Loop (core, starts against stubs, integrates last)

- [ ] Define `Droplet` struct in WGSL (pos, dir, speed, water, sediment) — 10K droplets, `workgroup_size(64)`
- [ ] Write droplet compute pass: sample height via bilinear read of atomics (4× `atomicLoad` per step)
- [ ] Implement water allocation and velocity tracking with adaptive sub-stepping
- [ ] Implement material detachment scaled by slope and hardness
- [ ] Implement sediment transport via bilinear interpolation
- [ ] Implement velocity-threshold deposition switch
- [ ] Use `atomicSub` at source cell / `atomicAdd` at deposition cell to avoid write races
- [ ] Add fixed-point overflow clamping around every atomic op (i32 range vs `* 10000` scale)
- [ ] Use `webgpu-utils` helpers where appropriate for buffer management and compute pass setup
- [ ] Wire in real Module 1 height/hardness buffers
- [ ] Wire in real Module 2 slope/aspect textures
- [ ] Test: droplet simulation produces visible terrain changes over N iterations
- [ ] Test: no NaN/overflow in fixed-point arithmetic under stress params

### Known optimisations to consider
- [ ] **Spatial hashing**: instead of all 10K droplets in one dispatch, bucket by grid cell to reduce atomic contention
- [ ] **Double-buffer heights**: read from buffer A, write to buffer B, swap — avoids race conditions entirely (trade-off: no intra-step visibility)
- [ ] **Early exit**: droplets with `water < threshold` skip remaining compute (via `atomicAdd` on a live-droplet counter)
- [ ] **Persistent threads**: reuse droplet slots — when a droplet dies, respawn at a new random location instead of wasting the invocation

## 4. Module 4 — Renderer (starts against stub geometry, integrates last)

- [ ] `@babylonjs/lite` scene setup: ground mesh (256×256 vertices) displaced from height buffer
- [ ] Create `VertexBuffer` from height storage buffer via `VertexBuffer(engine, storageBuffer.getBuffer(), ...)` — no CPU readback
- [ ] Lighting shader: dot product of normal map vs. moving sun vector → diffuse + shadows
- [ ] Material blending shader: height/slope/hardness-driven texture splat (sand/grass/granite)
- [ ] Wire in real Module 2 normal texture
- [ ] Wire in real Module 3 updated height buffer (same buffer, GPU-side)
- [ ] **Visualization mode: Hardness map** — render hardness buffer as grayscale overlay on terrain (dark = soft, bright = hard)
- [ ] **Visualization mode: Normal arrows** — render per-cell normal vectors as small arrow glyphs (color-coded by direction, length by slope) overlaid on terrain; toggle density to avoid clutter at 256×256
- [ ] **Visualization mode: Erosion/deposition heatmap** — compute delta = `erodedHeightBuffer - baseHeightBuffer` per cell; render red where material removed (erosion), blue/green where deposited, neutral where unchanged; intensity proportional to magnitude
- [ ] Implement render mode switching (lit terrain / hardness / normals / erosion-deposition) via UI radio buttons
- [ ] Test: renders without errors, camera controls functional
- [ ] Test: each visualization mode displays correct data

## 5. UI Layer (no simulation dependency, fully parallel)

- [ ] Build native HTML/CSS slider panel (no framework) matching `index.html` style
- [ ] Sliders with real-world unit labels:
  - [ ] Rain rate (L/step)
  - [ ] Erosion rate (mm/step)
  - [ ] Deposition rate (m³/step)
  - [ ] Evaporation (L/step)
  - [ ] Sediment capacity (m³)
- [ ] Step count input + "Erode" button — runs simulation for N steps then stops
- [ ] Visualization mode selector (radio buttons):
  - [ ] **Lit terrain** — default 3D shaded view with material splatting
  - [ ] **Hardness map** — grayscale overlay (dark = soft, bright = hard)
  - [ ] **Normal arrows** — per-cell normal vector glyphs (color = direction, length = slope); density slider to reduce clutter
  - [ ] **Erosion/deposition heatmap** — red = erosion, blue/green = deposition, intensity = magnitude; legend with mm/m³ scale
- [ ] Pass toggle checkboxes — hierarchical, disabling a parent greys out dependents:
  - [ ] Heightmap generation (root — all others disabled if off)
  - [ ] Hardness map generation (depends on heightmap)
  - [ ] Normal/slope/aspect calculation (depends on heightmap)
  - [ ] Hydraulic erosion (depends on hardness + normals)
  - [ ] Deposition (depends on erosion)
- [ ] Toggling a pass off → renderer reads from `baseHeightBuffer` (hides that pass + all downstream effects)
- [ ] Toggling a pass back on → renderer reads from `erodedHeightBuffer` (restores preserved state, no recalculation)
- [ ] Greyed-out checkboxes are visually disabled and non-interactive when parent is off
- [ ] "Reset to Base" button — copies `baseHeightBuffer` → `erodedHeightBuffer`, clears all erosion
- [ ] Implement `updateParams()` → writes directly to uniform buffer (no virtual DOM)
- [ ] Bind slider + checkbox change events to uniform buffer update
- [ ] Display real-world scale info (area: 2.56 km², height: 0–500 m, cell: 10 m)
- [ ] Optional: paint water/hardness interaction via raycast-to-UV → write to hardness/height buffers
- [ ] Test: slider changes propagate to simulation within one frame
- [ ] Test: toggling a pass off/on correctly swaps between base and eroded buffers

## 6. Integration Pass (after all modules land)

- [ ] Wire UI writes → uniform buffer → simulation loop → renderer
- [ ] Confirm frame loop reads updated heights from GPU buffer for mesh displacement (no CPU round-trip)
- [ ] Verify render loop reads latest height buffer for mesh displacement
- [ ] End-to-end test: generate → erode (N steps) → render cycle completes at interactive framerate
- [ ] Add `webgpu.html` link to `index.html` navigation
- [ ] Update `package.json` dependencies (`@babylonjs/lite`, `webgpu-utils`, Vite)
- [ ] Set up Vite build config (`vite.config.js` for `webgpu.html` entry)
- [ ] Lint: `pnpm lint`

## Open Questions

- [ ] (none remaining — all resolved)
