// WGSL compute shaders for the Namib star-dune prototype.
//
// Two passes:
//  1. generateBase — macro landform in metres (f32):
//       Mode A/C: warped Voronoi crest network. Cell edges are knife-edge dune
//                 crests, cell interiors are flat pans, Voronoi vertices (where
//                 3+ crests meet) are boosted into star peaks. Each crest has a
//                 gentle windward side and a steep slip face sized from real
//                 slope angles. Optional smaller "generations" of the same
//                 network climb the flanks of the larger one (compound dunes).
//       Mode B:   smooth low-octave sand swell (analytic gradient); pass 2
//                 adds a very-low-frequency Phacelle mega-ridge octave first.
//  2. applyArms — Runevision-style stacked faded Phacelle stripes (see
//       src/webgpu/erosion/shaders/erosion.wgsl.js) aligned with the base
//       downslope direction, so crest lines radiate from dome summits and later
//       octaves branch off earlier ones. The cosine gully profile is replaced
//       by a sharp, wind-asymmetric dune crest profile. Then pans are flattened
//       and the result is written as fixed-point heights.

import { N, CELL_SPACING_M, FIXED_POINT_SCALE, MAX_HEIGHT_M, MAX_FIXED_POINT, PARAMS_STRUCT_WGSL, MODE_VORONOI, MODE_PHACELLE, MODE_HYBRID } from "../constants.js";

