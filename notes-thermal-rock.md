# Scratch Notes: Improving Thermal Erosion & Exposed Rock

Status: Deferred from WebGPU plan. These are research notes for future work.

## Current Implementation Problems

### Thermal Erosion (`fastnoise-terrain.js:543-590`)

1. **Single global talus angle** — `thermalTalus` is one value for the entire terrain. Real talus angles vary by material: loose scree ~30°, fractured limestone ~45°, solid granite ~70°+. Without coupling to the hardness map, everything softens uniformly.

2. **Pure diffusion, no deposition features** — material is redistributed proportionally to 8 neighbors. Real scree forms distinct aprons with a sharp angle break at the slope base. The current approach produces a smooth gradient instead of a visible talus cone.

3. **No grain-size sorting** — real talus segregates by particle size: coarse blocks at the top (near the cliff), fine particles at the base (transported further by water and gravity). This is completely absent. Would need a second scalar field tracking average grain size per cell.

4. **No cliff/talus boundary** — real thermal erosion creates a sharp transition: vertical cliff above, talus slope below. The current cosine-weighted redistribution blurs this into a smooth curve.

5. **No freeze-thaw cycling** — the dominant driver of thermal erosion in alpine terrain is ice wedging (water enters cracks, freezes, expands, fractures rock). The simulation has no temperature model, no moisture-in-cracks model, no cyclical forcing.

6. **Uniform strength regardless of elevation** — `thermalStrength` is constant. Real thermal erosion is strongest above the treeline (~2000m in the Dolomites) where vegetation doesn't stabilize soil and freeze-thaw cycles are frequent.

### Exposed Rock / Surface Relief (`fastnoise-terrain.js:777-832`)

1. **Cosine dome mounds** — `stampMound()` uses `cos(dist/radius * π/2)` for every rock and boulder. Real boulders are angular, have flat fracture faces, and are highly irregular. A heightmap can't represent true 3D rock geometry, but normal perturbation or displacement noise could fake angularity.

2. **Scale issues** — boulder magnitude is `HEIGHT_SCALE * 0.02` (~10m at HEIGHT_SCALE=1000), rock magnitude is `HEIGHT_SCALE * 0.006` (~3m). A 10m "boulder" is a small hill. Real boulders in alpine terrain are 1-5m. The radius calculation (`boulderMaxRadius * (0.5 + 0.5 * cell)`) also produces features that are too large and too smooth.

3. **No erosion exposure logic** — rocks/boulders are placed by a cellular noise mask + slope/elevation gate. They're not *exposed* by erosion — they're stamped on top. Real exposed rock appears where erosion has removed overlying soil. The placement should be a function of `(baseHeight - erodedHeight)` — i.e., how much material has been removed.

4. **No geological structure** — real exposed rock shows strata, jointing, and fracture patterns. The current approach has no concept of rock fabric. Would need a directional noise field for jointing/bedding planes that influences both the hardness map and the visual texture.

5. **No talus association** — boulders in real terrain cluster at the base of cliffs (talus cones, rockfall deposits). The current placement is slope-gated but not proximity-to-cliff-gated.

## What Would Significantly Improve Results

### Thermal Erosion — Realistic Improvements

**Tier 1: Moderate effort, high impact**

- **Hardness-coupled talus angle**: sample the hardness buffer to set per-cell angle of repose. Soft material (low hardness) → low talus angle (~30°), hard material → high angle or no erosion at all (>70°). This alone creates realistic differential weathering — soft layers retreat, hard layers form cliffs and overhangs (in the visual, not the heightmap).
  - *Implementation*: one extra buffer read in the thermal compute pass, map hardness [0,1] → talus angle [25°, 75°]
  - *GPU cost*: negligible

- **Elevation-dependent strength**: multiply erosion strength by a fade function that peaks above treeline and drops to zero below. Simple smoothstep on elevation.
  - *Implementation*: one multiply in the compute shader
  - *GPU cost*: negligible

- **Deposition accumulation with angle break**: instead of proportional diffusion, deposit material at the base of steep slopes with a distinct angle break. When material arrives at a cell where the slope drops below the local talus angle, deposit it there (accumulate) rather than continuing to diffuse. This creates visible talus aprons.
  - *Implementation*: check slope vs local talus angle; if below, deposit and stop transport
  - *GPU cost*: negligible

**Tier 2: Significant effort, high impact**

- **Grain-size transport field**: add a second scalar buffer (0 = fine silt, 1 = coarse blocks). Thermal erosion moves coarse material short distances (high friction, stops quickly) and fine material long distances. This creates the natural sorting seen in real talus cones.
  - *Implementation*: second `Float32Array`/GPUBuffer, updated alongside heights in the thermal pass
  - *GPU cost*: ~2× the thermal pass (double the buffer writes)

- **Jointing/fracture field**: a directional noise field representing rock joint sets (common in granite/limestone). Thermal erosion preferentially attacks joints — material is removed faster along joint directions. This creates the blocky, columnar weathering seen in real cliffs.
  - *Implementation*: 2-3 directional noise fields (joint set orientations), sample in the thermal shader to weight erosion
  - *GPU cost*: a few extra noise samples per cell per pass

**Tier 3: Major R&D, uncertain payoff**

