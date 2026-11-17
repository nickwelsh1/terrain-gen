# terrain-gen — AI Agent Instructions

## Project Overview

Procedural terrain generation engine that produces Dolomites-style mountain landscapes. Renders to a canvas via pixel buffers using layered noise, hydraulic erosion, slope calculation, and biome-based coloring.

There are two independent generators:
- **Legacy Dolomites biome renderer** (`src/terrain.js` + `src/noise.js`, used by `examples/tempterrain.html`) — colored biome output described below.
- **Natural mountain heightmap** (`src/fastnoise-terrain.js`, used by `index.html`) — a FastNoiseLite-based B&W elevation pipeline described in "FastNoiseLite Heightmap Pipeline".

## Architecture

The legacy terrain pipeline runs in this order:

1. **`initHeightmap(width, height, noise, settings)`** — Generates base height values using ridge noise with two mountain ranges at different angles, domain warping, and medium/fine detail layers. Settings control zoom, ridge sharpness, and layer toggles. Clamps to [-30, 500].
2. **`simulateErosion(heightmap, erosionStrength)`** — 8-pass hydraulic erosion simulating water flow to lowest neighbors. Uses `Math.random` for erosion probability.
3. **`calculateSlopes(heightmap)`** — Computes per-pixel slope via gradient magnitude. Returns values in [0, 1].
4. **`render(heightmap, slopeMap, microNoiseFunc, settings)`** — Maps height + slope to biome colors (snow peaks, alpine rock, scree, forest, pasture, transition). Applies hillshade directional lighting from `settings.sunAngle`. Supports grayscale heightmap mode (`settings.grayscale`). Packs to `Uint32Array` in ABGR format for `putImageData`.

## FastNoiseLite Heightmap Pipeline

`src/fastnoise-terrain.js` builds a natural mountain heightmap and is consumed by `index.html`. All stages operate on `Float64Array` elevation data in an internal unit space of `[0, HEIGHT_SCALE]` (1000); only the final step converts to pixels. `generateTerrain(width, height, settings)` runs the stages and returns `{ heightmap, slopeMap }`:

1. **`generateBaseHeightmap`** — layers warped Cellular structure (the user-supplied config), broad OpenSimplex2 FBm elevation, ridged crests, and fine detail, then normalizes and applies a height curve.
2. **`applyEdgeFalloff`** — lowers elevation toward the boundary (blends rectangular/mainland and radial/island masks, warped by low-freq noise) to shape the overall landform. This replaces "vignette" and modifies height, not pixels.
3. **`applyAsymmetricSlopes`** — steepens the scarp-facing aspect and gentles the dip side within a height band (independent smooth fades + low-freq coverage gate) to emulate folded strata.
4. **`applyThermalErosion`** — talus passes that move material downhill to soften spikes.
5. **`conditionDrainage` → `calculateFlow` → `carveChannels`** — pit-fill, D8 flow accumulation, then carve rivers whose depth/width grow with contributing area (dry gullies high up, wider rivers downstream).
6. **`calculateSlopes(heightmap, width, height)`** — gradient magnitude normalized to [0, 1] (note: different signature from the legacy `calculateSlopes`).
7. **`addSurfaceRelief`** — adds rock/boulder mounds as real elevation (masked by slope/elevation/cellular field), not painted dark pixels.
8. **`renderGrayscale`** — normalizes to B&W (white = high) and packs ABGR; `settings.fixedRange` maps `[0, HEIGHT_SCALE]` so subtle slider changes aren't renormalized away.

`DEFAULT_SETTINGS` holds all slider defaults; `index.html` spreads it and wires sliders/checkboxes 1:1 to keys (except `asymDirection`, which converts degrees→radians). `domainWarp(noise, coord)` wraps the fastnoise-lite **`DomainWrap` typo** (the library misspells the public method) with a fallback to `DomainWarp`.

## Namib Star-Dune Prototype (`dunes.html`)

