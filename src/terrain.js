/**
 * Core terrain generation functions
 */

/**
 * Ridge noise helper — produces sharp ridgelines from smooth noise
 */
function ridge(noiseFn, x, y) {
    return 1 - Math.abs(noiseFn(x, y));
}

/**
 * Initialize heightmap with ridge-based mountain ranges
 * Two ranges at different angles meet to create dramatic ridge lines
 */
export function initHeightmap(width, height, noise, settings) {
    const size = width * height;
    const heightmap = new Float64Array(size);

    const zoom = settings.zoom || 1.0;
    const ridgeSharpness = settings.ridge || 1.5;
    const scale = 0.008 * zoom;
    const enableRange2 = settings.enableRange2 !== false;
    const enableWarp = settings.enableWarp !== false;
    const enableMediumDetail = settings.enableMediumDetail !== false;
    const enableFineDetail = settings.enableFineDetail !== false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let idx = y * width + x;

            // Domain warp for geological folds
            let warp = enableWarp ? noise.fwNoise(x, y) * 0.3 : 0;

            // Range 1: primary mountain range
            let r1 = ridge(noise.noise2D.bind(noise), x * scale + warp, y * scale + warp);

            // Range 2: secondary range at different angle/scale — meets range 1
            let ridges;
            if (enableRange2) {
                let r2 = ridge(noise.noise2D.bind(noise),
                    x * scale * 1.3 + 100 + warp, y * scale * 0.7 + 200 + warp);
                ridges = Math.max(r1, r2) * 0.6 + r1 * r2 * 0.4;
            } else {
                ridges = r1;
            }

            // Apply ridge sharpness — higher values create sharper ridge lines
            ridges = Math.pow(ridges, ridgeSharpness);

            // Base elevation from ridges
            let heightVal = ridges * 400 - 50;

            // Medium detail layer
            if (enableMediumDetail) {
                let detail = noise.noise2D(x * 0.02, y * 0.02);
                heightVal += detail * 60;
            }

            // Fine detail layer
            if (enableFineDetail) {
                let fine = noise.noise2D(x * 0.05, y * 0.05);
                heightVal += fine * 20;
            }

            // Clamp for water level and basic bounds
            heightmap[idx] = Math.max(-30, Math.min(500, heightVal));
        }
    }

    return heightmap;
}

/**
 * Hydraulic erosion simulation - creates V-shaped ravines and riverbeds
 */
export function simulateErosion(heightmap, erosionStrength) {
    const workHeight = new Float64Array(heightmap);
    const width = workHeight.length / Math.sqrt(workHeight.length);
    const height = width;

    // Multiple passes for deeper erosion effect
    for (let pass = 0; pass < 8; pass++) {
        for (let y = 3; y < height - 3; y++) {
            for (let x = 3; x < width - 3; x++) {
                let idx = y * width + x;
                let curH = workHeight[idx];

                // Check surrounding neighbors for flow direction
                let down = workHeight[(y + 1) * width + x];
                let left = workHeight[y * width + x - 1];
                let right = workHeight[y * width + x + 1];
                let botLeft = workHeight[(y + 1) * width + x - 1];
                let botRight = workHeight[(y + 1) * width + x + 1];

                // Find lowest neighbor (water flows this way)
                let neighbors = [down, left, right, botLeft, botRight];
                let minH = Infinity;
                for (let n of neighbors) {
                    if (n < minH) minH = n;
                }

                // Water flows to lowest point
                if (curH > minH) {
                    let diff = curH - minH;

                    // Erode current pixel based on steepness and erosion strength
                    if (Math.random() < 0.12 + diff / 300) {
                        workHeight[idx] -= diff * (erosionStrength / 5);

                        // Deposit sediment to the receiving neighbor
                        let targetIdx = neighbors.indexOf(minH) === 0 ? (y + 1) * width + x :
                            neighbors.indexOf(minH) === 1 ? y * width + x - 1 :
                                neighbors.indexOf(minH) === 2 ? y * width + x + 1 :
                                    neighbors.indexOf(minH) === 3 ? (y + 1) * width + x - 1 :
                                        (y + 1) * width + x + 1;

                        workHeight[targetIdx] += diff * 0.25;
                    }
                }
            }
        }
    }

    // Update heightmap with eroded terrain
    for (let i = 0; i < heightmap.length; i++) {
        heightmap[i] = workHeight[i];
    }

    return heightmap;
}

/**
 * Calculate slope at each pixel using simple gradient approximation
 */
export function calculateSlopes(heightmap) {
    const width = Math.sqrt(heightmap.length);
    const height = width;
    const slopeMap = new Float64Array(heightmap.length);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let idx = y * width + x;

            let left = heightmap[y * width + x - 1];
            let right = heightmap[y * width + x + 1];
            let top = heightmap[(y - 1) * width + x];
            let bottom = heightmap[(y + 1) * width + x];

            // Diagonals for more accurate slope calculation
            let bl = heightmap[(y - 1) * width + (x - 1)];
            let br = heightmap[(y - 1) * width + (x + 1)];

            let hLeft = left;
            let hRight = right;
            let hTop = top;
            let hBottom = bottom;

            // Calculate gradient magnitude
            let dx = Math.abs(hRight - hLeft);
            let dy = Math.abs(hBottom - hTop);
            let diagonal = 1.414 * Math.max(dx, dy);

            slopeMap[idx] = (Math.sqrt(dy * dy + dx * dx) / (diagonal + 0.05));
        }
    }

    return slopeMap;
}

