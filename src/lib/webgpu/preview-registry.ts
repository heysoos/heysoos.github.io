export interface PreviewController {
  pause(): void
  resume(): void
}

export async function createPreviewController(
  sim: string,
  canvas: HTMLCanvasElement,
): Promise<PreviewController | null> {
  if (sim === 'boids') {
    const { BoidsController } = await import(
      '../../components/simulations/boids/boids-controller'
    )
    const ctrl = new BoidsController()
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    ctrl.params.numParticles = 150
    ctrl.params.size = 0.018
    ctrl.trailsEnabled = false
    return {
      pause: () => ctrl.stop(),
      resume: () => ctrl.start(),
    }
  }
  if (sim === 'cppn') {
    const [{ CPPNController }, { CPPN_PRESETS }] = await Promise.all([
      import('../../components/simulations/cppn/cppn-controller'),
      import('../../data/cppn-presets'),
    ])
    const ctrl = new CPPNController()
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    if (CPPN_PRESETS.length > 0) await ctrl.loadPreset(CPPN_PRESETS[0])
    ctrl.maxResolution = 320
    return {
      pause: () => ctrl.stop(),
      resume: () => ctrl.start(),
    }
  }
  return null
}