const PRELUDE = /* wgsl */`
const N : u32 = ${N}u;
const N_I : i32 = ${N};
const CELL_M : f32 = ${CELL_SPACING_M.toFixed(4)};
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_HEIGHT : f32 = ${MAX_HEIGHT_M}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const PI : f32 = 3.14159265358979;
const TAU : f32 = 6.28318530717959;
const MODE_VORONOI : u32 = ${MODE_VORONOI}u;
const MODE_PHACELLE : u32 = ${MODE_PHACELLE}u;
const MODE_HYBRID : u32 = ${MODE_HYBRID}u;

${PARAMS_STRUCT_WGSL}

@group(0) @binding(0) var<uniform> params: DuneParams;

fn clamp01(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn genMode() -> u32 {
    return u32(params.mode + 0.5);
}

fn windVec() -> vec2f {
    let r = params.windDirection * PI / 180.0;
    return vec2f(cos(r), sin(r));
}

// Per-seed domain offset; k decorrelates independent noise layers.
fn seedOffset(k: f32) -> vec2f {
    return vec2f(
        fract(params.seed * 0.1031 + k * 0.3719) * 211.0,
        fract(params.seed * 0.1737 + k * 0.6113) * 173.0
    );
}

fn hash22(x: vec2f) -> vec2f {
    var p3 = fract(vec3f(x.x, x.y, x.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return -1.0 + 2.0 * fract((p3.xx + p3.yz) * p3.zy);
}

fn hash12(x: vec2f) -> f32 {
    var p3 = fract(vec3f(x.x, x.y, x.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + vec3f(33.33, 33.33, 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

// Gradient noise returning value in x and analytical derivatives in yz.
fn noised(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = fract(p);

    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    let ga = hash22(i + vec2f(0.0, 0.0));
    let gb = hash22(i + vec2f(1.0, 0.0));
    let gc = hash22(i + vec2f(0.0, 1.0));
    let gd = hash22(i + vec2f(1.0, 1.0));

    let va = dot(ga, f - vec2f(0.0, 0.0));
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));

    let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
    let deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);

    return vec3f(value, deriv.x, deriv.y);
}

// Octave-rotated fBm of gradient noise, roughly in [-0.8, 0.8].
fn fbm(p: vec2f, octaves: i32) -> f32 {
    var sum = 0.0;
    var amp = 0.5;
    var q = p;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        sum = sum + noised(q).x * amp;
        q = vec2f(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.03 + vec2f(17.1, 9.3);
        amp = amp * 0.5;
    }
    return sum * 2.0;
}

// Low-frequency multiplier in [0.25, 1.25] that breaks up uniform dune height.
fn heightVary(pM: vec2f, k: f32) -> f32 {
    let n01 = clamp01(fbm(pM / max(params.domeSpacing * 0.6, 1.0) + seedOffset(k), 2) * 0.6 + 0.5);
    return mix(1.0, 0.25 + n01, params.heightVariation);
}

// Mode B base: smooth low-octave sand swell with exact analytic gradient
// (value, dh/dx, dh/dy in metres per metre). Kept deliberately smooth so the
// Phacelle arms on top follow long, coherent downslope directions.
fn smoothDomes(pM: vec2f) -> vec3f {
    let spacing = max(params.domeSpacing, 1.0);
    let q = pM / spacing + seedOffset(9.0);
    let n0 = noised(q);
    let q1 = vec2f(0.8 * q.x - 0.6 * q.y, 0.6 * q.x + 0.8 * q.y) * 2.03 + vec2f(17.1, 9.3);
    let n1 = noised(q1);
    // Chain rule back through the octave rotation + scale.
    let g1 = 2.03 * vec2f(0.8 * n1.y + 0.6 * n1.z, -0.6 * n1.y + 0.8 * n1.z);
    let v = (n0.x + params.domeDetail * n1.x) * 1.4;
    let dv = (n0.yz + params.domeDetail * g1) * 1.4 / spacing;
    let t = 0.5 + 0.5 * v + (params.domeCoverage - 0.5);
    if (t <= 0.0) { return vec3f(0.0); }
    return vec3f(params.duneHeight * t, params.duneHeight * 0.5 * dv);
}

fn pow_inv(t: f32, power: f32) -> f32 {
    return 1.0 - pow(1.0 - clamp01(t), max(power, 0.001));
}

fn ease_out(t: f32) -> f32 {
    let v = 1.0 - clamp01(t);
    return 1.0 - v * v;
}

fn safe_normalize(n: vec2f) -> vec2f {
    let l = length(n);
    if (l > 1e-10) { return n / l; }
    return vec2f(1.0, 0.0);
}

// Phacelle Noise (Runevision): 4x4 cell-blended phasor stripes aligned with
// normDir. Returns normalized (cos, sin) in xy and the side direction in zw.
fn phacelleNoise(p: vec2f, normDir: vec2f, freq: f32, normalization: f32) -> vec4f {
    let sideDir = normDir.yx * vec2f(-1.0, 1.0) * freq * TAU;
    let pInt = floor(p);
    let pFrac = fract(p);

    var phaseDir = vec2f(0.0, 0.0);
    var weightSum = 0.0;
    for (var i: i32 = -1; i <= 2; i = i + 1) {
        for (var j: i32 = -1; j <= 2; j = j + 1) {
            let gridOffset = vec2f(f32(i), f32(j));
            let randomOffset = hash22(pInt + gridOffset) * 0.5;
            let v = pFrac - gridOffset - randomOffset;
            let weight = max(0.0, exp(-dot(v, v) * 2.0) - 0.01111);
            weightSum = weightSum + weight;
            let waveInput = dot(v, sideDir);
            phaseDir = phaseDir + vec2f(cos(waveInput), sin(waveInput)) * weight;
        }
    }
    if (weightSum <= 1e-10) {
        return vec4f(1.0, 0.0, sideDir.x, sideDir.y);
    }
    let interpolated = phaseDir / weightSum;
    let magnitude = max(1.0 - normalization, length(interpolated));
    return vec4f(interpolated / magnitude, sideDir.x, sideDir.y);
}

// Sharp, wind-asymmetric crest profile from a stripe phase angle.
// phi = 0 is the crest; the trough is shifted toward the downwind side so the
// slip face is narrower (steeper) than the windward face. Returns [-1, 1].
fn duneRidge(phi: f32, sideN: vec2f, wind: vec2f, lambdaM: f32, roundingM: f32, sharpness: f32) -> f32 {
    let k = 0.34 * params.armAsymmetry * dot(sideN, wind);
    let u = fract(phi / TAU);
    let ut = clamp(0.5 - k, 0.12, 0.88);
    var x = 0.0;
    var sideM = 0.0;
    if (u < ut) {
        x = u / ut;
        sideM = ut * lambdaM;
    } else {
        x = (1.0 - u) / (1.0 - ut);
        sideM = (1.0 - ut) * lambdaM;
    }
    // Round the cusp over crestRounding metres so the brink doesn't alias into
    // pixel stair-steps (seen as saw-teeth at grazing view angles).
    let r = roundingM / max(sideM, 1.0);
    let xr = (sqrt(x * x + r * r) - r) / (sqrt(1.0 + r * r) - r);
    return pow(clamp01(1.0 - xr), sharpness) * 2.0 - 1.0;
}
`;

