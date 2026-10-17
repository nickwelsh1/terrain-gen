/**
 * 9-dot grid icon (waffle) app launcher Web Component.
 * Provides a unified navigation menu across all terrain-gen pages and external projects.
 */

export const APPS = [
    {
        id: 'index',
        title: 'Mountain Heightmap',
        desc: 'FastNoiseLite 2D elevation pipeline',
        path: 'index.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,
    },
    {
        id: 'webgpu',
        title: 'WebGPU Erosion Simulator',
        desc: 'Real-time 3D GPU hydraulic erosion',
        path: 'webgpu.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
    },
    {
        id: 'erodemountains',
        title: 'Eroded Mountains',
        desc: 'GPU hydraulic & thermal terrain',
        path: 'erodemountains.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 20 7-13 4 6 3-3 6 10H2z"/><path d="M14 17h4"/><path d="M7 17h3"/></svg>`,
    },
    {
        id: 'dunes',
        title: 'Sand Dunes',
        desc: 'WebGPU wind & sand simulation',
        path: 'dunes.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18c3-4 6-6 10-6s7 4 10 4"/><path d="M2 12c3-4 7-4 10-1s6 2 10 0"/></svg>`,
    },
    {
        id: 'noisegallery',
        title: 'Noise Gallery',
        desc: 'Interactive noise & fractal reference',
        path: 'noisegallery.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    },
    {
        id: 'colours',
        title: 'Color Palettes',
        desc: 'Palette extractor & gradient tool',
        path: 'colours.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    },
    {
        id: 'tempterrain',
        title: 'Terrain Visualizer',
        desc: 'Dolomites biome 3D engine',
        path: 'examples/tempterrain.html',
        section: 'terrain',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    },
    {
        id: 'pose-capture',
        title: '2D Pose Capture',
        desc: 'motion & joint tracking',
        path: 'https://animate-csd.pages.dev',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="8" r="1.5"/><path d="m9 11 3 1.5 3-1.5"/><path d="M12 12.5V15"/><path d="m9 18 3-3 3 3"/></svg>`,
    },
    {
        id: 'solargame',
        title: 'Solar Game',
        desc: 'solargame.pages.dev',
        path: 'https://solargame.pages.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    },
    {
        id: 'exploregame',
        title: 'Explore Game',
        desc: 'exploregame.pages.dev',
        path: 'https://exploregame.pages.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    },
    {
        id: 'sleep-doh',
        title: 'Sleep Doh',
        desc: 'sleep-doh.pages.dev',
        path: 'https://sleep-doh.pages.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    },
    {
        id: 'webrtc-chat',
        title: 'WebRTC Chat',
        desc: 'webrtc-chat-67d.pages.dev',
        path: 'https://webrtc-chat-67d.pages.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    },
    {
        id: 'triangle-ships',
        title: 'Random Triangle Ships',
        desc: 'CodePen generative ships',
        path: 'https://es-d-97180453320261016-01a1337a-909e-7276-a2bf-50891d4d12f2.codepen.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 21 12 17 2 21 12 2"/></svg>`,
    },
    {
        id: 'pixelart-ships',
        title: 'Random Pixelart Ships',
        desc: 'CodePen pixelart generator',
        path: 'https://codepen.io/komakaze/full/eYrYpBq',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/><path d="M9 4h6v6H9z"/></svg>`,
    },
    {
        id: 'create-splatters',
        title: "Create Splatter's",
        desc: 'CodePen canvas splatter physics',
        path: 'https://es-d-97180453320261016-01a0c774-c944-7528-90af-8f1d1e8f7f0a.codepen.dev/',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 22v-4"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-4"/><path d="m19.07 4.93-2.83 2.83"/></svg>`,
    },
    {
        id: 'babylon-test-2',
        title: 'Babylon.js Test 2',
        desc: 'CodePen 3D rendering test',
        path: 'https://codepen.io/komakaze/full/qEZyJOV',
        section: 'projects',
        external: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    },
];

export function isPageActive(appPath, currentPathname = (typeof window !== 'undefined' ? window.location.pathname : '')) {
    if (appPath.startsWith('http://') || appPath.startsWith('https://')) {
        return false;
    }
    const cleanPath = currentPathname.replace(/\/$/, '/index.html');
    if (appPath === 'index.html') {
        return (
            cleanPath.endsWith('/index.html') ||
            cleanPath === '' ||
            cleanPath === '/' ||
            cleanPath.endsWith('terrain-gen/') ||
            cleanPath.endsWith('terrain-gen/index.html')
        );
    }
    if (appPath === 'colours.html') {
        return (
            cleanPath.endsWith('colours.html') ||
            cleanPath.endsWith('colors.html') ||
            cleanPath.endsWith('color.html')
        );
    }
    if (appPath === 'examples/tempterrain.html') {
        return cleanPath.endsWith('tempterrain.html');
    }
    return cleanPath.endsWith(appPath);
}

export function getAppHref(appPath, currentPathname = (typeof window !== 'undefined' ? window.location.pathname : '')) {
    if (appPath.startsWith('http://') || appPath.startsWith('https://')) {
        return appPath;
    }
    const inExamples = currentPathname.includes('/examples/');
    if (inExamples) {
        if (appPath.startsWith('examples/')) {
            return appPath.slice('examples/'.length);
        }
        return `../${appPath}`;
    }
    return appPath;
}

const TEMPLATE = `
<style>
:host {
    display: inline-block;
    position: relative;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.4;
    z-index: 500;
}

*, *::before, *::after {
    box-sizing: border-box;
}

.waffle-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    margin: 0;
    border: 1px solid var(--border-strong, hsla(0, 0%, 100%, 0.16));
    border-radius: 6px;
    background: hsla(0, 0%, 12%, 0.85);
    color: var(--accent, hsl(50, 100%, 67%));
    cursor: pointer;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease;
}

.waffle-button:hover {
    background: var(--surface-hover, hsl(0, 0%, 20%));
    border-color: var(--accent, hsl(50, 100%, 67%));
    box-shadow: 0 0 12px var(--accent-subtle, hsla(50, 100%, 67%, 0.2));
}

.waffle-button[aria-expanded="true"] {
    background: var(--surface-hover, hsl(0, 0%, 20%));
    border-color: var(--accent, hsl(50, 100%, 67%));
    box-shadow: 0 0 14px var(--accent-subtle, hsla(50, 100%, 67%, 0.25));
}

.waffle-button:focus-visible {
    outline: 2px solid var(--accent, hsl(50, 100%, 67%));
    outline-offset: 2px;
}

.waffle-icon {
    display: block;
    width: 20px;
    height: 20px;
}

.waffle-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 330px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: hsla(0, 0%, 11%, 0.96);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border-strong, hsla(0, 0%, 100%, 0.16));
    border-radius: 10px;
    padding: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px hsla(0, 0%, 100%, 0.05);
    display: none;
    flex-direction: column;
    gap: 3px;
    z-index: 1000;
}

.waffle-menu::-webkit-scrollbar {
    width: 6px;
}
.waffle-menu::-webkit-scrollbar-thumb {
    background: hsla(0, 0%, 100%, 0.2);
    border-radius: 3px;
}

.waffle-menu.is-open {
    display: flex;
    animation: waffleFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes waffleFadeIn {
    from {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 8px;
    border-bottom: 1px solid hsla(0, 0%, 100%, 0.08);
    margin-bottom: 4px;
}

.menu-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, hsl(0, 0%, 65%));
}

.menu-count {
    font-size: 0.68rem;
    color: var(--text-muted, hsl(0, 0%, 55%));
    background: hsla(0, 0%, 100%, 0.06);
    padding: 2px 6px;
    border-radius: 10px;
}

.menu-section-title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, hsl(0, 0%, 55%));
    padding: 8px 8px 4px;
    margin-top: 4px;
    border-top: 1px solid hsla(0, 0%, 100%, 0.08);
}

.menu-section-title:first-child {
    border-top: none;
    margin-top: 0;
    padding-top: 2px;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 7px;
    text-decoration: none;
    color: var(--text, hsl(0, 0%, 88%));
    border: 1px solid transparent;
    transition: background 0.15s ease, border-color 0.15s ease;
}

.menu-item:hover,
.menu-item:focus-visible {
    background: var(--surface-hover, hsl(0, 0%, 18%));
    border-color: hsla(0, 0%, 100%, 0.1);
    outline: none;
}

.menu-item.is-active {
    background: var(--accent-subtle, hsla(50, 100%, 67%, 0.12));
    border-color: var(--accent, hsl(50, 100%, 67%));
}

.item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: hsla(0, 0%, 100%, 0.05);
    color: var(--accent, hsl(50, 100%, 67%));
    flex-shrink: 0;
}

.menu-item:hover .item-icon {
    background: hsla(0, 0%, 100%, 0.09);
}

.menu-item.is-active .item-icon {
    background: hsla(0, 0%, 100%, 0.14);
}

.item-content {
    flex: 1;
    min-width: 0;
}

.item-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text, hsl(0, 0%, 92%));
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.menu-item.is-active .item-title {
    color: var(--accent, hsl(50, 100%, 67%));
}

.item-desc {
    font-size: 0.67rem;
    color: var(--text-muted, hsl(0, 0%, 60%));
    line-height: 1.2;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.item-badge {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--accent, hsl(50, 100%, 67%));
    color: hsl(0, 0%, 10%);
    flex-shrink: 0;
}

.item-arrow {
    font-size: 0.75rem;
    color: var(--text-muted, hsl(0, 0%, 45%));
    transition: transform 0.15s ease, color 0.15s ease;
    flex-shrink: 0;
}

.menu-item:hover .item-arrow {
    transform: translateX(2px);
    color: var(--accent, hsl(50, 100%, 67%));
}
</style>
<button class="waffle-button" type="button" aria-label="Applications menu" aria-haspopup="menu" aria-expanded="false" title="Applications">
    <svg class="waffle-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="4" r="2.2" />
        <circle cx="10" cy="4" r="2.2" />
        <circle cx="16" cy="4" r="2.2" />
        <circle cx="4" cy="10" r="2.2" />
        <circle cx="10" cy="10" r="2.2" />
        <circle cx="16" cy="10" r="2.2" />
        <circle cx="4" cy="16" r="2.2" />
        <circle cx="10" cy="16" r="2.2" />
        <circle cx="16" cy="16" r="2.2" />
    </svg>
</button>
<div class="waffle-menu" role="menu" aria-label="Applications">
    <div class="menu-header">
        <span class="menu-title">Applications</span>
        <span class="menu-count">${APPS.length} links</span>
    </div>
    <div class="menu-items"></div>
</div>
`;

export class TerrainAppLauncher extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.isOpen = false;
        this.onDocClick = this.handleDocumentClick.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);
    }

    connectedCallback() {
        this.render();
    }

    disconnectedCallback() {
        document.removeEventListener('click', this.onDocClick);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    render() {
        this.shadowRoot.innerHTML = TEMPLATE;
        this.buttonEl = this.shadowRoot.querySelector('.waffle-button');
        this.menuEl = this.shadowRoot.querySelector('.waffle-menu');
        this.itemsContainer = this.shadowRoot.querySelector('.menu-items');

        const currentPathname = typeof window !== 'undefined' ? window.location.pathname : '';

        const terrainApps = APPS.filter(a => a.section === 'terrain');
        const projectApps = APPS.filter(a => a.section === 'projects');

        const renderItem = (app) => {
            const active = isPageActive(app.path, currentPathname);
            const href = getAppHref(app.path, currentPathname);
            const targetAttr = app.external ? 'target="_blank" rel="noopener noreferrer"' : '';
            const arrow = app.external ? '↗' : '→';
            return `
                <a class="menu-item ${active ? 'is-active' : ''}" href="${href}" role="menuitem" ${active ? 'aria-current="page"' : ''} ${targetAttr}>
                    <div class="item-icon">${app.icon}</div>
                    <div class="item-content">
                        <div class="item-title">${app.title}</div>
                        <div class="item-desc">${app.desc}</div>
                    </div>
                    ${active ? '<span class="item-badge">Active</span>' : `<span class="item-arrow">${arrow}</span>`}
                </a>
            `;
        };

        let html = '';
        if (terrainApps.length > 0) {
            html += `<div class="menu-section-title">Terrain Apps</div>`;
            html += terrainApps.map(renderItem).join('');
        }
        if (projectApps.length > 0) {
            html += `<div class="menu-section-title">More Projects &amp; Demos</div>`;
            html += projectApps.map(renderItem).join('');
        }

        this.itemsContainer.innerHTML = html;

        this.buttonEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });

        this.menuEl.addEventListener('keydown', (e) => {
            this.handleMenuKeyDown(e);
        });
    }

    toggleMenu(force) {
        this.isOpen = typeof force === 'boolean' ? force : !this.isOpen;
        this.buttonEl.setAttribute('aria-expanded', String(this.isOpen));

        if (this.isOpen) {
            this.menuEl.classList.add('is-open');
            this.positionMenu();
            document.addEventListener('click', this.onDocClick);
            document.addEventListener('keydown', this.onKeyDown);

            // Focus the active item or first item
            const activeItem = this.shadowRoot.querySelector('.menu-item.is-active') || this.shadowRoot.querySelector('.menu-item');
            if (activeItem) {
                setTimeout(() => activeItem.focus(), 0);
            }
        } else {
            this.menuEl.classList.remove('is-open');
            document.removeEventListener('click', this.onDocClick);
            document.removeEventListener('keydown', this.onKeyDown);
        }
    }

    positionMenu() {
        if (typeof window === 'undefined') return;
        const margin = 8;
        const hostRect = this.getBoundingClientRect();
        const buttonRect = this.buttonEl.getBoundingClientRect();
        const menuWidth = this.menuEl.offsetWidth || 330;
        const menuLeft = Math.max(
            margin,
            Math.min(buttonRect.left, window.innerWidth - menuWidth - margin)
        );
        this.menuEl.style.left = `${menuLeft - hostRect.left}px`;
        this.menuEl.style.right = 'auto';
    }

    handleDocumentClick(e) {
        if (!this.contains(e.target) && !e.composedPath().includes(this)) {
            this.toggleMenu(false);
        }
    }

    handleKeyDown(e) {
        if (e.key === 'Escape' && this.isOpen) {
            e.preventDefault();
            this.toggleMenu(false);
            this.buttonEl.focus();
        }
    }

    handleMenuKeyDown(e) {
        const items = Array.from(this.shadowRoot.querySelectorAll('.menu-item'));
        const currentIndex = items.indexOf(this.shadowRoot.activeElement);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % items.length;
            items[nextIndex]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + items.length) % items.length;
            items[prevIndex]?.focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1]?.focus();
        }
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('terrain-app-launcher')) {
    customElements.define('terrain-app-launcher', TerrainAppLauncher);
}
