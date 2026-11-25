// Tabbed Help & Algorithm Guide modal:
//   1. Quick Start & Export
//   2. Matching Metrics (0th / 1st / 2nd Derivative + 2D FFT + Layout)
//   3. Evolution, MCMC & Guided Mutation
//   4. Best Use Cases & Limitations
export class HelpModalView {
  constructor(modalRoot) {
    this.root = modalRoot;
    this.activeTab = 'quickstart';
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="modal__dialog modal__dialog--wide">
        <div class="modal__header">
          <span class="modal__title">🧬 Genetic Shaders — Guide & Algorithm Reference</span>
          <button class="modal__close" title="Close (Esc)">✕</button>
        </div>
        <div class="modal__tabs">
          <button class="modal__tab modal__tab--active" data-tab="quickstart">Quick Start & Export</button>
          <button class="modal__tab" data-tab="metrics">Geomorphology Metrics</button>
          <button class="modal__tab" data-tab="algorithms">Evolution, MCMC & Guided</button>
          <button class="modal__tab" data-tab="tips">Best Use Cases & Tips</button>
        </div>
        <div class="modal__body help-guide">
          <!-- Tab 1: Quick Start & Export -->
          <div data-pane="quickstart" class="help-guide__pane">
            <section class="help-guide__section">
              <h3 class="help-guide__heading">Interactive Breeding (IGA)</h3>
              <p>
                The explorer grid surrounds the center <strong>Parent</strong> shader with mutated offspring.
                Inner rings contain subtle refinements while outer rings explore bolder variations.
              </p>
              <ul class="help-guide__list">
                <li><strong>Click any cell</strong> to promote it to the center Parent and breed a new generation around it.</li>
                <li><strong>Click <code>◉</code> (Inspect)</strong> on any cell to preview it in the 2D/3D Hero viewport without evolving the grid.</li>
                <li><strong>Click <code>★</code></strong> on any cell to save it to your persistent Favorites library (accessible from the toolbar <code>★</code> button).</li>
                <li><strong>Lock Genes (<code>🔒</code>)</strong> in the right-hand parameter cards to freeze specific parameters (such as <em>Noise Type</em> or <em>Frequency</em>) while evolving everything else.</li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Exporting GLSL Shaders, PNG Heightmaps & JSON</h3>
              <p>
                Click the <strong><code>⤓ Export GLSL / PNG</code></strong> button inside the <strong>Hero Preview &amp; 3D Heightmap</strong> card to export whichever shader is currently shown in the Hero viewport:
              </p>
              <ul class="help-guide__list">
                <li><strong>GLSL Code (<code>.frag</code>):</strong> Generates a self-contained, dependency-free fragment shader with all noise functions (Perlin, Simplex, Worley F1/Crackle, Ridged Multifractal, Domain Warping, Runevision Phacelle &amp; Classic Gavoronoise Erosion Filters, Laplacian feedback) and your exact evolved constants baked in. Ready to paste directly into <em>Shadertoy</em> or custom WebGL/Three.js pipelines.</li>
                <li><strong>PNG Heightmap:</strong> Renders a clean grayscale heightmap at <strong>512×512</strong>, <strong>1024×1024</strong>, or <strong>2048×2048</strong> resolution for displacement mapping in Blender, Unreal, Unity, or GIS tools.</li>
                <li><strong>Genotype JSON:</strong> Exports the compact 28-gene parameter payload so you can archive or share genotypes.</li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Keyboard Shortcuts</h3>
              <div class="help-guide__grid">
                <div><kbd>M</kbd> — Mutate grid around parent</div>
                <div><kbd>R</kbd> — Randomize grid (keeps parent)</div>
                <div><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> — Undo / Redo</div>
                <div><kbd>Esc</kbd> — Close overlays &amp; modals</div>
              </div>
            </section>
          </div>

          <!-- Tab 2: Geomorphology Metrics -->
          <div data-pane="metrics" class="help-guide__pane hidden">
            <section class="help-guide__section">
              <h3 class="help-guide__heading">Multi-Derivative Terrain &amp; Texture Feature Signature</h3>
              <p>
                Pixel-by-pixel MSE fails on procedural noise because shifting a noise seed by 1 millimeter changes every pixel while preserving the exact same visual terrain. Instead, the Target Image Matcher evaluates a complete <strong>geomorphological derivative hierarchy</strong> plus 2D spectral energy:
              </p>
              <ul class="help-guide__list">
                <li>
                  <strong>0th Derivative — Elevation Histogram CDF (<code>Histogram</code>):</strong>
                  Compares the 32-bin cumulative distribution of heights using <em>1D Wasserstein / Earth Mover's Distance (EMD)</em> plus mean/std moments. Captures overall brightness, contrast, and plateau-vs-basin balance.
                </li>
                <li>
                  <strong>1st Derivative — Slope / Steepness Distribution (<code>Slope</code>):</strong>
                  Computes the Sobel / central-difference gradient magnitude <code>|∇h| = √(gx² + gy²)</code> across the heightfield and compares its 32-bin CDF and mean slope energy. Distinguishes steep cliffs and terraced canyons from gentle rolling hills.
                </li>
                <li>
                  <strong>2nd Derivative — Isotropic 8-Neighbor Laplacian (<code>Laplacian</code>):</strong>
                  Convolves the heightfield with a rotationally invariant 3×3 Laplacian kernel (<code>0.5·orthogonal + 0.25·diagonal − 3·center</code>). Because it includes diagonal neighbors, 45° mountain ridges and cellular cracks score identically to horizontal/vertical ridges.
                </li>
                <li>
                  <strong>Spectral — 2D Radix-2 FFT Power Spectrum (<code>FFT Spectrum</code>):</strong>
                  Applies a 2D Hann window and Fast Fourier Transform, partitioning log-power into <strong>32 radial frequency rings</strong> (feature scale &amp; fBm 1/f<sup>β</sup> rolloff) and <strong>8 angular wedges</strong> (directional anisotropy).
                </li>
                <li>
                  <strong>Coarse Spatial Structure — 8×8 Regional Layout (<code>Match spatial layout</code>):</strong>
                  Optional toggle that compares an 8×8 grid of regional mean luminances (and automatically tests luminance inversion) so large-scale bright peaks and dark basins land in similar regions of the frame.
                </li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Scoring Resolution: 64×64 vs. 128×128 vs. 256×256</h3>
              <p>
                Uploaded target images are center-cropped and stored at <strong>256×256</strong> master resolution so you can switch scoring resolution on the fly without re-uploading:
              </p>
              <ul class="help-guide__list">
                <li><strong>64×64 (Fast):</strong> Ideal for rapid macro-exploration (4× faster FFT &amp; WebGL readback). Captures up to Nyquist frequency 32 cycles/tile.</li>
                <li><strong>128×128 (High):</strong> Balanced speed and crispness for multi-octave ridges and erosion (Nyquist 64 cycles/tile).</li>
                <li><strong>256×256 (Ultra):</strong> Matches the full 256×256 tile resolution for ultra-fine Worley crackle, high-lacunarity fBm, and sharp micro-detail. Pair with <em>Hide grid tiles while evolving</em> to keep frame rates fast.</li>
              </ul>
            </section>
          </div>

          <!-- Tab 3: Evolution, MCMC & Guided Mutation -->
          <div data-pane="algorithms" class="help-guide__pane hidden">
            <section class="help-guide__section">
              <h3 class="help-guide__heading">Fixed 80-Candidate Memetic Pool &amp; Gen-0 Tournament</h3>
              <p>
                Whether your visible grid is set to <strong>3×3</strong> (9 tiles) or <strong>9×9</strong> (81 tiles), Auto-Evolve always evaluates a full <strong>80-candidate internal pool</strong> every generation and projects the top runners-up onto your visible grid sorted by genetic distance from the parent.
              </p>
              <ul class="help-guide__list">
                <li><strong>Gen-0 Stratified Tournament:</strong> Generation 1 automatically tests all 6 starter presets and all 6 noise families across 3 normalized frequency scales, followed by a <strong>3-step analytical tone micro-climb</strong> (<code>contrast</code>, <code>bias</code>, <code>invert</code>) so every noise family competes with matched brightness and contrast from the very first step.</li>
                <li><strong>Cross-Noise Frequency Normalization:</strong> Simplex and Worley Crackle have ~1.6–1.75× higher intrinsic feature density than Perlin at the same <code>uFrequency</code> uniform. Whenever mutation jumps between noise families, <code>frequency</code> is automatically rescaled so feature size stays locked.</li>
                <li><strong>5-Step Re-heat Cooldown &amp; Structural Chimeras:</strong> After 8 stagnant generations, variation spikes and cools down smoothly over 5 generations while injecting <em>Structural Chimeras</em> (new noise/warp genes grafted onto the parent's already-tuned frequency and tone).</li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Metric-Guided Mutation vs. MCMC Valley-Crossing</h3>
              <ul class="help-guide__list">
                <li>
                  <strong>Metric-Guided Mutation (Default: ON):</strong>
                  Inspects the current parent's sub-score deficits (<code>FFT</code>, <code>Slope</code>, <code>Laplacian</code>, <code>Histogram</code>, <code>Layout</code>). Gene groups whose corresponding metric is already <code>&gt;92%</code> converged are damped (<code>0.45×</code>) to prevent destructive drift, while lagging gene groups get up to <code>1.5×</code> focused exploration. Also cross-breeds each generation's best <em>spectral specialist</em> (<code>core</code>+<code>warp</code>) with its best <em>curvature/tone specialist</em> (<code>curvature</code>+<code>tone</code>).
                </li>
                <li>
                  <strong>MCMC Valley-Crossing (Default: OFF):</strong>
                  Switches parent selection from strict Elitist <code>(1 + λ)</code> to <strong>Multiple-Try Metropolis-Hastings MCMC</strong>. Offspring with slightly lower fitness (<code>Δ</code>) can be accepted as the active search parent with probability <code>P = exp(−Δ / T)</code>, allowing the search to walk across fitness valleys when escaping deceptive local optima. Your all-time highest scorer is always preserved in <em>Best match</em> and restored when you pause.
                </li>
                <li>
                  <strong>Hide Grid Tiles While Evolving:</strong>
                  Pauses DOM canvas blitting on the grid during active Auto-Evolve so 100% of GPU/CPU budget goes to offscreen fitness evaluation. Full grid tiles render immediately when you click Pause or Step.
                </li>
              </ul>
            </section>
          </div>

          <!-- Tab 4: Best Use Cases & Limitations -->
          <div data-pane="tips" class="help-guide__pane hidden">
            <section class="help-guide__section">
              <h3 class="help-guide__heading">What Procedural Shader Matching Excels At</h3>
              <ul class="help-guide__list">
                <li><strong>Digital Elevation Models (DEMs) &amp; Heightmaps:</strong> Mountain ranges, eroded valleys, river basins, volcanic calderas, dune fields, and bathymetries.</li>
                <li><strong>Organic &amp; Mineral Textures:</strong> Cellular cracks, Voronoi basalt, coral stone, marble veins, clouds, bark, and weathered rock surfaces.</li>
                <li><strong>Infinite Resolution &amp; Zero-Texture Memory:</strong> Once matched, your exported GLSL shader synthesizes the texture mathematically at any resolution or UV scale with 0 KB of image assets.</li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Procedural Terrain Erosion Filter (Runevision &amp; Classic)</h3>
              <p>
                The <strong>Erosion Filter</strong> card carves slope-aligned branching gullies and sharp ridges in a single GPU pass on top of any base noise family and domain warp:
              </p>
              <ul class="help-guide__list">
                <li><strong>Runevision Advanced (Phacelle + Stacked Fade):</strong> Uses 4×4 cellular <em>Simple Phacelle Noise</em> with partial amplitude normalization, stacked octave masking (so small gullies don't chew up primary mountain ridges), straight triangle-wave gully slopes for clean branching angles, and a dendritic <code>ridgeMap</code> output.</li>
                <li><strong>Classic (Clay John / Fewes Gavoronoise):</strong> Uses frequency-scaled Gabor-Voronoi directional waves where stripe thickness scales with slope steepness and curl feeds successive octaves.</li>
                <li><strong>Display Modes:</strong> Switch <em>Color Mode</em> to <strong>Alpine &amp; Drainage</strong> or <strong>Erosion Ridge Map</strong> to visualize dendritic river/sediment channels and ridge crests.</li>
              </ul>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Fundamental Limitations</h3>
              <p>
                The shader pipeline is a stationary procedural heightfield generator (6 noise families + domain warping + dual-mode Phacelle/Gavoronoise erosion + Laplacian feedback + tone shaping). It matches <strong>statistical, spectral, and geomorphological structure</strong> (plus coarse 8×8 regional layout when enabled) — <em>not</em> arbitrary pixel-exact photographs (such as faces, lettering, man-made architecture, or perspective-lit photos with baked shadows). For best results, use top-down grayscale heightmaps or albedo-free surface textures.
              </p>
            </section>

            <section class="help-guide__section">
              <h3 class="help-guide__heading">Recommended Pro Workflow</h3>
              <ol class="help-guide__list help-guide__list--ordered">
                <li><strong>Start at 64×64 or 128×128</strong> with <em>Metric-guided mutation</em> ON for the first 30–60 generations to rapidly lock in the right Noise Type, Frequency, and Domain Warp.</li>
                <li><strong>Lock converged macro genes:</strong> Once the main ridge/cell structure looks right, click <code>🔒</code> next to <em>Noise Type</em> and <em>Frequency</em> in the Core Noise card.</li>
                <li><strong>Switch to 256×256 + Prioritize Crisp Ridges</strong> for 20–40 generations of fine-detail sharpening on <em>Laplacian Weight</em>, <em>Ridge Sharpness</em>, and <em>Lacunarity</em>.</li>
                <li><strong>Save / Resume anytime:</strong> Progress auto-checkpoints to browser storage every generation, or click <strong>💾 Save</strong> to download a portable <code>.json</code> search file.</li>
              </ol>
            </section>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--primary" id="__help-close-btn">Got it</button>
        </div>
      </div>`;

    this.root.querySelector('.modal__close').addEventListener('click', () => this.close());
    this.root.querySelector('#__help-close-btn').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });

    this.panes = {};
    for (const pane of this.root.querySelectorAll('[data-pane]')) {
      this.panes[pane.dataset.pane] = pane;
    }
    this.tabs = {};
    for (const tab of this.root.querySelectorAll('.modal__tab')) {
      this.tabs[tab.dataset.tab] = tab;
      tab.addEventListener('click', () => this._showTab(tab.dataset.tab));
    }
  }

  _showTab(name) {
    this.activeTab = name;
    for (const [k, pane] of Object.entries(this.panes)) {
      pane.classList.toggle('hidden', k !== name);
    }
    for (const [k, tab] of Object.entries(this.tabs)) {
      tab.classList.toggle('modal__tab--active', k === name);
    }
  }

  open(tab = 'quickstart') {
    this._showTab(tab);
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
  }
}
