// Geometry for the solid sides of the terrain tile.
// Four vertical walls around the border plus a bottom cap, so the terrain reads
// as a slice cut out of the ground instead of a hollow shell.
//
// Top wall vertices are flagged with position.y = TOP_FLAG; the wall vertex
// shader replaces that with the terrain height sampled from the height buffer,
// which keeps the wall welded to the surface after erosion. Bottom vertices are
// flagged with 0 and land at -SCENE_BASE_DEPTH.

import { N, SCENE_AREA } from "./constants.js";

export const TOP_FLAG = 1;

export function buildSkirtGeometry() {
    const half = SCENE_AREA / 2;
    const step = SCENE_AREA / (N - 1);

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    // Grid cell (col, row) → world position and the UV convention used by the
    // ground mesh: gridX = uv.x * (N-1), gridY = (1 - uv.y) * (N-1).
    const addEdge = (cellAt, normal) => {
        const base = positions.length / 3;

        for (let i = 0; i < N; i++) {
            const [col, row] = cellAt(i);
            const x = -half + col * step;
            const z = half - row * step;
            const u = col / (N - 1);
            const v = 1 - row / (N - 1);

            positions.push(x, TOP_FLAG, z);
            normals.push(normal[0], normal[1], normal[2]);
            uvs.push(u, v);

            positions.push(x, 0, z);
            normals.push(normal[0], normal[1], normal[2]);
            uvs.push(u, v);
        }

        for (let i = 0; i < N - 1; i++) {
            const top0 = base + i * 2;
            const bottom0 = top0 + 1;
            const top1 = top0 + 2;
            const bottom1 = top0 + 3;
            indices.push(top0, bottom0, bottom1, top0, bottom1, top1);
        }
    };

    addEdge((i) => [i, 0], [0, 0, 1]); // north, z = +half
    addEdge((i) => [i, N - 1], [0, 0, -1]); // south, z = -half
    addEdge((i) => [0, i], [-1, 0, 0]); // west, x = -half
    addEdge((i) => [N - 1, i], [1, 0, 0]); // east, x = +half

    // Bottom cap — flat bedrock floor
    const capBase = positions.length / 3;
    const corners = [
        [-half, half],
        [half, half],
        [half, -half],
        [-half, -half],
    ];
    for (const [x, z] of corners) {
        positions.push(x, 0, z);
        normals.push(0, -1, 0);
        uvs.push(0, 0);
    }
    indices.push(capBase, capBase + 1, capBase + 2, capBase, capBase + 2, capBase + 3);

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs),
    };
}
