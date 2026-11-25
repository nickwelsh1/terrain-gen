// Sidebar navigation: a "find control" search box and a "jump to section"
// dropdown. Both expand the target card and scroll it into view just beneath
// the sticky (pinned) Hero Preview card.
const ROW_SELECTOR = '.slider-row, .target-matcher__option, .target-matcher__res-row';
const LABEL_SELECTOR = '.slider-row__label, .target-matcher__option-label';

export class SidebarNavView {
  constructor(mount, cardsContainer) {
    this.cards = cardsContainer;
    this.matches = [];
    this.matchIndex = -1;
    this._build(mount);
  }

  _build(mount) {
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'input sidebar-nav__search';
    this.search.placeholder = 'Find a control…';
    this.search.setAttribute('aria-label', 'Find a control or section');
    this.search.title = 'Type part of a control or section name · Enter = next match · Shift+Enter = previous';

    this.count = document.createElement('output');
    this.count.className = 'sidebar-nav__count';
    this.count.setAttribute('aria-live', 'polite');

    this.jump = document.createElement('select');
    this.jump.className = 'select sidebar-nav__jump';
    this.jump.setAttribute('aria-label', 'Jump to section');

    const searchWrap = document.createElement('div');
    searchWrap.className = 'sidebar-nav__search-wrap';
    searchWrap.append(this.search, this.count);
    mount.append(searchWrap, this.jump);

    this.search.addEventListener('input', () => this._runSearch());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.matches.length) {
        e.preventDefault();
        this._step(e.shiftKey ? -1 : 1);
      }
    });
    this.jump.addEventListener('focus', () => this.refreshSections());
    this.jump.addEventListener('change', () => {
      const card = this._sectionCards()[Number(this.jump.value)];
      if (card) this._reveal(card, card);
      this.jump.value = '';
    });
    this.refreshSections();
  }

  _sectionCards() {
    return [...this.cards.querySelectorAll(':scope > .control-card')];
  }

  // (Re)builds the dropdown from the current card headings.
  refreshSections() {
    const placeholder = new Option('Jump to section…', '');
    placeholder.disabled = true;
    const opts = this._sectionCards().map((card, i) => {
      const icon = card.querySelector('.control-card__icon')?.textContent || '';
      const title = card.querySelector('.control-card__title')?.textContent || `Section ${i + 1}`;
      return new Option(`${icon} ${title}`.trim(), String(i));
    });
    this.jump.replaceChildren(placeholder, ...opts);
    this.jump.value = '';
  }

  _runSearch() {
    const q = this.search.value.trim().toLowerCase();
    this.matches = [];
    this.matchIndex = -1;
    if (q) {
      for (const card of this._sectionCards()) {
        const title = card.querySelector('.control-card__title')?.textContent || '';
        if (title.toLowerCase().includes(q)) this.matches.push({ card, target: card });
        for (const label of card.querySelectorAll(LABEL_SELECTOR)) {
          // First text node is the label name (value readouts are appended after it).
          const text = (label.firstChild?.textContent || '').toLowerCase();
          if (text.includes(q)) {
            this.matches.push({ card, target: label.closest(ROW_SELECTOR) || label });
          }
        }
      }
    }
    this._step(1);
  }

  _step(dir) {
    const n = this.matches.length;
    if (!n) {
      this.count.textContent = this.search.value.trim() ? '0' : '';
      this.search.classList.toggle('sidebar-nav__search--none', Boolean(this.search.value.trim()));
      return;
    }
    this.search.classList.remove('sidebar-nav__search--none');
    this.matchIndex = (this.matchIndex + dir + n) % n;
    this.count.textContent = `${this.matchIndex + 1}/${n}`;
    const { card, target } = this.matches[this.matchIndex];
    this._reveal(card, target);
  }

  _reveal(card, target) {
    card.classList.remove('control-card--collapsed');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._scrollTo(target, reduce);
    const hitClass = `${target.classList[0]}--search-hit`;
    target.classList.remove(hitClass);
    void target.offsetWidth; // restart the flash animation
    target.classList.add(hitClass);
    clearTimeout(target._hitTimer);
    target._hitTimer = setTimeout(() => target.classList.remove(hitClass), 1700);
  }

  // Scrolls `el` to just beneath the pinned card. Native smooth scrolling
  // speed isn't tunable, so this runs a short eased animation (~2x faster).
  _scrollTo(el, reduce) {
    if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf);
    const cards = this.cards;
    const delta = el.classList.contains('control-card--pinned')
      ? -cards.scrollTop // sticky card can't be scrolled to; go to top instead
      : el.getBoundingClientRect().top - cards.getBoundingClientRect().top -
        (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
    const dest = Math.max(0, Math.min(cards.scrollTop + delta, cards.scrollHeight - cards.clientHeight));
    if (reduce) { cards.scrollTop = dest; return; }
    const start = cards.scrollTop;
    const dist = dest - start;
    if (Math.abs(dist) < 2) { cards.scrollTop = dest; return; }
    const duration = Math.min(300, 90 + Math.abs(dist) * 0.28);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      cards.scrollTop = start + dist * e;
      this._scrollRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    this._scrollRaf = requestAnimationFrame(step);
  }
}
