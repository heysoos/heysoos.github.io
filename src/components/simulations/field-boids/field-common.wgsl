// field-common.wgsl — shared declarations. The controller prepends this
// string to every field-boids shader module, so the uniform layout is
// declared exactly once. Byte offsets must match packUniforms() in
// field-boids-controller.ts.
struct Params {
  deltaTime:        f32,  // 0
  attractionRadius: f32,  // 4
  repulsionRadius:  f32,  // 8
  attraction:       f32,  // 12
  repulsion:        f32,  // 16
  alignment:        f32,  // 20
  friction:         f32,  // 24
  maxSpeed:         f32,  // 28
  numParticles:     u32,  // 32
  mouseX:           f32,  // 36
  mouseY:           f32,  // 40
  mouseActive:      f32,  // 44
  mouseRadius:      f32,  // 48
  coneAngle:        f32,  // 52
  aspect:           f32,  // 56  — canvas width / height
  tick:             u32,  // 60
  noise:            f32,  // 64
  memory:           f32,  // 68
  splatSize:        f32,  // 72  — gaussian sigma, field texels
  viewMode:         u32,  // 76  — 0 density, 1 flow, 2 points
  exposure:         f32,  // 80
  fieldW:           f32,  // 84
  fieldH:           f32,  // 88
  maxLod:           f32,  // 92  — mipLevelCount - 1
  colorR:           f32,  // 96
  colorG:           f32,  // 100
  colorB:           f32,  // 104
  bgR:              f32,  // 108
  bgG:              f32,  // 112
  bgB:              f32,  // 116
  pointAlpha:       f32,  // 120
  pad0:             f32,  // 124
}                          // 128 bytes total

struct Particle {
  pos: vec2f,
  vel: vec2f,
}

// NDC position → field texture UV. Texture row 0 is clip y = +1, so y flips.
fn ndcToUv(p: vec2f) -> vec2f {
  return p * vec2f(0.5, -0.5) + vec2f(0.5);
}
