import { Store } from './state/store.js';
import { FavoritesManager } from './state/favoritesManager.js';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  exportSearchJson,
  importSearchJson,
} from './state/searchStorage.js';
import { Genotype } from './ga/Genotype.js';
import {
  populateGrid,
  populateRandomGrid,
  randomGenotype,
  centerIndexFor,
} from './ga/GeneticEngine.js';
import { EvolutionScheduler } from './ga/EvolutionScheduler.js';
import { OffscreenTileRenderer } from './renderer/OffscreenTileRenderer.js';
import { HeroPreviewRenderer } from './renderer/HeroPreviewRenderer.js';
import {
  loadImageLuminance,
  loadLuminanceFromDataUrl,
  downsampleLuminance,
} from './matcher/ImageAnalyzer.js';
import {
  extractFeatures,
  ANALYSIS_SIZE,
  ANALYSIS_SIZE_HI,
  ANALYSIS_SIZE_ULTRA,
} from './matcher/FeatureExtractor.js';
import { scoreCandidate } from './matcher/FitnessEvaluator.js';
import { AppLayout } from './ui/AppLayout.js';
import { ExplorerGridView } from './ui/ExplorerGridView.js';
import { ControlPanelView } from './ui/ControlPanelView.js';
import { TargetMatcherView } from './ui/TargetMatcherView.js';
import { FavoritesView } from './ui/FavoritesView.js';
import { ExportModalView } from './ui/ExportModalView.js';
import { HelpModalView } from './ui/HelpModalView.js';
import { createCard } from './ui/CollapsibleCard.js';
import { SidebarNavView } from './ui/SidebarNavView.js';
import { PRESETS, DEFAULT_PRESET } from './config/presets.js';

// ---------------------------------------------------------------- bootstrap
const store = new Store();
const favorites = new FavoritesManager();
const tileRenderer = new OffscreenTileRenderer();
const scheduler = new EvolutionScheduler({ store, tileRenderer });

let historyTimer = null;
function pushHistoryThrottled() {
  if (historyTimer) return;
  store.pushHistory();
  historyTimer = setTimeout(() => { historyTimer = null; }, 900);
}

// Lightweight toast for transient confirmations (favorites saved etc.)
let toastEl = null;
let toastTimer = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('toast--visible'), 1800);
}

// Gene-signature set of all favorited genotypes (key order is stable —
// every genes object is built by spreading schema-ordered defaults).
function favSignatures() {
  return new Set(favorites.items.map((i) => JSON.stringify(i.genes)));
}

function refreshStars() {
  gridView.refreshStars(favSignatures(), store.state.cells);
}

function gaOptions() {
  const st = store.state;
  return {
    intensity: st.variationIntensity,
    spatialScaling: st.spatialScaling,
    mutationRate: st.mutationRate,
    locked: st.lockedGenes,
  };
}

// Push a history snapshot of the CURRENT state, then repopulate.
// Callers that change `parent` must pushHistory BEFORE assigning it,
// otherwise the snapshot would mix the new parent with the old cells.
function repopulate(pushHistory = true) {
  const st = store.state;
  if (pushHistory) store.pushHistory();
  st.cells = populateGrid(st.parent, st.gridSize, gaOptions());
  st.centerIndex = centerIndexFor(st.gridSize);
  st.fitness = null;
  st.auto.bestIndex = -1;
  st.inspectIndex = -1;
  store.emit('grid');
  store.emit('inspect');
}

function refreshBadges() {
  const st = store.state;
  gridView.updateBadges({
    centerIndex: st.centerIndex,
    bestIndex: st.target ? st.auto.bestIndex : -1,
    fitness: st.fitness,
  });
}

function syncToolbar() {
  const st = store.state;
  layout.syncToolbar({
    variation: st.variationIntensity,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
  });
}