- **Freeze-thaw model**: a temperature field (lapse rate with elevation + seasonal cycle), moisture-in-cracks field, and ice-expansion fracturing. Water that entered cracks during the day freezes overnight → expansion → rock fracture → fresh material available for transport.
  - *Implementation*: temperature buffer, moisture buffer, crack-density buffer (derived from jointing), cyclical forcing
  - *GPU cost*: 3+ extra buffers, multiple passes per cycle
  - *Tuning difficulty*: very high — many interdependent parameters

- **Mass wasting events**: stochastic rockfall/landslide triggers when accumulated stress exceeds a threshold. A cliff that has been losing material gradually suddenly releases a large block. Creates realistic episodic deposition events rather than continuous diffusion.
  - *Implementation*: per-cell stress accumulation, probability threshold, event-based material transport (large instantaneous move rather than gradual)
  - *GPU cost*: low per-step, but requires atomic operations for event coordination
  - *Tuning difficulty*: high — threshold values, event sizes, probability distributions

### Exposed Rock — Realistic Improvements

**Tier 1: Moderate effort, high impact**

- **Erosion-driven exposure**: instead of stamping rocks by noise, compute `exposureDepth = baseHeight - erodedHeight`. Where `exposureDepth > soilDepth` (a per-cell parameter), the terrain is bare rock. The material shader switches to rock texture based on this threshold.
  - *Implementation*: a soil depth buffer (generated with noise, 0-5m range), comparison in the fragment shader
  - *GPU cost*: one extra buffer, one comparison in shader

- **Angular displacement**: replace cosine mounds with a sum of random-frequency noise octaves that create irregular, angular profiles. Use a hard threshold (step function) instead of smooth cosine to create flat tops and sharp edges.
  - *Implementation*: noise-based displacement in the vertex shader, threshold function
  - *GPU cost*: a few extra noise evaluations per vertex

- **Cliff-proximity placement**: compute a "distance to cliff" field (cells where slope > 60°). Place boulders only within N cells of a cliff base, with density falling off with distance. This creates realistic talus cone deposits.
  - *Implementation*: distance transform (can be approximated with a few blur passes), mask in the scatter pass
  - *GPU cost*: one extra compute pass for the distance field

**Tier 2: Significant effort, high impact**

- **Strata visualization**: when rock is exposed, render horizontal banding (sedimentary layers) or columnar jointing (volcanic) based on a geological type field. The bands should follow the terrain surface with slight warping.
  - *Implementation*: geological type buffer (enum: sedimentary/igneous/metamorphic), strata direction noise, fragment shader banding
  - *GPU cost*: texture lookups in fragment shader, negligible

- **Normal-based rock shading**: perturb normals on exposed rock surfaces using a high-frequency noise to create the rough, pitted appearance of weathered stone. Smooth normals for soil, rough normals for rock.
  - *Implementation*: blend between smooth normal map and high-freq noise normal map based on exposure
  - *GPU cost*: extra noise sample in fragment shader

## Recommended Implementation Order (if pursued later)

1. Hardness-coupled talus angle + elevation-dependent strength + deposition accumulation (Tier 1 thermal) — biggest visual improvement for least effort
2. Erosion-driven exposure + soil depth buffer (Tier 1 rock) — makes erosion visually meaningful
3. Grain-size transport field (Tier 2 thermal) — creates realistic talus sorting
4. Jointing field + blocky weathering (Tier 2 thermal) — creates realistic cliff morphology
5. Angular displacement + cliff-proximity boulder placement (Tier 1 rock) — visual polish
6. Strata visualization + normal-based rock shading (Tier 2 rock) — visual polish
7. Freeze-thaw model (Tier 3) — only if targeting scientific accuracy
8. Mass wasting events (Tier 3) — only if targeting dramatic visual effects

## Estimated Effort

| Feature | Effort | New Buffers | New Passes | Tuning Difficulty |
|---|---|---|---|---|
| Hardness-coupled talus | Low | 0 | 0 (modify existing) | Low |
| Elevation strength | Low | 0 | 0 (modify existing) | Low |
| Deposition accumulation | Medium | 0 | 0 (modify existing) | Medium |
| Grain-size field | Medium | 1 | 0 (modify existing) | High |
| Jointing field | Medium | 1-3 | 0 (modify existing) | High |
| Erosion-driven exposure | Medium | 1 (soil depth) | 0 (shader change) | Low |
| Angular displacement | Medium | 0 | 0 (shader change) | Medium |
| Cliff-proximity placement | Medium | 1 (distance field) | 1 | Medium |
| Strata visualization | Medium | 1 (geo type) | 0 (shader change) | Medium |
| Normal-based rock shading | Low | 0 | 0 (shader change) | Low |
| Freeze-thaw model | Very High | 3+ | 2+ per cycle | Very High |
| Mass wasting events | High | 1 (stress) | 1 (event check) | High |


Multi-layer geological strata — instead of a single hardness value per cell, a stack of layers (soil → sedimentary → granite) with different hardness at different depths. As erosion deepens, it exposes different rock types. This requires either a 3D texture or multiple 2D hardness buffers at different depth bands, plus the erosion shader needs to sample the correct layer based on current erosion depth. Significant buffer and shader complexity. Could be a future enhancement but would roughly double Module 3's complexity.

Add boulder scatter as a one-time generation pass. 