// -----------------------------------------------------------------------------
// Pass 1: base landform
// -----------------------------------------------------------------------------
export const DUNES_BASE_SHADER = /* wgsl */`
${PRELUDE}

// x = main landform (network level 0 / swell), y = smaller dune generations.
// Kept apart so the arms pass can steer by the smooth main landform only.
@group(0) @binding(1) var<storage, read_write> baseHeights: array<vec2f>;

struct Crest {
    h: f32,        // metres
    h01: f32,      // 0 = pan floor, 1 = on the crest
    lee: f32,      // 1 = on the slip-face side of the winning crest
    fill: f32,     // 1 = this cell is sand-filled (smaller dunes allowed in its pan)
};

fn cellPoint(id: vec2f, so: vec2f) -> vec2f {
    return 0.5 + 0.42 * hash22(id + so);
}

// World metres -> warped network space (cell units). Wind-aligned frame
// (x' = downwind) stretched along the wind so cells elongate into the linear
// trend seen in the Namib sand sea; low-frequency warp curves the crests.
fn networkSpace(pM: vec2f, spacingM: f32, so: vec2f) -> vec2f {
    let w0 = windVec();
    let stretch = max(params.netStretch, 0.5);
    let q = vec2f(dot(pM, w0) / stretch, dot(pM, vec2f(-w0.y, w0.x))) / spacingM;
    let wq = q * params.netWarpFreq + so * 0.37;
    return q + vec2f(fbm(wq, 3), fbm(wq + vec2f(41.3, 17.9), 3)) * params.netWarp + so;
}

// Warped Voronoi crest network. Crest lines are the (warped) Voronoi edges;
// each edge's cross-section is a power-curve ramp whose width is chosen so the
// slope right at the crest equals the windward / slip-face angle.
fn crestNetwork(pM: vec2f, spacingM: f32, heightM: f32, level: f32) -> Crest {
    let so = seedOffset(level * 3.0 + 1.0);
    let wind = vec2f(1.0, 0.0); // downwind in network space

    // Local Jacobian of the warp so edge distances convert to true metres
    // (the warp compresses/stretches space; without this slopes overshoot repose).
    let q = networkSpace(pM, spacingM, so);
    let jStep = spacingM * 0.05;
    let dqdx = (networkSpace(pM + vec2f(jStep, 0.0), spacingM, so) - networkSpace(pM - vec2f(jStep, 0.0), spacingM, so)) / (2.0 * jStep);
    let dqdy = (networkSpace(pM + vec2f(0.0, jStep), spacingM, so) - networkSpace(pM - vec2f(0.0, jStep), spacingM, so)) / (2.0 * jStep);

    let qi = floor(q);
    let qf = fract(q);

    // Pass 1: nearest feature point.
    var md = 1e9;
    var mg = vec2f(0.0);
    var mr = vec2f(0.0);
    for (var j: i32 = -1; j <= 1; j = j + 1) {
        for (var i: i32 = -1; i <= 1; i = i + 1) {
            let g = vec2f(f32(i), f32(j));
            let r = g + cellPoint(qi + g, so) - qf;
            let d = dot(r, r);
            if (d < md) {
                md = d;
                mr = r;
                mg = g;
            }
        }
    }
    let h1 = hash12(qi + mg + so * 1.7);

    // Single pass over the 5x5 neighbourhood (cell units):
    //  - e1: distance to the nearest bisector = the cell boundary.
    //    Continuous across every crest, so both sides meet at the same height.
    //  - softmax weights (by edge distance) blend each edge's windward/slip
    //    side, so flanks stay smooth where edges hand over.
    //  - F1..F3: distances to the 3 nearest feature points. F3 - F1 -> 0 only at
    //    a Voronoi vertex and is symmetric across edges -> star-peak factor J.
    let sigma = 0.04;
    var e1 = 1e9;
    var wSum = 0.0;
    var leeSum = 0.0;
    var gradSum = 0.0;
    let f1 = sqrt(md);
    var f2 = 1e9;
    var f3 = 1e9;
    for (var j: i32 = -2; j <= 2; j = j + 1) {
        for (var i: i32 = -2; i <= 2; i = i + 1) {
            let g = mg + vec2f(f32(i), f32(j));
            let id = qi + g;
            let r = g + cellPoint(id, so) - qf;
            let dr = r - mr;
            if (dot(dr, dr) < 1e-6) { continue; }
            let dist = length(r);
            f3 = select(min(f3, dist), f2, dist < f2);
            f2 = min(f2, dist);

            let n = normalize(dr);
            let e = max(dot(0.5 * (mr + r), n), 0.0);

            // Symmetric per-edge hashes so both sides of a crest agree.
            let hj = hash12(id + so * 1.7);
            let eh = hash12(vec2f(h1 + hj, h1 * hj) * 97.31);
            let eh2 = fract(eh * 13.17 + (h1 + hj) * 3.7);

            // The edge lies along +n from this pixel. If +n points downwind
            // the pixel is upwind of the crest (windward side), else lee side.
            var windSide = dot(n, wind);
            if (eh2 < params.crestReversal * 0.5) { windSide = -windSide; }
            let lee = smoothstep(-0.25, 0.25, -windSide);

            // Online softmin weighting relative to the running nearest edge.
            if (e < e1) {
                let rescale = select(exp(-(e1 - e) / sigma), 0.0, e1 > 1e8);
                wSum = wSum * rescale;
                leeSum = leeSum * rescale;
                gradSum = gradSum * rescale;
                e1 = e;
            }
            let w = exp(-(e - e1) / sigma);
            wSum = wSum + w;
            leeSum = leeSum + w * lee;
            gradSum = gradSum + w * length(vec2f(dot(dqdx, n), dot(dqdy, n)));
        }
    }
    let jr = max(params.junctionRadius, 0.01);
    let J = exp(-pow((f3 - f1) / jr, 2.0));
    let alongCrest = mix(1.0 - params.saddleDepth, 1.0 + params.junctionBoost, J);
    let lee = leeSum / max(wSum, 1e-6);
    // Crest height varies smoothly in world space (not per edge) so both sides
    // of every crest agree exactly -> no steps along the brink.
    let hv = clamp01(fbm(pM / spacingM * 1.3 + so * 0.53, 2) * 0.7 + 0.5);
    let edgeVar = mix(1.0, 0.3 + 0.7 * hv, params.edgeVariation);
    let crestH = heightM * edgeVar * alongCrest;

    // Edge distance in true metres: e1 / |d e1 / d pM| (softmax-blended so the
    // metric doesn't jump where the nearest edge hands over).
    let e1M = e1 / max(gradSum / max(wSum, 1e-6), 1e-7);

    // Cross-section: width chosen so the slope at the crest equals the
    // windward / slip-face angle; power curve eases into the pan floor.
    let tanS = tan(clamp(params.stossAngle, 3.0, 40.0) * PI / 180.0);
    let tanL = tan(clamp(params.leeAngle, 10.0, 40.0) * PI / 180.0);
    let p = mix(1.35, 1.08, lee);
    let widthM = p * crestH / mix(tanS, tanL, lee);
    // Slight crest rounding (metres) keeps knife crests from stair-stepping on the
    // grid. The network's brinks are wide and smooth, so they need only half of
    // what the narrow Phacelle arms need.
    let rr = params.crestRounding * 0.5;
    let eM = sqrt(e1M * e1M + rr * rr) - rr;
    let prof = pow(clamp01(1.0 - eM / max(widthM, 1.0)), p);

    var res: Crest;
    res.h = crestH * prof;
    res.h01 = prof;
    res.lee = lee;
    res.fill = select(0.0, 1.0, h1 < params.sandFill);
    return res;
}

// Where a smaller dune generation may sit on a larger one: on windward flanks
// and sand-filled pans, never on the crest itself or down the slip face.
fn childGate(c: Crest) -> f32 {
    let notCrest = 1.0 - smoothstep(0.72, 0.97, c.h01);
    let notSlip = 1.0 - 0.85 * c.lee * smoothstep(0.05, 0.35, c.h01);
    let onSand = max(smoothstep(0.02, 0.2, c.h01), c.fill);
    return notCrest * notSlip * onSand;
}

@compute @workgroup_size(8, 8)
fn generateBase(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= N || gid.y >= N) { return; }
    let idx = gid.y * N + gid.x;
    let pM = vec2f(f32(gid.x), f32(gid.y)) * CELL_M;

    var h = 0.0;
    var d = 0.0;
    if (genMode() == MODE_PHACELLE) {
        h = smoothDomes(pM).x;
    } else {
        var spacing = params.netSpacing;
        var height = params.duneHeight;
        let c0 = crestNetwork(pM, spacing, height, 0.0);
        h = c0.h;
        var gate = childGate(c0);
        let octaves = i32(params.netOctaves + 0.5);
        for (var i: i32 = 1; i < octaves; i = i + 1) {
            spacing = spacing / params.netLacunarity;
            height = height * params.netGain;
            let c = crestNetwork(pM, spacing, height, f32(i));
            let add = c.h * gate;
            h = h + add;
            d = d + add;
            gate = gate * childGate(c);
        }
    }
    baseHeights[idx] = vec2f(h - d, d);
}
`;

