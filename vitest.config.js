import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        environment: 'node',
        globals: true,
        setupFiles: ['./test/setup.js'],
    },
    resolve: {
        alias: {
            '@': '.',
        },
    },
});
