import { describe, it, expect, beforeAll } from 'vitest';
import { Noise } from '../../src/noise.js';

describe('Noise Module', () => {
    let noise;

    beforeAll(() => {
        noise = new Noise();
    });

    describe('Noise class instantiation', () => {
        it('should create a Noise instance without errors', () => {
            const n = new Noise();
            expect(n).toBeDefined();
            expect(typeof n.noise2D).toBe('function');
            expect(typeof n.fwNoise).toBe('function');
            expect(typeof n.microNoise).toBe('function');
        });
    });

    describe('fwNoise (domain warped) function', () => {
        it('should return a value within expected range for domain warped noise', () => {
            const result = noise.fwNoise(10, 20);
            expect(result).toBeDefined();
            expect(result >= -1.5 && result <= 1.5).toBe(true);
        });

        it('should handle zero coordinates', () => {
            const result = noise.fwNoise(0, 0);
            expect(typeof result).toBe('number');
            expect(isFinite(result)).toBe(true);
        });

        it('should return different values for different inputs', () => {
            const v1 = noise.fwNoise(100, 200);
            const v2 = noise.fwNoise(101, 201);
            expect(v1 !== v2).toBe(true);
        });
    });

    describe('microNoise (microtexture) function', () => {
        it('should return a value for microtexture noise', () => {
            const result = noise.microNoise(10, 20);
            expect(typeof result).toBe('number');
            expect(isFinite(result)).toBe(true);
        });

        it('should handle zero coordinates', () => {
            const result = noise.microNoise(0, 0);
            expect(typeof result).toBe('number');
            expect(isFinite(result)).toBe(true);
        });

        it('should return different values for different inputs', () => {
            const v1 = noise.microNoise(500, 600);
            const v2 = noise.microNoise(501, 601);
            expect(v1 !== v2).toBe(true);
        });
    });
});
