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

function waveSine(phase) {
    return (Math.sin(phase) + 1) * 0.5;
}

function waveSquare(phase) {
    return Math.sin(phase) >= 0 ? 1 : 0;
}

function waveTriangle(phase) {
    return Math.acos(Math.cos(phase)) / Math.PI;
}

function waveSawtooth(phase) {
    const t = phase / (2 * Math.PI);
    return t - Math.floor(t);
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
    {
        id: 'os2-ridged-cross',
        title: 'Crossed Ridged (FastNoiseLite)',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.OpenSimplex2,
        fractalType: T.FractalType.Ridged,
        noiseType: 'OpenSimplex2 + Ridged (crossed)',
        family: 'fractal',
        complexity: 'Complex',
        tags: ['iron oxide', 'striations', 'rock'],
        description: 'Two ridged layers rotated and summed. Criss-crossed iron-oxide bands in rock.',
        params: { frequency: 0.02, octaves: 5, crossAngle: 55 },
        modifierType: 'crossAngle',
    },
    {
        id: 'custom-ridged-cross',
        title: 'Crossed Ridged (custom)',
        library: 'custom',
        customType: 'ridgedCross',
        noiseType: 'Ridged Multifractal (crossed)',
        family: 'custom',
        complexity: 'Complex',
        tags: ['iron oxide', 'striations', 'veins'],
        description: 'Two custom ridged multifractal layers rotated and summed. Criss-crossed mineral veins.',
        params: { frequency: 0.02, crossAngle: 55 },
        modifierType: 'crossAngle',
    },
    {
        id: 'wave-sine',
        title: 'Sine on fBm',
        library: 'custom',
        customType: 'sine',
        noiseType: 'Sine Wave',
        family: 'wave',
        complexity: 'Simple',
        tags: ['bands', 'rolling', 'texture'],
        description: 'Base fBm noise used as a phase for a sine wave. Smooth, rolling bands.',
        params: { frequency: 0.02, waveFreq: 6 },
        modifierType: 'waveFrequency',
    },
    {
        id: 'wave-square',
        title: 'Square on fBm',
        library: 'custom',
        customType: 'square',
        noiseType: 'Square Wave',
        family: 'wave',
        complexity: 'Simple',
        tags: ['hard bands', 'terraces', 'texture'],
        description: 'Hard black/white bands from thresholded sine. Terrace-like layers.',
        params: { frequency: 0.02, waveFreq: 6 },
        modifierType: 'waveFrequency',
    },
    {
        id: 'wave-triangle',
        title: 'Triangle on fBm',
        library: 'custom',
        customType: 'triangle',
        noiseType: 'Triangle Wave',
        family: 'wave',
        complexity: 'Simple',
        tags: ['ramps', 'bands', 'texture'],
        description: 'Triangle wave of fBm noise. Linear ramps between dark and light bands.',
        params: { frequency: 0.02, waveFreq: 6 },
        modifierType: 'waveFrequency',
    },
    {
        id: 'wave-sawtooth',
        title: 'Sawtooth on fBm',
        library: 'custom',
        customType: 'sawtooth',
        noiseType: 'Sawtooth Wave',
        family: 'wave',
        complexity: 'Simple',
        tags: ['repeating', 'layers', 'texture'],
        description: 'Sawtooth wave of fBm noise. Repeating linear ramps, good for layered strata.',
        params: { frequency: 0.02, waveFreq: 6 },
        modifierType: 'waveFrequency',
    },
    {
        id: 'anisotropic-primary',
        title: 'Anisotropic Ridged Striations',
        library: 'custom',
        customType: 'anisotropic',
        noiseType: 'Anisotropic Ridged',
        family: 'custom',
        complexity: 'Complex',
        tags: ['iron oxide', 'striations', 'rock'],
        description: 'Stretched ridged noise with a small fBm displacement. A few straight, grainy mineral bands.',
        params: { frequency: 0.02, lineFrequency: 3, displacement: 0.3, angle: 0 },
    },
    {
        id: 'anisotropic-crisp',
        title: 'Parallel Crisp Striations',
        library: 'custom',
        customType: 'anisotropic',
        noiseType: 'Anisotropic Ridged',
        family: 'custom',
        complexity: 'Complex',
        tags: ['iron oxide', 'crisp', 'rock'],
        description: 'Low displacement, low line frequency. Straight, widely-spaced, almost ruler-clean bands.',
        params: { frequency: 0.02, lineFrequency: 2, displacement: 0.05, angle: 45 },
    },
    {
        id: 'anisotropic-warped',
        title: 'Warped Mineral Veins',
        library: 'custom',
        customType: 'anisotropic',
        noiseType: 'Anisotropic Ridged',
        family: 'custom',
        complexity: 'Complex',
        tags: ['iron oxide', 'veins', 'rock'],
        description: 'High displacement. Fewer bands that curve and cross, like organic mineral veins.',
        params: { frequency: 0.02, lineFrequency: 2, displacement: 0.9, angle: 60 },
    },
    {
        id: 'sine-crests',
        title: 'Noisy Sine Crests',
        library: 'custom',
        customType: 'sineCrests',
        noiseType: 'Sine Crests',
        family: 'wave',
        complexity: 'Medium',
        tags: ['iron oxide', 'striations', 'rock'],
        description: 'Sine wave crests clipped to thin bright lines. Large black areas between iron-oxide bands.',
        params: { frequency: 0.02, lineWidth: 0.12, waviness: 1.0, angle: 0, angle2: 30, cross: false },
        modifierType: 'sineCrests',
    },
    {
        id: 'criss-cross-sine',
        title: 'Criss-Cross Sine Crests',
        library: 'custom',
        customType: 'sineCrests',
        noiseType: 'Sine Crests',
        family: 'wave',
        complexity: 'Medium',
        tags: ['iron oxide', 'veins', 'criss-cross'],
        description: 'Two sparse sine crest fields crossing. Bright veins on a mostly black background.',
        params: { frequency: 0.02, lineWidth: 0.12, waviness: 1.5, angle: 45, cross: true },
        modifierType: 'sineCrests',
    },
    {
        id: 'cellular-faults',
        title: 'Cellular Fault Lines',
        library: 'fastnoise-lite',
        baseType: T.NoiseType.Cellular,
        fractalType: T.FractalType.None,
        returnType: T.CellularReturnType.Distance,
        distance: T.CellularDistanceFunction.Euclidean,
        noiseType: 'Cellular Distance',
        family: 'cellular',
        complexity: 'Medium',
        tags: ['iron oxide', 'faults', 'cracks'],
        description: 'Cellular distance thresholded to thin bright edges. Large dark cells with white fault boundaries.',
        params: { frequency: 0.015, threshold: 0.7, waveFreq: 4 },
        modifierType: 'threshold',
    },
    {
        id: 'sawtooth-crests',
        title: 'Thresholded Sawtooth Bands',
        library: 'custom',
        customType: 'sawtoothCrests',
        noiseType: 'Sawtooth Crests',
        family: 'wave',
        complexity: 'Medium',
        tags: ['iron oxide', 'bands', 'strata'],
        description: 'Sawtooth wave bands with only the bright top kept. Sharp, straight-ish mineral layers.',
        params: { frequency: 0.02, lineWidth: 0.15, waviness: 0.6, angle: 30 },
        modifierType: 'sawtoothCrests',
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

function rotateCoord(x, y, c, s) {
    return { x: x * c - y * s, y: x * s + y * c };
}

function renderFastNoise(ctx, width, height, card, seed, frequency, state) {
    const n = new FastNoiseLite();
    n.SetSeed(seed);
    n.SetFrequency(frequency);
    n.SetNoiseType(card.baseType);
    n.SetFractalType(card.fractalType || T.FractalType.None);

    const octaves = card.modifierType !== 'crossAngle'
        ? (state.modifier ?? card.params.octaves ?? 3)
        : (card.params.octaves ?? 5);
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
    const isCross = card.modifierType === 'crossAngle';
    const crossAngle = ((state.modifier !== undefined ? state.modifier : card.params.crossAngle) * Math.PI) / 180;
    const c = Math.cos(crossAngle);
    const s = Math.sin(crossAngle);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const x0 = x * invW * width;
            const y0 = y * invH * height;
            let v;

            if (isCross) {
                const p1 = rotateCoord(x0, y0, c, s);
                const p2 = rotateCoord(x0, y0, c, -s);
                const v1 = n.GetNoise(p1.x, p1.y);
                const v2 = n.GetNoise(p2.x, p2.y);
                v = (v1 + v2) * 0.5;
            } else {
                v = n.GetNoise(x0, y0);
            }
            let t;

            if (card.customType === 'cellularFaults' && card.returnType === T.CellularReturnType.Distance) {
                const d = v + 1;
                const waveFreq = (state.waveFreq ?? card.params.waveFreq ?? 4) * Math.PI * 2;
                const wave = (Math.sin(d * waveFreq) + 1) * 0.5;
                const threshold = state.modifier ?? state.threshold ?? card.params.threshold ?? 0.7;
                t = wave > threshold ? (wave - threshold) / (1 - threshold) : 0;
            } else if (isCellular) {
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

function renderCustom(ctx, width, height, card, seed, frequency, state) {
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const invW = 1 / width;
    const invH = 1 / height;

    const isCross = card.customType === 'ridgedCross';
    const isWave = ['sine', 'square', 'triangle', 'sawtooth'].includes(card.customType);
    const isAnisotropic = card.customType === 'anisotropic';
    const isSineCrests = card.customType === 'sineCrests';
    const isSawtoothCrests = card.customType === 'sawtoothCrests';
    const crossAngle = ((state.modifier !== undefined ? state.modifier : (card.params.crossAngle ?? 55)) * Math.PI) / 180;
    const anisotropicAngle = ((state.angle !== undefined ? state.angle : (card.params.angle ?? 0)) * Math.PI) / 180;
    const crestAngle = ((state.angle !== undefined ? state.angle : (card.params.angle ?? 0)) * Math.PI) / 180;
    const crestAngle2 = (card.params.cross
        ? -crestAngle
        : ((state.angle2 !== undefined ? state.angle2 : (card.params.angle2 ?? 30)) * Math.PI) / 180);
    const c = Math.cos(isAnisotropic ? anisotropicAngle : (isSineCrests || isSawtoothCrests ? crestAngle : crossAngle));
    const s = Math.sin(isAnisotropic ? anisotropicAngle : (isSineCrests || isSawtoothCrests ? crestAngle : crossAngle));
    const c2 = Math.cos(crestAngle2);
    const s2 = Math.sin(crestAngle2);
    const waveFreq = (state.modifier !== undefined ? state.modifier : (card.params.waveFreq ?? 6)) * 2 * Math.PI;
    const lineFrequency = (state.lineFrequency !== undefined ? state.lineFrequency : (card.params.lineFrequency ?? 3));
    const displacement = (state.displacement !== undefined ? state.displacement : (card.params.displacement ?? 0.3));
    const lineWidth = (state.lineWidth !== undefined ? state.lineWidth : (card.params.lineWidth ?? 0.1));
    const waviness = (state.waviness !== undefined ? state.waviness : (card.params.waviness ?? 1.0));

    const waveFn = (() => {
        switch (card.customType) {
            case 'sine': return waveSine;
            case 'square': return waveSquare;
            case 'triangle': return waveTriangle;
            case 'sawtooth': return waveSawtooth;
            default: return null;
        }
    })();

    const generator = (() => {
        switch (card.customType) {
            case 'value': return valueNoise;
            case 'fbm': return fbm;
            case 'ridged': return ridged;
            case 'warp': return domainWarped;
            case 'sine':
            case 'square':
            case 'triangle':
            case 'sawtooth': return fbm;
            default: return fbm;
        }
    })();

    const perpScale = lineFrequency * 0.4;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const x0 = x * invW * width * frequency;
            const y0 = y * invH * height * frequency;
            let v;

            if (isCross) {
                const p1 = rotateCoord(x0, y0, c, s);
                const p2 = rotateCoord(x0, y0, c, -s);
                const v1 = ridged(p1.x, p1.y, seed);
                const v2 = ridged(p2.x, p2.y, seed + 999);
                v = (v1 + v2) * 0.5;
            } else if (isWave) {
                const n = generator(x0, y0, seed);
                v = waveFn(n * waveFreq);
            } else if (isAnisotropic) {
                const u = x0 * c + y0 * s;
                const w = -x0 * s + y0 * c;
                const vNoise = fbm(u * 0.5, w * 0.5, seed + 99) - 0.5;
                const worldX = u * 4.0;
                const worldY = w * perpScale + vNoise * displacement * 0.8;
                v = ridged(worldX, worldY, seed);
            } else if (isSineCrests) {
                const layers = [
                    { c: c, s: s, freq: 6.0, seed: seed },
                    { c: c2, s: s2, freq: 9.0, seed: seed + 50 },
                ];
                let crest = 0;
                for (let i = 0; i < layers.length; i += 1) {
                    const layer = layers[i];
                    const p = rotateCoord(x0, y0, layer.c, layer.s);
                    const uu = p.x * layer.freq;
                    const ww = p.y;
                    const warp = (fbm(uu * 0.05, ww * 0.05, layer.seed + 1) - 0.5) * waviness * 3.0;
                    const phaseNoise = (fbm(uu * 0.2, ww * 0.2, layer.seed + 10) - 0.5) * waviness * 1.5;
                    const phase = uu + warp + phaseNoise;
                    const wave = (Math.sin(phase) + 1) * 0.5;
                    const cutoff = 1 - lineWidth;
                    let cval = (wave - cutoff) / lineWidth;
                    cval = Math.max(0, Math.min(1, cval));
                    crest = Math.max(crest, cval);
                }
                v = crest;
            } else if (isSawtoothCrests) {
                const p = rotateCoord(x0, y0, c, s);
                const uu = p.x * 6.0;
                const ww = p.y;
                const warp = (fbm(uu * 0.05, ww * 0.05, seed + 1) - 0.5) * waviness * 3.0;
                const phase = uu + warp;
                const wave = waveSawtooth(phase);
                const cutoff = 1 - lineWidth;
                let cval = (wave - cutoff) / lineWidth;
                cval = Math.max(0, Math.min(1, cval));
                v = cval;
            } else {
                v = generator(x0, y0, seed);
            }

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
        renderFastNoise(ctx, CANVAS_SIZE, CANVAS_SIZE, card, state.seed, state.frequency, state);
    } else {
        renderCustom(ctx, CANVAS_SIZE, CANVAS_SIZE, card, state.seed, state.frequency, state);
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
    } else if (card.modifierType === 'crossAngle') {
        const angle = card.params.crossAngle ?? 55;
        modWrap = document.createElement('label');
        modWrap.innerHTML = `<span>Cross angle</span><span class="val">${angle}°</span>`;
        modifierSlider = document.createElement('input');
        modifierSlider.type = 'range';
        modifierSlider.min = 0;
        modifierSlider.max = 180;
        modifierSlider.step = 5;
        modifierSlider.value = angle;
        controls.appendChild(modWrap);
        controls.appendChild(modifierSlider);
    } else if (card.modifierType === 'waveFrequency') {
        const waveFreq = card.params.waveFreq ?? 6;
        modWrap = document.createElement('label');
        modWrap.innerHTML = `<span>Wave frequency</span><span class="val">${waveFreq}</span>`;
        modifierSlider = document.createElement('input');
        modifierSlider.type = 'range';
        modifierSlider.min = 0.5;
        modifierSlider.max = 20;
        modifierSlider.step = 0.5;
        modifierSlider.value = waveFreq;
        controls.appendChild(modWrap);
        controls.appendChild(modifierSlider);
    } else if (card.customType === 'anisotropic') {
        const lineFreq = card.params.lineFrequency ?? 3;
        const lfWrap = document.createElement('label');
        lfWrap.innerHTML = `<span>Line frequency</span><span class="val">${lineFreq}</span>`;
        const lfSlider = document.createElement('input');
        lfSlider.type = 'range';
        lfSlider.min = 1;
        lfSlider.max = 10;
        lfSlider.step = 1;
        lfSlider.value = lineFreq;
        controls.appendChild(lfWrap);
        controls.appendChild(lfSlider);

        const disp = card.params.displacement ?? 0.3;
        const dWrap = document.createElement('label');
        dWrap.innerHTML = `<span>Displacement</span><span class="val">${disp.toFixed(2)}</span>`;
        const dSlider = document.createElement('input');
        dSlider.type = 'range';
        dSlider.min = 0;
        dSlider.max = 1;
        dSlider.step = 0.05;
        dSlider.value = disp;
        controls.appendChild(dWrap);
        controls.appendChild(dSlider);

        const angle = card.params.angle ?? 0;
        const aWrap = document.createElement('label');
        aWrap.innerHTML = `<span>Angle</span><span class="val">${angle}°</span>`;
        const aSlider = document.createElement('input');
        aSlider.type = 'range';
        aSlider.min = 0;
        aSlider.max = 180;
        aSlider.step = 5;
        aSlider.value = angle;
        controls.appendChild(aWrap);
        controls.appendChild(aSlider);

        lfSlider.addEventListener('input', (e) => {
            state.lineFrequency = parseFloat(e.target.value);
            lfWrap.querySelector('.val').textContent = `${Math.round(state.lineFrequency)}`;
            debouncedRender();
        });
        dSlider.addEventListener('input', (e) => {
            state.displacement = parseFloat(e.target.value);
            dWrap.querySelector('.val').textContent = state.displacement.toFixed(2);
            debouncedRender();
        });
        aSlider.addEventListener('input', (e) => {
            state.angle = parseFloat(e.target.value);
            aWrap.querySelector('.val').textContent = `${Math.round(state.angle)}°`;
            debouncedRender();
        });
    } else if (card.modifierType === 'sineCrests') {
        const lw = card.params.lineWidth ?? 0.1;
        const lwWrap = document.createElement('label');
        lwWrap.innerHTML = `<span>Line width</span><span class="val">${lw.toFixed(2)}</span>`;
        const lwSlider = document.createElement('input');
        lwSlider.type = 'range';
        lwSlider.min = 0.02;
        lwSlider.max = 0.4;
        lwSlider.step = 0.02;
        lwSlider.value = lw;
        controls.appendChild(lwWrap);
        controls.appendChild(lwSlider);

        const wav = card.params.waviness ?? 1.0;
        const wWrap = document.createElement('label');
        wWrap.innerHTML = `<span>Waviness</span><span class="val">${wav.toFixed(2)}</span>`;
        const wSlider = document.createElement('input');
        wSlider.type = 'range';
        wSlider.min = 0;
        wSlider.max = 3;
        wSlider.step = 0.1;
        wSlider.value = wav;
        controls.appendChild(wWrap);
        controls.appendChild(wSlider);

        const angle = card.params.angle ?? 0;
        const aWrap = document.createElement('label');
        aWrap.innerHTML = `<span>Angle</span><span class="val">${angle}°</span>`;
        const aSlider = document.createElement('input');
        aSlider.type = 'range';
        aSlider.min = 0;
        aSlider.max = 180;
        aSlider.step = 5;
        aSlider.value = angle;
        controls.appendChild(aWrap);
        controls.appendChild(aSlider);

        let a2Slider = null;
        if (!card.params.cross) {
            const angle2 = card.params.angle2 ?? 30;
            const a2Wrap = document.createElement('label');
            a2Wrap.innerHTML = `<span>Second angle</span><span class="val">${angle2}°</span>`;
            a2Slider = document.createElement('input');
            a2Slider.type = 'range';
            a2Slider.min = 0;
            a2Slider.max = 180;
            a2Slider.step = 5;
            a2Slider.value = angle2;
            controls.appendChild(a2Wrap);
            controls.appendChild(a2Slider);
        }

        lwSlider.addEventListener('input', (e) => {
            state.lineWidth = parseFloat(e.target.value);
            lwWrap.querySelector('.val').textContent = state.lineWidth.toFixed(2);
            debouncedRender();
        });
        wSlider.addEventListener('input', (e) => {
            state.waviness = parseFloat(e.target.value);
            wWrap.querySelector('.val').textContent = state.waviness.toFixed(2);
            debouncedRender();
        });
        aSlider.addEventListener('input', (e) => {
            state.angle = parseFloat(e.target.value);
            aWrap.querySelector('.val').textContent = `${Math.round(state.angle)}°`;
            debouncedRender();
        });
        if (a2Slider) {
            a2Slider.addEventListener('input', (e) => {
                state.angle2 = parseFloat(e.target.value);
                a2Wrap.querySelector('.val').textContent = `${Math.round(state.angle2)}°`;
                debouncedRender();
            });
        }
    } else if (card.modifierType === 'sawtoothCrests') {
        const lw = card.params.lineWidth ?? 0.15;
        const lwWrap = document.createElement('label');
        lwWrap.innerHTML = `<span>Line width</span><span class="val">${lw.toFixed(2)}</span>`;
        const lwSlider = document.createElement('input');
        lwSlider.type = 'range';
        lwSlider.min = 0.02;
        lwSlider.max = 0.4;
        lwSlider.step = 0.02;
        lwSlider.value = lw;
        controls.appendChild(lwWrap);
        controls.appendChild(lwSlider);

        const wav = card.params.waviness ?? 1.0;
        const wWrap = document.createElement('label');
        wWrap.innerHTML = `<span>Waviness</span><span class="val">${wav.toFixed(2)}</span>`;
        const wSlider = document.createElement('input');
        wSlider.type = 'range';
        wSlider.min = 0;
        wSlider.max = 3;
        wSlider.step = 0.1;
        wSlider.value = wav;
        controls.appendChild(wWrap);
        controls.appendChild(wSlider);

        lwSlider.addEventListener('input', (e) => {
            state.lineWidth = parseFloat(e.target.value);
            lwWrap.querySelector('.val').textContent = state.lineWidth.toFixed(2);
            debouncedRender();
        });
        wSlider.addEventListener('input', (e) => {
            state.waviness = parseFloat(e.target.value);
            wWrap.querySelector('.val').textContent = state.waviness.toFixed(2);
            debouncedRender();
        });
    } else if (card.modifierType === 'threshold') {
        const threshold = card.params.threshold ?? 0.7;
        modWrap = document.createElement('label');
        modWrap.innerHTML = `<span>Line thinness</span><span class="val">${threshold.toFixed(2)}</span>`;
        modifierSlider = document.createElement('input');
        modifierSlider.type = 'range';
        modifierSlider.min = 0.55;
        modifierSlider.max = 0.95;
        modifierSlider.step = 0.01;
        modifierSlider.value = threshold;
        controls.appendChild(modWrap);
        controls.appendChild(modifierSlider);

        const waveFreq = card.params.waveFreq ?? 4;
        const wfWrap = document.createElement('label');
        wfWrap.innerHTML = `<span>Wave frequency</span><span class="val">${waveFreq}</span>`;
        const wfSlider = document.createElement('input');
        wfSlider.type = 'range';
        wfSlider.min = 1;
        wfSlider.max = 10;
        wfSlider.step = 1;
        wfSlider.value = waveFreq;
        controls.appendChild(wfWrap);
        controls.appendChild(wfSlider);

        wfSlider.addEventListener('input', (e) => {
            state.waveFreq = parseFloat(e.target.value);
            wfWrap.querySelector('.val').textContent = `${Math.round(state.waveFreq)}`;
            debouncedRender();
        });
    }

    root.appendChild(canvas);
    root.appendChild(title);
    root.appendChild(meta);
    root.appendChild(desc);
    root.appendChild(tags);
    root.appendChild(controls);

    const state = {
        seed: 1337,
        frequency: card.params.frequency,
        modifier: card.params.octaves ?? card.params.crossAngle ?? card.params.waveFreq ?? card.params.threshold ?? 0.3,
        lineFrequency: card.params.lineFrequency,
        displacement: card.params.displacement,
        angle: card.params.angle,
        angle2: card.params.angle2,
        lineWidth: card.params.lineWidth,
        waviness: card.params.waviness,
        threshold: card.params.threshold,
        waveFreq: card.params.waveFreq,
    };

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
            let display;
            if (card.modifierType === 'crossAngle') {
                display = `${Math.round(state.modifier)}°`;
            } else if (card.modifierType === 'waveFrequency') {
                display = `${state.modifier.toFixed(1)}`;
            } else if (card.modifierType === 'threshold') {
                display = `${state.modifier.toFixed(2)}`;
            } else if (card.params.octaves !== undefined && card.modifierType !== 'warp') {
                display = `${Math.round(state.modifier)}`;
            } else {
                display = state.modifier.toFixed(2);
            }
            modWrap.querySelector('.val').textContent = display;
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
