export interface PreviewController {
  pause(): void
  resume(): void
}

export async function createPreviewController(
  sim: string,
  canvas: HTMLCanvasElement,
): Promise<PreviewController | null> {
  if (sim === 'boids') {
    const [{ BoidsController }, { BOIDS_PRESETS }, { applyBoidsPreset }, { scaledHeroCount }] = await Promise.all([
      import('../../components/simulations/boids/boids-controller'),
      import('../../data/boids-presets'),
      import('../../lib/sim-page/boids-preset-apply'),
      import('../../lib/sim-page/hero-scale'),
    ])
    const ctrl = new BoidsController()
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    // Same preset as the home page, including its trails: the default is a
    // low-opacity bokeh that only reads once trails accumulate, so a single
    // trail-less frame of it was all but black. Count scales with card area.
    const preset = BOIDS_PRESETS.find(p => p.isDefault) ?? BOIDS_PRESETS[0]
    if (preset) await applyBoidsPreset(ctrl, preset)
    ctrl.params.numParticles = scaledHeroCount(ctrl.params.numParticles, canvas.clientWidth, canvas.clientHeight)
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
  if (sim === 'nca') {
    const [{ NCAController }, { NCA_PRESETS }] = await Promise.all([
      import('../../components/simulations/nca/nca-controller'),
      import('../../data/nca-presets'),
    ])
    const ctrl = new NCAController()
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    const preset = NCA_PRESETS.find(p => p.id === 'ca-vgg16-zebra') ?? NCA_PRESETS[0]
    if (preset) await ctrl.loadPreset(preset)
    return {
      pause: () => ctrl.stop(),
      resume: () => ctrl.start(),
    }
  }
  if (sim === 'field-boids') {
    const [{ FieldBoidsController }, { FIELD_BOIDS_PRESETS }] = await Promise.all([
      import('../../components/simulations/field-boids/field-boids-controller'),
      import('../../data/field-boids-presets'),
    ])
    const ctrl = new FieldBoidsController()
    ctrl.maxFieldSize = 512
    const ok = await ctrl.init(canvas)
    if (!ok) return null
    const preset = FIELD_BOIDS_PRESETS.find(p => p.isDefault) ?? FIELD_BOIDS_PRESETS[0]
    if (preset) ctrl.loadPreset(preset)
    ctrl.params.numParticles = Math.min(ctrl.params.numParticles, 100000)
    return {
      pause: () => ctrl.stop(),
      resume: () => ctrl.start(),
    }
  }
  return null
}
