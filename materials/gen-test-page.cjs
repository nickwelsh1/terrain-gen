// Usage: node materials/gen-test-page.cjs <material.json> <out.html>
const fs = require('fs');
const src = process.argv[2] || 'materials/genetic-height.nme.json';
const dst = process.argv[3] || 'test-nme.html';
const mat = fs.readFileSync(src, 'utf8');
const html = `<!doctype html><html><body style="margin:0">
<canvas id="c" width="900" height="700"></canvas>
<script src="https://cdn.babylonjs.com/babylon.js"><\/script>
<script>
const json = ${mat};
const canvas = document.getElementById("c");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);
const camera = new BABYLON.ArcRotateCamera("cam", -1.2, 1.2, 5, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);
new BABYLON.HemisphericLight("l", new BABYLON.Vector3(0, 1, 0), scene);
try {
  const m = BABYLON.NodeMaterial.Parse(json, scene);
  const s = BABYLON.MeshBuilder.CreateSphere("s", { diameter: 2, segments: 64 }, scene);
  s.material = m;
  console.log("MATERIAL_PARSED_OK");
} catch (e) { console.error("PARSE_FAIL", e.message, e.stack); }
engine.runRenderLoop(() => scene.render());
<\/script></body></html>`;
fs.writeFileSync(dst, html);
console.log('written', dst);
