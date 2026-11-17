# Genetic Shaders — Smart Procedural Shader Generator

Browser-based Interactive Genetic Algorithm (IGA) GLSL shader explorer and target
image matcher. Vanilla ES6+ modules, Three.js, Vite, **pure CSS (BEM + atomic
utilities — no CSS frameworks, no Tailwind)**.

## Commands

```bash
pnpm install     # install deps (three + vite only)
pnpm dev         # vite dev server (default port 5173)
pnpm build       # production build to dist/
pnpm preview     # serve the production build
```

## Architecture

- `src/config/parameterSchema.js` — single source of truth for genotype genes
  (bounds, types, defaults, UI grouping, and a one-sentence plain-language
  `hint` shown by each row's ⓘ button). Add a gene here and the control
  panel, mutation and crossover pick it up automatically; shader genes also
  need a uniform in `noiseLib.glsl.js` `UNIFORM_DECLS` + `uniforms.js`, and a
  baked constant in `glslExporter.js`.
- `src/shaders/` — GLSL chunks composed by `noiseLib.glsl.js` into a shared
  `NOISE_LIB` used by the 2D fragment shader AND the 3D displaced-mesh vertex
  shader. Includes `chunks/erosion.glsl.js` (Mode 1: Runevision 2026 Advanced
  Phacelle + Stacked-Fade erosion filter with dendritic `ridgeMap`; Mode 2:
  Clay John / Fewes Classic Gavoronoise erosion filter). `uniforms.js` maps
  genes -> uniforms (`syncUniforms`).
- `src/renderer/OffscreenTileRenderer.js` — ONE shared WebGL context renders
  every grid tile into 2D canvases via a frame-budgeted queue (8 ms/frame).
  Browsers cap WebGL contexts at ~8-16, so never create one renderer per cell.
  A `setTimeout` watchdog drains the queue when RAF is throttled (hidden tabs).
- `src/renderer/HeroPreviewRenderer.js` — dedicated renderer for the 2D/3D
  hero preview (renders on dirty-flag only, OrbitControls in 3D mode).
- `src/ga/` — `Genotype` (validation + anti-fragmentation guardrails),
  `GeneticEngine` (Gaussian mutation, BLX-alpha crossover, radial distance
  scaling, `NOISE_FREQ_SCALE` cross-noise frequency normalization,
  `adaptToneToTarget` analytical tone alignment, `specialistCrossover`,
  metric-guided group mutation, `immigrantGenotype` with structural chimeras),
  `EvolutionScheduler` (memetic `(1 + λ)` / Multiple-Try Metropolis MCMC loop
  with a fixed 80-candidate internal pool across all grid sizes, Gen-0
  multi-preset/multi-family tournament + 3-step tone micro-climb, and 5-step
  re-heat cooldown).
- `src/matcher/` — `ImageAnalyzer` (center-crop -> 256x256 master luminance,
  `downsampleLuminance` for 128px/64px scoring, `loadLuminanceFromDataUrl` for
  checkpoint restore), `FFT2D` (pure JS radix-2 FFT + radial/angular power
  spectrum), `FeatureExtractor` (histogram CDF, 1st-derivative Slope CDF,
  isotropic 8-neighbor Laplacian CDF, 2D FFT spectrum, 8x8 regional layout),
  `FitnessEvaluator` (composite score 0-100% + smoothness guard; opts
  `{layout, crisp}`). `store.state.matcher` holds the matcher card options:
  `analysisSize` (`64 | 128 | 256`), `layout`, `crisp`, `metricGuided`,
  `mcmc`, and `hideTiles`.
- `src/state/` — pub/sub `Store` with undo/redo snapshots, `FavoritesManager`
  (localStorage key `iga_shader_saved_faves_v1` + saved-faves.json I/O), and
  `searchStorage.js` (localStorage key `iga_shader_search_checkpoint_v1` +
  `.json` search session save/load/resume).
  Favorites UI lives in the toolbar ★ button's overlay panel
  (`#favorites-overlay`), NOT in the sidebar; cells whose genotype signature
  (JSON.stringify(genes)) matches a favorite show a persistent gold star.
- `src/ui/` — view classes (`AppLayout`, `ExplorerGridView`, `ControlPanelView`,
  `TargetMatcherView`, `FavoritesView`, `ExportModalView`, `HelpModalView`,
  `SidebarNavView` — find-a-control search + jump-to-section dropdown that
  scroll targets beneath the sticky Hero card via `--pinned-offset`);
  `icons.js` holds the Line Awesome SVGs (info / lock / unlock);
  `main.js` is the orchestrator wiring everything.
- `window.__iga` is exposed for console debugging (store, renderers, etc.).

## Conventions

- CSS: BEM blocks (`.shader-cell__canvas`, `--modifier`) + atomic utilities
  (`.d-flex`, `.gap-2`). Styles live in `src/styles/`; add component sheets to
  `index.html`'s link list. **Do not add Tailwind or any CSS framework.**
- Display-only genes (`colorMode`, `displacementScale`) are listed in
  `DISPLAY_GENES` and are excluded from mutation (`allowDisplay: false`).
- Guardrails live in `Genotype.validate()` — Nyquist frequency cap, warp
  stability damping, persistence envelope. All genotype construction funnels
  through it.
- GLSL is written GLSL-ES-1.00-style (works on WebGL1 and WebGL2 via three's
  compatibility defines): `varying`, `gl_FragColor`, `texture2D`. Keep loop
  bounds constant (`for i < 8` + `break`) for strict ANGLE compilers.
- History: callers must `store.pushHistory()` BEFORE changing
  `store.state.parent`, then call `repopulate(false)` — otherwise snapshots
  mix the new parent with the old cell grid.

## Verification

- `pnpm build` must pass cleanly.
- Manual smoke test: load dev server, confirm 3x3 renders, switch grid to 9x9
  (81 tiles via single shared context), Mutate, Shift+click crossover, star a
  favorite, "Use random genotype as target" -> Auto-Evolve fitness climbs,
  Export GLSL/PNG modal opens, zero console errors.
