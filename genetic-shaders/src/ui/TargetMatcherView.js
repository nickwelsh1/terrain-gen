// Target Image Matcher card contents: dropzone, target-vs-best comparison,
// per-metric similarity bars, resolution/algorithm options, Save/Load/Resume,
// and Auto-Evolve loop controls.
export class TargetMatcherView {
  // callbacks: {
  //   onBrowse(), onUpload(file), onSyntheticTarget(), onAutoToggle(), onAutoStep(),
  //   onClearTarget(), onMatcherOption(key, val), onSaveSearch(), onLoadSearchBrowse(),
  //   onResumeCheckpoint(), onDismissCheckpoint()
  // }
  constructor(body, callbacks) {
    this.cb = callbacks;
    this.el = document.createElement('div');
    this.el.className = 'd-flex flex-col gap-3';
    this.optionInputs = new Map();
    body.append(this.el);
    this._build();
  }

  _build() {
    // Saved checkpoint resume banner (hidden unless a localStorage checkpoint exists)
    this.resumeBanner = document.createElement('div');
    this.resumeBanner.className = 'target-matcher__resume hidden';
    this.resumeInfo = document.createElement('div');
    this.resumeInfo.className = 'target-matcher__resume-info';
    const resumeActions = document.createElement('div');
    resumeActions.className = 'd-flex gap-1 items-center';
    this.btnResume = document.createElement('button');
    this.btnResume.className = 'btn btn--sm btn--primary';
    this.btnResume.textContent = '↺ Resume';
    this.btnResume.title = 'Restore saved target and evolution progress from browser storage';
    this.btnResume.addEventListener('click', () => this.cb.onResumeCheckpoint?.());
    this.btnDismissResume = document.createElement('button');
    this.btnDismissResume.className = 'btn btn--sm';
    this.btnDismissResume.textContent = '✕';
    this.btnDismissResume.title = 'Dismiss saved checkpoint';
    this.btnDismissResume.addEventListener('click', () => this.cb.onDismissCheckpoint?.());
    resumeActions.append(this.btnResume, this.btnDismissResume);
    this.resumeBanner.append(this.resumeInfo, resumeActions);

    // Dropzone
    this.dropzone = document.createElement('div');
    this.dropzone.className = 'target-matcher__dropzone';
    this.dropzone.innerHTML =
      '<strong>Drop a target heightmap</strong><span class="text-faint">or click to browse — center-cropped up to 256×256</span>';
    this.dropzone.addEventListener('click', () => this.cb.onBrowse());
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('target-matcher__dropzone--drag');
    });
    this.dropzone.addEventListener('dragleave', () => {
      this.dropzone.classList.remove('target-matcher__dropzone--drag');
    });
    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('target-matcher__dropzone--drag');
      const file = e.dataTransfer.files?.[0];
      if (file) this.cb.onUpload(file);
    });

    // Synthetic target + Load Search + Clear row
    const synthRow = document.createElement('div');
    synthRow.className = 'd-flex flex-wrap gap-2';
    this.btnSynth = document.createElement('button');
    this.btnSynth.className = 'btn btn--sm flex-1';
    this.btnSynth.textContent = '⚗ Random target';
    this.btnSynth.title = 'Renders a random genotype as the target — instant way to test the matcher';
    this.btnSynth.addEventListener('click', () => this.cb.onSyntheticTarget());

    this.btnLoadSearch = document.createElement('button');
    this.btnLoadSearch.className = 'btn btn--sm';
    this.btnLoadSearch.textContent = '📂 Load Search';
    this.btnLoadSearch.title = 'Load a previously saved .json search session';
    this.btnLoadSearch.addEventListener('click', () => this.cb.onLoadSearchBrowse?.());

    this.btnClear = document.createElement('button');
    this.btnClear.className = 'btn btn--sm btn--danger hidden';
    this.btnClear.textContent = 'Clear';
    this.btnClear.addEventListener('click', () => this.cb.onClearTarget());
    synthRow.append(this.btnSynth, this.btnLoadSearch, this.btnClear);

    // Match & Evolution options
    const options = document.createElement('div');
    options.className = 'target-matcher__options';

    // Resolution selector row (64 / 128 / 256)
    const resRow = document.createElement('div');
    resRow.className = 'target-matcher__res-row';
    const resLbl = document.createElement('span');
    resLbl.className = 'target-matcher__option-label';
    resLbl.textContent = 'Scoring Resolution';
    this.resSelect = document.createElement('select');
    this.resSelect.className = 'select target-matcher__res-select';
    for (const [val, text] of [
      [64, '64×64 (Fast)'],
      [128, '128×128 (High)'],
      [256, '256×256 (Ultra)'],
    ]) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = text;
      this.resSelect.append(o);
    }
    this.resSelect.value = '128';
    this.resSelect.addEventListener('change', () => {
      const sz = Number(this.resSelect.value);
      this.cb.onMatcherOption('analysisSize', sz);
    });
    resRow.append(resLbl, this.resSelect);
    options.append(resRow);

    for (const [key, label, hint, defChecked] of [
      ['layout', 'Match spatial layout', 'compares 8×8 regional structure + auto-invert', false],
      ['crisp', 'Prioritize crisp ridges', 'boosts Laplacian curvature & slope weight', false],
      ['metricGuided', 'Metric-guided mutation', 'targets lagging sub-scores & breeds specialists', true],
      ['mcmc', 'MCMC valley-crossing', 'Metropolis annealing escapes deep traps (slower)', false],
      ['hideTiles', 'Hide grid tiles while evolving', 'skips tile redraws until paused for max speed', false],
    ]) {
      const row = document.createElement('label');
      row.className = 'target-matcher__option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'checkbox';
      box.checked = defChecked;
      box.addEventListener('input', () => this.cb.onMatcherOption(key, box.checked));
      this.optionInputs.set(key, box);
      const txt = document.createElement('span');
      txt.className = 'target-matcher__option-label';
      txt.textContent = label;
      const h = document.createElement('span');
      h.className = 'target-matcher__option-hint';
      h.textContent = hint;
      row.append(box, txt, h);
      options.append(row);
    }

    // Compare thumbnails
    this.compare = document.createElement('div');
    this.compare.className = 'target-matcher__compare hidden';
    this.compare.innerHTML = `
      <div class="target-matcher__thumb">
        <img class="target-matcher__thumb-img" id="__target-thumb" alt="Target" />
        <span class="target-matcher__thumb-label">Target</span>
      </div>
      <div class="target-matcher__thumb">
        <div class="target-matcher__thumb-frame">
          <img class="target-matcher__thumb-img target-matcher__thumb-img--best" id="__best-thumb" alt="Best match" />
          <span class="target-matcher__thumb-badge hidden" id="__best-badge">—</span>
        </div>
        <span class="target-matcher__thumb-label">Best match <span class="target-matcher__thumb-pct" id="__best-pct"></span></span>
      </div>`;
    this.targetThumb = this.compare.querySelector('#__target-thumb');
    this.bestThumb = this.compare.querySelector('#__best-thumb');
    this.bestBadge = this.compare.querySelector('#__best-badge');
    this.bestPct = this.compare.querySelector('#__best-pct');

    // Metric bars (0th, 1st, 2nd derivative + FFT spectrum)
    this.metrics = document.createElement('div');
    this.metrics.className = 'd-flex flex-col gap-2 hidden';
    this.bars = {};
    for (const [key, label] of [
      ['total', 'Total Fitness'],
      ['hist', 'Histogram (0th)'],
      ['slope', 'Slope (1st)'],
      ['lap', 'Laplacian (2nd)'],
      ['fft', 'FFT Spectrum'],
    ]) {
      const row = document.createElement('div');
      row.className = 'metric-bar';
      row.innerHTML = `
        <span class="metric-bar__label">${label}</span>
        <div class="metric-bar__track"><div class="metric-bar__fill"></div></div>
        <span class="metric-bar__value">—</span>`;
      this.bars[key] = {
        fill: row.querySelector('.metric-bar__fill'),
        value: row.querySelector('.metric-bar__value'),
      };
      this.metrics.append(row);
    }

    // Auto-evolve controls
    this.autoRow = document.createElement('div');
    this.autoRow.className = 'd-flex flex-col gap-2 hidden';
    const btnRow = document.createElement('div');
    btnRow.className = 'd-flex flex-wrap gap-2';
    this.btnAuto = document.createElement('button');
    this.btnAuto.className = 'btn btn--primary btn--sm flex-1';
    this.btnAuto.textContent = '▶ Auto-Evolve';
    this.btnAuto.addEventListener('click', () => this.cb.onAutoToggle());
    this.btnStep = document.createElement('button');
    this.btnStep.className = 'btn btn--sm';
    this.btnStep.textContent = 'Step';
    this.btnStep.title = 'Evaluate 80-candidate pool for one generation';
    this.btnStep.addEventListener('click', () => this.cb.onAutoStep());
    this.btnSaveSearch = document.createElement('button');
    this.btnSaveSearch.className = 'btn btn--sm';
    this.btnSaveSearch.textContent = '💾 Save';
    this.btnSaveSearch.title = 'Download this search session (.json) to resume later';
    this.btnSaveSearch.addEventListener('click', () => this.cb.onSaveSearch?.());
    btnRow.append(this.btnAuto, this.btnStep, this.btnSaveSearch);

    this.stats = document.createElement('div');
    this.stats.className = 'target-matcher__stats';
    this.stats.textContent = 'No generations run yet (80 candidates/gen).';

    this.algoStatus = document.createElement('div');
    this.algoStatus.className = 'target-matcher__algo-status hidden';

    this.autoRow.append(btnRow, this.stats, this.algoStatus);

    this.el.append(this.resumeBanner, this.dropzone, synthRow, options, this.compare, this.metrics, this.autoRow);
  }

  syncOptions(matcher = {}) {
    if (matcher.analysisSize) {
      this.resSelect.value = String(matcher.analysisSize);
    }
    for (const [key, box] of this.optionInputs.entries()) {
      if (key in matcher) box.checked = Boolean(matcher[key]);
    }
  }

  setCheckpointBanner(checkpoint) {
    if (!checkpoint || !checkpoint.target) {
      this.resumeBanner.classList.add('hidden');
      return;
    }
    const gen = checkpoint.auto?.generation || 0;
    const fit = typeof checkpoint.auto?.bestFitness === 'number'
      ? `${checkpoint.auto.bestFitness.toFixed(1)}%`
      : '—';
    const name = checkpoint.target.name || 'Saved target';
    this.resumeInfo.innerHTML =
      `<strong>Saved search: ${name}</strong><span class="text-faint">Gen ${gen} · Best ${fit}</span>`;
    this.resumeBanner.classList.remove('hidden');
  }

  setTarget({ thumbUrl, name }) {
    this.targetThumb.src = thumbUrl;
    this.compare.classList.remove('hidden');
    this.metrics.classList.remove('hidden');
    this.autoRow.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');
    this.resumeBanner.classList.add('hidden');
    this.dropzone.innerHTML =
      `<strong>${name || 'Target loaded'}</strong><span class="text-faint">drop or click to replace</span>`;
  }

  clearTarget() {
    this.compare.classList.add('hidden');
    this.metrics.classList.add('hidden');
    this.autoRow.classList.add('hidden');
    this.btnClear.classList.add('hidden');
    this.dropzone.innerHTML =
      '<strong>Drop a target heightmap</strong><span class="text-faint">or click to browse — center-cropped up to 256×256</span>';
    this.setScores(null);
    this.setBestMatch({ thumbUrl: null, fitness: null, stale: false });
    this.stats.textContent = 'No generations run yet (80 candidates/gen).';
  }

  setScores(scores) {
    for (const key of Object.keys(this.bars)) {
      const v = scores ? scores[key] : null;
      this.bars[key].fill.style.width = v == null ? '0%' : `${(v * 100).toFixed(1)}%`;
      this.bars[key].value.textContent = v == null ? '—' : `${(v * 100).toFixed(1)}%`;
    }
  }

  setBestThumb(dataUrl) {
    if (dataUrl) this.bestThumb.src = dataUrl;
  }

  setBestMatch({ thumbUrl, fitness, stale = false } = {}) {
    if (thumbUrl) this.bestThumb.src = thumbUrl;
    const hasScore = typeof fitness === 'number' && fitness >= 0;
    const txt = hasScore ? `${fitness.toFixed(1)}%` : '';
    const title = stale
      ? 'Matcher options changed since last run or step — Step or Auto-Evolve to update'
      : 'Best match fitness';
    this.bestPct.textContent = txt ? `· ${txt}` : '';
    this.bestPct.classList.toggle('target-matcher__thumb-pct--stale', stale);
    this.bestPct.title = title;
    this.bestBadge.textContent = txt || '—';
    this.bestBadge.classList.toggle('hidden', !hasScore);
    this.bestBadge.classList.toggle('target-matcher__thumb-badge--stale', stale);
    this.bestBadge.title = title;
    this.bestThumb.classList.toggle('target-matcher__thumb-img--stale', stale);
  }

  setAutoState(auto, lockedCount = 0) {
    this.btnAuto.textContent = auto.running ? '⏸ Pause' : '▶ Auto-Evolve';
    this.stats.textContent =
      `Gen ${auto.generation} · best ${auto.bestFitness.toFixed(1)}%` +
      (auto.bestStale ? ' (options changed — ready to re-run)' : '') +
      (auto.running ? ' · evolving 80/gen…' : '');

    if (!this.algoStatus) return;
    const parts = [];
    if (lockedCount > 0) {
      parts.push(`🔒 ${lockedCount} user-locked`);
    }
    if (auto.reheatRemaining > 0) {
      parts.push(`🔥 Re-heat ${auto.reheatRemaining}/5 (chimera jump)`);
    }
    if (auto.groupMultipliers) {
      const labels = { core: 'Core', warp: 'Warp', erosion: 'Erosion', curvature: 'Curvature', tone: 'Tone' };
      const holds = [];
      const boosts = [];
      for (const [k, m] of Object.entries(auto.groupMultipliers)) {
        if (m <= 0.5) holds.push(labels[k] || k);
        else if (m >= 1.12) boosts.push(`${labels[k] || k} ${m.toFixed(1)}×`);
      }
      if (boosts.length) parts.push(`Exploring: ${boosts.join(', ')}`);
      if (holds.length) parts.push(`Soft-held: ${holds.join(', ')}`);
    }
    if (parts.length > 0 && (auto.generation > 0 || lockedCount > 0)) {
      this.algoStatus.textContent = parts.join(' · ');
      this.algoStatus.classList.remove('hidden');
    } else {
      this.algoStatus.classList.add('hidden');
    }
  }
}
