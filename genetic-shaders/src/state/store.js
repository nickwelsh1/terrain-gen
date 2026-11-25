import { Genotype } from '../ga/Genotype.js';

const HISTORY_LIMIT = 60;

// Minimal pub/sub store. Views subscribe to topics; controllers emit them.
// Topics: 'grid', 'parent', 'inspect', 'selection', 'settings',
//         'target', 'fitness', 'auto', 'history'
export class Store {
  constructor() {
    this.listeners = new Map();
    this.past = [];
    this.future = [];
    this.state = {
      gridSize: 3,
      centerIndex: 4,        // index of the parent cell within cells[]
      parent: null,          // Genotype
      cells: [],             // Genotype[]
      inspectIndex: -1,      // -1 => hero shows parent
      variationIntensity: 0.4,
      spatialScaling: true,
      mutationRate: 1.0,
      lockedGenes: new Set(['warpIntensity', 'warpFrequency']),
      preview3d: false,
      wireframe: false,
      target: null,          // { lum, lumSize, features, thumbUrl, name }
      matcher: {
        layout: false,
        hiDetail: true,
        analysisSize: 128,
        crisp: false,
        metricGuided: true,
        mcmc: false,
        hideTiles: false,
      },
      fitness: null,         // Float64Array per-cell scores 0..100
      auto: {
        running: false,
        generation: 0,
        bestFitness: 0,
        bestIndex: -1,
        bestGenotype: null,
        bestThumbUrl: null,
        bestStale: false,
        matcherSig: null,
      },
    };
  }

  on(topic, fn) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(fn);
    return () => this.listeners.get(topic)?.delete(fn);
  }

  emit(topic) {
    for (const fn of this.listeners.get(topic) || []) fn(this.state);
  }

  set(patch, topics) {
    Object.assign(this.state, patch);
    for (const t of topics) this.emit(t);
  }

  // --- history (undo/redo over parent + cells) ---

  snapshot() {
    return {
      parent: this.state.parent.serialize(),
      cells: this.state.cells.map((c) => c.serialize()),
    };
  }

  pushHistory() {
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    this.emit('history');
  }

  _restore(snap) {
    this.state.parent = Genotype.deserialize(snap.parent);
    this.state.cells = snap.cells.map((c) => Genotype.deserialize(c));
    this.state.inspectIndex = -1;
    this.emit('grid');
    this.emit('parent');
    this.emit('inspect');
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(this.snapshot());
    this._restore(this.past.pop());
    this.emit('history');
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(this.snapshot());
    this._restore(this.future.pop());
    this.emit('history');
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  // --- helpers ---

  // The genotype the hero preview + parameter panel should reflect.
  inspectedGenotype() {
    const { inspectIndex, cells, parent } = this.state;
    if (inspectIndex >= 0 && cells[inspectIndex]) return cells[inspectIndex];
    return parent;
  }

  setParentGene(key, value) {
    const g = { ...this.state.parent.genes, [key]: value };
    this.state.parent = new Genotype(g);
    // Keep the center cell in lock-step with the parent.
    if (this.state.cells[this.state.centerIndex]) {
      this.state.cells[this.state.centerIndex] = this.state.parent;
    }
    this.emit('parent');
  }
}
