// WebGPU feature detection only.
// Babylon Lite's createEngine handles adapter/device/context creation.

export async function checkWebGPUSupport() {
    if (!navigator.gpu) {
        return { error: "WebGPU is not supported in this browser. Please use Chrome/Edge 113+ or a recent Firefox/Safari build." };
    }

    return { supported: true };
}
