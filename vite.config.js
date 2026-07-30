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
                color: "color.html",
                colors: "colors.html",
                colours: "colours.html",
                terrain: "examples/tempterrain.html",
            },
        },
    },
});
