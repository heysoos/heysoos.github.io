import { setGpuInfo, trackShaderError } from '../analytics';
export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

// One device per page: the gallery runs several thumbnail sims at once and
// each adapter/device request is main-thread work that showed up as a stutter.
// A lost device clears the cache so the next init asks for a fresh one.
let sharedDevice: Promise<GPUDevice | null> | null = null;

function getSharedDevice(): Promise<GPUDevice | null> {
  if (!sharedDevice) {
    sharedDevice = (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      try { setGpuInfo((adapter as unknown as { info?: GPUAdapterInfo }).info ?? null); } catch { /* not exposed */ }
      const device = await adapter.requestDevice();
      // Validation errors (bad pipelines, shader compile failures) surface here.
      device.addEventListener('uncapturederror', (e) => trackShaderError(String((e as GPUUncapturedErrorEvent).error?.message ?? 'GPU error')));
      device.lost.then((info) => {
        console.warn('WebGPU device lost:', info.message);
        sharedDevice = null;
      });
      return device;
    })();
    sharedDevice.catch(() => { sharedDevice = null; });
  }
  return sharedDevice;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext | null> {
  try {
    if (!navigator.gpu) return null;

    const device = await getSharedDevice();
    if (!device) return null;

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