`src/webgpu/dunes/` is a standalone WebGPU prototype for star dunes (not wired into the `webgpu.html` compositor yet). `PARAM_SCHEMA` in `constants.js` is the single source of truth: it generates the WGSL `DuneParams` struct, uniform packing (all f32), defaults and the UI. Two compute passes in `shaders/dunes.wgsl.js`:
1. `generateBase` — Mode A/C: warped Voronoi crest network (edges = crests, cells = pans, vertices = star peaks via `F3 − F1`), edge distance converted to true metres with the warp Jacobian so slopes match the windward/slip-face angles; optional smaller "generations". Mode B: `smoothDomes` — smooth 2-octave swell with analytic gradient (pass 2 prepends a low-frequency Phacelle mega-ridge octave, `megaSpacing`/`megaHeight`, inside the same stacked-fade loop so arms are steered by it continuously). Writes `vec2f(main landform, smaller generations)`.
2. `applyArms` — Mode B/C: Runevision stacked-fade Phacelle arms with a sharp wind-asymmetric crest profile, per-octave relief capped at repose and a Nyquist guard on the narrow side; then pan flattening.

Phacelle arms only look patterned when steered by a **smooth** field: B uses the analytic gradient of `smoothDomes`; C steers by the main network only (generations excluded) via a wide stencil. `armBranching` scales octave-to-octave steering (low = parallel, high = dendritic/chaotic). Saw-tooth artifacts come from sharp features below ~5 grid cells (16 m cells) or from discontinuous direction fields feeding Phacelle — keep crest rounding, the Nyquist guard and the continuous feed-forward slope. `window.__dunes` exposes `{ pipeline, renderer }` for debugging; `pipeline.baseBuffer` (`vec2f` per cell) is `COPY_SRC` for readback.

## Code Conventions

- **ES modules** — `"type": "module"` in package.json, use `import`/`export`
- **No TypeScript** — plain `.js` files only
- **Typed arrays** — `Float64Array` for heightmaps and slope maps, `Uint32Array` for pixel buffers
- **Pixel format** — ABGR packed as `(a << 24) | (b << 16) | (g << 8) | r`
- **Indentation** — 4 spaces
- **Runtime dependencies**:
  - `simplex-noise` — wrapped by `src/noise.js` (Noise class with `noise2D`, `fwNoise`, `microNoise`), used by the legacy renderer.
  - `fastnoise-lite` — used directly by `src/fastnoise-terrain.js`. Deterministic per seed (unlike `simplex-noise`). **Public warp method is misspelled `DomainWrap`** — always go through the `domainWarp` helper.

## Testing

- **Framework**: Vitest with `globals: true`
- **Config**: `vitest.config.js` — environment is `node`, tests match `test/**/*.test.js`
- **Setup**: `test/setup.js` creates global `noise` (Noise instance) and `settings` (default slider values)
- **Path alias**: `@` maps to project root
- **Run tests**: `pnpm test` (single run) or `pnpm test:ui` (watch with UI)
- **Test structure**:
  - `test/unit/noise.test.js` — Noise class: instantiation, noise2D, fwNoise, microNoise, error handling
  - `test/unit/terrain.test.js` — All legacy terrain functions + full pipeline integration
  - `test/unit/fastnoise-terrain.test.js` — FastNoiseLite pipeline: math helpers, each stage, determinism per seed, edge-lowering, drainage/flow, grayscale packing, full pipeline
  - `test/integration/ui.test.js` — Canvas, settings binding, event handlers, error recovery

### Testing Constraints

- **Noise is non-deterministic** — `simplex-noise`'s `createNoise2D()` generates random state on construction. Tests use range checks and value type assertions, not exact equality.
- **Erosion uses `Math.random`** — results vary between runs. Tests compare different runs for inequality, not equality.
- **Integration tests use `document`** — `vitest.config.js` sets `environment: 'node'` but tests pass (67/67) with the current setup.

## Linting

- **Command**: `pnpm lint` — runs `biome lint --write .`
- **Note**: Biome is installed globally therefore does not need to be installed.

## Key Constraints

- **`examples/tempterrain.html` imports from `src/`** — it imports `Noise` from `../src/noise.js` but still duplicates terrain generation logic (`initHeightmap`, `simulateErosion`, `calculateSlopes`, `render`) inline. Changes to `src/terrain.js` may need to be mirrored in the HTML file.
- **`examples/tempterrain.html` requires HTTP** — ES module imports require serving over HTTP (e.g. `pnpm dev`). Opening via `file://` will fail with CORS errors.
- **No build step** — the project runs directly in the browser or via Vitest. No bundler, no transpilation.
- **Package manager**: pnpm (lockfile is `pnpm-lock.yaml`)
