import * as THREE from 'three';
import { FRAG_2D } from '../shaders/heightmap.frag.glsl.js';
import { VERT_2D } from '../shaders/heightmap.vert.glsl.js';
import { createUniforms, syncUniforms } from '../shaders/uniforms.js';

// One-shot high-resolution PNG heightmap export. Creates a temporary
// renderer at the requested size, renders once, downloads, disposes.
export function exportPng(genotype, size = 1024, filename = 'heightmap.png') {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(size, size, false);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = createUniforms();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_2D,
    fragmentShader: FRAG_2D,
    uniforms,
    extensions: { derivatives: true },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  syncUniforms(uniforms, genotype);
  renderer.render(scene, camera);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    quad.geometry.dispose();
    material.dispose();
    renderer.dispose();
  }, 'image/png');
}