/**
 * Render terrain to pixels based on heightmap, slopes, and biomes
 */
export function render(heightmap, slopeMap, microNoiseFunc, settings) {
    const width = Math.sqrt(heightmap.length);
    const height = width;
    const size = width * height;
    const pixels = new Uint32Array(size);

    // Grayscale heightmap mode — pure black-to-white by actual terrain height
    if (settings.grayscale) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < size; i++) {
            if (heightmap[i] < min) min = heightmap[i];
            if (heightmap[i] > max) max = heightmap[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < size; i++) {
            let v = Math.round((heightmap[i] - min) / range * 255);
            pixels[i] = (255 << 24) | (v << 16) | (v << 8) | v;
        }
        return pixels;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let idx = y * width + x;

            let heightVal = heightmap[idx];
            let slope = slopeMap ? slopeMap[idx] : 0.2; // Fallback default slope

            // Get microtexture noise for lichen/porosity effects
            let microNoise = settings.enableMicroTexture !== false
                ? microNoiseFunc(x * 0.1, y * 0.1) * settings.micro
                : 0;

            let r, g, b, a = 255;

            // --- BIOME LOGIC - Transition from Dolomites style geology ---

            if (heightVal > 350) {
                // SNOW / ICE PEAKS - High altitude limestone
                r = 250 + microNoise * 10;
                g = 245 + microNoise * 8;
                b = 242;

                if (slope > 0.9) {
                    // Rock edges on snow faces
                    r -= 8; g -= 7;
                }

            } else if (heightVal > 200) {
                // HIGH ALPINE LATEX / GRANITE - Dolomite peaks
                r = 195 + microNoise * 35;
                g = 170 + microNoise * 28;
                b = 145 + microNoise * 22;

                if (slope > 0.6) {
                    // Steeper slopes show more weathered rock
                    r -= 3; g -= 2;
                }

            } else if (heightVal > 80 && settings.vegetation < 9) {
                // LOW ALPINE / SCREE FIELDS - Broken limestone deposits
                r = 175 + microNoise * 40;
                g = 155 + microNoise * 32;
                b = 125 + microNoise * 25;

                if (slope > 0.8) {
                    // Darker scree on steep slopes with shadows
                    r -= 6; g -= 5;
                }

            } else {
                // VEGETATION TERRAIN

                if (heightVal < 40 && slope < 0.3) {
                    // DENSE FOREST - Lowlands and valleys
                    r = 18 + microNoise * 25;
                    g = 42 + microNoise * 12;
                    b = 15 + microNoise * 6;

                    if (settings.vegetation > 7) {
                        // Darker, denser forest canopy
                        r -= 8; g -= 4; b -= 3;
                    }
                } else if (heightVal < 100) {
                    // ROLLING ALPINE PASTURES - Hay meadows
                    let mix = (heightVal < 60 ? 0.9 : 0.4); // More vibrant in valleys

                    r = 52 + microNoise * 45;
                    g = 82 + microNoise * 18 + (mix * 30);
                    b = 28 + microNoise * 12 + (mix * 8);

                    // Add autumnal touches to hillside grass
                    if (heightVal > 60 && heightVal < 140) {
                        r += microNoise * 50; // Reddish-brown on slopes
                        g -= microNoise * 3;
                    }
                } else {
                    // TRANITION ZONES - Rock and grass mix
                    r = 140 + microNoise * 30;
                    g = 125 + microNoise * 22;
                    b = 95 + microNoise * 18;
                }
            }

            // --- HILLSHADE LIGHTING ---
            // Compute surface normal from heightmap gradient
            let hLeft = x > 0 ? heightmap[idx - 1] : heightVal;
            let hRight = x < width - 1 ? heightmap[idx + 1] : heightVal;
            let hUp = y > 0 ? heightmap[idx - width] : heightVal;
            let hDown = y < height - 1 ? heightmap[idx + width] : heightVal;
            let gradX = hRight - hLeft;
            let gradY = hDown - hUp;

            // Light direction from sun angle (radians)
            let sunAngle = settings.sunAngle !== undefined ? settings.sunAngle : 2.36;
            let lightX = Math.cos(sunAngle);
            let lightY = Math.sin(sunAngle);
            let lightZ = 0.5;

            // Dot product of surface normal with light direction
            let normalLen = Math.sqrt(gradX * gradX + gradY * gradY + 1);
            let dot = (-gradX * lightX - gradY * lightY + lightZ) / normalLen;

            // Brightness factor: 0.5 (shadow) to 1.3 (lit)
            let shade = 0.5 + Math.max(0, dot) * 0.8;
            shade = Math.min(1.3, shade);

            r = Math.min(255, Math.max(0, r * shade));
            g = Math.min(255, Math.max(0, g * shade));
            b = Math.min(255, Math.max(0, b * shade));

            // Pack to Uint32 ABGR format for Canvas putImageData
            pixels[idx] = (a << 24) | (b << 16) | (g << 8) | r;
        }
    }

    return pixels;
}

/**
 * UI settings bindings - parse slider values to update settings state
 */
export function bindSettings(event, targetName) {
    const value = parseFloat(event.target.value);

    switch (targetName) {
        case 'sharpness':
            return { sharpness: value };
        case 'erosion':
            return { erosion: value };
        case 'vegetation':
            return { vegetation: value };
        case 'micro':
            return { micro: value };
        case 'zoom':
            return { zoom: value };
        case 'ridge':
            return { ridge: value };
        case 'sunAngle':
            return { sunAngle: value * Math.PI / 180 };
    }

    return {};
}
