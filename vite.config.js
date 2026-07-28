import { defineConfig } from "vite";

export default defineConfig({
    server: {
        open: "/webgpu.html",
    },
    build: {
        rollupOptions: {
            input: {
                main: "index.html",
                webgpu: "webgpu.html",
            },
        },
    },
});
