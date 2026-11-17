import { createCard } from './CollapsibleCard.js';
import { PRESETS, DEFAULT_PRESET } from '../config/presets.js';

// Owns the app-shell DOM: toolbar wiring, sidebar collapse,
// and the first two inspector cards (Hero Preview, Evolution).
export class AppLayout {
  // callbacks: {
  //   onPreset(name), onGridSize(n), onVariation(v), onMutate(), onCrossover(),
  //   onRandomize(), onUndo(), onRedo(), onPreviewMode(mode), onWireframe(on),
  //   onSpatialScaling(on), onMutationRate(v), onExport()
  // }
  constructor(callbacks) {
    this.cb = callbacks;
    this.workspace = document.getElementById('workspace');
    this.cardsContainer = document.getElementById('cards-container');
    this._wireToolbar();
    this._wireSidebar();
    this._buildHeroCard();
    this._buildEvolutionCard();
  }

  _wireToolbar() {
    this.presetSelect = document.getElementById('preset-select');
    for (const name of Object.keys(PRESETS)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      this.presetSelect.append(o);
    }
    this.presetSelect.value = DEFAULT_PRESET;
    this.presetSelect.addEventListener('change', () => this.cb.onPreset(this.presetSelect.value));

    this.gridSelect = document.getElementById('grid-size-select');
    this.gridSelect.addEventListener('change', () => this.cb.onGridSize(Number(this.gridSelect.value)));

    this.variationSlider = document.getElementById('variation-slider');
    this.variationOutput = document.getElementById('variation-output');
    this.variationSlider.addEventListener('input', () => {
      this._onVariation(Number(this.variationSlider.value));
    });

    this.btnMutate = document.getElementById('btn-mutate');
    this.btnCrossover = document.getElementById('btn-crossover');
    this.btnRandomize = document.getElementById('btn-randomize');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.btnFavorites = document.getElementById('btn-favorites');
    this.btnHelp = document.getElementById('btn-help');
    this.favCount = document.getElementById('fav-count');
    this.btnMutate.addEventListener('click', () => this.cb.onMutate());
    this.btnFavorites.addEventListener('click', () => this.cb.onFavoritesToggle());
    this.btnHelp?.addEventListener('click', () => this.cb.onHelpToggle?.());
    this.btnCrossover.addEventListener('click', () => this.cb.onCrossover());
    this.btnRandomize.addEventListener('click', () => this.cb.onRandomize());
    this.btnUndo.addEventListener('click', () => this.cb.onUndo());
    this.btnRedo.addEventListener('click', () => this.cb.onRedo());
  }

  _wireSidebar() {
    const sidebarBtn = document.getElementById('btn-sidebar');
    sidebarBtn.addEventListener('click', () => {
      this.workspace.classList.toggle('workspace--sidebar-collapsed');
    });
    document.getElementById('btn-expand-all').addEventListener('click', () => {
      for (const c of this.cardsContainer.querySelectorAll('.control-card')) {
        c.classList.remove('control-card--collapsed');
      }
    });
    document.getElementById('btn-collapse-all').addEventListener('click', () => {
      for (const c of this.cardsContainer.querySelectorAll('.control-card')) {
        c.classList.add('control-card--collapsed');
      }
    });
  }

  _buildHeroCard() {
    const card = createCard({ title: 'Hero Preview & 3D Heightmap', icon: '🔍' });
    card.el.classList.add('control-card--pinned');

    const wrap = document.createElement('div');
    wrap.className = 'hero-preview';

    const viewport = document.createElement('div');
    viewport.className = 'hero-preview__viewport';
    this.heroCanvas = document.createElement('canvas');
    this.heroCanvas.className = 'hero-preview__canvas';
    this.heroTag = document.createElement('span');
    this.heroTag.className = 'hero-preview__tag';
    this.heroTag.textContent = 'Parent · 2D';
    this.heroFitness = document.createElement('span');
    this.heroFitness.className = 'hero-preview__fitness hidden';
    viewport.append(this.heroCanvas, this.heroTag, this.heroFitness);

    const bar = document.createElement('div');
    bar.className = 'hero-preview__bar';

    this.seg2d = document.createElement('button');
    this.seg3d = document.createElement('button');
    const seg = document.createElement('div');
    seg.className = 'seg';
    this.seg2d.className = 'seg__btn seg__btn--active';
    this.seg2d.textContent = '2D Shader';
    this.seg3d.className = 'seg__btn';
    this.seg3d.textContent = '3D Mesh';
    this.seg2d.addEventListener('click', () => this._setMode('2d'));
    this.seg3d.addEventListener('click', () => this._setMode('3d'));
    seg.append(this.seg2d, this.seg3d);

    const wireLabel = document.createElement('label');
    wireLabel.className = 'field';
    const wire = document.createElement('input');
    wire.type = 'checkbox';
    wire.className = 'checkbox';
    wire.addEventListener('input', () => this.cb.onWireframe(wire.checked));
    const wireTxt = document.createElement('span');
    wireTxt.className = 'field__label';
    wireTxt.textContent = 'Wireframe';
    wireLabel.append(wire, wireTxt);

    const btnExport = document.createElement('button');
    btnExport.className = 'btn btn--sm ml-auto';
    btnExport.textContent = '⤓ Export GLSL / PNG';
    btnExport.addEventListener('click', () => this.cb.onExport());

    bar.append(seg, wireLabel, btnExport);
    wrap.append(viewport, bar);
    card.body.append(wrap);
    this.cardsContainer.append(card.el);
  }

