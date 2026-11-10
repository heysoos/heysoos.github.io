import { setGpuInfo, track, trackShaderError } from '../analytics';

/** Why the last initWebGPU returned null, for the sim-open analytics event:
 *  insecure (not a secure context), no-api (browser has no WebGPU), no-adapter
 *  (WebGPU exists but this GPU / driver is blocked), device-failed
 *  (requestDevice threw), no-context (canvas refused a webgpu context). */
export let webgpuFailure: { reason: string; message?: string } | null = null;
const fail = (reason: string, e?: unknown): null => {
  webgpuFailure = { reason, ...(e !== undefined ? { message: String((e as Error)?.message ?? e).slice(0, 200) } : {}) };
  return null;
};
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
      if (!adapter) return fail('no-adapter');
      try { setGpuInfo((adapter as unknown as { info?: GPUAdapterInfo }).info ?? null); } catch { /* not exposed */ }
      let device: GPUDevice;
      try { device = await adapter.requestDevice(); } catch (e) { return fail('device-failed', e); }
      // Validation errors (bad pipelines, shader compile failures) surface here.
      device.addEventListener('uncapturederror', (e) => trackShaderError(String((e as GPUUncapturedErrorEvent).error?.message ?? 'GPU error')));
      device.lost.then((info) => {
        console.warn('WebGPU device lost:', info.message);
        if (info.reason !== 'destroyed') track('gpu-device-lost', { message: String(info.message ?? '').slice(0, 200) });
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
    webgpuFailure = null;
    if (!window.isSecureContext) return fail('insecure');
    if (!navigator.gpu) return fail('no-api');

    const device = await getSharedDevice();
    if (!device) return webgpuFailure ? null : fail('no-adapter');

    const context = canvas.getContext('webgpu');
    if (!context) return fail('no-context');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    return { device, context, format, canvas };
  } catch (e) {
    console.error('WebGPU init failed:', e);
    return fail('device-failed', e);
  }
}
