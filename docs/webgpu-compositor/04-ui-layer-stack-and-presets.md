# 04 — Specification: Layer-Centric Accordion UI & Built-In Presets (Part 5)

## UX Design Principles

1. **Side-Panel Only (No Node Graph)**:
   - All controls live in `#webgpu-ui` on the right side of `webgpu.html`.
2. **Layer-Centric Accordion Hierarchy**:
   - Top-level `<details class="ui-accordion" name="composer-section">` elements represent distinct stages of the stack:
     1. **Preset & Scale** (Preset selector, Seed, Grid resolution `256/512/1024`, World extent `1.28 / 2.56 / 5.12 / 10.24 km`)
     2. **Layer 1: Base Terrain** (Generator selector + primary controls, Fine-tune subdrawer, Shapers subdrawer with Terrace / Fold / Glacial / Warp / Curve Remap toggles & sliders)
     3. **Layer 2: Secondary Biome / Overlay** (Enable toggle, Generator selector — e.g. Aeolian Dunes with Phacelle vs. Warped-fBm crest mode, Mask & Placement subdrawer, Blend Mode subdrawer)
     4. **Simulations & Erosion** (Phacelle Analytic Gullies, Thermal Talus / Scree, Wind / Snow Drift, Water / Sea Level, and Interactive Hydraulic Droplets with Erode / Reset buttons)
     5. **Visualization & Mask Inspector** (Lit Biome 3D, Heightmap, Hardness, Slope Arrows, Erosion/Sediment Heatmap, Active Layer Mask, Curvature & AO)
3. **Scoped Control Binding (`data-scope`)**:
   - Every slider/select/checkbox uses scoped attributes (`data-layer="layer1" data-op="gen.duneField" data-param="duneHeight"`) rather than global bare IDs when inside operator blocks, while preserving backward-compatible IDs (`#baseHeight`, `#seed`, `#erosionRate`, `#stepCount`, `#erodeBtn`, `#resetBtn`, `#regenerateBtn`, `#passHeightmap`, etc.) so existing unit tests and keyboard workflows continue working seamlessly.
4. **Primary vs. Fine-Tune Subdrawers**:
   - Each operator surfaces 3–5 primary sliders directly and places secondary parameters inside `<details class="ui-subdrawer">`.

---

## Built-In Presets (`src/webgpu/presets.js`)

| Preset ID | Label | Description & Stack |
|---|---|---|
| `alpine-dolomites` | **Alpine Dolomites** | Tectonic 2-range `gen.ridgeFbm` + `shape.fold` + `shape.glacialCarve` (arêtes & U-valleys) + `sim.phacelleErosion` + `sim.thermalTalus` (cliff rock + scree cones). |
| `grand-mesa-canyons` | **Grand Mesa & Canyons** | `gen.voronoiBlock` (multi-scale fault blocks) + `shape.terrace` (tilted 3D strata steps) + `sim.thermalTalus` + `sim.dropletErosion`. |
| `namib-mega-dunes` | **Namib Mega-Dune Sea** | `5.12 km` extent; `gen.duneField` with Draa mega-ridges + Phacelle Y-junction barchanoid crests + sharp brink profile + wind-shadow leeward faces + stoss ripples. |
| `canyon-valley-dunes` | **Canyon & Valley Dunes (Multi-Biome)** | Layer 1: Voronoi terraced rocky canyons. Layer 2: `gen.duneField` masked to low-altitude gentle valley basins (`alt < 320m`, `slope < 24°`, warped boundary) blended with `Height-Fill` (`heightLerp`) so sand fills canyon floors without seam outlines. |
| `volcanic-caldera-island` | **Volcanic Caldera Island** | `gen.islandCaldera` + `sim.phacelleErosion` radial gullies + `sim.waterLevel` (ocean + flooded crater lake). |
| `snow-drifted-peaks` | **Snow-Drifted Peaks** | Sharp alpine `gen.ridgeFbm` + `shape.glacialCarve` + `sim.windDrift` gated above `350 m` depositing leeward snow drifts and cornices. |