  _setMode(mode) {
    this.seg2d.classList.toggle('seg__btn--active', mode === '2d');
    this.seg3d.classList.toggle('seg__btn--active', mode === '3d');
    this.cb.onPreviewMode(mode);
  }

  _buildEvolutionCard() {
    const card = createCard({ title: 'Evolution & Variation', icon: '🧪' });

    // Variation intensity mirrors the live toolbar control.
    const varRow = this._sliderRow('Variation Intensity', 0.02, 1, 0.01, 0.4, (v) => {
      this._onVariation(v);
    });
    this.evoVariationRange = varRow.range;
    this.evoVariationValue = varRow.valueEl;

    // Mutate applies the current variation setting to generate new offspring.
    this.evoMutateBtn = document.createElement('button');
    this.evoMutateBtn.className = 'btn btn--sm btn--primary';
    this.evoMutateBtn.style.gridArea = 'mutate';
    this.evoMutateBtn.textContent = 'Mutate';
    this.evoMutateBtn.title = 'Generate new offspring using this variation setting';
    this.evoMutateBtn.addEventListener('click', () => this.cb.onMutate());
    varRow.row.style.gridTemplateColumns = '1fr auto auto';
    varRow.row.style.gridTemplateAreas = "'label label mutate' 'slider num mutate'";
    varRow.row.append(this.evoMutateBtn);

    // Mutation rate
    const rateRow = this._sliderRow('Mutation Rate (genes touched)', 0.1, 1, 0.01, 1.0, (v) => {
      this.cb.onMutationRate(v);
    });

    // Spatial distance scaling toggle
    const spatial = document.createElement('label');
    spatial.className = 'field';
    const spatialBox = document.createElement('input');
    spatialBox.type = 'checkbox';
    spatialBox.className = 'checkbox';
    spatialBox.checked = true;
    spatialBox.addEventListener('input', () => this.cb.onSpatialScaling(spatialBox.checked));
    const spatialTxt = document.createElement('span');
    spatialTxt.className = 'field__label';
    spatialTxt.textContent = 'Radial distance scaling (outer rings = bolder mutations)';
    spatial.append(spatialBox, spatialTxt);

    const hint = document.createElement('p');
    hint.className = 'text-xs text-faint';
    hint.textContent = 'Lock genes in the parameter cards below to freeze them during mutation.';

    card.body.append(varRow.row, rateRow.row, spatial, hint);
    this.cardsContainer.append(card.el);
  }

  _sliderRow(label, min, max, step, value, onInput) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.style.gridTemplateAreas = "'label label' 'slider num'";

    const lbl = document.createElement('span');
    lbl.className = 'slider-row__label';
    lbl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'slider-row__value';
    lbl.append(valueEl);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'slider-row__range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;

    const num = document.createElement('output');
    num.className = 'slider-row__num text-mono text-xs text-accent';
    num.style.gridArea = 'num';
    num.textContent = `${Math.round(value * 100)}%`;

    const update = () => {
      const v = Number(range.value);
      num.textContent = `${Math.round(v * 100)}%`;
      onInput(v);
    };
    range.addEventListener('input', update);

    row.append(lbl, range, num);
    return { row, range, valueEl: num };
  }

  // Keep both variation controls and readouts in sync.
  _onVariation(v) {
    const pct = `${Math.round(v * 100)}%`;
    this.variationSlider.value = v;
    this.variationOutput.textContent = pct;
    if (this.evoVariationRange) {
      this.evoVariationRange.value = v;
      this.evoVariationValue.textContent = pct;
    }
    this.cb.onVariation(v);
  }

  // Reflect state into toolbar controls without firing callbacks.
  syncToolbar({ variation, canUndo, canRedo, canCrossover }) {
    this.variationSlider.value = variation;
    this.variationOutput.textContent = `${Math.round(variation * 100)}%`;
    if (this.evoVariationRange) {
      this.evoVariationRange.value = variation;
      this.evoVariationValue.textContent = `${Math.round(variation * 100)}%`;
    }
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;
    this.btnCrossover.disabled = !canCrossover;
  }

  setFavCount(n) {
    this.favCount.textContent = n;
  }

  setHeroTag(text) {
    this.heroTag.textContent = text;
  }

  setHeroFitness(v) {
    if (v == null) {
      this.heroFitness.classList.add('hidden');
    } else {
      this.heroFitness.textContent = `${v.toFixed(1)}%`;
      this.heroFitness.classList.remove('hidden');
    }
  }
}
