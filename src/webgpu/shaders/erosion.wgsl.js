// WGSL compute shader: droplet-based hydraulic erosion
// Uses fixed-point atomics to avoid write races on the height buffer.
// Each thread simulates one droplet's full lifetime.

import {
    N,
    FIXED_POINT_SCALE,
    DROPLET_COUNT,
    WORKGROUP_SIZE,
} from "../constants.js";

export const EROSION_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const N_F : f32 = ${N}.0;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const DROPLET_COUNT : u32 = ${DROPLET_COUNT}u;

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

fn heightAt(x: f32, y: f32) -> f32 {
    // Bilinear interpolation of 4 neighboring cells
    let ix = clamp(u32(x), 0u, N - 2u);
    let iy = clamp(u32(y), 0u, N - 2u);
    let fx = clamp(x - f32(ix), 0.0, 1.0);
    let fy = clamp(y - f32(iy), 0.0, 1.0);
    
    let h00 = f32(atomicLoad(&heights[iy * N + ix])) / FIXED_SCALE;
    let h10 = f32(atomicLoad(&heights[iy * N + ix + 1u])) / FIXED_SCALE;
    let h01 = f32(atomicLoad(&heights[(iy + 1u) * N + ix])) / FIXED_SCALE;
    let h11 = f32(atomicLoad(&heights[(iy + 1u) * N + ix + 1u])) / FIXED_SCALE;
    
    return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

fn hardnessAt(x: f32, y: f32) -> f32 {
    let ix = clamp(u32(x), 0u, N - 2u);
    let iy = clamp(u32(y), 0u, N - 2u);
    let fx = clamp(x - f32(ix), 0.0, 1.0);
    let fy = clamp(y - f32(iy), 0.0, 1.0);
    
    let h00 = f32(hardness[iy * N + ix]) / FIXED_SCALE;
    let h10 = f32(hardness[iy * N + ix + 1u]) / FIXED_SCALE;
    let h01 = f32(hardness[(iy + 1u) * N + ix]) / FIXED_SCALE;
    let h11 = f32(hardness[(iy + 1u) * N + ix + 1u]) / FIXED_SCALE;
    
    return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

fn gradientAt(x: f32, y: f32) -> vec2f {
    let hL = heightAt(x - 1.0, y);
    let hR = heightAt(x + 1.0, y);
    let hU = heightAt(x, y - 1.0);
    let hD = heightAt(x, y + 1.0);
    return vec2f(hR - hL, hD - hU) * 0.5;
}

fn clampFixed(v: i32) -> i32 {
    return clamp(v, 0, i32(${(500 * FIXED_POINT_SCALE).toString()}));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn simulateDroplets(@builtin(global_invocation_id) gid: vec3u) {
    let id = gid.x;
    if (id >= DROPLET_COUNT) { return; }
    
    // Initialize droplet at random position
    let rx = hash(id * 2u, params.seed);
    let ry = hash(id * 2u + 1u, params.seed);
    
    var d: Droplet;
    d.pos = vec2f(rx * N_F, ry * N_F);
    d.dir = vec2f(0.0, 0.0);
    d.speed = 0.0;
    d.water = params.rainRate;
    d.sediment = 0.0;
    
    let maxSteps = u32(params.stepCount);
    let erosionMm = params.erosionRate;        // mm per step
    let depositionM3 = params.depositionRate;   // m³ per step
    let evapL = params.evaporation;             // L per step
    let capacityM3 = params.sedimentCapacity;   // m³
    let inertia = 0.05;
    let gravity = 4.0;
    let minWater = 0.01;
    
    for (var step: u32 = 0u; step < maxSteps; step = step + 1u) {
        if (d.water < minWater) { break; }
        
        let oldHeight = heightAt(d.pos.x, d.pos.y);
        let grad = gradientAt(d.pos.x, d.pos.y);
        
        // Update direction with inertia
        d.dir = d.dir * inertia - grad * (1.0 - inertia);
        let dirLen = length(d.dir);
        if (dirLen > 0.001) {
            d.dir = d.dir / dirLen;
        }
        
        // Update speed from gravity
        d.speed = d.speed * inertia + (1.0 - inertia) * gravity * length(grad);
        d.speed = max(d.speed, 0.0);
        
        // Move droplet
        let oldPos = d.pos;
        d.pos = d.pos + d.dir;
        
        // Check bounds — kill droplet if it leaves the grid
        if (d.pos.x < 0.0 || d.pos.x >= N_F || d.pos.y < 0.0 || d.pos.y >= N_F) {
            // Deposit remaining sediment at old position
            if (d.sediment > 0.0) {
                let depositM = d.sediment;  // meters of deposition
                let depositFixed = i32(depositM * FIXED_SCALE);
                let cellIdx = u32(clamp(oldPos.y, 0.0, N_F - 1.0)) * N + u32(clamp(oldPos.x, 0.0, N_F - 1.0));
                let oldVal = atomicLoad(&heights[cellIdx]);
                atomicStore(&heights[cellIdx], clampFixed(oldVal + depositFixed));
            }
            break;
        }
        
        let newHeight = heightAt(d.pos.x, d.pos.y);
        let deltaHeight = newHeight - oldHeight;
        
        // Sediment capacity based on speed, water, and slope
        let capacity = max(0.0, d.speed * d.water * max(0.0, -deltaHeight) * capacityM3);
        
        if (deltaHeight < 0.0) {
            // Downhill — erode material
            // Erosion scaled by slope, hardness (inverse), and erosion rate
            let slope = max(0.0, -deltaHeight);
            let hard = hardnessAt(d.pos.x, d.pos.y);
            let erodeAmount = erosionMm * 0.1 * slope * (1.0 - hard * 0.8);  // cm → m
            let actualErode = min(erodeAmount, d.water * 0.1);  // limited by water
            
            // Erode from old position (bilinear: distribute to 4 cells)
            let ix = u32(clamp(oldPos.x, 0.0, N_F - 1.0));
            let iy = u32(clamp(oldPos.y, 0.0, N_F - 1.0));
            let fx = clamp(oldPos.x - f32(ix), 0.0, 1.0);
            let fy = clamp(oldPos.y - f32(iy), 0.0, 1.0);
            
            let erodeFixed = i32(actualErode * FIXED_SCALE);
            let w00 = i32((1.0 - fx) * (1.0 - fy) * f32(erodeFixed));
            let w10 = i32(fx * (1.0 - fy) * f32(erodeFixed));
            let w01 = i32((1.0 - fx) * fy * f32(erodeFixed));
            let w11 = i32(fx * fy * f32(erodeFixed));
            
            atomicStore(&heights[iy * N + ix], clampFixed(atomicLoad(&heights[iy * N + ix]) - w00));
            atomicStore(&heights[iy * N + ix + 1u], clampFixed(atomicLoad(&heights[iy * N + ix + 1u]) - w10));
            atomicStore(&heights[(iy + 1u) * N + ix], clampFixed(atomicLoad(&heights[(iy + 1u) * N + ix]) - w01));
            atomicStore(&heights[(iy + 1u) * N + ix + 1u], clampFixed(atomicLoad(&heights[(iy + 1u) * N + ix + 1u]) - w11));
            
            d.sediment = d.sediment + actualErode;
        } else {
            // Uphill or flat — deposit sediment
            if (d.sediment > 0.0) {
                let excess = d.sediment - capacity;
                if (excess > 0.0) {
                    let depositAmount = min(excess, depositionM3);
                    d.sediment = d.sediment - depositAmount;
                    
                    // Deposit at new position (bilinear)
                    let ix = u32(clamp(d.pos.x, 0.0, N_F - 1.0));
                    let iy = u32(clamp(d.pos.y, 0.0, N_F - 1.0));
                    let fx = clamp(d.pos.x - f32(ix), 0.0, 1.0);
                    let fy = clamp(d.pos.y - f32(iy), 0.0, 1.0);
                    
                    let depositFixed = i32(depositAmount * FIXED_SCALE);
                    let w00 = i32((1.0 - fx) * (1.0 - fy) * f32(depositFixed));
                    let w10 = i32(fx * (1.0 - fy) * f32(depositFixed));
                    let w01 = i32((1.0 - fx) * fy * f32(depositFixed));
                    let w11 = i32(fx * fy * f32(depositFixed));
                    
                    atomicStore(&heights[iy * N + ix], clampFixed(atomicLoad(&heights[iy * N + ix]) + w00));
                    atomicStore(&heights[iy * N + ix + 1u], clampFixed(atomicLoad(&heights[iy * N + ix + 1u]) + w10));
                    atomicStore(&heights[(iy + 1u) * N + ix], clampFixed(atomicLoad(&heights[(iy + 1u) * N + ix]) + w01));
                    atomicStore(&heights[(iy + 1u) * N + ix + 1u], clampFixed(atomicLoad(&heights[(iy + 1u) * N + ix + 1u]) + w11));
                }
            }
        }
        
        // Evaporate water
        d.water = d.water - evapL;
        d.water = max(d.water, 0.0);
    }
    
    // Write final droplet state back (for potential debugging/visualization)
    droplets[id] = d;
}
`;
