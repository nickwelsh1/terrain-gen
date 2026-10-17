// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APPS, isPageActive, getAppHref } from '../../src/app-launcher.js';

describe('App Launcher Module', () => {
    describe('APPS registry', () => {
        it('contains all internal and external apps', () => {
            expect(APPS.length).toBeGreaterThanOrEqual(2);
            const appIds = APPS.map(a => a.id);
            expect(appIds).toContain('index');
            expect(appIds).toContain('webgpu');
            expect(appIds).toContain('erodemountains');
            expect(appIds).toContain('dunes');
            expect(appIds).toContain('noisegallery');
            expect(appIds).toContain('colours');
            expect(appIds).toContain('tempterrain');
            expect(appIds).toContain('solargame');
            expect(appIds).toContain('exploregame');
            expect(appIds).toContain('sleep-doh');
            expect(appIds).toContain('webrtc-chat');
            expect(appIds).toContain('triangle-ships');
            expect(appIds).toContain('pixelart-ships');
            expect(appIds).toContain('create-splatters');
            expect(appIds).toContain('babylon-test-2');
        });

        it('has valid titles, paths, and icons for each app', () => {
            for (const app of APPS) {
                expect(app.title).toBeTruthy();
                expect(app.desc).toBeTruthy();
                expect(app.path).toBeTruthy();
                expect(app.icon).toContain('<svg');
            }
        });
    });

    describe('isPageActive', () => {
        it('matches root index.html', () => {
            expect(isPageActive('index.html', '/')).toBe(true);
            expect(isPageActive('index.html', '/index.html')).toBe(true);
            expect(isPageActive('index.html', '/terrain-gen/index.html')).toBe(true);
            expect(isPageActive('index.html', '/webgpu.html')).toBe(false);
        });

        it('matches webgpu.html', () => {
            expect(isPageActive('webgpu.html', '/webgpu.html')).toBe(true);
            expect(isPageActive('webgpu.html', '/index.html')).toBe(false);
        });

        it('matches erodemountains.html and dunes.html', () => {
            expect(isPageActive('erodemountains.html', '/erodemountains.html')).toBe(true);
            expect(isPageActive('dunes.html', '/dunes.html')).toBe(true);
        });

        it('matches noisegallery.html', () => {
            expect(isPageActive('noisegallery.html', '/noisegallery.html')).toBe(true);
        });

        it('matches colours.html and its aliases', () => {
            expect(isPageActive('colours.html', '/colours.html')).toBe(true);
            expect(isPageActive('colours.html', '/colors.html')).toBe(true);
            expect(isPageActive('colours.html', '/color.html')).toBe(true);
        });

        it('matches examples/tempterrain.html', () => {
            expect(isPageActive('examples/tempterrain.html', '/examples/tempterrain.html')).toBe(true);
            expect(isPageActive('examples/tempterrain.html', '/index.html')).toBe(false);
        });
    });

    describe('getAppHref', () => {
        it('resolves relative URLs when on root pages', () => {
            expect(getAppHref('index.html', '/index.html')).toBe('index.html');
            expect(getAppHref('webgpu.html', '/index.html')).toBe('webgpu.html');
            expect(getAppHref('examples/tempterrain.html', '/index.html')).toBe('examples/tempterrain.html');
        });

        it('resolves relative URLs when in examples subfolder', () => {
            expect(getAppHref('index.html', '/examples/tempterrain.html')).toBe('../index.html');
            expect(getAppHref('webgpu.html', '/examples/tempterrain.html')).toBe('../webgpu.html');
            expect(getAppHref('examples/tempterrain.html', '/examples/tempterrain.html')).toBe('tempterrain.html');
        });
    });

    describe('TerrainAppLauncher Web Component', () => {
        let launcher;

        beforeEach(() => {
            launcher = document.createElement('terrain-app-launcher');
            document.body.appendChild(launcher);
        });

        afterEach(() => {
            launcher.remove();
        });

        it('renders the waffle button and menu', () => {
            const button = launcher.shadowRoot.querySelector('.waffle-button');
            const menu = launcher.shadowRoot.querySelector('.waffle-menu');
            expect(button).toBeDefined();
            expect(menu).toBeDefined();
            expect(button.getAttribute('aria-expanded')).toBe('false');
        });

        it('renders a link for every app inside the menu', () => {
            const links = launcher.shadowRoot.querySelectorAll('.menu-item');
            expect(links.length).toBe(APPS.length);
        });

        it('toggles menu visibility on button click', () => {
            const button = launcher.shadowRoot.querySelector('.waffle-button');
            const menu = launcher.shadowRoot.querySelector('.waffle-menu');

            expect(menu.classList.contains('is-open')).toBe(false);
            button.click();
            expect(menu.classList.contains('is-open')).toBe(true);
            expect(button.getAttribute('aria-expanded')).toBe('true');

            button.click();
            expect(menu.classList.contains('is-open')).toBe(false);
            expect(button.getAttribute('aria-expanded')).toBe('false');
        });

        it('closes menu on Escape key', () => {
            const button = launcher.shadowRoot.querySelector('.waffle-button');
            const menu = launcher.shadowRoot.querySelector('.waffle-menu');

            button.click();
            expect(menu.classList.contains('is-open')).toBe(true);

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(menu.classList.contains('is-open')).toBe(false);
        });

        it('closes menu when clicking outside', () => {
            const button = launcher.shadowRoot.querySelector('.waffle-button');
            const menu = launcher.shadowRoot.querySelector('.waffle-menu');

            button.click();
            expect(menu.classList.contains('is-open')).toBe(true);

            document.body.click();
            expect(menu.classList.contains('is-open')).toBe(false);
        });
    });
});
