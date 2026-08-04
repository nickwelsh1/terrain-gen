import FastNoiseLite from 'fastnoise-lite';

const T = FastNoiseLite;
const CANVAS_SIZE = 128;

const smoothstep = (t) => t * t * (3.0 - 2.0 * t);
const mix = (a, b, t) => a + (b - a) * t;

function hash2(x, y) {
    let v = ((x * 374761393 + y * 668265263) >>> 0);
    v = (v ^ (v >>> 13)) >>> 0;
    v = (v * 1274126177) >>> 0;
    return v / 4294967295.0;
}

function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = Math.floor(seed * 1000);
    const sy = Math.floor(seed * 2000);

    const a = hash2(ix + sx, iy + sy);
    const b = hash2(ix + 1 + sx, iy + sy);
    const c = hash2(ix + sx, iy + 1 + sy);
    const d = hash2(ix + 1 + sx, iy + 1 + sy);

    const ux = smoothstep(fx);
    const uy = smoothstep(fy);

    return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

function fbm(x, y, seed) {
    let value = 0.0;
    let amplitude = 0.5;
    let frequency = 1.0;
    let sum = 0.0;

    for (let i = 0; i < 6; i += 1) {
        value += amplitude * valueNoise(x * frequency, y * frequency, seed + i * 17.0);
        sum += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value / sum;
}

function ridged(x, y, seed) {
    let value = 0.0;
    let amplitude = 0.5;
    let frequency = 1.0;
    let weight = 1.0;
    let sum = 0.0;

    for (let i = 0; i < 5; i += 1) {
        let n = valueNoise(x * frequency, y * frequency, seed + i * 31.0);
        n = 1.0 - Math.abs(n * 2.0 - 1.0);
        n = n * n;
        n = n * weight;
        weight = Math.min(Math.max(n * 2.0, 0.0), 1.0);
        value += amplitude * n;
        sum += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value / sum;
}

function domainWarped(x, y, seed) {
    const warpX = fbm(x * 2.0 + 50.0, y * 2.0, seed + 13.0) * 0.3;
    const warpY = fbm(x * 2.0, y * 2.0 + 50.0, seed + 19.0) * 0.3;
    return fbm(x + warpX, y + warpY, seed + 23.0);
}

const CARDS = [
    {
        id: 'os2',
        title: 'OpenSimplex2',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.None,
        noiseType: 'OpenSimplex2',
        family: 'gradient',
        complexity: 'Simple',
        tags: ['base terrain', 'hills'],
        description: 'Smooth gradient noise. Best as a base layer for hills and gentle terrain.',
        params: { frequency: 0.02 },
    },
    {
        id: 'os2-fbm',
        title: 'OpenSimplex2 + fBm',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.FBm,
        noiseType: 'OpenSimplex2 + fBm',
        family: 'fractal',
        complexity: 'Medium',
        tags: ['mountain massifs', 'mountains'],
        description: 'Multi-octave rolling hills and mountain massifs.',
        params: { frequency: 0.008, octaves: 5 },
    },
    {
        id: 'os2-ridged',
        title: 'OpenSimplex2 + Ridged',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.Ridged,
        noiseType: 'OpenSimplex2 + Ridged',
        family: 'fractal',
        complexity: 'Medium',
        tags: ['ridges', 'crests'],
        description: 'Sharp ridges and alpine crests.',
        params: { frequency: 0.008, octaves: 5 },
    },
    {
        id: 'os2-pp',
        title: 'OpenSimplex2 + PingPong',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.PingPong,
        noiseType: 'OpenSimplex2 + PingPong',
        family: 'fractal',
        complexity: 'Complex',
        tags: ['caverns', 'erosion'],
        description: 'Bubbly, cavernous erosion-like patterns.',
        params: { frequency: 0.008, octaves: 5 },
    },
    {
        id: 'os2-dw',
        title: 'OpenSimplex2 + Domain Warp',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.DomainWarpProgressive,
        noiseType: 'OpenSimplex2 + Domain Warp',
        family: 'fractal',
        complexity: 'Complex',
        tags: ['folded strata', 'valleys'],
        description: 'Folded, warped strata and river valleys.',
        params: { frequency: 0.008, octaves: 4 },
    },
    {
        id: 'os2s',
        title: 'OpenSimplex2S',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2S,
        fractalType: T.FractalType.None,
        noiseType: 'OpenSimplex2S',
        family: 'gradient',
        complexity: 'Simple',
        tags: ['clouds', 'masks'],
        description: 'Smoother variant for subtle cloud or erosion masks.',
        params: { frequency: 0.02 },
    },
    {
        id: 'cell-dist',
        title: 'Cellular Distance',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Cellular,
        fractalType: T.FractalType.None,
        returnType: T.CellularReturnType.Distance,
        distance: T.CellularDistanceFunction.Euclidean,
        noiseType: 'Cellular Distance',
        family: 'cellular',
        complexity: 'Simple',
        tags: ['basins', 'tectonic'],
        description: 'Voronoi distance. Useful for basins, tectonic plates, and lake beds.',
        params: { frequency: 0.02 },
    },
    {
        id: 'cell-value',
        title: 'Cellular CellValue',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Cellular,
        fractalType: T.FractalType.None,
        returnType: T.CellularReturnType.CellValue,
        distance: T.CellularDistanceFunction.Euclidean,
        noiseType: 'Cellular CellValue',
        family: 'cellular',
        complexity: 'Simple',
        tags: ['biomes', 'rock types'],
        description: 'Discrete cells. Good for rock-type regions and biome patches.',
        params: { frequency: 0.02 },
    },
    {
        id: 'cell-d2sub',
        title: 'Cellular Distance2Subtract',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Cellular,
        fractalType: T.FractalType.None,
        returnType: T.CellularReturnType.Distance2Sub,
        distance: T.CellularDistanceFunction.Euclidean,
        noiseType: 'Cellular Distance2Subtract',
        family: 'cellular',
        complexity: 'Medium',
        tags: ['fault lines', 'fractures'],
        description: 'Thin ridge lines. Useful for fault lines and fractures.',
        params: { frequency: 0.02 },
    },
    {
        id: 'cell-jitter',
        title: 'Cellular + Jitter',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Cellular,
        fractalType: T.FractalType.None,
        returnType: T.CellularReturnType.Distance,
        distance: T.CellularDistanceFunction.Euclidean,
        noiseType: 'Cellular Distance',
        family: 'cellular',
        complexity: 'Simple',
        tags: ['cracked mud', 'plateau'],
        description: 'Irregular cell boundaries. Cracked mud and eroded plateaus.',
        params: { frequency: 0.02, jitter: 1.2 },
    },
    {
        id: 'perlin',
        title: 'Perlin',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Perlin,
        fractalType: T.FractalType.None,
        noiseType: 'Perlin',
        family: 'gradient',
        complexity: 'Simple',
        tags: ['clouds', 'marble'],
        description: 'Classic gradient noise. Clouds, fog, and soft marble.',
        params: { frequency: 0.02 },
    },
    {
        id: 'perlin-fbm',
        title: 'Perlin + fBm',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Perlin,
        fractalType: T.FractalType.FBm,
        noiseType: 'Perlin + fBm',
        family: 'fractal',
        complexity: 'Medium',
        tags: ['cloud cover', 'soft terrain'],
        description: 'Soft rolling terrain and cloud cover.',
        params: { frequency: 0.008, octaves: 5 },
    },
    {
        id: 'vc',
        title: 'ValueCubic',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.ValueCubic,
        fractalType: T.FractalType.None,
        noiseType: 'ValueCubic',
        family: 'value',
        complexity: 'Simple',
        tags: ['dunes', 'sastrugi'],
        description: 'Smooth value noise. Gentle sand dunes and sastrugi.',
        params: { frequency: 0.02 },
    },
    {
        id: 'vc-ridged',
        title: 'ValueCubic + Ridged',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.ValueCubic,
        fractalType: T.FractalType.Ridged,
        noiseType: 'ValueCubic + Ridged',
        family: 'fractal',
        complexity: 'Medium',
        tags: ['dunes', 'wind ridges'],
        description: 'Sharper dune crests and wind-carved ridges.',
        params: { frequency: 0.008, octaves: 5 },
    },
    {
        id: 'val',
        title: 'Value',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Value,
        fractalType: T.FractalType.None,
        noiseType: 'Value',
        family: 'value',
        complexity: 'Simple',
        tags: ['crystalline', 'low-poly'],
        description: 'Raw blocky value noise. Low-poly or crystalline looks.',
        params: { frequency: 0.04 },
    },
    {
        id: 'val-fbm',
        title: 'Value + fBm',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Value,
        fractalType: T.FractalType.FBm,
        noiseType: 'Value + fBm',
        family: 'fractal',
        complexity: 'Medium',
        tags: ['scree', 'sand', 'gravel'],
        description: 'Granular rough surfaces for sand, gravel, and scree.',
        params: { frequency: 0.02, octaves: 5 },
    },
    {
        id: 'custom-value',
        title: 'Value Noise',
        library: 'custom',
        customType: 'value',
        noiseType: 'Value Noise',
        family: 'custom',
        complexity: 'Simple',
        tags: ['base layer', 'hash'],
        description: 'Hash-based 2D value noise. A building block for custom terrain.',
        params: { frequency: 0.02 },
    },
    {
        id: 'custom-fbm',
        title: 'Custom fBm',
        library: 'custom',
        customType: 'fbm',
        noiseType: 'fBm',
        family: 'custom',
        complexity: 'Medium',
        tags: ['rolling terrain', 'natural'],
        description: '6-octave fractal Brownian motion. Rolling natural terrain.',
        params: { frequency: 0.02 },
    },
    {
        id: 'custom-ridged',
        title: 'Custom Ridged Multifractal',
        library: 'custom',
        customType: 'ridged',
        noiseType: 'Ridged Multifractal',
        family: 'custom',
        complexity: 'Medium',
        tags: ['mountain crests', 'ridges'],
        description: '5-octave ridged multifractal. Sharp mountain crests.',
        params: { frequency: 0.02 },
    },
    {
        id: 'custom-warp',
        title: 'Custom Domain-Warped fBm',
        library: 'custom',
        customType: 'warp',
        noiseType: 'Domain-Warped fBm',
        family: 'custom',
        complexity: 'Complex',
        tags: ['organic landforms', 'valleys'],
        description: 'fBm warped by fBm. More organic landforms and valleys.',
        params: { frequency: 0.02 },
    },
];

const SIGNED_TYPES = new Set([
    T.NoiseType.OpenSimplex2,
    T.NoiseType.OpenSimplex2S,
    T.NoiseType.Perlin,
]);

function createFastNoise(card, seed) {
    const n = new FastNoiseLite();
    n.SetSeed(seed);
    n.SetFrequency(card.params.frequency);
    n.SetNoiseType(card.baseType);
    n.SetFractalType(card.fractalType || T.FractalType.None);

    if (card.params.octaves) {
        n.SetFractalOctaves(card.params.octaves);
    }

    if (card.baseType === T.NoiseType.Cellular) {
        if (card.returnType) n.SetCellularReturnType(card.returnType);
        if (card.distance) n.SetCellularDistanceFunction(card.distance);
        if (card.params.jitter !== undefined) n.SetCellularJitter(card.params.jitter);
    }

    return n;
}

function renderFastNoise(ctx, width, height, card, seed, frequency, modifier) {
    const n = new FastNoiseLite();
    n.SetSeed(seed);
    n.SetFrequency(frequency);
    n.SetNoiseType(card.baseType);
    n.SetFractalType(card.fractalType || T.FractalType.None);

    const octaves = modifier ?? card.params.octaves ?? 3;
    n.SetFractalOctaves(Math.max(1, Math.min(10, Math.round(octaves))));

    if (card.baseType === T.NoiseType.Cellular) {
        if (card.returnType) n.SetCellularReturnType(card.returnType);
        if (card.distance) n.SetCellularDistanceFunction(card.distance);
        if (card.params.jitter !== undefined) n.SetCellularJitter(card.params.jitter);
    }

    const image = ctx.createImageData(width, height);
    const data = image.data;
    const signed = SIGNED_TYPES.has(card.baseType);
    const invW = 1 / width;
    const invH = 1 / height;
    const isCellular = card.baseType === T.NoiseType.Cellular;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let v = n.GetNoise(x * invW * width, y * invH * height);
            let t;

            if (isCellular) {
                // FastNoiseLite cellular return values are shifted by -1.
                switch (card.returnType) {
                    case T.CellularReturnType.Distance:
                        t = v + 1;
                        break;
                    case T.CellularReturnType.Distance2Sub:
                        t = 1 - Math.abs(v + 1);
                        break;
                    default:
                        t = (v + 1) * 0.5;
                }
            } else if (signed) {
                t = (v + 1) * 0.5;
            } else {
                t = v;
            }

            const g = Math.max(0, Math.min(255, Math.round(t * 255)));
            const i = (y * width + x) * 4;
            data[i] = g;
            data[i + 1] = g;
            data[i + 2] = g;
            data[i + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);
}

function renderCustom(ctx, width, height, card, seed, frequency, _modifier) {
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const invW = 1 / width;
    const invH = 1 / height;

    const generator = (() => {
        switch (card.customType) {
            case 'value': return valueNoise;
            case 'fbm': return fbm;
            case 'ridged': return ridged;
            case 'warp': return domainWarped;
            default: return fbm;
        }
    })();

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const v = generator(x * invW * width * frequency, y * invH * height * frequency, seed);
            const g = Math.max(0, Math.min(255, Math.round(v * 255)));
            const i = (y * width + x) * 4;
            data[i] = g;
            data[i + 1] = g;
            data[i + 2] = g;
            data[i + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);
}

function renderCard(canvas, card, state) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    if (card.library === 'fastnoise-lite') {
        renderFastNoise(ctx, CANVAS_SIZE, CANVAS_SIZE, card, state.seed, state.frequency, state.modifier);
    } else {
        renderCustom(ctx, CANVAS_SIZE, CANVAS_SIZE, card, state.seed, state.frequency, state.modifier);
    }
}

function debounce(fn, ms = 16) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function createCard(card) {
    const root = document.createElement('div');
    root.className = 'card';
    root.dataset.id = card.id;
    root.dataset.complexity = card.complexity;
    root.dataset.family = card.family;

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    const title = document.createElement('h3');
    title.textContent = card.title;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span class="noise-type">${card.noiseType}</span><span class="family ${card.family}">${card.family}</span>`;

    const desc = document.createElement('p');
    desc.className = 'description';
    desc.textContent = card.description;

    const tags = document.createElement('div');
    tags.className = 'tags';
    card.tags.forEach((tag) => {
        const span = document.createElement('span');
        span.textContent = tag;
        tags.appendChild(span);
    });

    const controls = document.createElement('div');
    controls.className = 'controls';

    const freqWrap = document.createElement('label');
    freqWrap.innerHTML = `<span>Zoom</span><span class="val">${card.params.frequency.toFixed(3)}</span>`;
    const freqSlider = document.createElement('input');
    freqSlider.type = 'range';
    freqSlider.min = 0.001;
    freqSlider.max = 0.1;
    freqSlider.step = 0.001;
    freqSlider.value = card.params.frequency;
    controls.appendChild(freqWrap);
    controls.appendChild(freqSlider);

    let modifierSlider = null;
    let modWrap = null;
    if (card.library === 'fastnoise-lite' && card.fractalType && card.fractalType !== T.FractalType.None && card.fractalType !== T.FractalType.DomainWarpProgressive && card.fractalType !== T.FractalType.DomainWarpIndependent) {
        modWrap = document.createElement('label');
        modWrap.innerHTML = `<span>Octaves</span><span class="val">${card.params.octaves}</span>`;
        modifierSlider = document.createElement('input');
        modifierSlider.type = 'range';
        modifierSlider.min = 1;
        modifierSlider.max = 10;
        modifierSlider.step = 1;
        modifierSlider.value = card.params.octaves;
        controls.appendChild(modWrap);
        controls.appendChild(modifierSlider);
    } else if (card.library === 'custom' && card.customType === 'warp') {
        modWrap = document.createElement('label');
        modWrap.innerHTML = `<span>Warp amount</span><span class="val">0.30</span>`;
        modifierSlider = document.createElement('input');
        modifierSlider.type = 'range';
        modifierSlider.min = 0;
        modifierSlider.max = 1;
        modifierSlider.step = 0.05;
        modifierSlider.value = 0.3;
        controls.appendChild(modWrap);
        controls.appendChild(modifierSlider);
    }

    root.appendChild(canvas);
    root.appendChild(title);
    root.appendChild(meta);
    root.appendChild(desc);
    root.appendChild(tags);
    root.appendChild(controls);

    const state = { seed: 1337, frequency: card.params.frequency, modifier: card.params.octaves };

    const rerender = () => renderCard(canvas, card, state);
    const debouncedRender = debounce(rerender, 30);

    freqSlider.addEventListener('input', (e) => {
        state.frequency = parseFloat(e.target.value);
        freqWrap.querySelector('.val').textContent = state.frequency.toFixed(3);
        debouncedRender();
    });

    if (modifierSlider) {
        modifierSlider.addEventListener('input', (e) => {
            state.modifier = parseFloat(e.target.value);
            modWrap.querySelector('.val').textContent = state.modifier.toFixed(2);
            debouncedRender();
        });
    }

    renderCard(canvas, card, state);

    return root;
}

function sortCards(by) {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    const cards = Array.from(grid.children);
    const cfgById = new Map(CARDS.map((c) => [c.id, c]));

    cards.sort((a, b) => {
        const ca = cfgById.get(a.dataset.id);
        const cb = cfgById.get(b.dataset.id);

        if (by === 'alphabetical') {
            return ca.title.localeCompare(cb.title);
        }

        if (by === 'complexity') {
            const order = { Simple: 0, Medium: 1, Complex: 2 };
            return order[ca.complexity] - order[cb.complexity] || ca.title.localeCompare(cb.title);
        }

        // by noise type (baseType order)
        const typeOrder = {
            OpenSimplex2: 0,
            OpenSimplex2S: 1,
            Cellular: 2,
            Perlin: 3,
            ValueCubic: 4,
            Value: 5,
            custom: 6,
        };

        const ta = ca.library === 'custom' ? 'custom' : String(ca.baseType);
        const tb = cb.library === 'custom' ? 'custom' : String(cb.baseType);
        const diff = (typeOrder[ta] ?? 99) - (typeOrder[tb] ?? 99);
        if (diff !== 0) return diff;
        return ca.title.localeCompare(cb.title);
    });

    cards.forEach((c) => grid.appendChild(c));
}

function initGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    CARDS.forEach((card) => {
        grid.appendChild(createCard(card));
    });

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => sortCards(e.target.value));
    }

    const seedInput = document.getElementById('seed-input');
    if (seedInput) {
        seedInput.addEventListener('input', debounce((e) => {
            const seed = parseInt(e.target.value, 10) || 0;
            const canvases = grid.querySelectorAll('canvas');
            const cardsById = new Map(CARDS.map((c) => [c.id, c]));

            canvases.forEach((canvas) => {
                const cardEl = canvas.closest('.card');
                if (!cardEl) return;
                const card = cardsById.get(cardEl.dataset.id);
                if (!card) return;

                const freq = parseFloat(cardEl.querySelector('input[type="range"]').value);
                const mod = cardEl.querySelectorAll('input[type="range"]').length > 1
                    ? parseFloat(cardEl.querySelectorAll('input[type="range"]')[1].value)
                    : undefined;

                renderCard(canvas, card, { seed, frequency: freq, modifier: mod });
            });
        }, 80));
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const cardsById = new Map(CARDS.map((c) => [c.id, c]));

            Array.from(grid.children).forEach((el) => {
                const card = cardsById.get(el.dataset.id);
                const visible = q === ''
                    || card.title.toLowerCase().includes(q)
                    || card.family.toLowerCase().includes(q)
                    || card.tags.some((t) => t.toLowerCase().includes(q));
                el.style.display = visible ? '' : 'none';
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', initGallery);
