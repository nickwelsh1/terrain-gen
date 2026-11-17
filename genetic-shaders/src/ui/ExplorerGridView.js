import { centerIndexFor } from '../ga/GeneticEngine.js';

// Dynamic 3x3..9x9 explorer grid. Owns the DOM for all shader cells and
// funnels render jobs to the shared OffscreenTileRenderer.
export class ExplorerGridView {
  // callbacks: { onPromote(i), onInspect(i), onStar(i), onSelectB(i) }
  constructor(container, tileRenderer, callbacks) {
    this.container = container;
    this.tileRenderer = tileRenderer;
    this.cb = callbacks;
    this.cells = []; // per-cell DOM refs
    this.gridSize = 3;
  }

  setGridSize(n) {
    this.gridSize = n;
    this.container.style.setProperty('--grid-cols', n);
    this.tileRenderer.setGridSize(n);
    this._build();
  }

  _build() {
    this.container.replaceChildren();
    this.cells = [];
    const total = this.gridSize * this.gridSize;
    const center = centerIndexFor(this.gridSize);

    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'shader-cell' + (i === center ? ' shader-cell--parent' : '');
      cell.dataset.index = i;

      const canvas = document.createElement('canvas');
      canvas.className = 'shader-cell__canvas';
      canvas.width = this.tileRenderer.tileSize;
      canvas.height = this.tileRenderer.tileSize;

      const overlay = document.createElement('div');
      overlay.className = 'shader-cell__overlay';

      const topRow = document.createElement('div');
      topRow.className = 'shader-cell__row';
      const label = document.createElement('span');
      label.className = 'shader-cell__label';
      label.textContent = `#${i}`;
      const fitness = document.createElement('span');
      fitness.className = 'shader-cell__fitness hidden';
      topRow.append(label, fitness);

      const bottomRow = document.createElement('div');
      bottomRow.className = 'shader-cell__actions';

      const btnInspect = this._cellBtn('◉', 'Inspect in hero (no evolve)', 'inspect');
      const btnB = this._cellBtn('B', 'Select as crossover parent B', 'b');
      const btnStar = this._cellBtn('★', 'Save to favorites', 'star');
      bottomRow.append(btnInspect, btnB, btnStar);

      overlay.append(topRow, bottomRow);

      const badge = document.createElement('span');
      badge.className = 'shader-cell__badge hidden';

      const star = document.createElement('span');
      star.className = 'shader-cell__star';
      star.textContent = '★';

      cell.append(canvas, overlay, badge, star);
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.shader-cell__btn')) return;
        if (e.shiftKey) this.cb.onSelectB(i);
        else this.cb.onPromote(i);
      });
      btnInspect.addEventListener('click', () => this.cb.onInspect(i));
      btnB.addEventListener('click', () => this.cb.onSelectB(i));
      btnStar.addEventListener('click', () => this.cb.onStar(i));

      this.container.append(cell);
      this.cells.push({ el: cell, canvas, fitness, badge, btnStar, btnB });
    }
  }

  _cellBtn(text, title, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `shader-cell__btn shader-cell__btn--${kind}`;
    b.title = title;
    b.textContent = text;
    return b;
  }

  // Queue every cell's genotype for tile rendering, center-first.
  renderAll(cells) {
    const jobs = [];
    for (let i = 0; i < cells.length && i < this.cells.length; i++) {
      jobs.push({ index: i, genotype: cells[i], canvas: this.cells[i].canvas });
    }
    this.tileRenderer.enqueueBatch(jobs, this.gridSize);
  }

  // Re-render only the center tile (e.g. a slider changed the parent).
  renderCenter(genotype, centerIndex) {
    const cell = this.cells[centerIndex];
    if (cell) this.tileRenderer.renderInto(genotype, cell.canvas);
  }

  updateBadges({ centerIndex, crossoverIndex, bestIndex, fitness }) {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      c.el.classList.toggle('shader-cell--parent', i === centerIndex);
      c.el.classList.toggle('shader-cell--crossover', i === crossoverIndex);
      c.el.classList.toggle('shader-cell--best', i === bestIndex && bestIndex >= 0);

      if (i === centerIndex) {
        c.badge.textContent = 'Parent';
        c.badge.className = 'shader-cell__badge';
      } else if (i === crossoverIndex) {
        c.badge.textContent = 'Parent B';
        c.badge.className = 'shader-cell__badge shader-cell__badge--b';
      } else if (i === bestIndex && bestIndex >= 0) {
        c.badge.textContent = 'Best';
        c.badge.className = 'shader-cell__badge shader-cell__badge--best';
      } else {
        c.badge.className = 'shader-cell__badge hidden';
      }

      const f = fitness ? fitness[i] : null;
      if (f != null && f >= 0) {
        c.fitness.textContent = `${f.toFixed(1)}%`;
        c.fitness.classList.remove('hidden');
      } else {
        c.fitness.classList.add('hidden');
      }

      c.btnB.classList.toggle('shader-cell__btn--b-active', i === crossoverIndex);
    }
  }

  // Marks cells whose genotype matches a favorited gene signature.
  refreshStars(favSignatures, cells) {
    for (let i = 0; i < this.cells.length; i++) {
      const g = cells[i];
      const starred = !!g && favSignatures.has(JSON.stringify(g.genes));
      this.cells[i].el.classList.toggle('shader-cell--starred', starred);
    }
  }

  // Toggles the fast-search overlay when tile rendering is paused during Auto-Evolve.
  setPausedRender(paused, auto = null) {
    this.container.classList.toggle('explorer-grid--paused-render', paused);
    if (paused) {
      if (!this.pausedBanner) {
        this.pausedBanner = document.createElement('div');
        this.pausedBanner.className = 'explorer-grid__fast-banner';
        this.container.parentElement?.append(this.pausedBanner);
      }
      const gen = auto?.generation ?? 0;
      const best = typeof auto?.bestFitness === 'number' ? `${auto.bestFitness.toFixed(1)}%` : '—';
      this.pausedBanner.innerHTML =
        `<span>⚡ Fast Evolution Mode — Tile redraws paused (Gen ${gen} · Best ${best})</span>` +
        `<span class="text-faint">Pause or uncheck "Hide grid tiles" to render all tiles</span>`;
      this.pausedBanner.classList.remove('hidden');
    } else if (this.pausedBanner) {
      this.pausedBanner.classList.add('hidden');
    }
  }

  // Snapshot a cell canvas as a data-URL thumbnail (for favorites).
  thumbnailOf(index, size = 96) {
    const cell = this.cells[index];
    if (!cell) return null;
    const tmp = document.createElement('canvas');
    tmp.width = size;
    tmp.height = size;
    tmp.getContext('2d').drawImage(cell.canvas, 0, 0, size, size);
    return tmp.toDataURL('image/png');
  }
}
