// Setup file to load terrain engine for testing

import { Noise } from '../src/noise.js';

// Create global instances for tests
global.noise = new Noise();
global.settings = {
    sharpness: 1.5,
    erosion: 3.5,
    vegetation: 6.0,
    micro: 0.8,
    zoom: 1.0,
    ridge: 1.5,
    sunAngle: 2.36,
    enableRange2: true,
    enableWarp: true,
    enableMediumDetail: true,
    enableFineDetail: true,
    enableErosion: true,
    enableMicroTexture: true,
    grayscale: false
};