// ------------------------------------------------------------------- layout
const layout = new AppLayout({
  onPreset(name) {
    store.pushHistory();
    store.state.parent = new Genotype(PRESETS[name]);
    repopulate(false);
  },
  onGridSize(n) {
    store.state.gridSize = n;
    gridView.setGridSize(n);
    repopulate();
  },
  onVariation(v) {
    store.state.variationIntensity = v;
    syncToolbar();
  },
  onMutate() { repopulate(); },
  onRandomize() {
    // Fill the grid with random genotypes; the selected parent stays put.
    const st = store.state;
    store.pushHistory();
    st.cells = populateRandomGrid(st.parent, st.gridSize, gaOptions());
    st.fitness = null;
    st.auto.bestIndex = -1;
    st.inspectIndex = -1;
    store.emit('grid');
    store.emit('inspect');
  },
  onUndo() { store.undo(); refreshBadges(); syncToolbar(); refreshParentViews(); },
  onRedo() { store.redo(); refreshBadges(); syncToolbar(); refreshParentViews(); },
  onPreviewMode(mode) {
    store.state.preview3d = mode === '3d';
    heroRenderer.setMode(mode);
    heroRenderer.update(store.inspectedGenotype());
    layout.setHeroTag(`${heroTagText()} · ${mode === '3d' ? '3D' : '2D'}`);
  },
  onWireframe(on) { heroRenderer.setWireframe(on); },
  onSpatialScaling(on) { store.state.spatialScaling = on; },
  onMutationRate(v) { store.state.mutationRate = v; },
  onExport() { exportModal.open(store.inspectedGenotype()); },
  onFavoritesToggle() { toggleFavoritesOverlay(); },
  onHelpToggle() { helpModal.open('quickstart'); },
});

const heroRenderer = new HeroPreviewRenderer(layout.heroCanvas);

