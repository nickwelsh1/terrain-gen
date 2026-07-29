// WGSL compute shader: droplet-based hydraulic erosion
// Uses fixed-point atomics to avoid write races on the height buffer.
// Each thread simulates one droplet's full lifetime.

import {
    N,
    FIXED_POINT_SCALE,
    MAX_FIXED_POINT,
    CELL_SPACING_M,
    DROPLET_COUNT,
    WORKGROUP_SIZE,
    DROPLET_LIFETIME,
} from "../constants.js";

export const EROSION_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const N_F : f32 = ${N}.0;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const MAX_FIXED : i32 = ${MAX_FIXED_POINT};
const DROPLET_COUNT : u32 = ${DROPLET_COUNT}u;
const LIFETIME : u32 = ${DROPLET_LIFETIME}u;
const CELL_M : f32 = ${CELL_SPACING_M.toFixed(4)};
// Largest height change a single droplet step may apply. Tied to cell spacing so
// a step can never invert the local slope, which is what produced spikes on
// coarse grids where one cell spans a large drop.
const MAX_STEP_CHANGE : f32 = ${(CELL_SPACING_M * 0.25).toFixed(4)};

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> heights: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> hardness: array<i32>;
@group(0) @binding(3) var<storage, read_write> droplets: array<Droplet>;

struct SimParams {
    rainRate: f32,
    erosionRate: f32,
    depositionRate: f32,
    evaporation: f32,
    sedimentCapacity: f32,
    stepCount: f32,
    passFlags: u32,
    seed: f32,
    baseHeight: f32,
    batchSeed: f32,
};

struct Droplet {
    pos: vec2f,
    dir: vec2f,
    speed: f32,
    water: f32,
    sediment: f32,
};

// Hash for deterministic random
fn hash(idx: u32, seed: f32) -> f32 {
    var v: u32 = idx * 374761393u + u32(seed * 1000.0);
    v = (v ^ (v >> 13u)) * 1274126177u;
    return f32(v) / 4294967295.0;
}

// Clamp a sample position to the interior so the 2x2 bilinear footprint is
// always valid. Coordinates are clamped as floats first: u32(negative) is
// undefined behaviour in WGSL and produced garbage gradients along the edges.
fn cellOf(p: vec2f) -> vec2u {
    let c = clamp(p, vec2f(0.0, 0.0), vec2f(N_F - 2.0, N_F - 2.0));
    return vec2u(u32(c.x), u32(c.y));
}

fn fracOf(p: vec2f, cell: vec2u) -> vec2f {
    let c = clamp(p, vec2f(0.0, 0.0), vec2f(N_F - 2.0, N_F - 2.0));
    return clamp(c - vec2f(f32(cell.x), f32(cell.y)), vec2f(0.0, 0.0), vec2f(1.0, 1.0));
}

