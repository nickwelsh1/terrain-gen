// Favorites library card: starred shaders with load/delete/rename,
// plus saved-faves.json export/import controls.
export class FavoritesView {
  // callbacks: { onLoad(item), onDelete(id), onRename(id,name), onExport(), onImport(file) }
  constructor(body, callbacks) {
    this.cb = callbacks;
    this.el = document.createElement('div');
    this.el.className = 'd-flex flex-col gap-2';
    body.append(this.el);
    this._build();
  }

  _build() {
    const btnRow = document.createElement('div');
    btnRow.className = 'd-flex gap-2';

    this.btnExport = document.createElement('button');
    this.btnExport.className = 'btn btn--sm flex-1';
    this.btnExport.textContent = '⤓ saved-faves.json';
    this.btnExport.addEventListener('click', () => this.cb.onExport());

    this.btnImport = document.createElement('button');
    this.btnImport.className = 'btn btn--sm flex-1';
    this.btnImport.textContent = '⤒ Import JSON';
    this.btnImport.addEventListener('click', () => this.cb.onImportBrowse());

    btnRow.append(this.btnExport, this.btnImport);

    this.list = document.createElement('div');
    this.list.className = 'favorites-list';

    this.el.append(btnRow, this.list);
  }

  render(items) {
    this.list.replaceChildren();
    this.btnExport.disabled = items.length === 0;

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'favorites-list__empty';
      empty.textContent = 'No favorites yet — star a cell to save it here.';
      this.list.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'favorite-item';

      const thumb = document.createElement('img');
      thumb.className = 'favorite-item__thumb';
      thumb.alt = item.name;
      // Placeholder tile for entries saved without a thumbnail (e.g. imports).
      thumb.src = item.thumbUrl ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Crect width='44' height='44' fill='%230a0d14'/%3E%3Ctext x='22' y='27' font-size='16' text-anchor='middle' fill='%23f5b942'%3E★%3C/text%3E%3C/svg%3E";

      const meta = document.createElement('div');
      meta.className = 'favorite-item__meta';
      const name = document.createElement('input');
      name.className = 'favorite-item__name';
      name.value = item.name;
      name.title = 'Rename';
      name.addEventListener('change', () => {
        this.cb.onRename(item.id, name.value.trim() || item.name);
      });
      const sub = document.createElement('span');
      sub.className = 'favorite-item__sub';
      const date = new Date(item.timestamp).toLocaleDateString();
      sub.textContent = `${date}${item.fitness != null ? ` · ${item.fitness.toFixed(1)}%` : ''}`;
      meta.append(name, sub);

      const actions = document.createElement('div');
      actions.className = 'favorite-item__actions';
      const btnLoad = document.createElement('button');
      btnLoad.className = 'favorite-item__btn';
      btnLoad.title = 'Load as parent';
      btnLoad.textContent = '⤺';
      btnLoad.addEventListener('click', () => this.cb.onLoad(item));
      const btnDel = document.createElement('button');
      btnDel.className = 'favorite-item__btn favorite-item__btn--del';
      btnDel.title = 'Delete';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', () => this.cb.onDelete(item.id));
      actions.append(btnLoad, btnDel);

      row.append(thumb, meta, actions);
      this.list.append(row);
    }
  }
}
