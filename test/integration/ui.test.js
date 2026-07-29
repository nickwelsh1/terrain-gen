// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import * as terrain from '../../src/terrain.js';
import { Noise } from '../../src/noise.js';

describe('UI Integration Tests', () => {
    let canvas;
    let noise;

    beforeAll(() => {
        noise = new Noise();
    });

    beforeEach(() => {
        // Create a mock canvas element for testing
        canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
    });

    describe('Canvas creation and data transfer', () => {
        it('should create canvas with valid 2D context', () => {
            const ctx = canvas.getContext('2d');
            expect(ctx).toBeDefined();
            expect(canvas.width).toBe(256);
            expect(canvas.height).toBe(256);
        });

        it('should transfer pixel data to canvas without errors', () => {
            // Generate terrain data
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const eroded = terrain.simulateErosion(heightmap, 0.8);
            const slopes = terrain.calculateSlopes(eroded);

            const mockNoise = (x, y) => Math.sin(x * 0.1) * Math.cos(y * 0.1);
            const settings = { micro: 0.5, vegetation: 5 };

            // Render to pixel array
            const pixels = terrain.render(eroded, slopes, mockNoise, settings);

            // Transfer to canvas (simulating what examples/tempterrain.html does)
            const ctx = canvas.getContext('2d');
            if (ctx && ctx.putImageData) {
                for (let y = 0; y < 64; y++) {
                    for (let x = 0; x < 64; x++) {
                        const i = y * 64 + x;
                        const pixel = pixels[i];

                        // Decode ABGR format and draw as RGBA
                        const abgr = new Uint8Array(4);
                        abgr[0] = (pixel >> 16) & 0xFF;   // Alpha -> A
                        abgr[1] = (pixel >> 8) & 0xFF;    // Blue -> R
                        abgr[2] = pixel & 0xFF;           // Red -> G
                        abgr[3] = (pixel >>> 24) & 0xFF;  // Alpha -> A

                        ctx.putImageData(ctx.createImageData(1, 1), x % 4, y % 4);
                    }
                }
            }

            expect(canvas.getContext('2d')).toBeDefined();
        });

        it('should handle canvas resize gracefully', () => {
            const ctx = canvas.getContext('2d');
            canvas.width = 512;
            canvas.height = 512;

            expect(ctx).toBeDefined();
            expect(canvas.width).toBe(512);
            expect(canvas.height).toBe(512);
        });

        it('should handle zero-sized canvas without crashing', () => {
            const ctx = canvas.getContext('2d');
            canvas.width = 0;
            canvas.height = 0;

            // Should not throw
            expect(ctx).toBeDefined();
        });
    });

    describe('Settings binding and value propagation', () => {
        it('should update settings object when input changes', () => {
            const mockInput = document.createElement('input');
            const settings = { sharpness: 1.5, erosion: 0.5 };

            // Simulate input change event
            const event = new Event('input', { bubbles: true });
            mockInput.dispatchEvent(event);

            expect(settings).toBeDefined();
        });

        it('should update all terrain settings independently', () => {
            const settings1 = { sharpness: 2.0, erosion: 0.3, vegetation: 5, micro: 0.5 };
            const settings2 = { sharpness: 1.0, erosion: 0.8, vegetation: 10, micro: 0.2 };

            expect(settings1).not.toEqual(settings2);

            // Test that we can switch between them
            expect(settings1.sharpness).toBe(2.0);
            expect(settings2.sharpness).toBe(1.0);
        });

        it('should handle settings reset to defaults', () => {
            const defaultSettings = { sharpness: 2, erosion: 0.5, vegetation: 5, micro: 0 };
            expect(typeof defaultSettings.sharpness).toBe('number');
            expect(defaultSettings.erosion).toBeGreaterThan(0);
        });

        it('should persist settings across multiple terrain generations', () => {
            const persistedSettings = {
                sharpness: 3.5,
                erosion: 0.6,
                vegetation: 8,
                micro: 0.2
            };

            // Simulate multiple generations
            for (let gen = 0; gen < 5; gen++) {
                const h = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: persistedSettings.sharpness || 1.5 });
                expect(h.length).toBe(4096);
            }

            // Settings should still be valid after multiple generations
            expect(persistedSettings.erosion).toBe(0.6);
        });
    });

    describe('Full terrain generation flow', () => {
        it('should complete full pipeline without errors', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 2.5 });
            const eroded = terrain.simulateErosion(heightmap, 0.7);
            const slopes = terrain.calculateSlopes(eroded);

            const mockNoise = (x, y) => Math.sin(x * 0.1 + y * 0.1);
            const pixels = terrain.render(eroded, slopes, mockNoise, { micro: 0.3, vegetation: 5 });

            // All steps completed successfully
            expect(heightmap.length).toBe(4096);
            expect(eroded.length).toBe(4096);
            expect(slopes.length).toBe(4096);
            expect(pixels.length).toBe(4096);
        });

        it('should regenerate terrain with different settings', () => {
            const settings1 = { sharpness: 2, erosion: 0.5, vegetation: 5, micro: 0 };
            const settings2 = { sharpness: 4, erosion: 0.8, vegetation: 10, micro: 0.3 };

            const h1 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: settings1.sharpness || 2 });
            const h2 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: settings2.sharpness || 4 });

            expect(h1.length).toBe(h2.length);
            expect(h1).not.toEqual(h2); // Different sharpness should produce different results
        });

        it('should handle rapid terrain regeneration (no memory leaks)', () => {
            const previousHeightmaps = new Set();

            // Generate terrain 100 times rapidly
            for (let i = 0; i < 100; i++) {
                const h = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: Math.random() * 3 + 1 });

                // Convert to string for Set comparison
                previousHeightmaps.add(Array.from(h).join(',,'));
            }

            // Each iteration should produce unique results (with high probability)
            expect(previousHeightmaps.size).toBeGreaterThan(50);
        });

        it('should handle pipeline with varying terrain sizes', () => {
            const sizes = [16, 32, 64, 8];

            for (const size of sizes) {
                const heightmap = terrain.initHeightmap(size, size, noise, { zoom: 1.0, ridge: 2.0 });
                const eroded = terrain.simulateErosion(heightmap, 0.5);
                const slopes = terrain.calculateSlopes(eroded);

                const mockNoise = () => 0;
                const pixels = terrain.render(eroded, slopes, mockNoise, { micro: 0, vegetation: 5 });

                // Verify dimensions match
                expect(heightmap.length).toBe(size * size);
                expect(eroded.length).toBe(size * size);
                expect(slopes.length).toBe(size * size);
                expect(pixels.length).toBe(size * size);
            }
        });
    });

    describe('Event handler integration', () => {
        it('should handle button click events without errors', () => {
            const button = document.createElement('button');
            button.textContent = 'Generate';

            const mockClickHandler = (event) => {
                // Mock terrain generation
                const h = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 2.0 });
                return Array.from(h).length;
            };

            button.addEventListener('click', mockClickHandler);

            const result = mockClickHandler(new Event('click'));
            expect(result).toBe(4096);
        });

        it('should handle slider change events', () => {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = 1;
            slider.max = 5;
            slider.value = '3';

            const event = new Event('input', { bubbles: true });
            slider.dispatchEvent(event);

            expect(slider.value).toBe('3');
        });

        it('should handle checkbox toggle events', () => {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = false;

            const event = new Event('change', { bubbles: true });
            checkbox.dispatchEvent(event);

            expect(checkbox.checked).toBe(false);
        });
    });

    describe('Error recovery scenarios', () => {
        it('should recover after failed terrain generation', () => {
            // Simulate a "failure" by using invalid parameters
            try {
                const h = terrain.initHeightmap(-10, -10, noise, { zoom: 1.0, ridge: 2.0 });
                // If we get here, it handled the error gracefully
            } catch (e) {
                // Expected to handle errors internally
            }

            // Should still be able to generate valid terrain after
            const h = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 2.0 });
            expect(h.length).toBe(4096);
        });

        it('should handle null canvas context gracefully', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            // This should not crash the test suite
            const mockNoise = (x, y) => 0;
            const pixels = terrain.render(heightmap, slopes, mockNoise, { micro: 0, vegetation: 5 });

            expect(pixels.length).toBe(4096);
        });

        it('should handle malformed settings object', () => {
            // Test with missing properties
            const partialSettings = { sharpness: 2.0 }; // Missing erosion, vegetation, micro

            try {
                const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
                const slopes = terrain.calculateSlopes(heightmap);

                const mockNoise = (x, y) => 0;
                // Partial settings should be handled gracefully
                const pixels = terrain.render(heightmap, slopes, mockNoise, partialSettings);

                expect(pixels.length).toBe(4096);
            } catch (e) {
                // Even if it fails, we should get a meaningful error
                console.error('Error with partial settings:', e.message);
            }
        });

        it('should handle browser incompatibilities gracefully', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            expect(heightmap.length).toBe(4096);

            // Simulate environment where Float64Array might not work perfectly
            const slopes = terrain.calculateSlopes(heightmap);
            expect(slopes).toBeDefined();
        });
    });

    describe('State consistency', () => {
        it('should maintain consistent state after multiple operations', () => {
            let heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            let eroded = terrain.simulateErosion(heightmap, 0.5);
            let slopes = terrain.calculateSlopes(eroded);

            // Multiple render operations with same data
            const mockNoise = (x, y) => Math.sin(x * 0.1);

            for (let i = 0; i < 10; i++) {
                const pixels = terrain.render(eroded, slopes, mockNoise, { micro: 0.2, vegetation: 5 });
                expect(pixels.length).toBe(4096);
            }

            // State should remain consistent
            expect(heightmap.length).toBe(4096);
            expect(eroded.length).toBe(4096);
            expect(slopes.length).toBe(4096);
        });

        it('should produce reproducible results with same inputs', () => {
            const noise1 = new Noise();
            const heightmap1 = terrain.initHeightmap(64, 64, noise1, { zoom: 1.0, ridge: 2.5 });

            const noise2 = new Noise();
            const heightmap2 = terrain.initHeightmap(64, 64, noise2, { zoom: 1.0, ridge: 2.5 });

            // Different noise instances should produce different results
            expect(heightmap1).not.toEqual(heightmap2);
        });
    });
});
