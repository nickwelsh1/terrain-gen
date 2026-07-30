# terrain-gen

Procedural terrain generation engine that produces Dolomites-style mountain landscapes. Renders to a canvas via pixel buffers using layered noise, hydraulic erosion, slope calculation, and biome-based coloring.

## Tech Stack

- **Language**: Vanilla JavaScript (ES modules, no TypeScript)
- **Testing**: [Vitest](https://vitest.dev/)
- **Linting**: [Biome](https://biomejs.dev/)
- **Package Manager**: [pnpm](https://pnpm.io/)
- **No build step** — runs directly in the browser or via Vitest

## Quick Start

### Run the terrain visualizer

Open `examples/tempterrain.html` in any modern browser. The terrain generates automatically and you can adjust parameters via the UI panel.

### Run tests

```bash
pnpm install
pnpm test
pnpm dev
```

For watch mode with UI:

```bash
pnpm test:ui
```

### Lint

```bash
pnpm lint
```

### more scripts

For building and deploying:

```bash
pnpm build
npx wrangler pages deploy dist --project-name terrain-gen
```

> Note: Biome must be installed as a dev dependency (`pnpm add -D @biomejs/biome`).

## Project Structure

```
src/noise.js        — Perlin-like noise with domain warping (Noise class)
src/terrain.js      — Heightmap init, erosion, slopes, render, settings binding
examples/tempterrain.html — Standalone browser app (inline JS mirrors src/)
test/unit/          — Unit tests for noise and terrain modules
test/integration/   — UI/canvas integration tests
test/setup.js       — Global test setup (Noise instance, default settings)
vitest.config.js    — Vitest configuration (node env, globals, @ alias)
```

## Terrain Pipeline

The generation pipeline runs in four stages:

1. **Heightmap Initialization** (`initHeightmap`) — Generates base height values using 3 layers of domain-warped noise (fBm-like). Values clamped to [-30, 500].
2. **Hydraulic Erosion** (`simulateErosion`) — 8-pass simulation of water flow to lowest neighbors, creating V-shaped ravines and riverbeds.
3. **Slope Calculation** (`calculateSlopes`) — Computes per-pixel slope via gradient magnitude. Returns values in [0, 1].
4. **Rendering** (`render`) — Maps height + slope to biome colors (snow peaks, alpine rock, scree, forest, pasture, transition zones). Packs to `Uint32Array` in ABGR format for `putImageData`.

## Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `sharpness` | -2.5 to 3.0 | 1.5 | Exaggerates ridges and valleys |
| `erosion` | 0.0 to 8.0 | 3.5 | Controls hydraulic erosion depth |
| `vegetation` | 0.0 to 12.0 | 6.0 | Forest/grass density (above 9 hides scree) |
| `micro` | -1.5 to 2.0 | 0.8 | Limestone micro-texture (lichen/porosity) |

## Notes

- `examples/tempterrain.html` is a standalone file with inline JS that duplicates `src/` logic. Changes to `src/` may need to be mirrored in the HTML file.
- Noise generation is non-deterministic — the permutation table is randomly generated on each `Noise` construction.
- Erosion uses `Math.random`, so results vary between runs.
