import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FRAG_2D, FRAG_3D } from '../shaders/heightmap.frag.glsl.js';
import { VERT_2D, VERT_3D } from '../shaders/heightmap.vert.glsl.js';
import { createUniforms, syncUniforms } from '../shaders/uniforms.js';

const MESH_SEGMENTS = 160;

// Dedicated 60fps interactive preview: 2D fullscreen quad or a
// displaced 3D terrain mesh with OrbitControls. Renders on demand
// (uniform change / camera move) to keep the UI idle-cheap.
export class HeroPreviewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.mode = '2d';
    this.dirty = true;

    // --- 2D scene ---
    this.scene2d = new THREE.Scene();
    this.cam2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms2d = createUniforms();
    this.material2d = new THREE.ShaderMaterial({
      vertexShader: VERT_2D,
      fragmentShader: FRAG_2D,
      uniforms: this.uniforms2d,
      extensions: { derivatives: true },
      depthTest: false,
      depthWrite: false,
    });
    this.scene2d.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material2d));

    // --- 3D scene ---
    this.scene3d = new THREE.Scene();
    this.cam3d = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
    this.cam3d.position.set(1.55, 1.35, 1.55);
    this.uniforms3d = createUniforms();
    this.material3d = new THREE.ShaderMaterial({
      vertexShader: VERT_3D,
      fragmentShader: FRAG_3D,
      uniforms: this.uniforms3d,
      extensions: { derivatives: true },
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2, MESH_SEGMENTS, MESH_SEGMENTS),
      this.material3d
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.scene3d.add(this.mesh);
    this.scene3d.background = new THREE.Color(0x0a0d14);

    this.controls = new OrbitControls(this.cam3d, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxDistance = 6;
    this.controls.minDistance = 0.6;
    this.controls.enabled = false; // only active in 3D mode
    this.controls.addEventListener('change', () => { this.dirty = true; });

    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this._onResize();
    requestAnimationFrame(this._tick);
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === '3d';
    this.dirty = true;
  }

  setWireframe(on) {
    this.material3d.wireframe = !!on;
    this.dirty = true;
  }

  update(genotype) {
    syncUniforms(this.uniforms2d, genotype);
    syncUniforms(this.uniforms3d, genotype);
    this.dirty = true;
  }

  _onResize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = Math.max(64, el.clientWidth);
    const h = Math.max(64, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.cam3d.aspect = w / h;
    this.cam3d.updateProjectionMatrix();
    this.dirty = true;
  }

  _tick() {
    if (this.mode === '3d' && this.controls.enabled) {
      if (this.controls.update()) this.dirty = true;
    }
    if (this.dirty) {
      if (this.mode === '3d') {
        this.renderer.render(this.scene3d, this.cam3d);
      } else {
        this.renderer.render(this.scene2d, this.cam2d);
      }
      this.dirty = false;
    }
    requestAnimationFrame(this._tick);
  }

  dispose() {
    this._resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
