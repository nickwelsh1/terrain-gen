# 02 — Specification: Generators & Shapers (Parts 1 & 2)

## Generators (`category: "generator"`)

All generators can write either to `state.activeHeight` (when running on Base Layer 0) or to `state.layerScratch` (when running on Overlay Layer $k \ge 1$).

### 1. `gen.ridgeFbm` — Tectonic Multi-Range Ridges & fBm
Upgrades `src/webgpu/shaders/heightmap.wgsl.js` with analytical derivatives and two intersecting mountain range axes (ported from `src/terrain.js` + `src/fastnoise-terrain.js`):
- **Primary Parameters (`tier: "primary"`)**:
  - `baseHeight`: `25..1500 m` (default `800`)
  - `frequency`: `0.5..10.0` (default `3.5`)
  - `ridgeWeight`: `0.0..1.0` (default `0.45`) — blend between rolling fBm and sharp ridged multifractal
  - `ridgeSharpness`: `0.5..4.0` (default `2.0`)
  - `warpAmplitude`: `0.0..1.0` (default `0.3`)
- **Advanced Parameters (`tier: "advanced"`)**:
  - `octaves`: `1..8` (default `6`)
  - `lacunarity`: `1.5..3.0` (default `2.0`)
  - `gain`: `0.25..0.75` (default `0.5`)
  - `warpFrequency`: `0.5..6.0` (default `2.0`)
  - `secondRangeWeight`: `0.0..1.0` (default `0.25`) — tectonic cross-range interference
  - `secondRangeAngle`: `0..180 deg` (default `65`)
  - `heightCurve`: `0.5..4.0` (default `2.2`) — valley-flattening power curve

### 2. `gen.duneField` — Multi-Scale Aeolian Dune Field
Implements the full mathematical spec from `01-research-aeolian-dunes.md`:
- **Primary Parameters (`tier: "primary"`)**:
  - `crestMode`: `0 = Phacelle (Y-junctions)`, `1 = Warped fBm (Classic)` (default `0`)
  - `duneHeight`: `5..600 m` (default `140`) — vertical relief of main dunes
  - `duneWavelength`: `40..800 m` (default `180`) — physical crest-to-crest spacing in meters
  - `windDirection`: `0..360 deg` (default `45`)
  - `brinkPosition`: `0.55..0.90` (default `0.74`) — windward/leeward asymmetry
  - `interduneFlatness`: `0.0..0.7` (default `0.15`) — carves flat interdune corridors
- **Advanced Parameters (`tier: "advanced"`)**:
  - `draaHeight`: `0..500 m` (default `80`) — mega-dune underlying wave height
  - `draaWavelength`: `300..2500 m` (default `900`) — mega-dune spacing in meters
  - `draaAngleOffset`: `-45..45 deg` (default `-12`)
  - `warpFrequency`: `0.2..5.0` (default `1.2`)
  - `warpAmplitude`: `0.0..1.0` (default `0.35`)
  - `stossPower`: `0.5..2.0` (default `1.0`)
  - `leePower`: `1.0..3.5` (default `1.8`)
  - `angleOfRepose`: `28..38 deg` (default `33`)
  - `rippleFrequency`: `5..60` (default `28`)
  - `rippleAmplitude`: `0.0..5.0 m` (default `1.2`)
  - `shadowAngle`: `8..22 deg` (default `14`) — lee wind-shadow cutoff

### 3. `gen.voronoiBlock` — Multi-Scale Voronoi Fault Blocks & Mesas
Generates faulted plateaus, canyon blocks, and columnar rock fractures using 2–3 octaves of Voronoi ($F_1$ cell distance, $F_2 - F_1$ edge distance, and per-cell hash value $H_{\text{cell}}$):
- **Primary Parameters (`tier: "primary"`)**:
  - `baseHeight`: `50..1500 m` (default `700`)
  - `cellScale`: `1.0..16.0` (default `4.0`)
  - `blockRelief`: `0.0..1.0` (default `0.65`) — flat-topped mesa elevation step per cell
  - `canyonWidth`: `0.02..0.5` (default `0.14`) — width of $F_2 - F_1$ fault incisions
  - `canyonDepth`: `0.0..1.0` (default `0.6`)
- **Advanced Parameters (`tier: "advanced"`)**:
  - `jitter`: `0.0..1.0` (default `0.85`)
  - `blockTilt`: `0.0..0.5` (default `0.15`) — tilted fault-block dip across each cell
  - `fractureOctaves`: `1..3` (default `2`) — secondary/tertiary fracture networks
  - `warpAmplitude`: `0.0..0.8` (default `0.25`) — organic canyon meandering
  - `roughness`: `0.0..0.5` (default `0.2`) — fBm surface detail on plateaus

