// Pure JS 2D Radix-2 Cooley-Tukey FFT on square Float32Arrays (size = 2^k).
// Operates in place on paired real/imag arrays.

const REV_CACHE = new Map();
const ROOT_CACHE = new Map();

function bitReverseTable(n) {
  let table = REV_CACHE.get(n);
  if (table) return table;
  table = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    table[i] = r;
  }
  REV_CACHE.set(n, table);
  return table;
}

function rootsFor(n) {
  let roots = ROOT_CACHE.get(n);
  if (roots) return roots;
  roots = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
  for (let i = 0; i < n / 2; i++) {
    roots.cos[i] = Math.cos((-2 * Math.PI * i) / n);
    roots.sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  ROOT_CACHE.set(n, roots);
  return roots;
}

// In-place 1D FFT on a strided slice of re/im.
function fft1d(re, im, offset, stride, n) {
  const rev = bitReverseTable(n);
  const roots = rootsFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const ai = offset + i * stride;
      const aj = offset + j * stride;
      let t = re[ai]; re[ai] = re[aj]; re[aj] = t;
      t = im[ai]; im[ai] = im[aj]; im[aj] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const wr = roots.cos[j * step];
        const wi = roots.sin[j * step];
        const even = offset + (i + j) * stride;
        const odd = offset + (i + j + half) * stride;
        const tr = re[odd] * wr - im[odd] * wi;
        const ti = re[odd] * wi + im[odd] * wr;
        re[odd] = re[even] - tr;
        im[odd] = im[even] - ti;
        re[even] += tr;
        im[even] += ti;
      }
    }
  }
}

// Forward 2D FFT. `data` is a Float32Array of length size*size (row-major).
// Returns { re, im } Float32Arrays of the same length.
export function fft2d(data, size) {
  const n = size * size;
  const re = Float32Array.from(data);
  const im = new Float32Array(n);
  for (let y = 0; y < size; y++) fft1d(re, im, y * size, 1, size);
  for (let x = 0; x < size; x++) fft1d(re, im, x, size, size);
  return { re, im };
}

// Applies a separable Hann window to kill edge spectral leakage.
export function hannWindow(data, size) {
  const out = new Float32Array(data.length);
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = data[y * size + x] * w[x] * w[y];
    }
  }
  return out;
}

// Radially-averaged log power spectrum + directional wedge energies + 4-band
// linear RMS amplitude profile (Macro, Meso, Branching, Micro-bump).
// Returns { radial: Float32Array(bins), angular: Float32Array(wedges), bands: Float32Array(4) },
// each normalized to sum 1 (DC bin excluded).
export function powerSpectrumProfile(re, im, size, radialBins = 32, wedges = 8) {
  const half = size / 2;
  const radial = new Float64Array(radialBins);
  const radialCount = new Float64Array(radialBins);
  const angular = new Float64Array(wedges);
  const bands = new Float64Array(4);
  const maxR = half;
  const b1 = Math.max(2.5, maxR * 0.08);
  const b2 = Math.max(6.0, maxR * 0.22);
  const b3 = Math.max(14.0, maxR * 0.48);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Shift so DC sits at array center.
      const fx = x < half ? x : x - size;
      const fy = y < half ? y : y - size;
      const r = Math.hypot(fx, fy);
      if (r < 1 || r > maxR) continue;
      const power = re[y * size + x] ** 2 + im[y * size + x] ** 2;
      const amp = Math.sqrt(power);
      const lp = Math.log1p(power);
      const bin = Math.min(radialBins - 1, Math.floor((r / maxR) * radialBins));
      radial[bin] += lp;
      radialCount[bin]++;
      const angle = Math.atan2(fy, fx);
      const w = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * wedges) % wedges;
      angular[w] += lp;

      if (r <= b1) bands[0] += amp;
      else if (r <= b2) bands[1] += amp;
      else if (r <= b3) bands[2] += amp;
      else bands[3] += amp;
    }
  }

  const radialOut = new Float32Array(radialBins);
  let rSum = 0;
  for (let i = 0; i < radialBins; i++) {
    radialOut[i] = radialCount[i] > 0 ? radial[i] / radialCount[i] : 0;
    rSum += radialOut[i];
  }
  if (rSum > 0) for (let i = 0; i < radialBins; i++) radialOut[i] /= rSum;

  const angularOut = new Float32Array(wedges);
  let aSum = 0;
  for (let i = 0; i < wedges; i++) aSum += angular[i];
  if (aSum > 0) for (let i = 0; i < wedges; i++) angularOut[i] = angular[i] / aSum;

  const bandsOut = new Float32Array(4);
  let bSum = bands[0] + bands[1] + bands[2] + bands[3];
  if (bSum > 0) {
    for (let i = 0; i < 4; i++) bandsOut[i] = bands[i] / bSum;
  }

  return { radial: radialOut, angular: angularOut, bands: bandsOut };
}