// ------------------------------------------------------------------ views
const gridView = new ExplorerGridView(
  document.getElementById('explorer-grid'),
  tileRenderer,
  {
    onPromote(i) {
      const st = store.state;
      if (i === st.centerIndex) return;
      store.pushHistory();
      st.parent = st.cells[i].clone();
      repopulate(false);
    },
    onInspect(i) {
      const st = store.state;
      st.inspectIndex = i === st.centerIndex ? -1 : i;
      store.emit('inspect');
      if (layout.isMobileLayout()) {
        layout.heroPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    onStar(i) {
      const st = store.state;
      const g = st.cells[i] || st.parent;
      // Toggle: if this exact genotype is already saved, remove it.
      const sig = JSON.stringify(g.genes);
      const existing = favorites.items.find((it) => JSON.stringify(it.genes) === sig);
      if (existing) {
        favorites.remove(existing.id);
        toast('Removed from favorites');
      } else {
        favorites.add(g, gridView.thumbnailOf(i), {
          fitness: st.fitness ? st.fitness[i] : null,
        });
        toast('★ Saved to favorites');
      }
    },
  }
);

const controlPanel = new ControlPanelView(layout.cardsContainer, {
  onGene(key, value) {
    pushHistoryThrottled();
    // UX helper: if the user drags Erosion Strength above 0 while Erosion Mode
    // is Off (and unlocked), auto-enable Runevision Advanced erosion so the
    // slider has immediate visual effect.
    const st = store.state;
    const inspecting = st.inspectIndex >= 0 && Boolean(st.cells[st.inspectIndex]);
    const target = inspecting ? st.cells[st.inspectIndex] : st.parent;
    const autoEnableErosion =
      key === 'erosionStrength' &&
      value > 0.001 &&
      target.genes.erosionMode === 0 &&
      !st.lockedGenes.has('erosionMode');

    const nextGenes = {
      ...target.genes,
      ...(autoEnableErosion ? { erosionMode: 1 } : null),
      [key]: value,
    };
    const updated = new Genotype(nextGenes, st.lockedGenes);

    if (inspecting) {
      st.cells[st.inspectIndex] = updated;
      gridView.renderCenter(updated, st.inspectIndex);
      store.emit('inspect');
      return;
    }
    st.parent = updated;
    if (st.cells[st.centerIndex]) st.cells[st.centerIndex] = st.parent;
    store.emit('parent');
  },
  onLock(key, locked) {
    const st = store.state;
    if (locked) st.lockedGenes.add(key);
    else st.lockedGenes.delete(key);
    if (st.target) {
      st.auto.bestStale = true;
      matcherView.setAutoState(st.auto, st.lockedGenes.size);
    }
    controlPanel.refreshGroupStatus({
      lockedSet: st.lockedGenes,
      groupMultipliers: st.auto.groupMultipliers,
      hasTarget: Boolean(st.target),
    });
  },
});

const matcherCard = createCard({ title: 'Target Image Matcher', icon: '🎯' });
const matcherView = new TargetMatcherView(matcherCard.body, {
  onBrowse() { targetInput.click(); },
  onUpload: (file) => setTargetFromFile(file),
  onSyntheticTarget: () => setSyntheticTarget(),
  onClearTarget: () => clearTarget(),
  onAutoToggle: () => scheduler.toggle(),
  onAutoStep: () => scheduler.step(),
  onSaveSearch: () => {
    if (exportSearchJson(store.state)) {
      saveCheckpoint(store.state);
      toast('💾 Saved search session (.json)');
    }
  },
  onLoadSearchBrowse: () => searchInput.click(),
  onResumeCheckpoint: () => {
    const cp = loadCheckpoint();
    if (cp) restoreSearchSession(cp);
  },
  onDismissCheckpoint: () => {
    clearCheckpoint();
    matcherView.setCheckpointBanner(null);
  },
  onMatcherOption(key, val) {
    const st = store.state;
    st.matcher[key] = val;
    if (key === 'analysisSize') {
      st.matcher.hiDetail = val >= ANALYSIS_SIZE_HI;
    }
    if (key === 'hideTiles') {
      const paused = Boolean(val && st.auto.running);
      gridView.setPausedRender(paused, st.auto);
      if (!val) store.emit('grid');
    }
    if (!st.target) return;
    // Resolution changes require re-extracting the target's features.
    if (key === 'analysisSize' || key === 'hiDetail') {
      st.target.features = extractTargetFeatures(st.target.lum, st.target.lumSize);
    }
    if (key === 'analysisSize' || key === 'hiDetail' || key === 'layout' || key === 'crisp' || key === 'metricGuided' || key === 'mcmc') {
      st.auto.bestStale = JSON.stringify(st.matcher) !== st.auto.matcherSig;
      syncBestMatchView();
      store.emit('auto');
    }
  },
});
layout.cardsContainer.append(matcherCard.el);

// Built after every card is mounted so the jump list sees all section headings.
new SidebarNavView(document.getElementById('sidebar-nav'), layout.cardsContainer);

// Favorites live in a toolbar-triggered overlay over the explorer grid,
// not buried in the scrolling sidebar.
const favoritesOverlay = document.getElementById('favorites-overlay');
const favoritesView = new FavoritesView(
  document.getElementById('favorites-overlay-body'),
  {
    onLoad(item) {
      store.pushHistory();
      store.state.parent = new Genotype(item.genes);
      repopulate(false);
      toggleFavoritesOverlay(false);
    },
    onDelete(id) { favorites.remove(id); },
    onRename(id, name) { favorites.rename(id, name); },
    onExport() { favorites.exportJson(); },
    onImportBrowse() { favesInput.click(); },
  }
);

function toggleFavoritesOverlay(force) {
  const open = force !== undefined ? force : favoritesOverlay.classList.contains('hidden');
  favoritesOverlay.classList.toggle('hidden', !open);
}

document.getElementById('favorites-close').addEventListener('click', () => {
  toggleFavoritesOverlay(false);
});
// Click-outside dismisses the overlay.
document.addEventListener('pointerdown', (e) => {
  if (favoritesOverlay.classList.contains('hidden')) return;
  if (favoritesOverlay.contains(e.target)) return;
  if (e.target.closest('#btn-favorites')) return;
  toggleFavoritesOverlay(false);
});

const exportModal = new ExportModalView(document.getElementById('export-modal'));
const helpModal = new HelpModalView(document.getElementById('help-modal'));

const targetInput = document.getElementById('target-file-input');
const favesInput = document.getElementById('faves-file-input');
const searchInput = document.getElementById('search-file-input');

targetInput.addEventListener('change', () => {
  const file = targetInput.files?.[0];
  if (file) setTargetFromFile(file);
  targetInput.value = '';
});
favesInput.addEventListener('change', async () => {
  const file = favesInput.files?.[0];
  if (file) {
    try {
      const added = await favorites.importJson(file);
      console.log(`Imported ${added} favorites`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  }
  favesInput.value = '';
});
searchInput.addEventListener('change', async () => {
  const file = searchInput.files?.[0];
  if (file) {
    try {
      const session = await importSearchJson(file);
      await restoreSearchSession(session);
      toast(`📂 Loaded search (Gen ${session.auto?.generation || 0})`);
    } catch (err) {
      alert(`Could not load search file: ${err.message}`);
    }
  }
  searchInput.value = '';
});

// ------------------------------------------------------------ target logic
// Match option helpers: active analysis resolution + scorer options.
function analysisSize() {
  const m = store.state.matcher;
  if (m.analysisSize === ANALYSIS_SIZE_ULTRA || m.analysisSize === ANALYSIS_SIZE_HI || m.analysisSize === ANALYSIS_SIZE) {
    return m.analysisSize;
  }
  return m.hiDetail ? ANALYSIS_SIZE_HI : ANALYSIS_SIZE;
}

function matcherOpts() {
  const m = store.state.matcher;
  return { layout: m.layout, crisp: m.crisp };
}

// Target luminance is kept at ANALYSIS_SIZE_ULTRA (256); downsample when scoring at 128 or 64.
function extractTargetFeatures(lum, lumSize) {
  const size = analysisSize();
  const buf = lumSize === size ? lum : downsampleLuminance(lum, lumSize, size);
  return extractFeatures(buf, size);
}

function freshAutoState() {
  return {
    running: false,
    generation: 0,
    bestFitness: 0,
    bestIndex: -1,
    bestGenotype: null,
    bestThumbUrl: null,
    bestStale: false,
    matcherSig: JSON.stringify(store.state.matcher),
  };
}

let bestThumbCanvas = null;
function renderGenotypeThumb(genotype) {
  if (!genotype || typeof tileRenderer.renderToCanvas !== 'function') return null;
  if (!bestThumbCanvas) bestThumbCanvas = document.createElement('canvas');
  tileRenderer.renderToCanvas(genotype, bestThumbCanvas, 128);
  return bestThumbCanvas.toDataURL('image/png');
}

function syncBestMatchView() {
  const { auto } = store.state;
  matcherView.setBestMatch({
    thumbUrl: auto.bestThumbUrl,
    fitness: auto.bestGenotype ? auto.bestFitness : null,
    stale: auto.bestStale,
  });
}

async function setTargetFromFile(file) {
  try {
    scheduler.stop();
    const { lum, lumSize, thumbUrl } = await loadImageLuminance(file);
    store.set({
      target: { lum, lumSize, features: extractTargetFeatures(lum, lumSize), thumbUrl, name: file.name },
      fitness: null,
      auto: freshAutoState(),
    }, ['target', 'fitness', 'auto']);
    evaluateCurrentGrid();
    saveCheckpoint(store.state);
  } catch (err) {
    alert(`Could not load image: ${err.message}`);
  }
}

function setSyntheticTarget() {
  scheduler.stop();
  const targetGeno = randomGenotype();
  const lum = tileRenderer.sampleLuminance(targetGeno, ANALYSIS_SIZE_ULTRA);
  const thumb = document.createElement('canvas');
  tileRenderer.renderToCanvas(targetGeno, thumb, ANALYSIS_SIZE_ULTRA);
  store.set({
    target: {
      lum,
      lumSize: ANALYSIS_SIZE_ULTRA,
      features: extractTargetFeatures(lum, ANALYSIS_SIZE_ULTRA),
      thumbUrl: thumb.toDataURL('image/png'),
      name: 'Synthetic target',
    },
    fitness: null,
    auto: freshAutoState(),
  }, ['target', 'fitness', 'auto']);
  evaluateCurrentGrid();
  saveCheckpoint(store.state);
}

async function restoreSearchSession(session) {
  scheduler.stop();
  const { lum, lumSize } = await loadLuminanceFromDataUrl(session.target.thumbUrl, ANALYSIS_SIZE_ULTRA);
  const st = store.state;

  if (session.matcher && typeof session.matcher === 'object') {
    st.matcher = { ...st.matcher, ...session.matcher };
    matcherView.syncOptions(st.matcher);
  }
  if (Array.isArray(session.lockedGenes)) {
    st.lockedGenes = new Set(session.lockedGenes);
    controlPanel.refreshLocks(st.lockedGenes);
  }
  if (typeof session.variationIntensity === 'number') {
    st.variationIntensity = session.variationIntensity;
  }
  if (typeof session.spatialScaling === 'boolean') {
    st.spatialScaling = session.spatialScaling;
  }
  if (typeof session.mutationRate === 'number') {
    st.mutationRate = session.mutationRate;
  }
  if (typeof session.gridSize === 'number' && [3, 5, 7, 9].includes(session.gridSize) && session.gridSize !== st.gridSize) {
    st.gridSize = session.gridSize;
    layout.gridSelect.value = String(session.gridSize);
    gridView.setGridSize(session.gridSize);
  }

  st.parent = Genotype.deserialize(session.parent);
  st.centerIndex = centerIndexFor(st.gridSize);
  const totalCells = st.gridSize * st.gridSize;
  if (Array.isArray(session.cells) && session.cells.length === totalCells) {
    st.cells = session.cells.map((c) => Genotype.deserialize(c));
  } else {
    st.cells = populateGrid(st.parent, st.gridSize, gaOptions());
  }

  const features = extractTargetFeatures(lum, lumSize);
  st.target = {
    lum,
    lumSize,
    features,
    thumbUrl: session.target.thumbUrl,
    name: session.target.name || 'Restored target',
  };

  const savedAuto = session.auto || {};
  const bestGenotype = savedAuto.bestGenotype
    ? Genotype.deserialize(savedAuto.bestGenotype)
    : st.parent.clone();
  st.auto = {
    running: false,
    generation: Number(savedAuto.generation) || 0,
    bestFitness: typeof savedAuto.bestFitness === 'number' ? savedAuto.bestFitness : 0,
    bestIndex: typeof savedAuto.bestIndex === 'number' ? savedAuto.bestIndex : st.centerIndex,
    bestGenotype,
    bestThumbUrl: savedAuto.bestThumbUrl || renderGenotypeThumb(bestGenotype),
    bestStale: false,
    matcherSig: JSON.stringify(st.matcher),
  };

  if (Array.isArray(session.fitness) && session.fitness.length === totalCells) {
    st.fitness = Float64Array.from(session.fitness);
  } else {
    st.fitness = new Float64Array(totalCells).fill(-1);
    const sz = analysisSize();
    for (let i = 0; i < totalCells; i++) {
      const cLum = tileRenderer.sampleLuminance(st.cells[i], sz);
      st.fitness[i] = scoreCandidate(cLum, features, matcherOpts()).total * 100;
    }
  }

  const pLum = tileRenderer.sampleLuminance(st.parent, analysisSize());
  const pScore = scoreCandidate(pLum, features, matcherOpts());
  matcherView.setScores({
    total: pScore.total,
    hist: pScore.hist,
    slope: pScore.slope,
    lap: pScore.lap,
    fft: pScore.fft,
  });

  store.emit('target');
  store.emit('parent');
  store.emit('grid');
  store.emit('fitness');
  store.emit('auto');
  syncBestMatchView();
  saveCheckpoint(st);
}

function clearTarget() {
  scheduler.stop();
  gridView.setPausedRender(false);
  store.set({
    target: null,
    fitness: null,
    auto: freshAutoState(),
  }, ['target', 'fitness', 'auto']);
  matcherView.setCheckpointBanner(loadCheckpoint());
}

// Score every cell against the target once (used right after upload).
function evaluateCurrentGrid() {
  const st = store.state;
  if (!st.target) return;
  const scores = new Float64Array(st.cells.length).fill(-1);
  let best = -1;
  let bestScore = -1;
  let centerScores = null;
  const size = analysisSize();
  for (let i = 0; i < st.cells.length; i++) {
    const lum = tileRenderer.sampleLuminance(st.cells[i], size);
    const s = scoreCandidate(lum, st.target.features, matcherOpts());
    scores[i] = s.total * 100;
    if (i === st.centerIndex) centerScores = s;
    if (scores[i] > bestScore) { bestScore = scores[i]; best = i; }
  }
  st.fitness = scores;
  st.auto.bestFitness = bestScore;
  st.auto.bestIndex = best;
  st.auto.bestGenotype = best >= 0 && st.cells[best] ? st.cells[best].clone() : null;
  st.auto.bestThumbUrl = renderGenotypeThumb(st.auto.bestGenotype) || gridView.thumbnailOf(best);
  st.auto.bestStale = false;
  st.auto.matcherSig = JSON.stringify(st.matcher);
  store.emit('fitness');
  store.emit('auto');
  if (centerScores) {
    matcherView.setScores({
      total: scores[st.centerIndex] / 100,
      hist: centerScores.hist,
      slope: centerScores.slope,
      lap: centerScores.lap,
      fft: centerScores.fft,
    });
  }
  syncBestMatchView();
}

// -------------------------------------------------------------- view refresh
function heroTagText() {
  const st = store.state;
  return st.inspectIndex >= 0 ? `Cell #${st.inspectIndex}` : 'Parent';
}

function refreshParentViews() {
  const st = store.state;
  const g = store.inspectedGenotype();
  controlPanel.refresh(g);
  heroRenderer.update(g);
  gridView.renderCenter(st.parent, st.centerIndex);
  layout.setHeroTag(`${heroTagText()} · ${st.preview3d ? '3D' : '2D'}`);
}

// -------------------------------------------------------------- store wiring
store.on('grid', () => {
  gridView.renderAll(store.state.cells);
  refreshBadges();
  refreshStars();
});
store.on('parent', () => refreshParentViews());
store.on('inspect', () => {
  const st = store.state;
  const g = store.inspectedGenotype();
  controlPanel.refresh(g);
  heroRenderer.update(g);
  layout.setHeroTag(`${heroTagText()} · ${st.preview3d ? '3D' : '2D'}`);
  const f = st.fitness && st.inspectIndex >= 0 ? st.fitness[st.inspectIndex] : null;
  layout.setHeroFitness(f);
});
store.on('fitness', () => {
  refreshBadges();
  const st = store.state;
  if (st.inspectIndex >= 0 && st.fitness) {
    layout.setHeroFitness(st.fitness[st.inspectIndex]);
  }
});
store.on('target', () => {
  const st = store.state;
  const t = st.target;
  if (t) matcherView.setTarget(t);
  else matcherView.clearTarget();
  controlPanel.refreshGroupStatus({
    lockedSet: st.lockedGenes,
    groupMultipliers: st.auto.groupMultipliers,
    hasTarget: Boolean(t),
  });
  refreshBadges();
});
store.on('auto', () => {
  const st = store.state;
  matcherView.setAutoState(st.auto, st.lockedGenes.size);
  controlPanel.refreshGroupStatus({
    lockedSet: st.lockedGenes,
    groupMultipliers: st.auto.groupMultipliers,
    hasTarget: Boolean(st.target),
  });
  gridView.setPausedRender(Boolean(st.matcher?.hideTiles && st.auto.running), st.auto);
  syncToolbar();
});
store.on('history', () => syncToolbar());
favorites.onChange((items) => {
  favoritesView.render(items);
  layout.setFavCount(items.length);
  refreshStars();
});
scheduler.onGeneration = (auto, subScores) => {
  if (auto.bestGenotype) {
    auto.bestThumbUrl = renderGenotypeThumb(auto.bestGenotype) || auto.bestThumbUrl;
  }
  syncBestMatchView();
  // Refresh the metric bars for the newly promoted parent.
  const st = store.state;
  if (subScores) {
    matcherView.setScores({
      total: subScores.total,
      hist: subScores.hist,
      slope: subScores.slope,
      lap: subScores.lap,
      fft: subScores.fft,
    });
  } else if (st.target && st.parent) {
    const lum = tileRenderer.sampleLuminance(st.parent, analysisSize());
    const s = scoreCandidate(lum, st.target.features, matcherOpts());
    matcherView.setScores({
      total: s.total,
      hist: s.hist,
      slope: s.slope,
      lap: s.lap,
      fft: s.fft,
    });
  }
  saveCheckpoint(st);
};

// ---------------------------------------------------------------- shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo(); else store.undo();
    refreshBadges(); syncToolbar(); refreshParentViews();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    refreshBadges(); syncToolbar(); refreshParentViews();
  } else if (e.key === 'Escape') {
    toggleFavoritesOverlay(false);
    exportModal.close();
    helpModal.close();
    if (layout.isMobileLayout()) layout.setSidebarOpen(false);
  } else if (e.key === '?') {
    helpModal.open('quickstart');
  } else if (e.key.toLowerCase() === 'm') {
    repopulate();
  } else if (e.key.toLowerCase() === 'r') {
    layout.btnRandomize.click();
  }
});

// Debug handle for console inspection.
window.__iga = { store, tileRenderer, heroRenderer, favorites, scheduler, helpModal };

// --------------------------------------------------------------------- init
store.state.parent = new Genotype(PRESETS[DEFAULT_PRESET]);
gridView.setGridSize(store.state.gridSize);
repopulate(false);
favoritesView.render(favorites.items);
layout.setFavCount(favorites.items.length);
refreshStars();
controlPanel.refresh(store.state.parent);
controlPanel.refreshLocks(store.state.lockedGenes);
controlPanel.refreshGroupStatus({ lockedSet: store.state.lockedGenes });
matcherView.syncOptions(store.state.matcher);
matcherView.setCheckpointBanner(loadCheckpoint());
syncToolbar();
