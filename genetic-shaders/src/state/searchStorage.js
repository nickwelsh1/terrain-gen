const CHECKPOINT_KEY = 'iga_shader_search_checkpoint_v1';
const SEARCH_FILE_VERSION = 1;

// Serializes the active target-matching session (target thumbnail, parent,
// best match, generation counter, matcher options, locked genes, and grid cells).
export function serializeSearchState(state) {
  if (!state || !state.target || !state.parent) return null;
  return {
    app: 'genetic-shaders-search',
    version: SEARCH_FILE_VERSION,
    savedAt: new Date().toISOString(),
    gridSize: state.gridSize,
    variationIntensity: state.variationIntensity,
    spatialScaling: state.spatialScaling,
    mutationRate: state.mutationRate,
    lockedGenes: Array.from(state.lockedGenes || []),
    matcher: { ...state.matcher },
    parent: state.parent.serialize(),
    cells: (state.cells || []).map((c) => c.serialize()),
    fitness: state.fitness ? Array.from(state.fitness) : null,
    target: {
      name: state.target.name || 'Saved target',
      thumbUrl: state.target.thumbUrl || null,
    },
    auto: {
      generation: state.auto?.generation || 0,
      bestFitness: state.auto?.bestFitness || 0,
      bestIndex: state.auto?.bestIndex ?? -1,
      bestGenotype: state.auto?.bestGenotype ? state.auto.bestGenotype.serialize() : null,
      bestThumbUrl: state.auto?.bestThumbUrl || null,
    },
  };
}

export function saveCheckpoint(state) {
  const payload = serializeSearchState(state);
  if (!payload) return false;
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('Search checkpoint save failed', err);
    return false;
  }
}

export function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.parent || !parsed.target?.thumbUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckpoint() {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // ignore storage errors
  }
}

export function exportSearchJson(state) {
  const payload = serializeSearchState(state);
  if (!payload) return false;
  const gen = payload.auto?.generation || 0;
  const filename = `shader-search-gen${gen}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export async function importSearchJson(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.parent || !parsed.target?.thumbUrl) {
    throw new Error('Invalid search session file (missing target or parent genotype)');
  }
  return parsed;
}
