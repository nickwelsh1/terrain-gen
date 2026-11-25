import { generateStandaloneGLSL } from '../shaders/glslExporter.js';
import { exportPng } from '../renderer/PngExporter.js';
import { SCHEMA } from '../config/parameterSchema.js';

// Export modal with three tabs: GLSL source, PNG heightmap, raw genotype JSON.
export class ExportModalView {
  constructor(modalRoot) {
    this.root = modalRoot;
    this.genotype = null;
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="modal__dialog">
        <div class="modal__header">
          <span class="modal__title">Export Shader</span>
          <button class="modal__close" title="Close">✕</button>
        </div>
        <div class="modal__tabs">
          <button class="modal__tab modal__tab--active" data-tab="glsl">GLSL Code</button>
          <button class="modal__tab" data-tab="png">PNG Heightmap</button>
          <button class="modal__tab" data-tab="json">Genotype JSON</button>
        </div>
        <div class="modal__body">
          <div data-pane="glsl">
            <p class="text-xs text-dim mb-2">Self-contained Shadertoy-compatible fragment shader with constants baked in.</p>
            <pre class="modal__code" id="__glsl-code"></pre>
          </div>
          <div data-pane="png" class="hidden">
            <p class="text-xs text-dim mb-2">Render the active genotype to a high-resolution grayscale heightmap.</p>
            <div class="d-flex flex-wrap gap-2 items-center">
              <label class="field__label">Resolution</label>
              <select class="select" id="__png-size">
                <option value="512">512 × 512</option>
                <option value="1024" selected>1024 × 1024</option>
                <option value="2048">2048 × 2048</option>
              </select>
              <button class="btn btn--primary" id="__png-dl">Download PNG</button>
            </div>
          </div>
          <div data-pane="json" class="hidden">
            <p class="text-xs text-dim mb-2">Raw parameter array — re-importable via the favorites JSON format.</p>
            <pre class="modal__code" id="__json-code"></pre>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn" id="__copy">Copy to clipboard</button>
          <button class="btn btn--primary" id="__dl-file">Download .frag</button>
        </div>
      </div>`;

    this.root.querySelector('.modal__close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });

    this.panes = {};
    for (const pane of this.root.querySelectorAll('[data-pane]')) {
      this.panes[pane.dataset.pane] = pane;
    }
    this.tabs = {};
    for (const tab of this.root.querySelectorAll('.modal__tab')) {
      this.tabs[tab.dataset.tab] = tab;
      tab.addEventListener('click', () => this._showTab(tab.dataset.tab));
    }

    this.glslCode = this.root.querySelector('#__glsl-code');
    this.jsonCode = this.root.querySelector('#__json-code');
    this.pngSize = this.root.querySelector('#__png-size');
    this.btnCopy = this.root.querySelector('#__copy');
    this.btnDlFile = this.root.querySelector('#__dl-file');
    this.activeTab = 'glsl';

    this.btnCopy.addEventListener('click', () => {
      const text = this.activeTab === 'glsl' ? this.glslCode.textContent : this.jsonCode.textContent;
      navigator.clipboard.writeText(text).then(() => {
        this.btnCopy.textContent = 'Copied ✓';
        setTimeout(() => { this.btnCopy.textContent = 'Copy to clipboard'; }, 1200);
      });
    });

    this.btnDlFile.addEventListener('click', () => {
      if (this.activeTab === 'glsl') {
        this._download('shader.frag', this.glslCode.textContent, 'text/plain');
      } else if (this.activeTab === 'json') {
        this._download('genotype.json', this.jsonCode.textContent, 'application/json');
      }
    });

    this.root.querySelector('#__png-dl').addEventListener('click', () => {
      if (!this.genotype) return;
      exportPng(this.genotype, Number(this.pngSize.value), `heightmap-${this.pngSize.value}.png`);
    });
  }

  _download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  _showTab(name) {
    this.activeTab = name;
    for (const [k, pane] of Object.entries(this.panes)) {
      pane.classList.toggle('hidden', k !== name);
    }
    for (const [k, tab] of Object.entries(this.tabs)) {
      tab.classList.toggle('modal__tab--active', k === name);
    }
    const isPng = name === 'png';
    this.btnCopy.disabled = isPng;
    this.btnDlFile.disabled = isPng;
  }

  open(genotype) {
    this.genotype = genotype;
    this.glslCode.textContent = generateStandaloneGLSL(genotype);
    const genesView = {};
    for (const def of SCHEMA) genesView[def.key] = genotype.genes[def.key];
    this.jsonCode.textContent = JSON.stringify({ version: 1, genes: genesView }, null, 2);
    this._showTab('glsl');
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
  }
}
