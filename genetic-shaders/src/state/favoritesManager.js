const STORAGE_KEY = 'iga_shader_saved_faves_v1';
const FILE_VERSION = 1;

// Favorites library: localStorage persistence + saved-faves.json I/O.
export class FavoritesManager {
  constructor() {
    this.listeners = new Set();
    this.items = this._load();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.items);
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (err) {
      console.warn('Favorites persist failed (quota?)', err);
    }
    this._emit();
  }

  add(genotype, thumbUrl, meta = {}) {
    const item = {
      id: `fav_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: meta.name || `Shader ${new Date().toLocaleTimeString()}`,
      timestamp: Date.now(),
      genes: { ...genotype.genes },
      thumbUrl: thumbUrl || null,
      fitness: meta.fitness ?? null,
    };
    this.items.unshift(item);
    this._persist();
    return item;
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this._persist();
  }

  rename(id, name) {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.name = name;
      this._persist();
    }
  }

  get(id) {
    return this.items.find((i) => i.id === id) || null;
  }

  // --- saved-faves.json export / import ---

  exportJson() {
    const payload = {
      app: 'genetic-shaders',
      version: FILE_VERSION,
      exportedAt: new Date().toISOString(),
      favorites: this.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'saved-faves.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async importJson(file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Not a valid JSON file');
    }

    // Accept both the wrapped export format and a bare favorites array.
    const list = Array.isArray(parsed) ? parsed : parsed.favorites;
    if (!Array.isArray(list)) throw new Error('Missing "favorites" array');

    const known = new Set(this.items.map((i) => i.id));
    let added = 0;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || !entry.genes) continue;
      const item = {
        id: known.has(entry.id) ? `fav_${Date.now().toString(36)}_${added}` : (entry.id || `fav_${Date.now().toString(36)}_${added}`),
        name: String(entry.name || 'Imported shader'),
        timestamp: Number(entry.timestamp) || Date.now(),
        genes: { ...entry.genes },
        thumbUrl: typeof entry.thumbUrl === 'string' ? entry.thumbUrl : null,
        fitness: typeof entry.fitness === 'number' ? entry.fitness : null,
      };
      this.items.push(item);
      known.add(item.id);
      added++;
    }
    this._persist();
    return added;
  }
}
