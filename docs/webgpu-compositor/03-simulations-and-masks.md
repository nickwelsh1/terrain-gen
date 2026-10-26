# 03 — Specification: Simulations, Masks & Seamless Biome Blending (Parts 3 & 4)

## Simulations (`category: "simulation"`)

### 1. `sim.dropletErosion` (Atomic Particle Hydraulic Erosion)
- Preserves the deterministic droplet kernel in `src/webgpu/shaders/erosion.wgsl.js` (`atomicAdd` on `state.activeHeight`).
- **Enhancement**: Also updates `aux.y` (`sediment`) when depositing (`amount > 0`) and reduces `aux.y` first when eroding before cutting into bedrock (`hardness`).

### 2. `sim.phacelleErosion` (Analytic Multi-Octave Gully Filter)
- Adapts Rune Skovbo Johansen's Phacelle erosion filter (`src/webgpu/erosion/shaders/erosion.wgsl.js`) to operate as a **filter on the existing height buffer** (`heightA` → `heightB`, `pingPong: true`):
  - Computes smoothed height and gradient `(h, dh/dx, dh/dy)` from `heightA` at each pixel.
  - Runs `erosionFilter(p, heightAndSlope, fadeTarget)` across `erosionOctaves` (`1..6`).
  - Writes `h + erosion.heightDelta` to `heightB` and stores ridge/gully mask into `aux.w` (`maskB`).
- **Primary Params**: `erosionStrength` (`0.01..0.5`, default `0.18`), `erosionScale` (`0.04..0.35`, default `0.14`), `erosionOctaves` (`1..6`, default `4`), `gullyWeight` (`0..1`, default `0.5`), `ridgeRounding` (`0..1`, default `0.15`).

### 3. `sim.thermalTalus` (Two-Tier Bedrock / Scree Angle-of-Repose Sim)
- Iterative ping-pong pass (`iterations: 1..50`, default `12`, `pingPong: true` on both height and aux).
- At each cell $(x, y)$, inspects 8 neighbors $(x + dx, y + dy)$ with distance $d \in \{1, \sqrt{2}\} \cdot \text{CELL\_M}$:
  - Effective local repose angle blends between `bedrockReposeDeg` ($50^\circ\text{–}75^\circ$, scaled by `hardness`) when `sediment == 0` and `talusReposeDeg` ($30^\circ\text{–}38^\circ$, default $33^\circ$) when `sediment > 0.5m` or when weathering rate `weathering > 0` detaches cliff rock.
  - Outflow to lower neighbor $i$ when slope $s_i = (h - h_i) / d_i > \tan\theta_{\text{repose}}$; inflow gathered symmetrically from higher neighbors so **mass is strictly conserved**:
    $$\Delta h(x, y) = \sum_{j \in \text{higher}} \text{inflow}_j - \sum_{i \in \text{lower}} \text{outflow}_i$$
  - Material deposited at cliff bases increments `aux.y` (`sediment`), forming visible **scree cones and talus aprons**.

### 4. `sim.windDrift` (Aeolian Saltation / Alpine Snow Drift Sim)
- Iterative ping-pong pass (`iterations: 1..40`, default `10`, `pingPong: true`).
- Computes upwind shadow factor $S \in [0, 1]$ via 8-step upwind ray-march along `-windDir`.
- Picks up loose sediment/snow on windward faces ($S < 0.3$) and deposits in leeward shadow zones ($S > 0.4$) above `minAltitudeM` (set `minAltitudeM = 0` for desert sand transport, or `minAltitudeM = 350` for high-altitude snow drifts and leeward cornices).
- Enforces angle of repose ($33^\circ$ for sand, $38^\circ$ for cohesive snow) on deposited drifts.

### 5. `sim.waterLevel` (Sea, Lake & River Flooding)
- Pointwise pass setting `aux.x` (`water` depth in meters):
  - `waterDepth = max(0.0, waterLevelM - heightM)`.
  - Optional `shorelineErosionM`: gently flattens beach/shoreline shelves within $\pm 4\text{ m}$ of `waterLevelM` and writes a shoreline wetness mask to `aux.w`.

---

## Detailers, Masks & Seamless Biome Blending (`Part 4`)