### 4. `gen.islandCaldera` — Radial Island, Volcanic Cone & Caldera
Generates radial landforms with domain-warped coastlines and optional volcanic crater/caldera ring:
- **Primary Parameters (`tier: "primary"`)**:
  - `baseHeight`: `50..1500 m` (default `850`)
  - `islandRadius`: `0.2..1.0` (default `0.75`)
  - `calderaRadius`: `0.0..0.5` (default `0.22`)
  - `calderaDepth`: `0.0..1.0` (default `0.55`) — depth of central crater relative to rim
  - `coastWarp`: `0.0..0.6` (default `0.25`)
- **Advanced Parameters (`tier: "advanced"`)**:
  - `rimSharpness`: `0.5..4.0` (default `1.8`)
  - `radialGullies`: `0.0..1.0` (default `0.35`) — radial volcanic ridges/barrancos
  - `falloffMix`: `0.0..1.0` (default `0.8`) — radial vs. square boundary falloff

---

## Shapers / Filters (`category: "shaper"`)

### 1. `shape.terrace` (Pointwise)
Creates horizontal or tilted geological strata and canyon steps:
- Computes tilted elevation $h_s = h + A_{\text{tilt}}(\cos\theta_s \cdot u + \sin\theta_s \cdot v) + A_{\text{warp}}\text{fbm}(u, v)$.
- Step index $k = \lfloor h_s / \Delta h \rfloor$, fractional position $t = \text{fract}(h_s / \Delta h)$.
- Remaps $t$ via smooth terrace function:
  $$t' = \begin{cases} \frac{t}{1 - s} \cdot (1 - w) & t < 1 - s \\ (1 - w) + w \cdot \text{smoothstep}(1 - s, 1.0, t) & t \ge 1 - s \end{cases}$$
- **Params**: `stepHeightM` (`10..250 m`, default `45`), `sharpness` (`0.1..0.95`, default `0.75`), `strataTilt` (`0..150 m`, default `30`), `strataWarp` (`0..80 m`, default `20`), `strength` (`0..1`, default `0.75`).

### 2. `shape.fold` (Ping-Pong)
GPU port of `applyAsymmetricSlopes` (`src/fastnoise-terrain.js:487`):
- Computes local gradient $\nabla h$ from `heightA` and projects onto `dipDirection`: $d = \hat{g} \cdot \hat{u}_{\text{dip}}$.
- Steepens scarp-facing slopes ($d < 0$) and gentles dip-facing slopes ($d > 0$) within an altitude band `[minAltM, maxAltM]`.
- **Params**: `directionDeg` (`0..360`), `steepen` (`0..2.0`, default `0.8`), `gentle` (`0..2.0`, default `0.6`), `minAltM` (`0..800`), `maxAltM` (`200..1500`).

### 3. `shape.warp` (Ping-Pong)
Resamples `heightA` using bilinear interpolation at domain-warped and optionally swirled coordinates:
- **Params**: `warpAmplitudeM` (`0..300 m`, default `60`), `warpFrequency` (`0.5..8.0`, default `2.5`), `swirlStrength` (`-2.0..2.0`, default `0.0`), `octaves` (`1..4`, default `3`).

### 4. `shape.curveRemap` (Pointwise)
Reshapes elevation distribution and slope contrast:
- **Params**: `gamma` (`0.3..3.0`, default `1.2`), `valleyFloorM` (`0..400 m`, default `0`), `valleySmoothM` (`5..150 m`, default `40`), `plateauCeilingM` (`200..1500 m`, default `1500`), `strength` (`0..1`, default `1.0`).

### 5. `shape.glacialCarve` (Ping-Pong)
Combines **Apex peak sharpening** on convex ridges with **parabolic U-valley glacial trough widening** in concave valleys:
- Evaluates local 5-point and $5\times 5$ wide-radius mean height $\bar{h}_{\text{wide}}$ and Laplacian $\kappa = h - \bar{h}$.
- Where $\kappa > 0$ (ridges/peaks): adds $k_{\text{apex}} \cdot \kappa$ to sharpen arêtes and horns.
- Where $\kappa < 0$ (valleys): carves the valley floor toward a flat-bottomed parabolic U-profile $\bar{h}_{\text{min}} + (h - \bar{h}_{\text{min}})^2 / \Delta H_{\text{glacier}}$, steepening the side walls into fjord/trough cliffs.
- **Params**: `carveDepthM` (`0..200 m`, default `55`), `valleyWidth` (`1..4`, default `2`), `apexSharpen` (`-1.0..2.0`, default `0.6`), `altitudeGateM` (`0..1000 m`, default `150`).