// -----------------------------------------------------------------------------
// Pass 2: Phacelle star arms + pan flattening + fixed-point output
// -----------------------------------------------------------------------------
export const DUNES_ARMS_SHADER = /* wgsl */`
${PRELUDE}

@group(0) @binding(1) var<storage, read> baseHeights: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> heights: array<i32>;
@group(0) @binding(3) var<storage, read_write> detail: array<f32>;

fn baseAt(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, N_I - 1);
    let cy = clamp(y, 0, N_I - 1);
    return baseHeights[u32(cy) * N + u32(cx)].x;
}

// Stacked faded Phacelle star arms (Runevision erosion filter structure).
// Mode B prepends a very-low-frequency mega-ridge octave (draa scale), so the
// arms ride on — and are steered by — a large Phacelle landform through the
// same continuous feed-forward slope (no finite differences, no saw-teeth).
// Returns x = height contribution, yz = final fed-forward slope direction
// (drives surface ripples so they are directed by the slopes they sit on).
fn starArms(pM: vec2f, hBase: f32, grad: vec2f, crestMask: f32) -> vec3f {
    let wind = windVec();
    let cellScale = max(params.armCellScale, 0.1);
    let tanL = tan(clamp(params.leeAngle, 10.0, 40.0) * PI / 180.0);
    let mega = genMode() == MODE_PHACELLE && params.megaHeight > 0.0;
    var freq = 1.0 / (max(select(params.armSpacing, params.megaSpacing, mega), 1.0) * cellScale);
    var amp = select(params.armHeight, params.megaHeight, mega);
    var sharp = params.armSharpness;
    var rounding = params.crestRounding;
    if (mega) {
        // Draa are broad and near-triangular: a low power curve keeps the
        // repose cap high, and ~3x crest rounding softens the brink.
        sharp = max(1.0, params.armSharpness * 0.55);
        rounding = params.crestRounding * 3.0;
    }

    let slopeLen = max(length(grad), 1e-6);
    let fadeTarget0 = clamp(hBase / max(params.duneHeight, 1.0) * 2.0 - 1.0, -1.0, 1.0);
    // The mega octave is an absolute landform layer (baseline 0): its crests
    // rise above the swell and its troughs flatten into pans, rather than
    // being clamped to the smooth swell envelope.
    var fadeTarget = select(fadeTarget0, 0.0, mega);

    // Arms need slope to exist; summits and pans fade to the base shape.
    var combiMask = ease_out(slopeLen * params.armOnset);
    // Slip faces of the base (crest network) already are the dune; keep them clean.
    combiMask = combiMask * (1.0 - params.slipProtect * smoothstep(0.2, 0.45, slopeLen));
    // Knife-edge base crests have no single downslope direction; keep arms off them.
    combiMask = combiMask * (1.0 - crestMask);

    var gullySlope = mix(grad, grad / slopeLen * 0.5, params.armAssumedSlope);

    var total = 0.0;
    let octaves = i32(params.armOctaves + 0.5) + select(0, 1, mega);
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let so = seedOffset(20.0 + f32(i));
        // Nyquist guard on the *narrow* (slip-face) side of the stripe: below
        // ~5 grid cells it aliases into saw-teeth, so fade the octave out.
        let k0 = 0.34 * params.armAsymmetry;
        let narrowM = (0.5 - k0) / (freq * cellScale);
        let nyquist = smoothstep(5.0 * CELL_M, 8.0 * CELL_M, narrowM);
        if (nyquist <= 0.0) { break; }
        let ph = phacelleNoise(pM * freq + so, safe_normalize(gullySlope), cellScale, params.armNormalization);
        // The stripe phase is undefined at phase defects (Y-junctions) where the
        // phasor magnitude collapses; fade the sharp profile back to the smooth
        // cosine there so the surface stays continuous.
        let env = smoothstep(0.35, 0.9, length(ph.xy));
        let lambda = 1.0 / (freq * cellScale);
        let phi = atan2(ph.y, ph.x);
        let sideN = safe_normalize(ph.zw);
        let ridge = mix(ph.x, duneRidge(phi, sideN, wind, lambda, rounding, sharp), env);

        // Cap each octave's relief so its slip face stays at or below repose
        // (max slope ~ sharpness * 2A / narrow side width), then vary it in space:
        // arms are usually capped, so without variation every arm is the same size.
        let a = min(amp, tanL * narrowM / (2.0 * max(sharp, 1.0))) * nyquist * heightVary(pM, 23.0 + f32(i) * 7.0);

        // The mega octave is not gated by swell slope — draa cover summits and
        // march across flats — so it gets a coverage floor instead.
        let octMask = select(combiMask, max(combiMask, params.megaCoverage), mega && i == 0);
        let faded = mix(fadeTarget, ridge, octMask);
        // Each octave adds relief relative to the surface it sits on (the
        // incoming fadeTarget), i.e. dunes stacked on dunes.
        total = total + a * (faded - fadeTarget);

        // Feed this octave's side slope forward so the next octave branches off it.
        // Uses the octave's true (continuous) slope rather than Runevision's
        // sign(): a hard sign flips the next octave's direction exactly on each
        // crest, and because Phacelle phase is measured from cell pivots up to
        // 1.5 cells away, that tiny rotation aliases into saw-teeth on brinks.
        // armBranching scales how strongly each octave steers the next: low
        // values keep finer arms parallel to the main ones (pattern-like),
        // high values give Runevision's dendritic branching. The mega octave
        // always steers fully so arms follow the draa flanks.
        let steer = select(params.armBranching, 1.0, mega && i == 0);
        gullySlope = gullySlope + ph.y * ph.zw * (-freq) * a * steer;

        // Stacked fading: this octave's crests/troughs restrict the next one.
        fadeTarget = faded;
        combiMask = pow_inv(combiMask, params.armDetail) * ease_out(abs(ph.y) * params.armOnsetOctave);
        // ...and keep finer octaves off this octave's slip face (the narrow side).
        let k = k0 * dot(sideN, wind);
        let u = fract(phi / TAU);
        let onNarrow = select((u > 0.5 - k), (u < 0.5 - k), (k > 0.0));
        combiMask = combiMask * (1.0 - params.slipProtect * smoothstep(0.02, 0.12, abs(k)) * select(0.0, 1.0, onNarrow) * env);

        if (mega && i == 0) {
            freq = 1.0 / (max(params.armSpacing, 1.0) * cellScale);
            amp = params.armHeight;
            sharp = params.armSharpness;
            rounding = params.crestRounding;
        } else {
            amp = amp * params.armGain;
            freq = freq * params.armLacunarity;
        }
    }

    return vec3f(total, gullySlope.x, gullySlope.y);
}

// Fine transverse bedforms: symmetric Phacelle stripes whose crests run
// perpendicular to the local slope/flow direction (fed forward from the dune
// stack), blended toward pure wind alignment. Masked to sand above the pan
// floor, faded off avalanche-steep slip faces, and Nyquist-guarded.
fn rippleLayer(pM: vec2f, feedDir: vec2f, h: f32) -> f32 {
    let lambda = max(params.rippleSpacing, 1.0);
    let flow = safe_normalize(mix(feedDir, windVec() * 0.08, params.rippleWind));
    let ph = phacelleNoise(pM / lambda + seedOffset(77.0), vec2f(-flow.y, flow.x), 1.0, 0.0);
    let env = smoothstep(0.2, 0.7, length(ph.xy));
    let onSand = smoothstep(params.panLevel * 0.5, params.panLevel * 0.5 + 25.0, h);
    let notSlip = 1.0 - smoothstep(0.5, 0.62, length(feedDir));
    let nyq = smoothstep(48.0, 96.0, lambda);
    return params.rippleHeight * ph.x * env * onSand * notSlip * nyq * heightVary(pM, 91.0);
}

@compute @workgroup_size(8, 8)
fn applyArms(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= N || gid.y >= N) { return; }
    let x = i32(gid.x);
    let y = i32(gid.y);
    let idx = gid.y * N + gid.x;
    let pM = vec2f(f32(gid.x), f32(gid.y)) * CELL_M;

    let b = baseHeights[idx];
    let hBase = b.x;
    var h = b.x + b.y;
    var d = b.y;

    // Local large-slope direction field: analytic for the swell, a wide
    // (~100 m) stencil over the main network otherwise. Arms consume it as the
    // first steering direction; ripples use the fed-forward result.
    var feedDir = vec2f(0.0);
    var crestMask = 0.0;
    if (genMode() == MODE_PHACELLE) {
        feedDir = smoothDomes(pM).yz;
    } else {
        let s = 6;
        feedDir = vec2f(
            baseAt(x + s, y) - baseAt(x - s, y),
            baseAt(x, y + s) - baseAt(x, y - s)
        ) / (2.0 * f32(s) * CELL_M);
        if (genMode() == MODE_HYBRID) {
            // Convexity (metres over the stencil): large only on sharp base crests.
            let convex = 4.0 * hBase - baseAt(x + s, y) - baseAt(x - s, y) - baseAt(x, y + s) - baseAt(x, y - s);
            crestMask = smoothstep(4.0, 16.0, convex);
        }
    }

    let armsOn = genMode() != MODE_VORONOI && (params.armHeight > 0.0 || (genMode() == MODE_PHACELLE && params.megaHeight > 0.0));
    if (armsOn) {
        let res = starArms(pM, hBase, feedDir, crestMask);
        h = h + res.x;
        d = res.x;
        feedDir = res.yz;
    }

    if (params.rippleHeight > 0.0) {
        let rip = rippleLayer(pM, feedDir, h);
        h = h + rip;
        d = d + rip;
    }

    // Pans: everything below panLevel becomes flat floor with a sharp dune toe.
    h = max(h - params.panLevel, 0.0);

    heights[idx] = clamp(i32(h * FIXED_SCALE), 0, MAX_FIXED);
    detail[idx] = d;
}
`;
