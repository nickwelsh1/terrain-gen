/**
 * Noise generation module for terrain engine
 * Wraps simplex-noise with domain warping for geological features
 */

import { createNoise2D } from 'simplex-noise';

export class Noise {
    constructor() {
        this._noise2D = createNoise2D();
    }

    /**
     * 2D noise for base terrain structure
     */
    noise2D(x, y) {
        return this._noise2D(x, y);
    }

    /**
     * Domain warped noise for non-linear geological folds
     */
    fwNoise(x, y) {
        const xScale = 8.0;
        const yScale = 8.0;

        let wx = (x + 500.0) / xScale;
        let wy = (y + 500.0) / yScale;

        let n1 = this._noise2D(wx * 0.3, wy * 0.3);
        wx += n1;
        wy += n1;

        return this._noise2D(wx * 4.0, wy * 4.0) + n1 * 0.25;
    }

    /**
     * Domain warped noise for microtexture (lichen spots)
     */
    microNoise(x, y) {
        const xScale = 3.0;
        const yScale = 3.0;

        let wx = (x + 1234.0) / xScale;
        let wy = (y + 5678.0) / yScale;

        let n1 = this._noise2D(wx * 1.8, wy * 1.8);
        wx += n1;
        wy += n1;

        return this._noise2D(wx * 4.0, wy * 4.0) + n1 * 0.5;
    }
}
