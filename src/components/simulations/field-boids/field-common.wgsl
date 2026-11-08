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
  gravity:          f32,  // 124 — acceleration magnitude
  gravityX:         f32,  // 128 — unit direction, screen space (y up)
  gravityY:         f32,  // 132
  bloom:            f32,  // 136
  longExposure:     f32,  // 140
  curve:            u32,  // 144
  tonemap:          u32,  // 148
  palette:          u32,  // 152
  pointSize:        f32,  // 156 — sprite diameter, canvas px
  canvasW:          f32,  // 160
  canvasH:          f32,  // 164
  pointShape:       u32,  // 168
  pad0:             f32,  // 172
  // Up to 4 fingers / mouse. [2i] = (x, y, strength, 0) in NDC, strength 0 =
  // inactive; [2i+1] = (dx, dy, 0, 0) pointer displacement per sim step, NDC.
  pointers:         array<vec4f, 8>,  // 176
  // View: zoom about (viewCx, viewCy) in world NDC. 1 = whole torus visible.
  viewZoom:         f32,  // 304
  viewCx:           f32,  // 308
  viewCy:           f32,  // 312
  pad1:             f32,  // 316
}                          // 320 bytes total

struct Particle {
  pos: vec2f,
  vel: vec2f,
}

// NDC position → field texture UV. Texture row 0 is clip y = +1, so y flips.
fn ndcToUv(p: vec2f) -> vec2f {
  return p * vec2f(0.5, -0.5) + vec2f(0.5);
}
fn uvToNdc(uv: vec2f) -> vec2f {
  return (uv - vec2f(0.5)) * vec2f(2.0, -2.0);
}
// Shortest torus offset, components in [-1, 1).
fn wrapDelta(d: vec2f) -> vec2f {
  return d - round(d * 0.5) * 2.0;
}
// Screen NDC -> world NDC (the field texture samples with repeat, so no wrap needed here).
fn screenToWorld(p: vec2f) -> vec2f {
  return vec2f(params.viewCx, params.viewCy) + p / params.viewZoom;
}
// World NDC -> screen NDC via the shortest torus path, so particles near the seam stay put.
fn worldToScreen(w: vec2f) -> vec2f {
  return wrapDelta(w - vec2f(params.viewCx, params.viewCy)) * params.viewZoom;
}
