import{i as S}from"./device.Cw2v9yRX.js";import{r as y}from"./utils.DCtYZSmS.js";const v=`// field-common.wgsl — shared declarations. The controller prepends this\r
// string to every field-boids shader module, so the uniform layout is\r
// declared exactly once. Byte offsets must match packUniforms() in\r
// field-boids-controller.ts.\r
struct Params {\r
  deltaTime:        f32,  // 0\r
  attractionRadius: f32,  // 4\r
  repulsionRadius:  f32,  // 8\r
  attraction:       f32,  // 12\r
  repulsion:        f32,  // 16\r
  alignment:        f32,  // 20\r
  friction:         f32,  // 24\r
  maxSpeed:         f32,  // 28\r
  numParticles:     u32,  // 32\r
  mouseX:           f32,  // 36\r
  mouseY:           f32,  // 40\r
  mouseActive:      f32,  // 44\r
  mouseRadius:      f32,  // 48\r
  coneAngle:        f32,  // 52\r
  aspect:           f32,  // 56  — canvas width / height\r
  tick:             u32,  // 60\r
  noise:            f32,  // 64\r
  memory:           f32,  // 68\r
  splatSize:        f32,  // 72  — gaussian sigma, field texels\r
  viewMode:         u32,  // 76  — 0 density, 1 flow, 2 points\r
  exposure:         f32,  // 80\r
  fieldW:           f32,  // 84\r
  fieldH:           f32,  // 88\r
  maxLod:           f32,  // 92  — mipLevelCount - 1\r
  colorR:           f32,  // 96\r
  colorG:           f32,  // 100\r
  colorB:           f32,  // 104\r
  bgR:              f32,  // 108\r
  bgG:              f32,  // 112\r
  bgB:              f32,  // 116\r
  pointAlpha:       f32,  // 120\r
  gravity:          f32,  // 124 — acceleration magnitude\r
  gravityX:         f32,  // 128 — unit direction, screen space (y up)\r
  gravityY:         f32,  // 132\r
  bloom:            f32,  // 136\r
  longExposure:     f32,  // 140\r
  curve:            u32,  // 144\r
  tonemap:          u32,  // 148\r
  palette:          u32,  // 152\r
  pointSize:        f32,  // 156 — sprite diameter, canvas px\r
  canvasW:          f32,  // 160\r
  canvasH:          f32,  // 164\r
  pointShape:       u32,  // 168\r
  pad0:             f32,  // 172\r
  // Up to 4 fingers / mouse. [2i] = (x, y, strength, 0) in NDC, strength 0 =\r
  // inactive; [2i+1] = (dx, dy, 0, 0) pointer displacement per sim step, NDC.\r
  pointers:         array<vec4f, 8>,  // 176\r
}                          // 304 bytes total\r
\r
struct Particle {\r
  pos: vec2f,\r
  vel: vec2f,\r
}\r
\r
// NDC position → field texture UV. Texture row 0 is clip y = +1, so y flips.\r
fn ndcToUv(p: vec2f) -> vec2f {\r
  return p * vec2f(0.5, -0.5) + vec2f(0.5);\r
}\r
`,T=`// field-deposit.wgsl — one instanced quad per particle, additively blended\r
// into the field texture. Output (w, w·vx, w·vy, 0) where w is a normalised\r
// gaussian in texel units, so channel r integrates to one particle.\r
@group(0) @binding(0) var<uniform> params: Params;\r
@group(0) @binding(1) var<storage, read> particles: array<Particle>;\r
\r
struct DepositOut {\r
  @builtin(position) position: vec4f,\r
  @location(0) local: vec2f,   // offset from particle centre, texels\r
  @location(1) vel: vec2f,\r
}\r
\r
@vertex\r
fn depositVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DepositOut {\r
  var corners = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  let p = particles[ii];\r
  let corner = corners[vi];\r
  // Quad radius = 3 sigma. 2 NDC units span the whole texture.\r
  let radiusTexels = 3.0 * params.splatSize;\r
  let halfSize = vec2f(radiusTexels * 2.0 / params.fieldW, radiusTexels * 2.0 / params.fieldH);\r
  var out: DepositOut;\r
  out.position = vec4f(p.pos + corner * halfSize, 0.0, 1.0);\r
  out.local = corner * radiusTexels;\r
  out.vel = p.vel;\r
  return out;\r
}\r
\r
@fragment\r
fn depositFrag(@location(0) local: vec2f, @location(1) vel: vec2f) -> @location(0) vec4f {\r
  let s2 = params.splatSize * params.splatSize;\r
  let w = exp(-dot(local, local) / (2.0 * s2)) / (6.2831853 * s2);\r
  return vec4f(w, w * vel.x, w * vel.y, 0.0);\r
}\r
`,F=`// field-view.wgsl — fullscreen passes (decay, mip downsample, field display)\r
// and the raw-points display. All share one bind group layout; passes that\r
// don't use a binding still get one bound.\r
@group(0) @binding(0) var<uniform> params: Params;\r
@group(0) @binding(1) var fieldSampler: sampler;\r
@group(0) @binding(2) var fieldTex: texture_2d<f32>;\r
@group(0) @binding(3) var<storage, read> particles: array<Particle>;\r
\r
struct QuadOut {\r
  @builtin(position) position: vec4f,\r
  @location(0) uv: vec2f,\r
}\r
\r
@vertex\r
fn quadVert(@builtin(vertex_index) vi: u32) -> QuadOut {\r
  var pos = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  var out: QuadOut;\r
  out.position = vec4f(pos[vi], 0.0, 1.0);\r
  out.uv = ndcToUv(pos[vi]);\r
  return out;\r
}\r
\r
// Decay: dst = src × memory. Bound texture is the PREVIOUS frame's field.\r
@fragment\r
fn decayFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  return textureSampleLevel(fieldTex, fieldSampler, uv, 0.0) * params.memory;\r
}\r
\r
// Downsample: bound view is one mip level; the render target is the next.\r
// A linear sample at the destination texel centre is the 2×2 box mean.\r
@fragment\r
fn downsampleFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  return textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);\r
}\r
\r
fn hsv2rgb(c: vec3f) -> vec3f {\r
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\r
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);\r
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);\r
}\r
\r
// Field display. viewMode 0: accent tint by density. viewMode 1: hue by the\r
// direction of the mean velocity, saturation by its magnitude.\r
@fragment\r
fn fieldFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  let f = textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);\r
  let bright = 1.0 - exp(-max(f.r, 0.0) * params.exposure);\r
  let bg = vec3f(params.bgR, params.bgG, params.bgB);\r
  var tint = vec3f(params.colorR, params.colorG, params.colorB);\r
  if (params.viewMode == 1u) {\r
    let u = f.gb / max(f.r, 1e-5);\r
    let hue = atan2(u.y, u.x) / 6.2831853 + 0.5;\r
    let sat = clamp(length(u) / max(params.maxSpeed, 1e-4), 0.0, 1.0);\r
    tint = hsv2rgb(vec3f(hue, 0.35 + 0.65 * sat, 1.0));\r
  }\r
  return vec4f(mix(bg, tint, bright), 1.0);\r
}\r
\r
// Points display: one shaped sprite per particle, additive into the\r
// accumulation target's intensity channel (.a), so the post pass applies\r
// the same curve / palette / tonemap as the density view.\r
struct PointOut {\r
  @builtin(position) position: vec4f,\r
  @location(0) local: vec2f,   // −1..1 across the sprite\r
}\r
\r
@vertex\r
fn pointVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {\r
  var corners = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  let c = corners[vi];\r
  let half = vec2f(params.pointSize / max(params.canvasW, 1.0), params.pointSize / max(params.canvasH, 1.0));\r
  var out: PointOut;\r
  out.position = vec4f(particles[ii].pos + c * half, 0.0, 1.0);\r
  out.local = c;\r
  return out;\r
}\r
\r
@fragment\r
fn pointFrag(@location(0) local: vec2f) -> @location(0) vec4f {\r
  let r = length(local);\r
  var a = 0.0;\r
  switch params.pointShape {\r
    case 1u: { a = exp(-r * r * 3.0); }                        // soft\r
    case 2u: { a = smoothstep(0.18, 0.0, abs(r - 0.7)); }       // ring\r
    default: { a = 1.0 - smoothstep(0.85, 1.0, r); }            // disc\r
  }\r
  // Scale so a 1-px disc at intensity 1 matches the old 1-px point.\r
  let norm = 4.0 / max(params.pointSize * params.pointSize, 1.0);\r
  return vec4f(0.0, 0.0, 0.0, a * params.pointAlpha * params.exposure * norm * 4.0);\r
}\r
`,G=`// field-post.wgsl — display passes. Own bind group layout (binding 3 is the\r
// previous accumulation frame, not the particle buffer).\r
//\r
// The accumulation target holds two things per pixel:\r
//   rgb  colour for the Flow view (hue by direction), already a display value\r
//   a    scalar intensity for the Density and Points views, linear\r
// so the post pass can apply the response curve, palette and tonemap to\r
// points exactly as it does to the density field.\r
//\r
//   base:  field → (flow colour | density intensity, with bloom), blended\r
//          with the previous accumulation frame (render-only long exposure).\r
//          Points view writes nothing here; the points pass adds intensity.\r
//   post:  accumulation → curve → palette → tonemap → swapchain.\r
@group(0) @binding(0) var<uniform> params: Params;\r
@group(0) @binding(1) var fieldSampler: sampler;\r
@group(0) @binding(2) var fieldTex: texture_2d<f32>;   // full mip chain\r
@group(0) @binding(3) var accumTex: texture_2d<f32>;\r
\r
struct QuadOut {\r
  @builtin(position) position: vec4f,\r
  @location(0) uv: vec2f,\r
}\r
\r
@vertex\r
fn postQuadVert(@builtin(vertex_index) vi: u32) -> QuadOut {\r
  var pos = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  var out: QuadOut;\r
  out.position = vec4f(pos[vi], 0.0, 1.0);\r
  out.uv = ndcToUv(pos[vi]);\r
  return out;\r
}\r
\r
fn hsv2rgb(c: vec3f) -> vec3f {\r
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\r
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);\r
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);\r
}\r
\r
// Response curve on t ∈ [0,1]. 0 linear (1−e^−x), 1 sqrt, 2 log,\r
// 3 asinh (linear near zero, log at the top), 4 gamma 1/2.2.\r
fn curve(t: f32) -> f32 {\r
  switch params.curve {\r
    case 1u: { return sqrt(t); }\r
    case 2u: { return log(1.0 + t * 9.0) / log(10.0); }\r
    case 3u: { return asinh(t * 4.0) / asinh(4.0); }\r
    case 4u: { return pow(t, 1.0 / 2.2); }\r
    default: { return t; }\r
  }\r
}\r
\r
fn palette(t: f32) -> vec3f {\r
  switch params.palette {\r
    case 1u: { // ember: black → deep red → orange → cream\r
      if (t < 0.35) { return mix(vec3f(0.02, 0.0, 0.0), vec3f(0.55, 0.08, 0.03), t / 0.35); }\r
      if (t < 0.7)  { return mix(vec3f(0.55, 0.08, 0.03), vec3f(0.95, 0.55, 0.15), (t - 0.35) / 0.35); }\r
      return mix(vec3f(0.95, 0.55, 0.15), vec3f(1.0, 0.95, 0.8), (t - 0.7) / 0.3);\r
    }\r
    case 2u: { // ice\r
      if (t < 0.4)  { return mix(vec3f(0.0, 0.01, 0.05), vec3f(0.05, 0.2, 0.5), t / 0.4); }\r
      if (t < 0.75) { return mix(vec3f(0.05, 0.2, 0.5), vec3f(0.3, 0.75, 0.95), (t - 0.4) / 0.35); }\r
      return mix(vec3f(0.3, 0.75, 0.95), vec3f(0.95, 1.0, 1.0), (t - 0.75) / 0.25);\r
    }\r
    case 3u: { // spectral (viridis-like)\r
      var c = vec3f(0.27, 0.0, 0.33);\r
      c = mix(c, vec3f(0.13, 0.57, 0.55), smoothstep(0.0, 0.5, t));\r
      c = mix(c, vec3f(0.99, 0.91, 0.14), smoothstep(0.5, 1.0, t));\r
      return c * mix(0.15, 1.0, t);\r
    }\r
    default: { return vec3f(t); }\r
  }\r
}\r
\r
// Bloom term from the coarser mips of the density field. The field exists in\r
// every view, so Points gets the same glow as Density.\r
fn bloomTerm(uv: vec2f) -> f32 {\r
  if (params.bloom <= 0.0) { return 0.0; }\r
  let b = textureSampleLevel(fieldTex, fieldSampler, uv, 2.0).r\r
        + textureSampleLevel(fieldTex, fieldSampler, uv, 3.5).r\r
        + textureSampleLevel(fieldTex, fieldSampler, uv, 5.0).r;\r
  return max(b, 0.0) * params.exposure * params.bloom * 0.35;\r
}\r
\r
@fragment\r
fn baseFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  let prev = textureSampleLevel(accumTex, fieldSampler, uv, 0.0);\r
  let le = params.longExposure;\r
  var cur = vec4f(0.0);\r
  if (params.viewMode == 1u) {\r
    let f = textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);\r
    let x = max(f.r, 0.0) * params.exposure + bloomTerm(uv);\r
    let t = curve(1.0 - exp(-x));\r
    let u = f.gb / max(f.r, 1e-5);\r
    let hue = atan2(u.y, u.x) / 6.2831853 + 0.5;\r
    let sat = clamp(length(u) / max(params.maxSpeed, 1e-4), 0.0, 1.0);\r
    cur = vec4f(hsv2rgb(vec3f(hue, 0.35 + 0.65 * sat, 1.0)) * t, 0.0);\r
  } else if (params.viewMode == 0u) {\r
    let f = textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);\r
    cur = vec4f(0.0, 0.0, 0.0, max(f.r, 0.0) * params.exposure + bloomTerm(uv));\r
  } else {\r
    cur = vec4f(0.0, 0.0, 0.0, bloomTerm(uv));\r
  }\r
  return cur * (1.0 - le) + prev * le;\r
}\r
\r
fn aces(x: vec3f) -> vec3f {\r
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));\r
}\r
\r
@fragment\r
fn postFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  let s = textureSampleLevel(accumTex, fieldSampler, uv, 0.0);\r
  let bg = vec3f(params.bgR, params.bgG, params.bgB);\r
  var c: vec3f;\r
  if (params.viewMode == 1u) {\r
    c = s.rgb;\r
  } else {\r
    let t = curve(1.0 - exp(-max(s.a, 0.0)));\r
    if (params.palette == 0u) {\r
      c = mix(bg, vec3f(params.colorR, params.colorG, params.colorB), t);\r
    } else {\r
      c = palette(t);\r
    }\r
  }\r
  switch params.tonemap {\r
    case 1u: { c = c / (1.0 + c); }\r
    case 2u: { c = aces(c); }\r
    default: { c = clamp(c, vec3f(0.0), vec3f(1.0)); }\r
  }\r
  return vec4f(max(c, bg), 1.0);\r
}\r
`,R=`// field-boids.wgsl — sense + integrate. One thread per particle. The\r
// neighbour sum of boids.wgsl is replaced by a fixed stencil of texture taps\r
// over the (density, momentum) field written by field-deposit.wgsl.\r
@group(0) @binding(0) var<uniform> params: Params;\r
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;\r
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;\r
@group(0) @binding(3) var fieldTex: texture_2d<f32>;\r
@group(0) @binding(4) var fieldSampler: sampler;\r
\r
// PCG hash (well-distributed, GPU-safe integer arithmetic)\r
fn pcg(n: u32) -> u32 {\r
  var x = n * 747796405u + 2891336453u;\r
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;\r
  return (w >> 22u) ^ w;\r
}\r
\r
fn rand2(index: u32, tick: u32) -> vec2f {\r
  let s1 = pcg(index ^ (tick * 2654435761u));\r
  let s2 = pcg(s1 + 1u);\r
  return vec2f(f32(s1), f32(s2)) / f32(0xffffffffu) * 2.0 - vec2f(1.0);\r
}\r
\r
// One tap. \`offS\` is a screen-space offset from pos, \`areaS\` the patch this\r
// tap stands for (screen units²). The mip level is chosen so one sampled\r
// texel covers roughly that patch. Returns (count, Σvx, Σvy) over the patch:\r
// density × area gives a particle count, momentum × area gives Σ velocity.\r
fn tap(pos: vec2f, offS: vec2f, areaS: f32) -> vec3f {\r
  let texPerUnit = params.fieldH * 0.5;       // 2 NDC units of y = fieldH texels\r
  let areaTex = areaS * texPerUnit * texPerUnit;\r
  // LOD from the patch area, but never so coarse that the mip texel exceeds\r
  // half the tap radius: a footprint larger than the ring quantises the force\r
  // onto the mip grid and particles lock into a lattice.\r
  let rTex = length(offS) * texPerUnit;\r
  let lodArea = 0.5 * log2(max(areaTex, 1.0));\r
  let lodCap = log2(max(rTex * 0.5, 1.0));\r
  let lod = clamp(min(lodArea, lodCap), 0.0, params.maxLod);\r
  let p = pos + vec2f(offS.x / params.aspect, offS.y);\r
  // rgba16float saturates to Inf at ~65504 (reachable at memory 0.99 with\r
  // millions of particles); Inf·dir sums of opposite sign become NaN and\r
  // poison the whole sim. Clamp at the source.\r
  let f = min(textureSampleLevel(fieldTex, fieldSampler, ndcToUv(p), lod), vec4f(1e4));\r
  return vec3f(f.r, f.g, f.b) * areaTex;\r
}\r
\r
const RINGS: i32 = 3;\r
const TAPS_PER_RING: i32 = 5;\r
const REPULSE_TAPS: i32 = 6;\r
const PI: f32 = 3.14159265;\r
const TAU: f32 = 6.2831853;\r
\r
@compute @workgroup_size(64)\r
fn computeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let index = id.x;\r
  if (index >= params.numParticles) { return; }\r
\r
  var pos = particlesA[index].pos;\r
  var vel = particlesA[index].vel;\r
\r
  // Screen-space heading so the cone is isotropic on any canvas shape.\r
  let velS = vec2f(vel.x * params.aspect, vel.y);\r
  let speedS = length(velS);\r
  let heading = select(vec2f(1.0, 0.0), velS / max(speedS, 1e-4), speedS > 1e-4);\r
  let headAngle = atan2(heading.y, heading.x);\r
  let coneHalf = acos(clamp(params.coneAngle, -1.0, 1.0));\r
\r
  var spatial_force = vec2f(0.0);   // screen space\r
  var align_force   = vec2f(0.0);   // clip space\r
  var repulse_force = vec2f(0.0);   // screen space\r
  var coneCount     = 0.0;\r
  var repulseCount  = 0.0;\r
\r
  // Cone stencil: RINGS rings × TAPS_PER_RING taps spanning ±coneHalf.\r
  // No centre tap. The innermost ring's mip footprint still overlaps the\r
  // particle's own splat (~2% of ambient density at 500k particles,\r
  // dominant below ~20k); alignment self-cancels exactly, the cone term\r
  // does not.\r
  let dr = params.attractionRadius / f32(RINGS);\r
  let dTheta = 2.0 * coneHalf / f32(TAPS_PER_RING);\r
  for (var i = 0; i < RINGS; i++) {\r
    let r = dr * (f32(i) + 0.5);\r
    let area = dr * r * dTheta;\r
    for (var j = 0; j < TAPS_PER_RING; j++) {\r
      let theta = headAngle + (f32(j) - 0.5 * f32(TAPS_PER_RING - 1)) * dTheta;\r
      let dir = vec2f(cos(theta), sin(theta));\r
      let t = tap(pos, dir * r, area);\r
      let n = t.x;\r
      coneCount     += n;\r
      spatial_force += n * dir * (params.attractionRadius * params.attractionRadius) / (r * r + 0.001);\r
      align_force   += t.yz - n * vel;          // Σ (v_j − v)\r
    }\r
  }\r
\r
  // Repulsion stencil: a full ring at half the repulsion radius. The\r
  // particle's own splat lands symmetrically in all taps and cancels.\r
  let rr = 0.5 * params.repulsionRadius;\r
  let areaR = PI * params.repulsionRadius * params.repulsionRadius / f32(REPULSE_TAPS);\r
  for (var j = 0; j < REPULSE_TAPS; j++) {\r
    let theta = f32(j) * TAU / f32(REPULSE_TAPS);\r
    let dir = vec2f(cos(theta), sin(theta));\r
    let t = tap(pos, dir * rr, areaR);\r
    repulseCount  += t.x;\r
    repulse_force -= t.x * dir * (params.repulsionRadius * params.repulsionRadius) / (rr * rr + 0.0001);\r
  }\r
\r
  // Mean-field normalisation: divide by neighbour count so slider values\r
  // mean the same thing from 1k to 2M particles. One neighbour reproduces\r
  // the pairwise boids force exactly. Kernels are scaled by radius² so the\r
  // mean-field force is O(1)·slider regardless of radius; at r = radius the\r
  // weight is 1.\r
  let cn = max(coneCount, 1.0);\r
  let rn = max(repulseCount, 1.0);\r
  spatial_force = params.attraction * spatial_force / cn\r
                + params.repulsion  * repulse_force / rn;\r
  align_force   = params.alignment  * align_force   / cn;\r
\r
  // Gravity: constant acceleration along a screen-space direction. Straight\r
  // down by default; the phone tilt sensor steers it. Terminal speed against\r
  // the quadratic friction is sqrt(gravity / friction).\r
  let gravity = params.gravity * vec2f(params.gravityX / params.aspect, params.gravityY);\r
  let force = vec2f(spatial_force.x / params.aspect, spatial_force.y) + align_force + gravity;\r
  let friction = -params.friction * sign(vel) * vel * vel;\r
  vel = vel + params.deltaTime * (force + friction);\r
\r
  let sp = length(vel);\r
  if (sp > params.maxSpeed && sp > 0.0001) {\r
    vel = vel * (params.maxSpeed / sp);\r
  }\r
\r
  // Fingers / mouse (screen-space distance for an isotropic radius): each\r
  // active pointer attracts in proportion to its pressure. The carry\r
  // (advection) is applied to position further down, after the speed caps,\r
  // so a drag moves particles with the finger regardless of maxSpeed.\r
  var carry = vec2f(0.0);\r
  for (var i = 0u; i < 4u; i++) {\r
    let pp = params.pointers[i * 2u];\r
    if (pp.z <= 0.0) { continue; }\r
    let toP = pp.xy - pos;\r
    let dS = length(vec2f(toP.x * params.aspect, toP.y));\r
    if (dS < params.mouseRadius && dS > 0.0001) {\r
      vel += 0.005 * pp.z * normalize(toP) / dS;\r
      let w = 1.0 - dS / params.mouseRadius;\r
      carry += params.pointers[i * 2u + 1u].xy * sqrt(w);\r
    }\r
  }\r
\r
  // Noise, applied last so it does not interfere with steering\r
  if (params.noise > 0.0) {\r
    vel += rand2(index, params.tick) * params.noise;\r
    let nsp = length(vel);\r
    if (nsp > params.maxSpeed && nsp > 0.0001) {\r
      vel = vel * (params.maxSpeed / nsp);\r
    }\r
  }\r
\r
  // Belt and braces: a non-finite velocity never reaches the buffer.\r
  if (!(dot(vel, vel) < 1e30)) { vel = vec2f(0.0); }\r
\r
  pos = pos + vel * params.deltaTime;\r
  // Carried particles move with the finger exactly (per-step displacement)\r
  // and keep some of that motion as velocity, so they coast on release.\r
  if (dot(carry, carry) > 0.0) {\r
    pos = pos + carry;\r
    vel = vel + carry * (0.3 / params.deltaTime);\r
  }\r
  // Torus wrap into [-1, 1)\r
  pos = pos - floor((pos + 1.0) * 0.5) * 2.0;\r
\r
  particlesB[index] = Particle(pos, vel);\r
}\r
`,B={dt:.016,stepsPerFrame:1,numParticles:5e5,attractionRadius:.15,repulsionRadius:.03,attraction:.3,repulsion:1.5,alignment:.1,friction:2,maxSpeed:.22,coneAngle:-.5,noise:0,mouseRadius:.15,memory:0,splatSize:1.5,viewMode:0,exposure:2,pointAlpha:.15,pointSize:2,pointShape:0,curve:3,tonemap:2,palette:0,bloom:0,longExposure:0},m=2e6,b=304,w=4,f="rgba16float";class M{gpu=null;running=!1;animId=0;lastFrameTime=0;frame=0;inFlight=0;maxFps=1/0;tickCount=0;params={...B};maxFieldSize=1024;bgColor={r:.039,g:.031,b:.016,a:1};accent={r:.88,g:.63,b:.25};themeObserver=null;mouseX=0;mouseY=0;mouseActive=!1;pointers=new Map;onPointers;gravityX=0;gravityY=-1;gravity=0;uniformBuffer;particleBuffers=[];sampler;fieldTextures=[];fieldFullViews=[];fieldLevelViews=[];fieldW=0;fieldH=0;mipCount=1;writeIdx=0;depositPipeline;depositBindGroups=[];viewLayout;decayPipeline;downsamplePipeline;fieldPipeline;pointPipeline;postLayout;basePipeline;postPipeline;accumTextures=[];accumViews=[];baseBindGroups=[];postBindGroups=[];accumIdx=0;levelBindGroups=[];fullBindGroups=[];computePipeline;computeBindGroups=[];async init(t){try{if(this.gpu=await S(t),!this.gpu)return!1;const{device:n}=this.gpu;this.readTheme(),this.initThemeObserver(),this.uniformBuffer=n.createBuffer({size:b,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sampler=n.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"repeat",addressModeV:"repeat"});for(let a=0;a<2;a++)this.particleBuffers.push(n.createBuffer({size:m*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));this.createPipelines(n),y(t),this.createFieldTextures(n,t.width||1,t.height||1),this.reset();const e=()=>this.onPointers?.([...this.pointers].map(([a,l])=>({id:a,clientX:l.clientX,clientY:l.clientY,strength:l.strength,type:l.type}))),r=a=>{if(a.type==="pointermove"&&!this.pointers.has(a.pointerId)||a.type==="pointerdown"&&this.pointers.size>=w)return;const l=t.getBoundingClientRect(),s=(a.clientX-l.left)/l.width*2-1,i=-((a.clientY-l.top)/l.height*2-1),p=a.pressure,c=p>0&&p!==.5&&p!==1?p:0,u=Math.max(a.width,a.height),h=Math.min(1,Math.max(0,(u-10)/40)),x=a.pointerType==="mouse"?1:.5+1.5*Math.max(c,h),d=this.pointers.get(a.pointerId);if(d)d.x=s,d.y=i,d.strength=x,d.clientX=a.clientX,d.clientY=a.clientY;else{this.pointers.set(a.pointerId,{x:s,y:i,px:s,py:i,vx:0,vy:0,strength:x,type:a.pointerType,clientX:a.clientX,clientY:a.clientY});try{t.setPointerCapture(a.pointerId)}catch{}}this.mouseX=s,this.mouseY=i,this.mouseActive=!0,e()},o=a=>{this.pointers.delete(a.pointerId)&&(this.mouseActive=this.pointers.size>0,e())};return t.addEventListener("pointerdown",r),t.addEventListener("pointermove",r),t.addEventListener("pointerup",o),t.addEventListener("pointercancel",o),t.addEventListener("lostpointercapture",o),!0}catch(n){return console.error("FieldBoidsController init error:",n),!1}}createPipelines(t){const{format:n}=this.gpu,e={color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}},r=t.createShaderModule({code:v+T});this.depositPipeline=t.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"depositVert"},fragment:{module:r,entryPoint:"depositFrag",targets:[{format:f,blend:e}]},primitive:{topology:"triangle-list"}}),this.depositBindGroups=this.particleBuffers.map(u=>t.createBindGroup({layout:this.depositPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:u}}]}));const o=t.createShaderModule({code:v+F});this.viewLayout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]});const a=t.createPipelineLayout({bindGroupLayouts:[this.viewLayout]}),l=(u,h)=>t.createRenderPipeline({layout:a,vertex:{module:o,entryPoint:"quadVert"},fragment:{module:o,entryPoint:u,targets:[h]},primitive:{topology:"triangle-list"}});this.decayPipeline=l("decayFrag",{format:f}),this.downsamplePipeline=l("downsampleFrag",{format:f}),this.fieldPipeline=l("fieldFrag",{format:n}),this.pointPipeline=t.createRenderPipeline({layout:a,vertex:{module:o,entryPoint:"pointVert"},fragment:{module:o,entryPoint:"pointFrag",targets:[{format:f,blend:e}]},primitive:{topology:"triangle-list"}});const s=t.createShaderModule({code:v+G});this.postLayout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}}]});const i=t.createPipelineLayout({bindGroupLayouts:[this.postLayout]}),p=(u,h)=>t.createRenderPipeline({layout:i,vertex:{module:s,entryPoint:"postQuadVert"},fragment:{module:s,entryPoint:u,targets:[h]},primitive:{topology:"triangle-list"}});this.basePipeline=p("baseFrag",{format:f}),this.postPipeline=p("postFrag",{format:n});const c=t.createShaderModule({code:v+R});this.computePipeline=t.createComputePipeline({layout:"auto",compute:{module:c,entryPoint:"computeMain"}})}createFieldTextures(t,n,e){this.fieldTextures.forEach(s=>s.destroy());const r=Math.max(n,e),o=this.maxFieldSize/r;this.fieldW=Math.max(16,Math.round(n*o)),this.fieldH=Math.max(16,Math.round(e*o)),this.mipCount=Math.floor(Math.log2(Math.max(this.fieldW,this.fieldH)))+1,this.fieldTextures=[0,1].map(()=>t.createTexture({size:[this.fieldW,this.fieldH],format:f,mipLevelCount:this.mipCount,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})),this.fieldFullViews=this.fieldTextures.map(s=>s.createView()),this.fieldLevelViews=this.fieldTextures.map(s=>Array.from({length:this.mipCount},(i,p)=>s.createView({baseMipLevel:p,mipLevelCount:1})));const a=(s,i)=>t.createBindGroup({layout:this.viewLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.sampler},{binding:2,resource:s},{binding:3,resource:{buffer:i}}]});this.levelBindGroups=this.fieldLevelViews.map(s=>s.map(i=>a(i,this.particleBuffers[0]))),this.fullBindGroups=this.fieldFullViews.map(s=>this.particleBuffers.map(i=>a(s,i))),this.accumTextures.forEach(s=>s.destroy()),this.accumTextures=[0,1].map(()=>t.createTexture({size:[Math.max(1,n),Math.max(1,e)],format:f,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})),this.accumViews=this.accumTextures.map(s=>s.createView());const l=(s,i)=>t.createBindGroup({layout:this.postLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.sampler},{binding:2,resource:s},{binding:3,resource:i}]});this.baseBindGroups=this.fieldFullViews.map(s=>this.accumViews.map(i=>l(s,i))),this.postBindGroups=this.accumViews.map(s=>l(this.fieldFullViews[0],s)),this.onFieldTexturesCreated(t)}onFieldTexturesCreated(t){this.computeBindGroups=this.fieldFullViews.map(n=>[0,1].map(e=>t.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[e]}},{binding:2,resource:{buffer:this.particleBuffers[1-e]}},{binding:3,resource:n},{binding:4,resource:this.sampler}]})))}loadPreset(t){Object.assign(this.params,t.params)}capturePreset(t){return{id:t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""),name:t,params:{...this.params}}}start(){this.running||(this.running=!0,this.tick())}stop(){this.running=!1,cancelAnimationFrame(this.animId),clearTimeout(this.animId)}reset(){if(!this.gpu)return;const{device:t}=this.gpu,n=new Float32Array(m*4);for(let r=0;r<m;r++)n[r*4+0]=(Math.random()-.5)*2,n[r*4+1]=(Math.random()-.5)*2,n[r*4+2]=(Math.random()-.5)*.1,n[r*4+3]=(Math.random()-.5)*.1;t.queue.writeBuffer(this.particleBuffers[0],0,n),t.queue.writeBuffer(this.particleBuffers[1],0,n);const e=t.createCommandEncoder();for(const r of this.fieldLevelViews)for(const o of r)e.beginRenderPass({colorAttachments:[{view:o,loadOp:"clear",storeOp:"store"}]}).end();t.queue.submit([e.finish()]),this.frame=0,this.writeIdx=0}setGravityDirection(t,n){const e=Math.hypot(t,n);e>1e-6&&e>1&&(t/=e,n/=e),this.gravityX=t,this.gravityY=n}resetGravityDirection(){this.gravityX=0,this.gravityY=-1}packUniforms(t){const n=new ArrayBuffer(b),e=new DataView(n),r=this.params;e.setFloat32(0,r.dt,!0),e.setFloat32(4,r.attractionRadius,!0),e.setFloat32(8,r.repulsionRadius,!0),e.setFloat32(12,r.attraction,!0),e.setFloat32(16,r.repulsion,!0),e.setFloat32(20,r.alignment,!0),e.setFloat32(24,r.friction,!0),e.setFloat32(28,r.maxSpeed,!0),e.setUint32(32,Math.min(r.numParticles,m),!0),e.setFloat32(36,this.mouseX,!0),e.setFloat32(40,this.mouseY,!0),e.setFloat32(44,this.mouseActive?1:0,!0),e.setFloat32(48,r.mouseRadius,!0),e.setFloat32(52,r.coneAngle,!0),e.setFloat32(56,t,!0),e.setUint32(60,this.frame,!0),e.setFloat32(64,r.noise,!0),e.setFloat32(68,Math.min(r.memory,.999),!0),e.setFloat32(72,Math.max(.5,r.splatSize),!0),e.setUint32(76,r.viewMode,!0),e.setFloat32(80,r.exposure,!0),e.setFloat32(84,this.fieldW,!0),e.setFloat32(88,this.fieldH,!0),e.setFloat32(92,this.mipCount-1,!0),e.setFloat32(96,this.accent.r,!0),e.setFloat32(100,this.accent.g,!0),e.setFloat32(104,this.accent.b,!0),e.setFloat32(108,this.bgColor.r,!0),e.setFloat32(112,this.bgColor.g,!0),e.setFloat32(116,this.bgColor.b,!0),e.setFloat32(120,r.pointAlpha,!0),e.setFloat32(124,this.gravity,!0),e.setFloat32(128,this.gravityX,!0),e.setFloat32(132,this.gravityY,!0),e.setFloat32(136,r.bloom??0,!0),e.setFloat32(140,Math.min(r.longExposure??0,.995),!0),e.setUint32(144,r.curve??3,!0),e.setUint32(148,r.tonemap??2,!0),e.setUint32(152,r.palette??0,!0);const o=this.gpu?.canvas,a=o&&o.width>0&&o.clientWidth>0?o.width/o.clientWidth:1;e.setFloat32(156,Math.max(.5,(r.pointSize??2)*a),!0),e.setFloat32(160,o?.width??1,!0);let l=0;const s=Math.max(1,r.stepsPerFrame);for(const i of this.pointers.values()){if(l>=w)break;i.vx=.5*i.vx+.5*((i.x-i.px)/s),i.vy=.5*i.vy+.5*((i.y-i.py)/s),i.px=i.x,i.py=i.y;const p=176+l*32;e.setFloat32(p,i.x,!0),e.setFloat32(p+4,i.y,!0),e.setFloat32(p+8,i.strength,!0),e.setFloat32(p+16,i.vx,!0),e.setFloat32(p+20,i.vy,!0),l++}return e.setFloat32(164,o?.height??1,!0),e.setUint32(168,r.pointShape??0,!0),n}tick=()=>{if(!this.running||!this.gpu)return;if(Number.isFinite(this.maxFps)){const i=performance.now();if(i-this.lastFrameTime<1e3/this.maxFps-1){this.animId=requestAnimationFrame(this.tick);return}this.lastFrameTime=i}const{device:t,context:n,canvas:e}=this.gpu;y(e)&&this.createFieldTextures(t,e.width||1,e.height||1);const r=e.width>0&&e.height>0?e.width/e.height:1,o=Math.min(this.params.numParticles,m),a=Math.max(1,Math.min(30,Math.round(this.params.stepsPerFrame)));for(let i=0;i<a;i++){t.queue.writeBuffer(this.uniformBuffer,0,this.packUniforms(r));const p=this.frame%2,c=t.createCommandEncoder();this.runDecay(c),this.runDeposit(c,p,o),this.runMips(c),this.runCompute(c,p,o),i===a-1&&this.runDisplay(c,n,p,o),t.queue.submit([c.finish()]),this.frame++,this.writeIdx=1-this.writeIdx}this.tickCount++,this.inFlight++;const l=t.queue.onSubmittedWorkDone().then(()=>{this.inFlight--}),s=()=>{this.running&&(Number.isFinite(this.maxFps)?this.animId=window.setTimeout(this.tick,0):this.animId=requestAnimationFrame(this.tick))};this.inFlight>=2?l.then(s):s()};runDecay(t){if(this.params.memory<=0)return;const n=1-this.writeIdx,e=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][0],loadOp:"clear",storeOp:"store"}]});e.setPipeline(this.decayPipeline),e.setBindGroup(0,this.fullBindGroups[n][0]),e.draw(6),e.end()}runCompute(t,n,e){const r=t.beginComputePass();r.setPipeline(this.computePipeline),r.setBindGroup(0,this.computeBindGroups[this.writeIdx][n]),r.dispatchWorkgroups(Math.ceil(e/64)),r.end()}runDeposit(t,n,e){const r=this.params.memory>0,o=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][0],clearValue:{r:0,g:0,b:0,a:0},loadOp:r?"load":"clear",storeOp:"store"}]});o.setPipeline(this.depositPipeline),o.setBindGroup(0,this.depositBindGroups[n]),o.draw(6,e),o.end()}runMips(t){for(let n=1;n<this.mipCount;n++){const e=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][n],loadOp:"clear",storeOp:"store"}]});e.setPipeline(this.downsamplePipeline),e.setBindGroup(0,this.levelBindGroups[this.writeIdx][n-1]),e.draw(6),e.end()}}runDisplay(t,n,e,r){const o=this.accumIdx,a=1-o;this.accumIdx=a;const l=t.beginRenderPass({colorAttachments:[{view:this.accumViews[a],clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});if(l.setPipeline(this.basePipeline),l.setBindGroup(0,this.baseBindGroups[this.writeIdx][o]),l.draw(6),l.end(),this.params.viewMode===2){const i=t.beginRenderPass({colorAttachments:[{view:this.accumViews[a],loadOp:"load",storeOp:"store"}]});i.setPipeline(this.pointPipeline),i.setBindGroup(0,this.fullBindGroups[this.writeIdx][1-e]),i.draw(6,r),i.end()}const s=t.beginRenderPass({colorAttachments:[{view:n.getCurrentTexture().createView(),clearValue:this.bgColor,loadOp:"clear",storeOp:"store"}]});s.setPipeline(this.postPipeline),s.setBindGroup(0,this.postBindGroups[a]),s.draw(6),s.end()}readTheme(){if(typeof document>"u")return;const t=getComputedStyle(document.documentElement),n=P(t.getPropertyValue("--bg-primary")),e=P(t.getPropertyValue("--accent"));n&&(this.bgColor={...n,a:1}),e&&(this.accent=e)}initThemeObserver(){typeof MutationObserver>"u"||typeof document>"u"||(this.themeObserver=new MutationObserver(()=>this.readTheme()),this.themeObserver.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}))}}function P(g){let t=g.trim().replace(/^#/,"");return t.length===3&&(t=t.split("").map(n=>n+n).join("")),/^[0-9a-fA-F]{6}$/.test(t)?{r:parseInt(t.slice(0,2),16)/255,g:parseInt(t.slice(2,4),16)/255,b:parseInt(t.slice(4,6),16)/255}:null}const U=Object.freeze(Object.defineProperty({__proto__:null,FieldBoidsController:M,MAX_PARTICLES:m},Symbol.toStringTag,{value:"Module"}));export{B as D,M as F,U as f};