fn heightAt(x: f32, y: f32) -> f32 {
    // Bilinear interpolation of 4 neighboring cells
    let cell = cellOf(vec2f(x, y));
    let f = fracOf(vec2f(x, y), cell);
    let ix = cell.x;
    let iy = cell.y;
    
    let h00 = f32(atomicLoad(&heights[iy * N + ix])) / FIXED_SCALE;
    let h10 = f32(atomicLoad(&heights[iy * N + ix + 1u])) / FIXED_SCALE;
    let h01 = f32(atomicLoad(&heights[(iy + 1u) * N + ix])) / FIXED_SCALE;
    let h11 = f32(atomicLoad(&heights[(iy + 1u) * N + ix + 1u])) / FIXED_SCALE;
    
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

fn hardnessAt(x: f32, y: f32) -> f32 {
    let cell = cellOf(vec2f(x, y));
    let f = fracOf(vec2f(x, y), cell);
    let ix = cell.x;
    let iy = cell.y;
    
    let h00 = f32(hardness[iy * N + ix]) / FIXED_SCALE;
    let h10 = f32(hardness[iy * N + ix + 1u]) / FIXED_SCALE;
    let h01 = f32(hardness[(iy + 1u) * N + ix]) / FIXED_SCALE;
    let h11 = f32(hardness[(iy + 1u) * N + ix + 1u]) / FIXED_SCALE;
    
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

fn gradientAt(x: f32, y: f32) -> vec2f {
    let hL = heightAt(x - 1.0, y);
    let hR = heightAt(x + 1.0, y);
    let hU = heightAt(x, y - 1.0);
    let hD = heightAt(x, y + 1.0);
    return vec2f(hR - hL, hD - hU) * 0.5;
}

// Apply a signed height change atomically, then re-clamp into [0, MAX_FIXED].
// atomicAdd is required here: the previous load/store pair silently dropped
// concurrent droplet contributions to the same cell.
fn addFixed(idx: u32, delta: i32) {
    if (delta == 0) { return; }
    atomicAdd(&heights[idx], delta);
    atomicMax(&heights[idx], 0);
    atomicMin(&heights[idx], MAX_FIXED);
}

// Distribute a height change (in meters) over the 2x2 bilinear footprint.
fn addHeightBilinear(p: vec2f, amountM: f32) {
    if (amountM == 0.0) { return; }
    let cell = cellOf(p);
    let f = fracOf(p, cell);
    let ix = cell.x;
    let iy = cell.y;
    let amt = amountM * FIXED_SCALE;
    
    addFixed(iy * N + ix, i32(amt * (1.0 - f.x) * (1.0 - f.y)));
    addFixed(iy * N + ix + 1u, i32(amt * f.x * (1.0 - f.y)));
    addFixed((iy + 1u) * N + ix, i32(amt * (1.0 - f.x) * f.y));
    addFixed((iy + 1u) * N + ix + 1u, i32(amt * f.x * f.y));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn simulateDroplets(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= DROPLET_COUNT) { return; }
    
    // Initialize droplet at random position. batchSeed varies per dispatch so
    // repeated batches trace new paths instead of re-eroding identical tracks.
    let dropSeed = params.seed + params.batchSeed * 7.13;
    let rx = hash(id * 2u, dropSeed);
    let ry = hash(id * 2u + 1u, dropSeed);
    
    var d: Droplet;
    d.pos = vec2f(rx * N_F, ry * N_F);
    d.dir = vec2f(0.0, 0.0);
    d.speed = 0.0;
    d.water = params.rainRate;
    d.sediment = 0.0;
    
    // Rates act as per-step fractions of the capacity difference, which keeps
    // erosion bounded: a droplet can never remove more than it can carry, and
    // whatever it carries is deposited again further downhill.
    let erodeFrac = clamp(params.erosionRate * 0.1, 0.0, 1.0);
    let depositFrac = clamp(params.depositionRate, 0.0, 1.0);
    let evapFrac = clamp(params.evaporation, 0.0, 1.0);
    let capacityFactor = params.sedimentCapacity;
    let inertia = 0.05;
    let gravity = 4.0;
    let minWater = 0.01;
    let minCapacity = 0.001;
    
    for (var step: u32 = 0u; step < LIFETIME; step = step + 1u) {
        if (d.water < minWater) { break; }
        
        let oldPos = d.pos;
        let oldHeight = heightAt(oldPos.x, oldPos.y);
        let grad = gradientAt(oldPos.x, oldPos.y);
        
        // Update direction with inertia
        d.dir = d.dir * inertia - grad * (1.0 - inertia);
        let dirLen = length(d.dir);
        if (dirLen < 0.001) { break; }  // stuck in a flat spot
        d.dir = d.dir / dirLen;
        
        // Move droplet
        d.pos = d.pos + d.dir;
        
        // Check bounds — the droplet leaves the tile and carries its sediment
        // away with it. Depositing here instead built a raised rim along the
        // border, since every escaping droplet unloaded in the same edge cells.
        if (d.pos.x < 0.0 || d.pos.x >= N_F || d.pos.y < 0.0 || d.pos.y >= N_F) {
            d.sediment = 0.0;
            break;
        }
        
        let newHeight = heightAt(d.pos.x, d.pos.y);
        let deltaHeight = newHeight - oldHeight;
        
        // Work in dimensionless slope (rise over run), not raw metres. A metre
        // drop means something very different at 10 m spacing than at 2.5 m, and
        // using it directly made capacity (and therefore sediment load) scale
        // with cell size — huge loads on coarse grids, dumped as spikes.
        let slope = -deltaHeight / CELL_M;
        
        // How much sediment this droplet can carry at its current speed
        let capacity = max(slope * d.speed * d.water * capacityFactor, minCapacity);
        
        if (d.sediment > capacity || deltaHeight > 0.0) {
            // Over capacity, or moving uphill — deposit.
            // Uphill deposition is capped by deltaHeight so a droplet only fills
            // the pit it is sitting in rather than building a spike.
            var amount = (d.sediment - capacity) * depositFrac;
            if (deltaHeight > 0.0) {
                amount = min(deltaHeight, d.sediment);
            }
            amount = clamp(amount, 0.0, MAX_STEP_CHANGE);
            d.sediment = d.sediment - amount;
            addHeightBilinear(oldPos, amount);
        } else {
            // Under capacity and heading downhill — erode, but never more than
            // the remaining capacity, half the drop to the next cell, or the
            // per-step limit.
            let hard = hardnessAt(oldPos.x, oldPos.y);
            let softness = clamp(1.0 - hard * 0.8, 0.0, 1.0);
            let wanted = (capacity - d.sediment) * erodeFrac * softness;
            let eroded = clamp(min(wanted, -deltaHeight * 0.5), 0.0, MAX_STEP_CHANGE);
            d.sediment = d.sediment + eroded;
            addHeightBilinear(oldPos, -eroded);
        }
        
        // Speed from the slope it just descended; water evaporates as a fraction
        d.speed = sqrt(max(d.speed * d.speed + slope * gravity, 0.0));
        d.water = d.water * (1.0 - evapFrac);
    }
    
    // Any sediment still in transit is returned to the terrain, so a run does
    // not remove net mass from the landscape. Capped like any other step so a
    // dying droplet cannot drop its whole load into one cell as a spike.
    if (d.sediment > 0.0) {
        let amount = min(d.sediment, MAX_STEP_CHANGE);
        addHeightBilinear(d.pos, amount);
        d.sediment = d.sediment - amount;
    }
    
    // Write final droplet state back (for potential debugging/visualization)
    droplets[id] = d;
}
`;
