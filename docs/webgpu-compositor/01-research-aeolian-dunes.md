# 01 — Research: Aeolian Sand Dunes, Phase Defects & Saltation Math

## Why Simple Procedural Dune Shaders Look Like "Corrugated Tin Roof"

Standard procedural dune shaders evaluate:
$$h(u, v) = 1 - \left|2 \cdot \text{fbm}(u, v) - 1\right|$$
with domain warping and a power curve $h^\gamma$. This fails geologically for four reasons:
1. **Symmetric crests or rounded brinks**: Raising height to a power $h^\gamma$ scales elevation rather than horizontal phase, rounding the crest instead of producing a gentle ($\sim 12^\circ\text{–}15^\circ$) convex windward stoss slope meeting a sharp brink that drops off at the $\sim 33^\circ\text{–}34^\circ$ angle of repose.
2. **No Y-junction topological defects**: Real transverse and barchanoid dune ridges terminate, split, and merge at Y-junctions (phase dislocations). Domain-warped sine/fBm waves bend continuously without changing topology.
3. **No wind shadowing**: Upwind dunes cast a flow-separation shadow zone in their lee ($\sim 10^\circ\text{–}15^\circ$ downward cone from the brink). Inside the shadow zone, wind shear drops near zero: wind ripples vanish and saltating sand deposits onto the lee face.
4. **Single wavelength & 100m ceiling**: Real ergs (e.g., Namib, Rub' al Khali) superpose **draa** (mega-dunes with $1\text{–}3\text{ km}$ spacing and $100\text{–}350\text{ m}$ height), **meso-dunes** ($80\text{–}300\text{ m}$ spacing, $5\text{–}40\text{ m}$ height), and **aeolian ripples** ($0.5\text{–}5\text{ m}$ visual spacing on stoss slopes).

---

## 1. Dual Crest Topology Modes (`crestMode`)

To give users both realistic barchanoid Y-junctions and classic continuous meandering ridges, `gen.duneField` supports two selectable crest algorithms:

### Mode 0: Phacelle Phase-Defect Ridges (Default — Y-Junctions)
Uses `phacelleNoise(p, windDir, freq, offsetCycles, normalization, true)` (shared in `common.wgsl.js`):
- Evaluates a $4 \times 4$ neighborhood of randomly jittered cell pivots.
- Each cell contributes a complex phasor $(\cos\phi_i, \sin\phi_i)$ aligned with the wind vector $\mathbf{w} = (\cos\theta_w, \sin\theta_w)$:
  $$\phi_i(\mathbf{x}) = 2\pi f_{\text{dune}} \cdot ((\mathbf{x} - \mathbf{c}_i) \cdot \mathbf{w}) + \psi_i$$
  where $\psi_i$ is a cell-coherent phase offset modulated by low-frequency noise.
- Where adjacent cell phasors interfere out of phase, the interpolated phasor magnitude $\|\mathbf{z}\|$ drops toward zero and the phase angle $\text{atan2}(z_y, z_x)$ undergoes a $2\pi$ dislocation — creating an authentic **Y-junction crest split/merge** with zero cell-border seams.
- Recover the local downwind cycle phase $f \in [0, 1)$ from the blended phasor:
  $$f = \text{fract}\!\left(\frac{\text{atan2}(z_y, z_x)}{2\pi} + 0.5\right)$$
  and amplitude envelope $A_{\text{defect}} = \text{smoothstep}(0.05, 0.35, \|\mathbf{z}\|)$ so height smoothly pinches down at Y-junction tips (barchan horns).

### Mode 1: Sinuous Warped-fBm Ridges (Classic Mode)
Preserves the `dunes.html` look while upgrading its profile:
- Rotates UV into wind-aligned coordinates $(u_w, v_w)$ where $u_w = \mathbf{x} \cdot \mathbf{w}$ (downwind) and $v_w = \mathbf{x} \cdot \mathbf{w}_\perp$ (along-crest).
- Applies multi-octave domain warp $\Delta u_w = A_{\text{warp}} \cdot \text{fbm}(u_w f_w, v_w f_w)$.
- Computes continuous downwind phase $f = \text{fract}(u_w / \lambda_{\text{dune}} + \Delta u_w)$ mixed with ridged fBm envelope.

---

## 2. Piecewise Asymmetric Brink & Slip-Face Profile

Given a normalized downwind cycle phase $f \in [0, 1)$ and brink position $b \in [0.60, 0.88]$ (default $b = 0.74$, controlled by `brinkPosition` / windward-leeward ratio):

```wgsl
// Asymmetric dune profile over one wavelength, f in [0, 1) downwind.
// Windward stoss rise [0, brink) has a rounded trough and non-zero slope at the brink;
// Leeward slip face [brink, 1) leaves the brink sharp and eases into the interdune trough.
fn asymmetricDuneProfile(f: f32, brink: f32, stossPower: f32, leePower: f32) -> vec2f {
    let b = clamp(brink, 0.50, 0.92);
    if (f < b) {
        let x = clamp(f / b, 0.0, 1.0);
        // Convex-upward stoss ramp with C0 sharp brink and non-zero derivative at x=1
        let baseWind = x * x * (2.0 - x);
        let h = pow(clamp(baseWind, 0.0001, 1.0), stossPower);
        // Return (height, isSlipFace=0.0)
        return vec2f(h, 0.0);
    } else {
        let y = clamp((f - b) / (1.0 - b), 0.0, 1.0);
        let oy = 1.0 - y;
        // Steep slip face dropping from brink (y=0 -> h=1) to trough (y=1 -> h=0)
        let h = pow(clamp(oy, 0.0, 1.0), leePower);
        // Return (height, isSlipFace=1.0)
        return vec2f(h, 1.0);
    }
}
```

### Interdune Corridor Flatten (`interduneFlatness`)
Real barchan and mega-dune fields often sit on flat gravel/bedrock interdune corridors (*reg* or *serir*). Applying:
$$h_{\text{dune}} = \max(0.0, h_{\text{raw}} - \tau_{\text{interdune}}) / (1.0 - \tau_{\text{interdune}})$$
exposes flat interdune floors where `aux.sediment` drops to `0`, letting underlying bedrock or canyon floors show through naturally.

---

## 3. Multi-Scale Hierarchy: Draa + Meso-Dunes + Stoss Ripples

1. **Primary Draa Layer (Mega-Dunes)**:
   - Wavelength $\lambda_{\text{draa}} \in [300\text{ m}, 2500\text{ m}]$, height $H_{\text{draa}} \in [0\text{ m}, 400\text{ m}]$.
   - Rotated slightly ($-15^\circ\text{ to }+15^\circ$) relative to contemporary meso-dune wind direction to model compound/complex ergs.
2. **Secondary Meso-Dune Layer**:
   - Wavelength $\lambda_{\text{dune}} \in [40\text{ m}, 500\text{ m}]$, height $H_{\text{dune}} \in [2\text{ m}, 120\text{ m}]$.
   - Modulated so meso-dunes climb the windward backs of draa ridges and attenuate on steep draa slip faces.
3. **Tertiary Stoss Ripples**:
   - High-frequency asymmetric sawtooth ripples aligned perpendicular to local wind, masked by `(1.0 - isSlipFace) * (1.0 - shadowMask) * slopeGate` so **slip faces are avalanche-smoothed and ripple-free**.

---

## 4. Upwind Wind-Shadow Ray-March & Saltation (`sim.windDrift` & `gen.duneField`)

Following Werner (1995) and Paris et al. (2019 / 2024 GPU Desertscapes):

### Wind Shadow Calculation
For a cell at $\mathbf{p}$ with height $h(\mathbf{p})$, march $K = 12$ steps upwind along $-\mathbf{w}$ with step length $\Delta s$:
$$\theta_{\max}(\mathbf{p}) = \max_{1 \le k \le K} \arctan\!\left(\frac{h(\mathbf{p} - k\,\Delta s\,\mathbf{w}) - h(\mathbf{p})}{k\,\Delta s \cdot \text{CELL\_M}}\right)$$
The wind shadow factor $S(\mathbf{p}) \in [0, 1]$ is:
$$S(\mathbf{p}) = \text{smoothstep}(\tan 10^\circ, \tan 15^\circ, \tan\theta_{\max}(\mathbf{p}))$$
- $S = 0$: fully exposed to wind (erosion / saltation active, ripples visible).
- $S = 1$: inside leeward flow-separation bubble (zero wind erosion, high deposition trap, zero wind ripples).

### Iterative Saltation & Avalanching (`sim.windDrift`)
In each ping-pong iteration:
1. **Venturi Wind Speedup & Shear**:
   $$u_{\text{eff}}(\mathbf{p}) = (1.0 - S(\mathbf{p})) \cdot (1.0 + \alpha_{\text{venturi}} \frac{h(\mathbf{p})}{H_{\max}}) \cdot \max(0.1, 1.0 + \beta_{\text{slope}}(\nabla h \cdot \mathbf{w}))$$
2. **Erosion & Downwind Advection**:
   - Upwind exposed cells lose $\Delta s_{\text{erode}} = \min(\text{sediment}(\mathbf{p}), k_{\text{salt}} \cdot u_{\text{eff}}(\mathbf{p}))$.
   - Downwind cell receives advected flux from $\mathbf{p} - L_{\text{hop}}\mathbf{w}$, trapping fraction $\text{mix}(p_{\text{sand}}, 1.0, S(\mathbf{p}))$.
3. **Angle-of-Repose Avalanching ($\theta_{\text{repose}} \approx 33^\circ$)**:
   - Any sand pile where $(h(\mathbf{p}) - h(\mathbf{q})) / d(\mathbf{p}, \mathbf{q}) > \tan 33^\circ$ sheds half the excess height to lower neighbor $\mathbf{q}$, locking leeward slip faces to the exact physical angle of repose.
