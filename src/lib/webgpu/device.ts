export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext | null> {
  try {
    if (!navigator.gpu) return null;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;

    const device = await adapter.requestDevice();
    device.lost.then((info) => {
      console.warn('WebGPU device lost:', info.message);
    });

    const context = canvas.getContext('webgpu');
    if (!context) return null;

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    return { device, context, format, canvas };
  } catch (e) {
    console.error('WebGPU init failed:', e);
    return null;
  }
}
