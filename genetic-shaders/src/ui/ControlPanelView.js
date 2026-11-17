import { SCHEMA, GENE_GROUPS } from '../config/parameterSchema.js';
import { createCard } from './CollapsibleCard.js';
import { ICON_INFO, ICON_LOCK, ICON_UNLOCK } from './icons.js';

const GROUP_ICONS = { core: '〰', warp: '🌀', erosion: '🌊', curvature: '⛰', tone: '🎚', display: '🖥' };

function formatValue(def, v) {
  if (def.type === 'enum') return def.options[Math.round(v)] || String(v);
  if (def.type === 'bool') return v ? 'On' : 'Off';
  return Number(v).toFixed(def.step < 0.01 ? 3 : 2);
}

// Builds one collapsible card per gene group with live sliders/selects
// bound to the parent genotype, plus per-gene mutation locks.
export class ControlPanelView {
  // callbacks: { onGene(key, value), onLock(key, locked) }
  constructor(cardsContainer, callbacks) {
    this.cb = callbacks;
    this.controls = new Map(); // key -> {row, range, num, valueEl, lock}
    this.cards = {};

    for (const [groupKey, groupTitle] of Object.entries(GENE_GROUPS)) {
      const card = createCard({ title: groupTitle, icon: GROUP_ICONS[groupKey] || '⚙', open: groupKey !== 'warp' });
      this.cards[groupKey] = card;
      for (const def of SCHEMA.filter((d) => d.group === groupKey)) {
        card.body.append(this._buildRow(def));
      }
      cardsContainer.append(card.el);
    }
  }

  _buildRow(def) {
    const row = document.createElement('div');
    row.className = 'slider-row';

    const label = document.createElement('label');
    label.className = 'slider-row__label';
    label.textContent = def.label;
    const valueEl = document.createElement('span');
    valueEl.className = 'slider-row__value';
    label.append(valueEl);

    const actions = document.createElement('div');
    actions.className = 'slider-row__actions';

    const hintId = `gene-hint-${def.key}`;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'slider-row__icon-btn slider-row__info';
    info.innerHTML = ICON_INFO;
    info.setAttribute('aria-label', `About ${def.label}`);
    info.setAttribute('aria-expanded', 'false');
    info.setAttribute('aria-controls', hintId);
    info.title = `What does ${def.label} do?`;

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'slider-row__icon-btn slider-row__lock';
    lock.setAttribute('aria-label', `Lock ${def.label} against mutation`);

    actions.append(info, lock);
    row.append(label, actions);

    const hint = document.createElement('p');
    hint.className = 'slider-row__hint';
    hint.id = hintId;
    hint.hidden = true;
    hint.textContent = def.hint || '';
    info.addEventListener('click', () => {
      hint.hidden = !hint.hidden;
      info.setAttribute('aria-expanded', String(!hint.hidden));
    });

    const entry = { row, valueEl, def, lock, locked: false, inputs: [] };
    this._setLockUI(entry, false);

    if (def.type === 'enum') {
      const sel = document.createElement('select');
      sel.className = 'select slider-row__range';
      def.options.forEach((opt, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = opt;
        sel.append(o);
      });
      sel.addEventListener('input', () => this._commit(def, Number(sel.value)));
      row.append(sel);
      entry.inputs.push(sel);
    } else if (def.type === 'bool') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'checkbox slider-row__range';
      box.addEventListener('input', () => this._commit(def, box.checked ? 1 : 0));
      row.append(box);
      entry.inputs.push(box);
    } else {
      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'slider-row__range';
      range.min = def.min;
      range.max = def.max;
      range.step = def.step;
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'input input--num slider-row__num';
      num.min = def.min;
      num.max = def.max;
      num.step = def.step;

      range.addEventListener('input', () => this._commit(def, Number(range.value)));
      num.addEventListener('change', () => this._commit(def, Number(num.value)));
      row.append(range, num);
      entry.inputs.push(range, num);
      entry.range = range;
      entry.num = num;
    }

    row.append(hint);

    lock.addEventListener('click', () => {
      this._setLockUI(entry, !entry.locked);
      this.cb.onLock(def.key, entry.locked);
    });

    this.controls.set(def.key, entry);
    return row;
  }

  _setLockUI(entry, locked) {
    entry.locked = locked;
    entry.lock.innerHTML = locked ? ICON_LOCK : ICON_UNLOCK;
    entry.lock.setAttribute('aria-pressed', String(locked));
    entry.lock.title = locked
      ? 'Locked — this gene is frozen during mutation (click to unlock)'
      : 'Unlocked — click to freeze this gene during mutation';
    entry.row.classList.toggle('slider-row--locked', locked);
  }

  _commit(def, value) {
    if (!Number.isFinite(value)) return;
    if (def.type === 'int' || def.type === 'enum' || def.type === 'bool') {
      value = Math.round(value);
    }
    this.cb.onGene(def.key, value);
  }

  // Reflect a genotype's genes into all inputs (no events fired).
  refresh(genotype) {
    for (const [key, entry] of this.controls) {
      const v = genotype.genes[key];
      entry.valueEl.textContent = formatValue(entry.def, v);
      for (const input of entry.inputs) {
        if (input.type === 'checkbox') input.checked = !!v;
        else input.value = v;
      }
    }
  }

  // Reflect locked gene set into lock checkboxes.
  refreshLocks(lockedSet) {
    for (const [key, entry] of this.controls) {
      this._setLockUI(entry, lockedSet.has(key));
    }
  }

  // Updates per-card header badges showing user locks (🔒) and the algorithm's
  // internal metric-guided soft-locks (0.45x hold vs >1.1x active exploration).
  refreshGroupStatus({ lockedSet = new Set(), groupMultipliers = null, hasTarget = false } = {}) {
    for (const groupKey of Object.keys(GENE_GROUPS)) {
      const card = this.cards[groupKey];
      if (!card || !card.badgesEl) continue;
      const groupDefs = SCHEMA.filter((d) => d.group === groupKey);
      const lockedCount = groupDefs.filter((d) => lockedSet.has(d.key)).length;
      const mult = hasTarget && groupMultipliers ? groupMultipliers[groupKey] : null;

      card.badgesEl.innerHTML = '';

      if (mult != null) {
        const algoBadge = document.createElement('span');
        if (mult <= 0.5) {
          algoBadge.className = 'control-card__badge control-card__badge--hold';
          algoBadge.textContent = 'Soft-hold 0.45×';
          algoBadge.title = 'Algorithm soft-lock: group metric >92% converged, damping mutations to protect structure';
          card.badgesEl.append(algoBadge);
        } else if (mult >= 1.12) {
          algoBadge.className = 'control-card__badge control-card__badge--boost';
          algoBadge.textContent = `Explore ${mult.toFixed(1)}×`;
          algoBadge.title = 'Algorithm boost: actively exploring this group to close sub-score deficits';
          card.badgesEl.append(algoBadge);
        }
      }

      if (lockedCount > 0) {
        const lockBadge = document.createElement('span');
        lockBadge.className = 'control-card__badge control-card__badge--locked';
        lockBadge.textContent = `🔒 ${lockedCount}`;
        lockBadge.title = `${lockedCount} user-locked gene(s) in this group — strictly preserved during Mutate & Auto-Evolve`;
        card.badgesEl.append(lockBadge);
      }
    }
  }
}
