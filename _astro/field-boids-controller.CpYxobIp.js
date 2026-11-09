import{i as G,r as M}from"./prng.CnvGDmZk.js";import{r as F}from"./utils.DCtYZSmS.js";const b=`// field-common.wgsl — shared declarations. The controller prepends this\r
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
  // View: zoom about (viewCx, viewCy) in world NDC. 1 = whole torus visible.\r
  viewZoom:         f32,  // 304\r
  viewCx:           f32,  // 308\r
  viewCy:           f32,  // 312\r
  pad1:             f32,  // 316\r
}                          // 320 bytes total\r
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
fn uvToNdc(uv: vec2f) -> vec2f {\r
  return (uv - vec2f(0.5)) * vec2f(2.0, -2.0);\r
}\r
// Shortest torus offset, components in [-1, 1).\r
fn wrapDelta(d: vec2f) -> vec2f {\r
  return d - round(d * 0.5) * 2.0;\r
}\r
// Screen NDC -> world NDC (the field texture samples with repeat, so no wrap needed here).\r
fn screenToWorld(p: vec2f) -> vec2f {\r
  return vec2f(params.viewCx, params.viewCy) + p / params.viewZoom;\r
}\r
// World NDC -> screen NDC via the shortest torus path, so particles near the seam stay put.\r
fn worldToScreen(w: vec2f) -> vec2f {\r
  return wrapDelta(w - vec2f(params.viewCx, params.viewCy)) * params.viewZoom;\r
}\r
`,A=`// field-deposit.wgsl — one instanced quad per particle, additively blended\r
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
// Four instances per particle: the splat itself and, for particles within a\r
// splat radius of an edge, wrapped copies shifted by a full period in x, y or\r
// both, so the torus seam gets its full density. Copies that are not needed\r
// collapse to a point outside the clip volume.\r
@vertex\r
fn depositVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DepositOut {\r
  var corners = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  let p = particles[ii / 4u];\r
  let copy = ii % 4u;\r
  let corner = corners[vi];\r
  // Quad radius = 3 sigma. 2 NDC units span the whole texture.\r
  let radiusTexels = 3.0 * params.splatSize;\r
  let halfSize = vec2f(radiusTexels * 2.0 / params.fieldW, radiusTexels * 2.0 / params.fieldH);\r
  var out: DepositOut;\r
  // Shift toward the opposite edge when this copy's axis is near a border.\r
  var shift = vec2f(0.0);\r
  let wantX = (copy & 1u) == 1u;\r
  let wantY = (copy & 2u) == 2u;\r
  let nearX = abs(p.pos.x) > 1.0 - halfSize.x;\r
  let nearY = abs(p.pos.y) > 1.0 - halfSize.y;\r
  if ((wantX && !nearX) || (wantY && !nearY)) {\r
    out.position = vec4f(2.0, 2.0, 2.0, 1.0);   // culled\r
    out.local = vec2f(0.0);\r
    out.vel = vec2f(0.0);\r
    return out;\r
  }\r
  if (wantX) { shift.x = -2.0 * sign(p.pos.x); }\r
  if (wantY) { shift.y = -2.0 * sign(p.pos.y); }\r
  out.position = vec4f(p.pos + shift + corner * halfSize, 0.0, 1.0);\r
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
`,E=`// field-view.wgsl — fullscreen passes (decay, mip downsample, field display)\r
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
  // pointSize is in canvas px at zoom 1; sprites live in the world, so they\r
  // grow with the zoom and the pattern you see stays the same pattern.\r
  let half = vec2f(params.pointSize / max(params.canvasW, 1.0), params.pointSize / max(params.canvasH, 1.0)) * params.viewZoom;\r
  var out: PointOut;\r
  out.position = vec4f(worldToScreen(particles[ii].pos) + c * half, 0.0, 1.0);\r
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
  // Alpha is per-pixel: a bigger sprite is a bigger, equally bright blob\r
  // (overlaps add up and the tonemap handles dense regions). The constant\r
  // keeps the default 2 px sprite at the brightness it had before.\r
  return vec4f(0.0, 0.0, 0.0, a * params.pointAlpha * params.exposure * 4.0);\r
}\r
`,_=`// field-post.wgsl — display passes. Own bind group layout (binding 3 is the
// previous accumulation frame, not the particle buffer).
//
// The accumulation target holds two things per pixel:
//   rgb  colour for the Flow view (hue by direction), already a display value
//   a    scalar intensity for the Density and Points views, linear
// so the post pass can apply the response curve, palette and tonemap to
// points exactly as it does to the density field.
//
//   base:  field → (flow colour | density intensity, with bloom), blended
//          with the previous accumulation frame (render-only long exposure).
//          Points view writes nothing here; the points pass adds intensity.
//   post:  accumulation → curve → palette → tonemap → swapchain.
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var fieldSampler: sampler;
@group(0) @binding(2) var fieldTex: texture_2d<f32>;   // full mip chain
@group(0) @binding(3) var accumTex: texture_2d<f32>;

struct QuadOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn postQuadVert(@builtin(vertex_index) vi: u32) -> QuadOut {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  var out: QuadOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = ndcToUv(pos[vi]);
  return out;
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

// Response curve on t ∈ [0,1]. 0 linear (1−e^−x), 1 sqrt, 2 log,
// 3 asinh (linear near zero, log at the top), 4 gamma 1/2.2.
fn curve(t: f32) -> f32 {
  switch params.curve {
    case 1u: { return sqrt(t); }
    case 2u: { return log(1.0 + t * 9.0) / log(10.0); }
    case 3u: { return asinh(t * 4.0) / asinh(4.0); }
    case 4u: { return pow(t, 1.0 / 2.2); }
    default: { return t; }
  }
}

fn palette(t: f32) -> vec3f {
  switch params.palette {
    case 1u: { // ember: black → deep red → orange → cream
      if (t < 0.35) { return mix(vec3f(0.02, 0.0, 0.0), vec3f(0.55, 0.08, 0.03), t / 0.35); }
      if (t < 0.7)  { return mix(vec3f(0.55, 0.08, 0.03), vec3f(0.95, 0.55, 0.15), (t - 0.35) / 0.35); }
      return mix(vec3f(0.95, 0.55, 0.15), vec3f(1.0, 0.95, 0.8), (t - 0.7) / 0.3);
    }
    case 2u: { // ice
      if (t < 0.4)  { return mix(vec3f(0.0, 0.01, 0.05), vec3f(0.05, 0.2, 0.5), t / 0.4); }
      if (t < 0.75) { return mix(vec3f(0.05, 0.2, 0.5), vec3f(0.3, 0.75, 0.95), (t - 0.4) / 0.35); }
      return mix(vec3f(0.3, 0.75, 0.95), vec3f(0.95, 1.0, 1.0), (t - 0.75) / 0.25);
    }
    case 3u: { // spectral (viridis-like)
      var c = vec3f(0.27, 0.0, 0.33);
      c = mix(c, vec3f(0.13, 0.57, 0.55), smoothstep(0.0, 0.5, t));
      c = mix(c, vec3f(0.99, 0.91, 0.14), smoothstep(0.5, 1.0, t));
      return c * mix(0.15, 1.0, t);
    }
    default: { return vec3f(t); }
  }
}

// Bloom term from the coarser mips of the density field. The field exists in
// every view, so Points gets the same glow as Density.
fn bloomTerm(uv: vec2f) -> f32 {
  if (params.bloom <= 0.0) { return 0.0; }
  let b = textureSampleLevel(fieldTex, fieldSampler, uv, 2.0).r
        + textureSampleLevel(fieldTex, fieldSampler, uv, 3.5).r
        + textureSampleLevel(fieldTex, fieldSampler, uv, 5.0).r;
  return max(b, 0.0) * params.exposure * params.bloom * 0.35;
}

@fragment
fn baseFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let prev = textureSampleLevel(accumTex, fieldSampler, uv, 0.0);
  let le = params.longExposure;
  // The field is sampled through the view (zoom / pan); the sampler repeats,
  // so panning past an edge wraps around the torus.
  let wuv = ndcToUv(screenToWorld(uvToNdc(uv)));
  var cur = vec4f(0.0);
  if (params.viewMode == 1u) {
    let f = textureSampleLevel(fieldTex, fieldSampler, wuv, 0.0);
    let x = max(f.r, 0.0) * params.exposure + bloomTerm(wuv);
    let t = curve(1.0 - exp(-x));
    let u = f.gb / max(f.r, 1e-5);
    let hue = atan2(u.y, u.x) / 6.2831853 + 0.5;
    let sat = clamp(length(u) / max(params.maxSpeed, 1e-4), 0.0, 1.0);
    cur = vec4f(hsv2rgb(vec3f(hue, 0.35 + 0.65 * sat, 1.0)) * t, 0.0);
  } else if (params.viewMode == 0u) {
    let f = textureSampleLevel(fieldTex, fieldSampler, wuv, 0.0);
    cur = vec4f(0.0, 0.0, 0.0, max(f.r, 0.0) * params.exposure + bloomTerm(wuv));
  } else {
    cur = vec4f(0.0, 0.0, 0.0, bloomTerm(wuv));
  }
  return cur * (1.0 - le) + prev * le;
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn postFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let s = textureSampleLevel(accumTex, fieldSampler, uv, 0.0);
  let bg = vec3f(params.bgR, params.bgG, params.bgB);
  // Light theme (same threshold as boids' _isLight): the field is light
  // emitted over a dark page, and max(c, bg) below would erase anything
  // darker than cream. Render it as ink instead: density darkens the page,
  // with the palette read backwards so dense regions are its dark end.
  if (bg.r + bg.g + bg.b > 1.5) {
    var t: f32;
    var ink: vec3f;
    if (params.viewMode == 1u) {
      t = clamp(max(s.r, max(s.g, s.b)), 0.0, 1.0);
      ink = s.rgb / max(t, 1e-4) * 0.7;
    } else {
      t = curve(1.0 - exp(-max(s.a, 0.0)));
      if (params.palette == 0u) {
        ink = vec3f(params.colorR, params.colorG, params.colorB);
      } else {
        ink = palette(1.0 - t);
      }
    }
    return vec4f(mix(bg, clamp(ink, vec3f(0.0), vec3f(1.0)), t), 1.0);
  }
  var c: vec3f;
  if (params.viewMode == 1u) {
    c = s.rgb;
  } else {
    let t = curve(1.0 - exp(-max(s.a, 0.0)));
    if (params.palette == 0u) {
      c = mix(bg, vec3f(params.colorR, params.colorG, params.colorB), t);
    } else {
      c = palette(t);
    }
  }
  switch params.tonemap {
    case 1u: { c = c / (1.0 + c); }
    case 2u: { c = aces(c); }
    default: { c = clamp(c, vec3f(0.0), vec3f(1.0)); }
  }
  return vec4f(max(c, bg), 1.0);
}
`,I=`// field-boids.wgsl — sense + integrate. One thread per particle. The
// neighbour sum of boids.wgsl is replaced by a fixed stencil of texture taps
// over the (density, momentum) field written by field-deposit.wgsl.
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;
@group(0) @binding(3) var fieldTex: texture_2d<f32>;
@group(0) @binding(4) var fieldSampler: sampler;

// PCG hash (well-distributed, GPU-safe integer arithmetic)
fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rand2(index: u32, tick: u32) -> vec2f {
  let s1 = pcg(index ^ (tick * 2654435761u));
  let s2 = pcg(s1 + 1u);
  return vec2f(f32(s1), f32(s2)) / f32(0xffffffffu) * 2.0 - vec2f(1.0);
}

// One tap. \`offS\` is a screen-space offset from pos, \`areaS\` the patch this
// tap stands for (screen units²). The mip level is chosen so one sampled
// texel covers roughly that patch. Returns (count, Σvx, Σvy) over the patch:
// density × area gives a particle count, momentum × area gives Σ velocity.
fn tap(pos: vec2f, offS: vec2f, areaS: f32) -> vec3f {
  let texPerUnit = params.fieldH * 0.5;       // 2 NDC units of y = fieldH texels
  let areaTex = areaS * texPerUnit * texPerUnit;
  // LOD from the patch area, but never so coarse that the mip texel exceeds
  // half the tap radius: a footprint larger than the ring quantises the force
  // onto the mip grid and particles lock into a lattice.
  let rTex = length(offS) * texPerUnit;
  let lodArea = 0.5 * log2(max(areaTex, 1.0));
  let lodCap = log2(max(rTex * 0.5, 1.0));
  let lod = clamp(min(lodArea, lodCap), 0.0, params.maxLod);
  let p = pos + vec2f(offS.x / params.aspect, offS.y);
  // rgba16float saturates to Inf at ~65504 (reachable at memory 0.99 with
  // millions of particles); Inf·dir sums of opposite sign become NaN and
  // poison the whole sim. Clamp at the source.
  let f = min(textureSampleLevel(fieldTex, fieldSampler, ndcToUv(p), lod), vec4f(1e4));
  return vec3f(f.r, f.g, f.b) * areaTex;
}

const RINGS: i32 = 3;
const TAPS_PER_RING: i32 = 5;
const REPULSE_TAPS: i32 = 6;
const PI: f32 = 3.14159265;
const TAU: f32 = 6.2831853;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  var pos = particlesA[index].pos;
  var vel = particlesA[index].vel;

  // Screen-space heading so the cone is isotropic on any canvas shape.
  let velS = vec2f(vel.x * params.aspect, vel.y);
  let speedS = length(velS);
  let heading = select(vec2f(1.0, 0.0), velS / max(speedS, 1e-4), speedS > 1e-4);
  let headAngle = atan2(heading.y, heading.x);
  let coneHalf = acos(clamp(params.coneAngle, -1.0, 1.0));

  var spatial_force = vec2f(0.0);   // screen space
  var align_force   = vec2f(0.0);   // clip space
  var repulse_force = vec2f(0.0);   // screen space
  var coneCount     = 0.0;
  var repulseCount  = 0.0;

  // Cone stencil: RINGS rings × TAPS_PER_RING taps spanning ±coneHalf.
  // No centre tap. The innermost ring's mip footprint still overlaps the
  // particle's own splat (~2% of ambient density at 500k particles,
  // dominant below ~20k); alignment self-cancels exactly, the cone term
  // does not.
  let dr = params.attractionRadius / f32(RINGS);
  let dTheta = 2.0 * coneHalf / f32(TAPS_PER_RING);
  for (var i = 0; i < RINGS; i++) {
    let r = dr * (f32(i) + 0.5);
    let area = dr * r * dTheta;
    for (var j = 0; j < TAPS_PER_RING; j++) {
      let theta = headAngle + (f32(j) - 0.5 * f32(TAPS_PER_RING - 1)) * dTheta;
      let dir = vec2f(cos(theta), sin(theta));
      let t = tap(pos, dir * r, area);
      let n = t.x;
      coneCount     += n;
      spatial_force += n * dir * (params.attractionRadius * params.attractionRadius) / (r * r + 0.001);
      align_force   += t.yz - n * vel;          // Σ (v_j − v)
    }
  }

  // Repulsion stencil: a full ring at half the repulsion radius. The
  // particle's own splat lands symmetrically in all taps and cancels.
  let rr = 0.5 * params.repulsionRadius;
  let areaR = PI * params.repulsionRadius * params.repulsionRadius / f32(REPULSE_TAPS);
  for (var j = 0; j < REPULSE_TAPS; j++) {
    let theta = f32(j) * TAU / f32(REPULSE_TAPS);
    let dir = vec2f(cos(theta), sin(theta));
    let t = tap(pos, dir * rr, areaR);
    repulseCount  += t.x;
    repulse_force -= t.x * dir * (params.repulsionRadius * params.repulsionRadius) / (rr * rr + 0.0001);
  }

  // Mean-field normalisation: divide by neighbour count so slider values
  // mean the same thing from 1k to 2M particles. One neighbour reproduces
  // the pairwise boids force exactly. Kernels are scaled by radius² so the
  // mean-field force is O(1)·slider regardless of radius; at r = radius the
  // weight is 1.
  let cn = max(coneCount, 1.0);
  let rn = max(repulseCount, 1.0);
  spatial_force = params.attraction * spatial_force / cn
                + params.repulsion  * repulse_force / rn;
  align_force   = params.alignment  * align_force   / cn;

  // Gravity: constant acceleration along a screen-space direction. Straight
  // down by default; the phone tilt sensor steers it. Terminal speed against
  // the quadratic friction is sqrt(gravity / friction).
  // Velocity dynamics in screen space (x scaled by aspect), so friction,
  // the speed cap, the pointer force and noise are isotropic on screen. In
  // clip space a unit of x covers \`aspect\` times the pixels of a unit of y,
  // which stretched the motion along the long axis of the canvas.
  let asp = vec2f(params.aspect, 1.0);
  let gravityS = params.gravity * vec2f(params.gravityX, params.gravityY);
  let forceS = spatial_force + align_force * asp + gravityS;
  var vS = vel * asp;
  let frictionS = -params.friction * sign(vS) * vS * vS;
  vS = vS + params.deltaTime * (forceS + frictionS);

  let sp = length(vS);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vS = vS * (params.maxSpeed / sp);
  }

  // Fingers / mouse (screen-space distance for an isotropic radius): each
  // active pointer attracts in proportion to its pressure. The carry
  // (advection) is applied to position further down, after the speed caps,
  // so a drag moves particles with the finger regardless of maxSpeed.
  var carry = vec2f(0.0);
  for (var i = 0u; i < 4u; i++) {
    let pp = params.pointers[i * 2u];
    if (pp.z <= 0.0) { continue; }
    let toP = wrapDelta(pp.xy - pos);                 // shortest way round the torus
    let toPS = toP * asp;
    let dS = length(toPS);
    let radius = params.mouseRadius / params.viewZoom; // constant on screen
    if (dS < radius && dS > 0.0001) {
      vS += 0.005 * pp.z * toPS / (dS * dS);
      let w = 1.0 - dS / radius;
      carry += params.pointers[i * 2u + 1u].xy * sqrt(w);
    }
  }

  // Noise, applied last so it does not interfere with steering
  if (params.noise > 0.0) {
    vS += rand2(index, params.tick) * params.noise;
    let nsp = length(vS);
    if (nsp > params.maxSpeed && nsp > 0.0001) {
      vS = vS * (params.maxSpeed / nsp);
    }
  }
  vel = vS / asp;

  // Belt and braces: a non-finite velocity never reaches the buffer.
  if (!(dot(vel, vel) < 1e30)) { vel = vec2f(0.0); }

  pos = pos + vel * params.deltaTime;
  // Carried particles move with the finger exactly (per-step displacement)
  // and keep some of that motion as velocity, so they coast on release.
  if (dot(carry, carry) > 0.0) {
    pos = pos + carry;
    vel = vel + carry * (0.3 / params.deltaTime);
  }
  // Torus wrap into [-1, 1)
  pos = pos - floor((pos + 1.0) * 0.5) * 2.0;

  particlesB[index] = Particle(pos, vel);
}
`,L={dt:.016,stepsPerFrame:1,numParticles:5e5,attractionRadius:.15,repulsionRadius:.03,attraction:.3,repulsion:1.5,alignment:.1,friction:2,maxSpeed:.22,coneAngle:-.5,noise:0,mouseRadius:.15,memory:0,splatSize:1.5,viewMode:0,exposure:2,pointAlpha:.15,pointSize:2,pointShape:0,curve:3,tonemap:2,palette:0,tint:-1,bloom:0,longExposure:0},g=2e6,C=320,U=1,k=12,m=y=>y-Math.floor((y+1)*.5)*2,B=4,v="rgba16float";class O{gpu=null;running=!1;paused=!1;animId=0;lastFrameTime=0;frame=0;inFlight=0;maxFps=1/0;tickCount=0;params={...L};maxFieldSize=1024;bgColor={r:.039,g:.031,b:.016,a:1};accent={r:.88,g:.63,b:.25};themeObserver=null;mouseX=0;mouseY=0;mouseActive=!1;pointers=new Map;gesture=null;spaceHeld=!1;viewZoom=1;viewCx=0;viewCy=0;zoomAt(t,i,e){const n=this.viewZoom,o=Math.min(k,Math.max(U,n*t));if(o===n)return;const a=this.viewCx+i/n,u=this.viewCy+e/n;this.viewZoom=o,this.viewCx=m(a-i/o),this.viewCy=m(u-e/o)}panBy(t,i){this.viewCx=m(this.viewCx-t/this.viewZoom),this.viewCy=m(this.viewCy-i/this.viewZoom)}resetView(){this.viewZoom=1,this.viewCx=0,this.viewCy=0}pointerRadiusPx(){const t=this.gpu?.canvas;return(t?t.clientHeight:0)*.5*this.params.mouseRadius}onPointers;gravityX=0;gravityY=-1;gravity=0;uniformBuffer;particleBuffers=[];sampler;fieldTextures=[];fieldFullViews=[];fieldLevelViews=[];fieldW=0;fieldH=0;mipCount=1;writeIdx=0;depositPipeline;depositBindGroups=[];viewLayout;decayPipeline;downsamplePipeline;fieldPipeline;pointPipeline;postLayout;basePipeline;postPipeline;accumTextures=[];accumViews=[];baseBindGroups=[];postBindGroups=[];accumIdx=0;levelBindGroups=[];fullBindGroups=[];computePipeline;computeBindGroups=[];async init(t){try{if(this.gpu=await G(t),!this.gpu)return!1;const{device:i}=this.gpu;this.readTheme(),this.initThemeObserver(),this.uniformBuffer=i.createBuffer({size:C,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sampler=i.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"repeat",addressModeV:"repeat"});for(let r=0;r<2;r++)this.particleBuffers.push(i.createBuffer({size:g*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));this.createPipelines(i),F(t),this.createFieldTextures(i,t.width||1,t.height||1),this.reset();const e=()=>this.onPointers?.(this.gesture?[]:[...this.pointers].filter(([,r])=>!r.pan).map(([r,p])=>({id:r,clientX:p.clientX,clientY:p.clientY,strength:p.strength,type:p.type}))),n=r=>{const p=t.getBoundingClientRect();return[(r.clientX-p.left)/p.width*2-1,-((r.clientY-p.top)/p.height*2-1)]},o=(r,p)=>[m(this.viewCx+r/this.viewZoom),m(this.viewCy+p/this.viewZoom)],a=()=>[...this.pointers.values()].filter(r=>r.type!=="mouse"),u=(r,p)=>({mx:(r.sx+p.sx)/2,my:(r.sy+p.sy)/2,d:Math.max(.001,Math.hypot(r.sx-p.sx,r.sy-p.sy))}),s=r=>{if(r.type==="pointermove"&&!this.pointers.has(r.pointerId)||r.type==="pointerdown"&&this.pointers.size>=B)return;const[p,f]=n(r),d=this.pointers.get(r.pointerId);if(!d){const[x,h]=o(p,f),T=r.pointerType==="mouse"&&(this.spaceHeld||r.altKey||r.button===1);this.pointers.set(r.pointerId,{x,y:h,px:x,py:h,vx:0,vy:0,strength:1,type:r.pointerType,clientX:r.clientX,clientY:r.clientY,sx:p,sy:f,pan:T});try{t.setPointerCapture(r.pointerId)}catch{}T&&r.preventDefault();const S=a();S.length>=2&&(this.gesture=u(S[0],S[1]),this.mouseActive=!1),e();return}if(d.pan){this.panBy(p-d.sx,f-d.sy),d.sx=p,d.sy=f,d.clientX=r.clientX,d.clientY=r.clientY;return}if(d.sx=p,d.sy=f,d.clientX=r.clientX,d.clientY=r.clientY,this.gesture){const x=a();if(x.length>=2){const h=u(x[0],x[1]);this.zoomAt(h.d/this.gesture.d,h.mx,h.my),this.panBy(h.mx-this.gesture.mx,h.my-this.gesture.my),this.gesture=h}return}const[w,P]=o(p,f);d.x=w,d.y=P,this.mouseX=w,this.mouseY=P,this.mouseActive=!0,e()},l=r=>{if(!this.pointers.delete(r.pointerId))return;const p=a();if(this.gesture&&p.length<2){this.gesture=null;for(const f of p){const[d,w]=o(f.sx,f.sy);f.x=f.px=d,f.y=f.py=w,f.vx=f.vy=0}}this.mouseActive=!this.gesture&&[...this.pointers.values()].some(f=>!f.pan),e()};t.addEventListener("wheel",r=>{r.preventDefault();const[p,f]=n(r);this.zoomAt(Math.exp(-r.deltaY*.0015),p,f)},{passive:!1});const c=r=>r instanceof HTMLElement&&(r.tagName==="INPUT"||r.tagName==="TEXTAREA"||r.isContentEditable);return window.addEventListener("keydown",r=>{r.code!=="Space"||c(r.target)||(r.preventDefault(),!r.repeat&&(this.spaceHeld=!0,t.style.cursor="grab"))}),window.addEventListener("keyup",r=>{r.code!=="Space"||c(r.target)||(r.preventDefault(),this.spaceHeld=!1,t.style.cursor="")}),t.addEventListener("auxclick",r=>{r.button===1&&r.preventDefault()}),t.addEventListener("pointerdown",s),t.addEventListener("pointermove",s),t.addEventListener("pointerup",l),t.addEventListener("pointercancel",l),t.addEventListener("lostpointercapture",l),!0}catch(i){return console.error("FieldBoidsController init error:",i),!1}}createPipelines(t){const{format:i}=this.gpu,e={color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}},n=t.createShaderModule({code:b+A});this.depositPipeline=t.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"depositVert"},fragment:{module:n,entryPoint:"depositFrag",targets:[{format:v,blend:e}]},primitive:{topology:"triangle-list"}}),this.depositBindGroups=this.particleBuffers.map(p=>t.createBindGroup({layout:this.depositPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:p}}]}));const o=t.createShaderModule({code:b+E});this.viewLayout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]});const a=t.createPipelineLayout({bindGroupLayouts:[this.viewLayout]}),u=(p,f)=>t.createRenderPipeline({layout:a,vertex:{module:o,entryPoint:"quadVert"},fragment:{module:o,entryPoint:p,targets:[f]},primitive:{topology:"triangle-list"}});this.decayPipeline=u("decayFrag",{format:v}),this.downsamplePipeline=u("downsampleFrag",{format:v}),this.fieldPipeline=u("fieldFrag",{format:i}),this.pointPipeline=t.createRenderPipeline({layout:a,vertex:{module:o,entryPoint:"pointVert"},fragment:{module:o,entryPoint:"pointFrag",targets:[{format:v,blend:e}]},primitive:{topology:"triangle-list"}});const s=t.createShaderModule({code:b+_});this.postLayout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}}]});const l=t.createPipelineLayout({bindGroupLayouts:[this.postLayout]}),c=(p,f)=>t.createRenderPipeline({layout:l,vertex:{module:s,entryPoint:"postQuadVert"},fragment:{module:s,entryPoint:p,targets:[f]},primitive:{topology:"triangle-list"}});this.basePipeline=c("baseFrag",{format:v}),this.postPipeline=c("postFrag",{format:i});const r=t.createShaderModule({code:b+I});this.computePipeline=t.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:"computeMain"}})}createFieldTextures(t,i,e){this.fieldTextures.forEach(s=>s.destroy());const n=Math.max(i,e),o=this.maxFieldSize/n;this.fieldW=Math.max(16,Math.round(i*o)),this.fieldH=Math.max(16,Math.round(e*o)),this.mipCount=Math.floor(Math.log2(Math.max(this.fieldW,this.fieldH)))+1,this.fieldTextures=[0,1].map(()=>t.createTexture({size:[this.fieldW,this.fieldH],format:v,mipLevelCount:this.mipCount,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})),this.fieldFullViews=this.fieldTextures.map(s=>s.createView()),this.fieldLevelViews=this.fieldTextures.map(s=>Array.from({length:this.mipCount},(l,c)=>s.createView({baseMipLevel:c,mipLevelCount:1})));const a=(s,l)=>t.createBindGroup({layout:this.viewLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.sampler},{binding:2,resource:s},{binding:3,resource:{buffer:l}}]});this.levelBindGroups=this.fieldLevelViews.map(s=>s.map(l=>a(l,this.particleBuffers[0]))),this.fullBindGroups=this.fieldFullViews.map(s=>this.particleBuffers.map(l=>a(s,l))),this.accumTextures.forEach(s=>s.destroy()),this.accumTextures=[0,1].map(()=>t.createTexture({size:[Math.max(1,i),Math.max(1,e)],format:v,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})),this.accumViews=this.accumTextures.map(s=>s.createView());const u=(s,l)=>t.createBindGroup({layout:this.postLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.sampler},{binding:2,resource:s},{binding:3,resource:l}]});this.baseBindGroups=this.fieldFullViews.map(s=>this.accumViews.map(l=>u(s,l))),this.postBindGroups=this.accumViews.map(s=>u(this.fieldFullViews[0],s)),this.onFieldTexturesCreated(t)}onFieldTexturesCreated(t){this.computeBindGroups=this.fieldFullViews.map(i=>[0,1].map(e=>t.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[e]}},{binding:2,resource:{buffer:this.particleBuffers[1-e]}},{binding:3,resource:i},{binding:4,resource:this.sampler}]})))}loadPreset(t){Object.assign(this.params,t.params)}capturePreset(t){return{id:t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""),name:t,params:{...this.params}}}start(){this.paused=!1,!this.running&&(this.running=!0,this.tick())}pause(){this.paused=!0,this.running||(this.running=!0,this.tick())}stop(){this.running=!1,this.paused=!1,cancelAnimationFrame(this.animId),clearTimeout(this.animId)}reset(t){if(!this.gpu)return;const{device:i}=this.gpu,e=M(t),n=new Float32Array(g*4);for(let a=0;a<g;a++)n[a*4+0]=(e()-.5)*2,n[a*4+1]=(e()-.5)*2,n[a*4+2]=(e()-.5)*.1,n[a*4+3]=(e()-.5)*.1;i.queue.writeBuffer(this.particleBuffers[0],0,n),i.queue.writeBuffer(this.particleBuffers[1],0,n);const o=i.createCommandEncoder();for(const a of this.fieldLevelViews)for(const u of a)o.beginRenderPass({colorAttachments:[{view:u,loadOp:"clear",storeOp:"store"}]}).end();i.queue.submit([o.finish()]),this.frame=0,this.writeIdx=0}setGravityDirection(t,i){const e=Math.hypot(t,i);e>1e-6&&e>1&&(t/=e,i/=e),this.gravityX=t,this.gravityY=i}resetGravityDirection(){this.gravityX=0,this.gravityY=-1}packUniforms(t){const i=new ArrayBuffer(C),e=new DataView(i),n=this.params;e.setFloat32(0,n.dt,!0),e.setFloat32(4,n.attractionRadius,!0),e.setFloat32(8,n.repulsionRadius,!0),e.setFloat32(12,n.attraction,!0),e.setFloat32(16,n.repulsion,!0),e.setFloat32(20,n.alignment,!0),e.setFloat32(24,n.friction,!0),e.setFloat32(28,n.maxSpeed,!0),e.setUint32(32,Math.min(n.numParticles,g),!0),e.setFloat32(36,this.mouseX,!0),e.setFloat32(40,this.mouseY,!0),e.setFloat32(44,this.mouseActive?1:0,!0),e.setFloat32(48,n.mouseRadius,!0),e.setFloat32(52,n.coneAngle,!0),e.setFloat32(56,t,!0),e.setUint32(60,this.frame,!0),e.setFloat32(64,n.noise,!0),e.setFloat32(68,Math.min(n.memory,.999),!0),e.setFloat32(72,Math.max(.5,n.splatSize),!0),e.setUint32(76,n.viewMode,!0),e.setFloat32(80,n.exposure,!0),e.setFloat32(84,this.fieldW,!0),e.setFloat32(88,this.fieldH,!0),e.setFloat32(92,this.mipCount-1,!0);const o=(n.tint??-1)>=0?{r:(n.tint>>16&255)/255,g:(n.tint>>8&255)/255,b:(n.tint&255)/255}:this.accent;e.setFloat32(96,o.r,!0),e.setFloat32(100,o.g,!0),e.setFloat32(104,o.b,!0),e.setFloat32(108,this.bgColor.r,!0),e.setFloat32(112,this.bgColor.g,!0),e.setFloat32(116,this.bgColor.b,!0),e.setFloat32(120,n.pointAlpha,!0),e.setFloat32(124,this.gravity,!0),e.setFloat32(128,this.gravityX,!0),e.setFloat32(132,this.gravityY,!0),e.setFloat32(136,n.bloom??0,!0),e.setFloat32(140,Math.min(n.longExposure??0,.995),!0),e.setUint32(144,n.curve??3,!0),e.setUint32(148,n.tonemap??2,!0),e.setUint32(152,n.palette??0,!0);const a=this.gpu?.canvas,u=a&&a.width>0&&a.clientWidth>0?a.width/a.clientWidth:1;e.setFloat32(156,Math.max(.5,(n.pointSize??2)*u),!0),e.setFloat32(160,a?.width??1,!0);let s=0;const l=Math.max(1,n.stepsPerFrame);for(const c of this.pointers.values()){if(s>=B)break;if(c.pan||this.gesture)continue;c.vx=.5*c.vx+.5*(m(c.x-c.px)/l),c.vy=.5*c.vy+.5*(m(c.y-c.py)/l),c.px=c.x,c.py=c.y;const r=176+s*32;e.setFloat32(r,c.x,!0),e.setFloat32(r+4,c.y,!0),e.setFloat32(r+8,c.strength,!0),e.setFloat32(r+16,c.vx,!0),e.setFloat32(r+20,c.vy,!0),s++}return e.setFloat32(304,this.viewZoom,!0),e.setFloat32(308,this.viewCx,!0),e.setFloat32(312,this.viewCy,!0),e.setFloat32(164,a?.height??1,!0),e.setUint32(168,n.pointShape??0,!0),i}tick=()=>{if(!this.running||!this.gpu)return;if(Number.isFinite(this.maxFps)){const l=performance.now();if(l-this.lastFrameTime<1e3/this.maxFps-1){this.animId=requestAnimationFrame(this.tick);return}this.lastFrameTime=l}const{device:t,context:i,canvas:e}=this.gpu;F(e)&&this.createFieldTextures(t,e.width||1,e.height||1);const n=e.width>0&&e.height>0?e.width/e.height:1,o=Math.min(this.params.numParticles,g),a=this.paused?0:Math.max(1,Math.min(30,Math.round(this.params.stepsPerFrame)));if(this.paused){t.queue.writeBuffer(this.uniformBuffer,0,this.packUniforms(n));const l=t.createCommandEncoder();this.writeIdx=1-this.writeIdx,this.runDisplay(l,i,(this.frame+1)%2,o),this.writeIdx=1-this.writeIdx,t.queue.submit([l.finish()])}for(let l=0;l<a;l++){t.queue.writeBuffer(this.uniformBuffer,0,this.packUniforms(n));const c=this.frame%2,r=t.createCommandEncoder();this.runDecay(r),this.runDeposit(r,c,o),this.runMips(r),this.runCompute(r,c,o),l===a-1&&this.runDisplay(r,i,c,o),t.queue.submit([r.finish()]),this.frame++,this.writeIdx=1-this.writeIdx}this.tickCount++,this.inFlight++;const u=t.queue.onSubmittedWorkDone().then(()=>{this.inFlight--}),s=()=>{this.running&&(Number.isFinite(this.maxFps)?this.animId=window.setTimeout(this.tick,0):this.animId=requestAnimationFrame(this.tick))};this.inFlight>=2?u.then(s):s()};async prepareStill(t){if(!this.gpu)return;const{device:i,canvas:e}=this.gpu;this.stop(),e.width=t.width,e.height=t.height,this.createFieldTextures(i,t.width,t.height),this.viewZoom=t.viewZoom??1,this.viewCx=t.viewCx??0,this.viewCy=t.viewCy??0,this.mouseActive=!1,this.pointers.clear(),this.reset(t.seed),this.accumIdx=0;const n=Math.max(1,Math.round(t.steps)),o=n-1-120;for(let a=0;a<n-1;a++)this._stillStep(a>=o),a%32===31&&(await i.queue.onSubmittedWorkDone(),t.onProgress?.(a+1,n));await i.queue.onSubmittedWorkDone()}drawStill(){this._stillStep(!0)}_stillStep(t){const{device:i,context:e,canvas:n}=this.gpu,o=n.width/n.height,a=Math.min(this.params.numParticles,g);i.queue.writeBuffer(this.uniformBuffer,0,this.packUniforms(o));const u=this.frame%2,s=i.createCommandEncoder();this.runDecay(s),this.runDeposit(s,u,a),this.runMips(s),this.runCompute(s,u,a),t&&this.runDisplay(s,e,u,a),i.queue.submit([s.finish()]),this.frame++,this.writeIdx=1-this.writeIdx}runDecay(t){if(this.params.memory<=0)return;const i=1-this.writeIdx,e=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][0],loadOp:"clear",storeOp:"store"}]});e.setPipeline(this.decayPipeline),e.setBindGroup(0,this.fullBindGroups[i][0]),e.draw(6),e.end()}runCompute(t,i,e){const n=t.beginComputePass();n.setPipeline(this.computePipeline),n.setBindGroup(0,this.computeBindGroups[this.writeIdx][i]),n.dispatchWorkgroups(Math.ceil(e/64)),n.end()}runDeposit(t,i,e){const n=this.params.memory>0,o=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][0],clearValue:{r:0,g:0,b:0,a:0},loadOp:n?"load":"clear",storeOp:"store"}]});o.setPipeline(this.depositPipeline),o.setBindGroup(0,this.depositBindGroups[i]),o.draw(6,e*4),o.end()}runMips(t){for(let i=1;i<this.mipCount;i++){const e=t.beginRenderPass({colorAttachments:[{view:this.fieldLevelViews[this.writeIdx][i],loadOp:"clear",storeOp:"store"}]});e.setPipeline(this.downsamplePipeline),e.setBindGroup(0,this.levelBindGroups[this.writeIdx][i-1]),e.draw(6),e.end()}}runDisplay(t,i,e,n){const o=this.accumIdx,a=1-o;this.accumIdx=a;const u=t.beginRenderPass({colorAttachments:[{view:this.accumViews[a],clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});if(u.setPipeline(this.basePipeline),u.setBindGroup(0,this.baseBindGroups[this.writeIdx][o]),u.draw(6),u.end(),this.params.viewMode===2){const l=t.beginRenderPass({colorAttachments:[{view:this.accumViews[a],loadOp:"load",storeOp:"store"}]});l.setPipeline(this.pointPipeline),l.setBindGroup(0,this.fullBindGroups[this.writeIdx][1-e]),l.draw(6,n),l.end()}const s=t.beginRenderPass({colorAttachments:[{view:i.getCurrentTexture().createView(),clearValue:this.bgColor,loadOp:"clear",storeOp:"store"}]});s.setPipeline(this.postPipeline),s.setBindGroup(0,this.postBindGroups[a]),s.draw(6),s.end()}readTheme(){if(typeof document>"u")return;const t=getComputedStyle(document.documentElement),i=R(t.getPropertyValue("--bg-primary")),e=R(t.getPropertyValue("--accent"));i&&(this.bgColor={...i,a:1}),e&&(this.accent=e)}initThemeObserver(){typeof MutationObserver>"u"||typeof document>"u"||(this.themeObserver=new MutationObserver(()=>this.readTheme()),this.themeObserver.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}))}}function R(y){let t=y.trim().replace(/^#/,"");return t.length===3&&(t=t.split("").map(i=>i+i).join("")),/^[0-9a-fA-F]{6}$/.test(t)?{r:parseInt(t.slice(0,2),16)/255,g:parseInt(t.slice(2,4),16)/255,b:parseInt(t.slice(4,6),16)/255}:null}const V=Object.freeze(Object.defineProperty({__proto__:null,FieldBoidsController:O,MAX_PARTICLES:g},Symbol.toStringTag,{value:"Module"}));export{L as D,O as F,V as f};