### 1. Extended `detail.analysis`
In a single $8\times 8$ compute pass over `state.activeHeight`:
- **Normals**: $3\times 3$ Sobel gradient $\to (n_x, n_y, n_z)$ packed in `normals[idx]`.
- **Slope**: $\theta / (\pi/2) \in [0, 1]$ stored in `slopes[idx]` byte 0 (`.r`).
- **Curvature**: 9-point Laplacian $\kappa = \text{clamp}(0.5 + (h - \bar{h}_{3\times 3}) / (2 \cdot \text{CELL\_M}), 0.0, 1.0)$ stored in `slopes[idx]` byte 1 (`.g`). Values $> 0.5$ are convex ridges; $< 0.5$ are concave valleys/channels.
- **Horizon / Ambient Occlusion**: 4-cardinal-direction 6-step horizon elevation check stored in `slopes[idx]` byte 2 (`.b`).
- **Aspect**: Downhill unit vector packed in `aspects[idx]`.

### 2. `mask.select` — Composable Geological Mask Generator
Writes a smooth `[0, 1]` mask into `aux.z` (`maskA`) by multiplying four smooth-feathered selectors:
1. **Altitude Selector**:
   ```wgsl
   let mAlt = smoothstep(minAlt - featherAlt, minAlt + featherAlt, h)
            * (1.0 - smoothstep(maxAlt - featherAlt, maxAlt + featherAlt, h));
   ```
2. **Slope Selector** (in degrees, $0^\circ\text{–}90^\circ$):
   ```wgsl
   let mSlope = smoothstep(minSlope - featherSlope, minSlope + featherSlope, slopeDeg)
              * (1.0 - smoothstep(maxSlope - featherSlope, maxSlope + featherSlope, slopeDeg));
   ```
3. **Curvature Selector**: `-1` = concave basins/valleys only, `0` = all, `+1` = convex ridges only.
4. **Domain-Warped Noise Breakup**:
   - Evaluates warped fBm $n_w = \text{fbm}(u \cdot f_n + \text{warp}, v \cdot f_n + \text{warp})$.
   - Perturbs the altitude/slope thresholds by $(n_w - 0.5) \cdot \text{warpAmpM}$ **before** the `smoothstep` evaluation.
   - **Why this matters**: Perturbing the threshold before `smoothstep` (rather than multiplying noise after) bends the mask boundary organically into gullies and around spurs without creating speckled holes inside the biome or hard contour rings at a fixed elevation.

### 3. `mask.blur` — Spatial Feathering Pass (Ping-Pong on `aux`)
- $5\times 5$ Gaussian kernel over `aux.z` (`maskA`) to guarantee $C^1$-smooth spatial derivatives across biome transitions.

### 4. `blend.layer` — Seam-Free Biome Layer Compositor
Combines `hA` (`state.activeHeight`, e.g., rocky canyons) and `hB` (`state.layerScratch`, e.g., sand dunes) using `mask = aux.z` (`maskA`):

1. **Mode 0: Height-Fill Blend (`heightLerp` — Default for Dunes/Basins)**:
   ```wgsl
   // Sand fills low crevices of hA first and smoothly submerges rock as mask -> 1.
   // Zero step edges or artificial outlines at mask=0 because when mask=0, hB + offset << hA.
   let offset = (mask * 2.0 - 1.0) * blendDepthM;
   let hTarget = hA + offset;
   let diff = (hB + mask * blendDepthM) - hA;
   let w = smoothstep(-blendSmoothM, blendSmoothM, diff) * mask;
   let hOut = mix(hA, max(hA, hB), w);
   ```
   Also increments `aux.y` (`sediment`) by `max(0.0, hOut - hA)` so the renderer colors the sand/fill layer with desert dune shading while exposed rock highs keep mountain rock shading!
2. **Mode 1: Smooth Maximum / Minimum (`smax` / `smin`)**:
   ```wgsl
   // Polynomial smooth max with fillet radius k (meters)
   let h = max(k - abs(hA - hBMasked), 0.0) / k;
   let smax = max(hA, hBMasked) + h * h * k * 0.25;
   ```
3. **Mode 2: Feather Replace (`mix`)**:
   - `hOut = mix(hA, hB, smoothstep(0.0, 1.0, mask))`
4. **Mode 3: Masked Additive Relief**:
   - `hOut = hA + mask * (hB - baseOffset)`
