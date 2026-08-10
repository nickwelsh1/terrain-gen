// WebGPU feature detection only.
// Babylon Lite's createEngine handles adapter/device/context creation.

export async function checkWebGPUSupport() {
    if (!navigator.gpu) {
        return { error: "WebGPU is not supported in this browser. Please use Chrome/Edge 113+ or a recent Firefox/Safari build." };
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        return { error: "No suitable GPU adapter found. WebGPU requires a compatible GPU." };
    }

    return { supported: true };
}
