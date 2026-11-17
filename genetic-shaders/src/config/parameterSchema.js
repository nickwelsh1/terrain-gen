// Genotype parameter schema: bounds, defaults, step sizes and grouping.
// Every parameter is a "gene" that the genetic engine can mutate.
// `hint` is a one-sentence plain-language explanation shown by the ⓘ button.

export const GENE_GROUPS = {
  core: 'Core Noise',
  warp: 'Domain Warping',
  erosion: 'Erosion Filter',
  curvature: 'Laplacian & Curvature',
  tone: 'Tone & Remapping',
  display: 'Display',
};

export const SCHEMA = [
  // --- Core noise ---
  {
    key: 'noiseType', group: 'core', type: 'enum', min: 0, max: 5, step: 1, def: 1,
    label: 'Noise Type',
    options: ['Perlin', 'Simplex', 'Worley F1', 'Worley Crackle', 'Ridged Multifractal', 'Perlin-Worley Hybrid'],
    hint: 'Picks the basic pattern the terrain is built from, such as soft hills, cells, cracks or sharp ridges.',
  },
  {
    key: 'seed', group: 'core', type: 'float', min: 0, max: 1000, step: 0.1, def: 137.5, label: 'Seed',
    hint: 'Shuffles the random layout so you get a different landscape in the same overall style.',
  },
  {
    key: 'frequency', group: 'core', type: 'float', min: 0.5, max: 16, step: 0.05, def: 4.0, label: 'Frequency',
    hint: 'Acts like zoom: higher values pack in more, smaller features and lower values zoom in on fewer, larger ones.',
  },
  {
    key: 'octaves', group: 'core', type: 'int', min: 1, max: 8, step: 1, def: 5, label: 'Octaves',
    hint: 'Adds layers of ever-finer detail on top of the main shapes.',
  },
  {
    key: 'persistence', group: 'core', type: 'float', min: 0.15, max: 0.85, step: 0.01, def: 0.5, label: 'Persistence',
    hint: 'Sets how strong each finer layer of detail is, so higher values make the surface rougher.',
  },
  {
    key: 'lacunarity', group: 'core', type: 'float', min: 1.5, max: 3.2, step: 0.01, def: 2.0, label: 'Lacunarity',
    hint: 'Sets how much smaller each finer layer of detail is than the one before it.',
  },

  // --- Domain warping ---
  {
    key: 'warpIntensity', group: 'warp', type: 'float', min: 0, max: 2.5, step: 0.01, def: 0.03, label: 'Warp Intensity',
    hint: 'Bends and swirls the terrain, like pushing wet paint around with a brush.',
  },
  {
    key: 'warpFrequency', group: 'warp', type: 'float', min: 0.1, max: 8, step: 0.05, def: 0.7, label: 'Warp Frequency',
    hint: 'Sets the size of the swirls, where low values give broad, gentle bends and high values give tight twists.',
  },
  {
    key: 'warpOctaves', group: 'warp', type: 'int', min: 1, max: 4, step: 1, def: 2, label: 'Warp Octaves',
    hint: 'Adds smaller swirls inside the big ones for a more complex, twisted look.',
  },

  // --- Erosion filter (Runevision Phacelle / Clay John & Fewes Gavoronoise) ---
  {
    key: 'erosionMode', group: 'erosion', type: 'enum', min: 0, max: 2, step: 1, def: 0,
    label: 'Erosion Mode',
    options: ['Off', 'Runevision Advanced (Phacelle)', 'Classic (Clay John / Fewes)'],
    hint: 'Turns on simulated water erosion that carves branching gullies and ridges into the terrain.',
  },
  {
    key: 'erosionStrength', group: 'erosion', type: 'float', min: 0.0, max: 0.40, step: 0.005, def: 0.0, label: 'Erosion Strength',
    hint: 'Sets how deeply the erosion carves into the terrain.',
  },
  {
    key: 'erosionScale', group: 'erosion', type: 'float', min: 0.05, max: 0.50, step: 0.005, def: 0.15, label: 'Gully Scale',
    hint: 'Sets how wide the carved gullies are.',
  },
  {
    key: 'erosionOctaves', group: 'erosion', type: 'int', min: 1, max: 5, step: 1, def: 4, label: 'Erosion Octaves',
    hint: 'Adds extra levels of smaller gullies branching off the main ones.',
  },
  {
    key: 'erosionGain', group: 'erosion', type: 'float', min: 0.25, max: 0.75, step: 0.01, def: 0.50, label: 'Erosion Gain',
    hint: 'Sets how deep each smaller level of branching gullies is compared to the bigger ones.',
  },
  {
    key: 'erosionLacunarity', group: 'erosion', type: 'float', min: 1.5, max: 2.8, step: 0.01, def: 2.0, label: 'Erosion Lacunarity',
    hint: 'Sets how much narrower each smaller level of branching gullies gets.',
  },
  {
    key: 'erosionDetail', group: 'erosion', type: 'float', min: 0.5, max: 3.0, step: 0.02, def: 1.5, label: 'Branching Detail',
    hint: 'Controls how readily gullies keep splitting into finer and finer branches.',
  },
  {
    key: 'erosionGullyWeight', group: 'erosion', type: 'float', min: 0.15, max: 1.0, step: 0.01, def: 0.50, label: 'Gully Weight',
    hint: 'Sets how pronounced the gullies are and how strongly they follow the downhill direction.',
  },
  {
    key: 'erosionRounding', group: 'erosion', type: 'float', min: 0.0, max: 0.50, step: 0.01, def: 0.10, label: 'Ridge Rounding',
    hint: 'Softens eroded ridge crests and gully bottoms so they look less knife-edged.',
  },
  {
    key: 'erosionCellScale', group: 'erosion', type: 'float', min: 0.45, max: 1.10, step: 0.01, def: 0.70, label: 'Phacelle Cell Scale',
    hint: 'Adjusts the spacing between neighbouring gullies.',
  },
  {
    key: 'erosionNormalization', group: 'erosion', type: 'float', min: 0.0, max: 0.85, step: 0.01, def: 0.50, label: 'Gully Normalization',
    hint: 'Evens out gully depth so faint and strong areas look more alike.',
  },

  // --- Laplacian curvature & shaping ---
  {
    key: 'plateauRim', group: 'curvature', type: 'float', min: 0.0, max: 1.0, step: 0.01, def: 0.0, label: 'Plateau / Canyon Rim',
    hint: 'Turns high ground into flat-topped plateaus with steep canyon walls dropping below them.',
  },
  {
    key: 'laplacianWeight', group: 'curvature', type: 'float', min: -1.5, max: 1.5, step: 0.01, def: 0.0, label: 'Laplacian Weight',
    hint: 'Positive values sharpen ridges and valleys, while negative values smooth and round them off.',
  },
  {
    key: 'laplacianStep', group: 'curvature', type: 'float', min: 0.002, max: 0.025, step: 0.001, def: 0.008, label: 'Laplacian Step',
    hint: 'Sets how big an area the sharpen/smooth effect looks at, so larger values affect broader shapes.',
  },
  {
    key: 'ridgeSharpness', group: 'curvature', type: 'float', min: 0.5, max: 4, step: 0.01, def: 1.0, label: 'Ridge Sharpness',
    hint: 'Makes peaks taller and pointier at higher values, or broader and fuller at lower values.',
  },
  {
    key: 'peakRounding', group: 'curvature', type: 'float', min: 0.0, max: 1.0, step: 0.01, def: 0.0, label: 'Peak Rounding',
    hint: 'Rounds off the highest, pointiest peaks into smooth domes without flattening the rest of the terrain.',
  },

  // --- Tone ---
  {
    key: 'contrast', group: 'tone', type: 'float', min: 0.5, max: 2.5, step: 0.01, def: 1.0, label: 'Contrast',
    hint: 'Increases or decreases the height difference between low ground and high ground.',
  },
  {
    key: 'bias', group: 'tone', type: 'float', min: -0.4, max: 0.4, step: 0.005, def: 0.0, label: 'Bias',
    hint: 'Raises or lowers the whole terrain, making it brighter or darker overall.',
  },
  {
    key: 'invert', group: 'tone', type: 'bool', min: 0, max: 1, step: 1, def: 0, label: 'Invert',
    hint: 'Flips the terrain upside down so peaks become valleys and valleys become peaks.',
  },

  // --- Display (genes, but display-only: do not affect fitness) ---
  {
    key: 'colorMode', group: 'display', type: 'enum', min: 0, max: 5, step: 1, def: 0,
    label: 'Color Mode',
    options: [
      'Height Grayscale',
      'Hypsometric',
      'Laplacian Curvature',
      'Normal Map',
      'Alpine & Drainage',
      'Erosion Ridge Map',
    ],
    hint: 'Changes how the terrain is coloured for viewing, without changing its shape.',
  },
  {
    key: 'displacementScale', group: 'display', type: 'float', min: 0.05, max: 0.6, step: 0.01, def: 0.28, label: '3D Displacement',
    hint: 'Sets how tall the terrain is drawn in the 3D Mesh view.',
  },
];

export const GENES = Object.fromEntries(SCHEMA.map((g) => [g.key, g]));

// Genes that only affect display, never height/fitness.
export const DISPLAY_GENES = ['colorMode', 'displacementScale'];

export function defaults() {
  const g = {};
  for (const def of SCHEMA) g[def.key] = def.def;
  return g;
}
