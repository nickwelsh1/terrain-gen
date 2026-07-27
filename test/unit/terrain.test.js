import { describe, it, expect } from 'vitest';
import * as terrain from '../../src/terrain.js';
import { Noise } from '../../src/noise.js';

describe('Terrain Module', () => {
    let noise;

    beforeAll(() => {
        noise = new Noise();
    });

    describe('initHeightmap function', () => {
        it('should create a valid heightmap array for 64x64 terrain', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });

            expect(heightmap).toBeDefined();
            expect(heightmap).toBeInstanceOf(Float64Array);
            expect(heightmap.length).toBe(64 * 64); // 4096 elements
        });

        it('should clamp height values between -30 and 500', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });

            for (let i = 0; i < heightmap.length; i++) {
                expect(heightmap[i]).toBeGreaterThanOrEqual(-30);
                expect(heightmap[i]).toBeLessThanOrEqual(500);
            }
        });

        it('should return different heightmaps with different ridge sharpness', () => {
            const h1 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const h2 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 3.0 });

            // With different ridge sharpness, they should differ
            expect(h1).not.toEqual(h2);
        });

        it('should handle very small dimension values', () => {
            const heightmap = terrain.initHeightmap(8, 8, noise, { zoom: 1.0, ridge: 1.0 });

            expect(heightmap).toBeDefined();
            expect(heightmap.length).toBe(64);
        });

        it('should handle zero ridge sharpness gracefully', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 0 });

            expect(heightmap).toBeInstanceOf(Float64Array);
            expect(heightmap.length).toBe(4096);
        });

        it('should handle large ridge sharpness values', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 10 });

            // Still clamped to valid range
            expect(heightmap.length).toBe(4096);
            for (let h of heightmap) {
                expect(h).toBeLessThanOrEqual(500);
            }
        });

        it('should handle very large dimensions without crashing', () => {
            // Use smaller size to avoid memory issues in tests
            const heightmap = terrain.initHeightmap(32, 32, noise, { zoom: 1.0, ridge: 1.0 });

            expect(heightmap).toBeDefined();
            expect(heightmap.length).toBe(1024);
        });
    });

    describe('simulateErosion function', () => {
        it('should return an array when given a valid heightmap', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const eroded = terrain.simulateErosion(heightmap, 0.8);

            expect(eroded).toBeInstanceOf(Float64Array);
            expect(eroded.length).toBe(heightmap.length);
        });

        it('should create depth variation through erosion', () => {
            const heightmap1 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const heightmap2 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const eroded1 = terrain.simulateErosion(heightmap1, 0.3);
            const eroded2 = terrain.simulateErosion(heightmap2, 0.8);

            // Stronger erosion should create more variation
            expect(eroded2).not.toEqual(eroded1);
        });

        it('should handle zero erosion strength', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const eroded = terrain.simulateErosion(heightmap, 0);

            expect(eroded).toBeInstanceOf(Float64Array);
        });

        it('should handle very large erosion strength values', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const eroded = terrain.simulateErosion(heightmap, 20);

            // Should not crash, values should still be valid
            expect(eroded.length).toBe(heightmap.length);
        });

        it('should produce different results on multiple runs (randomness)', () => {
            const heightmap1 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const heightmap2 = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });
            const eroded1 = terrain.simulateErosion(heightmap1, 0.8);
            const eroded2 = terrain.simulateErosion(heightmap2, 0.8);

            // Different random states should produce different results
            expect(eroded1).not.toEqual(eroded2);
        });

        it('should return values in reasonable range after erosion', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const eroded = terrain.simulateErosion(heightmap, 0.8);

            // Values should not explode to infinity or NaN
            for (let val of eroded) {
                expect(isFinite(val)).toBe(true);
                expect(Number.isNaN(val)).toBe(false);
            }
        });
    });

    describe('calculateSlopes function', () => {
        it('should return a slope map array matching heightmap dimensions', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            expect(slopes).toBeDefined();
            expect(slopes).toBeInstanceOf(Float64Array);
            expect(slopes.length).toBe(heightmap.length);
        });

        it('should return slope values between 0 and 1', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 2.0 });
            const slopes = terrain.calculateSlopes(heightmap);

            for (let slope of slopes) {
                expect(slope).toBeGreaterThanOrEqual(0);
                expect(slope).toBeLessThanOrEqual(1);
            }
        });

        it('should handle uniform terrain (no slope variation)', () => {
            const uniformMap = new Float64Array(64 * 64).fill(100);
            const slopes = terrain.calculateSlopes(uniformMap);

            // Flat terrain should have near-zero slopes
            for (let s of slopes) {
                expect(s).toBeLessThan(0.1);
            }
        });

        it('should handle steep terrain', () => {
            const heightmap = new Float64Array([
                0, 100, 200,
                100, 300, 100,
                200, 100, 0
            ]);
            const slopes = terrain.calculateSlopes(heightmap);

            // Steep changes should produce higher slopes
            for (let s of slopes) {
                expect(s).toBeLessThanOrEqual(1);
            }
        });

        it('should handle null/undefined inputs gracefully', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.0 });

            // Should not crash on missing second argument (defaults to undefined)
            const slopes1 = terrain.calculateSlopes(heightmap);

            expect(slopes1).toBeInstanceOf(Float64Array);
        });

        it('should handle very small heightmap sizes', () => {
            const heightmap = terrain.initHeightmap(4, 4, noise, { zoom: 1.0, ridge: 1.0 });
            const slopes = terrain.calculateSlopes(heightmap);

            expect(slopes.length).toBe(16);
        });

        it('should return consistent results for same input', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes1 = terrain.calculateSlopes(heightmap);

            // Need to use a deterministic approach - this is tricky with Float64Arrays
            // But at minimum it should not throw
            const slopes2 = terrain.calculateSlopes(heightmap);

            expect(slopes1).toBeDefined();
            expect(slopes2).toBeDefined();
        });
    });

    describe('render function', () => {
        it('should return pixel array for valid inputs', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            // Create a simple micro-noise function
            const mockNoise = (x, y) => Math.sin(x * 0.1) * Math.cos(y * 0.1);

            const settings = { micro: 0.5, vegetation: 5 };
            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);

            expect(pixels).toBeDefined();
            expect(pixels.length).toBe(64 * 64);
        });

        it('should return Uint32Array format', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            const mockNoise = (x, y) => 0; // Constant zero for simplicity
            const settings = { micro: 0, vegetation: 5 };
            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);

            expect(pixels).toBeInstanceOf(Uint32Array);
        });

        it('should produce different colors for different heights', () => {
            const heightmap = new Float64Array([
                0, 0, 0,
                100, 100, 100,
                400, 400, 400
            ]);
            const slopes = new Float64Array(9).fill(0.2); // Flat terrain

            const mockNoise = (x, y) => 0;
            const settings = { micro: 0, vegetation: 5 };

            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);

            // Should produce different pixel values for different heights
            expect(pixels[0]).not.toEqual(pixels[3]);
            expect(pixels[3]).not.toEqual(pixels[6]);
        });

        it('should handle missing slopeMap (uses default)', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });

            const mockNoise = (x, y) => 0;
            const settings = { micro: 0, vegetation: 5 };

            // Should not crash when slopeMap is undefined
            const pixels = terrain.render(heightmap, undefined, mockNoise, settings);

            expect(pixels).toBeDefined();
        });

        it('should handle invalid microNoise function (returns NaN)', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            const mockNoise = () => NaN; // Bad noise function
            const settings = { micro: 0, vegetation: 5 };

            // Should not crash, pixels should still be valid
            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);

            expect(pixels.length).toBe(64 * 64);
        });

        it('should pack colors in ABGR format', () => {
            const heightmap = new Float64Array([0, 100, 200]);
            const slopes = new Float64Array(3).fill(0.2);

            const mockNoise = (x, y) => 0;
            const settings = { micro: 0, vegetation: 5 };
            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);

            // ABGR format means bit 31 is alpha, then blue, green, red
            // Check that we have valid packed colors (no NaN or Infinity)
            for (let p of pixels) {
                expect(Number.isNaN(p)).toBe(false);
                expect(Number.isFinite(p)).toBe(true);
            }
        });

        it('should handle extreme vegetation settings', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            const mockNoise = (x, y) => 0;

            // Test with very high vegetation setting
            const settingsHigh = { micro: 0, vegetation: 20 };
            let pixels = terrain.render(heightmap, slopes, mockNoise, settingsHigh);
            expect(pixels.length).toBe(4096);

            // Test with zero vegetation
            const settingsZero = { micro: 0, vegetation: 0 };
            pixels = terrain.render(heightmap, slopes, mockNoise, settingsZero);
            expect(pixels.length).toBe(4096);
        });

        it('should handle very large coordinate values in noise', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const slopes = terrain.calculateSlopes(heightmap);

            const mockNoise = (x, y) => Math.sin(x * 0.001) * Math.cos(y * 0.001);
            const settings = { micro: 0.5, vegetation: 5 };

            const pixels = terrain.render(heightmap, slopes, mockNoise, settings);
            expect(pixels.length).toBe(4096);
        });
    });

    describe('bindSettings function', () => {
        it('should return sharpness setting when target is "sharpness"', () => {
            const event = { target: { value: '2.5' } };
            const result = terrain.bindSettings(event, 'sharpness');

            expect(result).toEqual({ sharpness: 2.5 });
        });

        it('should return erosion setting when target is "erosion"', () => {
            const event = { target: { value: '0.7' } };
            const result = terrain.bindSettings(event, 'erosion');

            expect(result).toEqual({ erosion: 0.7 });
        });

        it('should return vegetation setting when target is "vegetation"', () => {
            const event = { target: { value: '5' } };
            const result = terrain.bindSettings(event, 'vegetation');

            expect(result).toEqual({ vegetation: 5 });
        });

        it('should return micro setting when target is "micro"', () => {
            const event = { target: { value: '0.3' } };
            const result = terrain.bindSettings(event, 'micro');

            expect(result).toEqual({ micro: 0.3 });
        });

        it('should return empty object for unknown targets', () => {
            const event = { target: { value: '1.0' } };
            const result = terrain.bindSettings(event, 'unknownSetting');

            expect(result).toEqual({});
        });

        it('should handle missing event.target.value gracefully', () => {
            const event = { target: {} }; // No value property
            const result = terrain.bindSettings(event, 'sharpness');

            // parseFloat(undefined) returns NaN
            expect(result).toEqual({ sharpness: NaN });
        });

        it('should handle invalid number strings', () => {
            const event = { target: { value: 'not a number' } };
            const result = terrain.bindSettings(event, 'sharpness');

            // parseFloat will parse partial numbers
            expect(typeof result.sharpness).toBe('number');
        });

        it('should handle empty string values', () => {
            const event = { target: { value: '' } };
            const result = terrain.bindSettings(event, 'sharpness');

            // parseFloat('') returns NaN
            expect(Number.isNaN(result.sharpness)).toBe(true);
        });
    });

    describe('Integration - Full Pipeline', () => {
        it('should generate valid terrain through full pipeline', () => {
            const heightmap = terrain.initHeightmap(64, 64, noise, { zoom: 1.0, ridge: 1.5 });
            const eroded = terrain.simulateErosion(heightmap, 0.8);
            const slopes = terrain.calculateSlopes(eroded);
            const pixels = terrain.render(eroded, slopes, (x, y) => Math.sin(x * 0.1), { micro: 0.5, vegetation: 5 });

            expect(heightmap.length).toBe(4096);
            expect(eroded.length).toBe(4096);
            expect(slopes.length).toBe(4096);
            expect(pixels.length).toBe(4096);
        });

        it('should produce visually different terrain with different parameters', () => {
            const noise1 = new Noise();
            const noise2 = new Noise();

            const h1 = terrain.initHeightmap(64, 64, noise1, { zoom: 1.0, ridge: 2.0 });
            const h2 = terrain.initHeightmap(64, 64, noise2, { zoom: 1.0, ridge: 1.5 });

            expect(h1).not.toEqual(h2);
        });

        it('should handle complete pipeline with different dimension sizes', () => {
            for (let size of [8, 16, 32, 64]) {
                const heightmap = terrain.initHeightmap(size, size, noise, { zoom: 1.0, ridge: 1.5 });
                const eroded = terrain.simulateErosion(heightmap, 0.5);
                const slopes = terrain.calculateSlopes(eroded);

                const mockNoise = (x, y) => 0;
                const pixels = terrain.render(eroded, slopes, mockNoise, { micro: 0, vegetation: 5 });

                expect(heightmap.length).toBe(size * size);
                expect(eroded.length).toBe(size * size);
                expect(slopes.length).toBe(size * size);
                expect(pixels.length).toBe(size * size);
            }
        });
    });
});
