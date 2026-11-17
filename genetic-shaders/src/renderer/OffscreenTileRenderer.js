import * as THREE from 'three';
import { FRAG_2D } from '../shaders/heightmap.frag.glsl.js';
import { VERT_2D } from '../shaders/heightmap.vert.glsl.js';
import { createUniforms, syncUniforms } from '../shaders/uniforms.js';
import { rgbaToLuminance } from '../matcher/ImageAnalyzer.js';
import { centerIndexFor, radialDistance } from '../ga/GeneticEngine.js';

const FRAME_BUDGET_MS = 8;
const CANVAS_SIZE = 512;

function tileSizeForGrid(gridSize) {
  if (gridSize <= 4) return 256;
  if (gridSize <= 6) return 192;
  return 128;
}

// Single shared WebGL context that renders every grid tile on a
// frame-budgeted queue, then blits results into lightweight 2D canvases.
// This avoids the browser's ~8-16 WebGL context cap at grids up to 9x9.
export class OffscreenTileRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(CANVAS_SIZE, CANVAS_SIZE, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = createUniforms();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT_2D,
      fragmentShader: FRAG_2D,
      uniforms: this.uniforms,
      extensions: { derivatives: true },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    this.tileSize = 256;
    this.queue = [];
    this.generation = 0;
    this.rafId = null;
    this._watchdog = null;
    this._pumpPending = false;
    this._targetCache = new Map();
    this._ctxCache = new WeakMap();
  }

  setGridSize(gridSize) {
    this.tileSize = tileSizeForGrid(gridSize);
    this.renderer.setSize(this.tileSize, this.tileSize, false);
  }

  // Enqueues a batch of {index, genotype, canvas} jobs. The center cell is
  // rendered first, then jobs spiral outward by radial distance.
  enqueueBatch(jobs, gridSize) {
    this.generation++;
    const gen = this.generation;
    const center = centerIndexFor(gridSize);
    this.queue = jobs
      .slice()
      .sort((a, b) => radialDistance(a.index, gridSize) - radialDistance(b.index, gridSize) ||
                      Math.abs(a.index - center) - Math.abs(b.index - center));
    this._schedule(gen);
  }

  // RAF throttles/pauses in background tabs; a setTimeout watchdog
  // guarantees the queue always drains.
  _schedule(gen) {
    if (this._pumpPending) return;
    this._pumpPending = true;
    const fire = (src) => {
      if (!this._pumpPending) return;
      this._pumpPending = false;
      if (src === 'raf' && this._watchdog !== null) {
        clearTimeout(this._watchdog);
        this._watchdog = null;
      }
      this.rafId = null;
      this._drain(gen);
    };
    this.rafId = requestAnimationFrame(() => fire('raf'));
    this._watchdog = setTimeout(() => fire('timeout'), 120);
  }

  _drain(gen) {
    const start = performance.now();
    while (this.queue.length && performance.now() - start < FRAME_BUDGET_MS) {
      const job = this.queue.shift();
      this.renderInto(job.genotype, job.canvas);
    }
    if (this.queue.length && gen === this.generation) {
      this._schedule(gen);
    }
  }

  renderInto(genotype, canvas) {
    let ctx = this._ctxCache.get(canvas);
    if (!ctx) {
      ctx = canvas.getContext('2d');
      this._ctxCache.set(canvas, ctx);
    }
    if (canvas.width !== this.tileSize) {
      canvas.width = this.tileSize;
      canvas.height = this.tileSize;
    }
    syncUniforms(this.uniforms, genotype);
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.renderer.domElement, 0, 0);
  }

  // Synchronous single-shot render into any 2D canvas at `size` px.
  renderToCanvas(genotype, canvas, size = 256) {
    this.renderer.setSize(size, size, false);
    syncUniforms(this.uniforms, genotype);
    this.renderer.render(this.scene, this.camera);
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = this._ctxCache.get(canvas) || canvas.getContext('2d');
    this._ctxCache.set(canvas, ctx);
    ctx.drawImage(this.renderer.domElement, 0, 0);
    // Restore tile size for subsequent queue work.
    this.renderer.setSize(this.tileSize, this.tileSize, false);
  }

  // Renders the height field (grayscale) into an offscreen target and reads
  // back normalized luminance for fitness evaluation.
  sampleLuminance(genotype, size) {
    let target = this._targetCache.get(size);
    if (!target) {
      target = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
      this._targetCache.set(size, target);
    }
    syncUniforms(this.uniforms, genotype);
    const prevColorMode = this.uniforms.uColorMode.value;
    this.uniforms.uColorMode.value = 0;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    const pixels = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    this.renderer.setRenderTarget(null);
    this.uniforms.uColorMode.value = prevColorMode;
    return rgbaToLuminance(pixels, size, true);
  }

  dispose() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this._watchdog !== null) clearTimeout(this._watchdog);
    for (const t of this._targetCache.values()) t.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
