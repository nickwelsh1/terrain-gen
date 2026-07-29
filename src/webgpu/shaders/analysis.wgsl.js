// WGSL compute shader: normal/slope/aspect analysis
// Sobel pass over height buffer → normal map, slope, aspect.
// Outputs to three rgba8unorm textures.

import { N, FIXED_POINT_SCALE, CELL_SPACING_M } from "../constants.js";

export const ANALYSIS_SHADER = /* wgsl */`
const N : u32 = ${N}u;
const FIXED_SCALE : f32 = ${FIXED_POINT_SCALE}.0;
const CELL_M : f32 = ${CELL_SPACING_M.toFixed(4)};

@group(0) @binding(0) var<storage, read> heights: array<i32>;
@group(0) @binding(1) var<storage, read_write> normals: array<u32>;  // packed rgba8unorm
@group(0) @binding(2) var<storage, read_write> slopes: array<u32>;   // packed rgba8unorm (r=slope)
@group(0) @binding(3) var<storage, read_write> aspects: array<u32>;  // packed rgba8unorm (rg=aspect dir)

fn heightAt(x: i32, y: i32) -> f32 {
    let cx = clamp(x, 0, i32(N) - 1);
    let cy = clamp(y, 0, i32(N) - 1);
    return f32(heights[cy * i32(N) + cx]) / FIXED_SCALE;
}

fn packRGBA(r: f32, g: f32, b: f32, a: f32) -> u32 {
    let ri = u32(clamp(r, 0.0, 1.0) * 255.0);
    let gi = u32(clamp(g, 0.0, 1.0) * 255.0);
    let bi = u32(clamp(b, 0.0, 1.0) * 255.0);
    let ai = u32(clamp(a, 0.0, 1.0) * 255.0);
    return (ai << 24u) | (bi << 16u) | (gi << 8u) | ri;
}

@compute @workgroup_size(8, 8)
fn computeNormals(@builtin(global_invocation_id) gid: vec3u) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= i32(N) || y >= i32(N)) { return; }
    
    let idx = y * i32(N) + x;
    
    // Sobel operator for gradient
    let hL = heightAt(x - 1, y - 1);
    let hC = heightAt(x, y - 1);
    let hR = heightAt(x + 1, y - 1);
    let hLM = heightAt(x - 1, y);
    let hRM = heightAt(x + 1, y);
    let hLB = heightAt(x - 1, y + 1);
    let hCB = heightAt(x, y + 1);
    let hRB = heightAt(x + 1, y + 1);
    
    // Sobel X gradient
    let gx = (hL + 2.0 * hLM + hLB) - (hR + 2.0 * hRM + hRB);
    // Sobel Y gradient
    let gz = (hL + 2.0 * hC + hR) - (hLB + 2.0 * hCB + hRB);
    
    // Normal from gradient (scale by cell spacing)
    let dx = gx / (8.0 * CELL_M);
    let dz = gz / (8.0 * CELL_M);
    let dy = 1.0;
    let len = sqrt(dx * dx + dy * dy + dz * dz);
    
    let nx = -dx / len;
    let ny = dy / len;
    let nz = -dz / len;
    
    // Pack normal to [0,1] range
    normals[idx] = packRGBA(nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0);
    
    // Slope = angle from vertical = acos(ny) / (pi/2)
    let slope = acos(clamp(ny, -1.0, 1.0)) / 1.5707963;
    slopes[idx] = packRGBA(slope, 0.0, 0.0, 1.0);
    
    // Aspect = horizontal flow direction (opposite of gradient horizontal)
    let aspectLen = sqrt(dx * dx + dz * dz);
    if (aspectLen > 0.001) {
        let ax = -dx / aspectLen;
        let az = -dz / aspectLen;
        aspects[idx] = packRGBA(ax * 0.5 + 0.5, az * 0.5 + 0.5, 0.0, 1.0);
    } else {
        aspects[idx] = packRGBA(0.5, 0.5, 0.0, 1.0);
    }
}
`;
