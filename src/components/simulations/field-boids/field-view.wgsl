// field-view.wgsl — fullscreen passes (decay, mip downsample, field display)
// and the raw-points display. All share one bind group layout; passes that
// don't use a binding still get one bound.
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var fieldSampler: sampler;
@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> particles: array<Particle>;

struct QuadOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn quadVert(@builtin(vertex_index) vi: u32) -> QuadOut {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  var out: QuadOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = ndcToUv(pos[vi]);
  return out;
}

// Decay: dst = src × memory. Bound texture is the PREVIOUS frame's field.
@fragment
fn decayFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(fieldTex, fieldSampler, uv, 0.0) * params.memory;
}

// Downsample: bound view is one mip level; the render target is the next.
// A linear sample at the destination texel centre is the 2×2 box mean.
@fragment
fn downsampleFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

// Field display. viewMode 0: accent tint by density. viewMode 1: hue by the
// direction of the mean velocity, saturation by its magnitude.
@fragment
fn fieldFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let f = textureSampleLevel(fieldTex, fieldSampler, uv, 0.0);
  let bright = 1.0 - exp(-max(f.r, 0.0) * params.exposure);
  let bg = vec3f(params.bgR, params.bgG, params.bgB);
  var tint = vec3f(params.colorR, params.colorG, params.colorB);
  if (params.viewMode == 1u) {
    let u = f.gb / max(f.r, 1e-5);
    let hue = atan2(u.y, u.x) / 6.2831853 + 0.5;
    let sat = clamp(length(u) / max(params.maxSpeed, 1e-4), 0.0, 1.0);
    tint = hsv2rgb(vec3f(hue, 0.35 + 0.65 * sat, 1.0));
  }
  return vec4f(mix(bg, tint, bright), 1.0);
}

// Points display: one shaped sprite per particle, additive into the
// accumulation target's intensity channel (.a), so the post pass applies
// the same curve / palette / tonemap as the density view.
struct PointOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,   // −1..1 across the sprite
}

@vertex
fn pointVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  let c = corners[vi];
  let half = vec2f(params.pointSize / max(params.canvasW, 1.0), params.pointSize / max(params.canvasH, 1.0));
  var out: PointOut;
  out.position = vec4f(worldToScreen(particles[ii].pos) + c * half, 0.0, 1.0);
  out.local = c;
  return out;
}

@fragment
fn pointFrag(@location(0) local: vec2f) -> @location(0) vec4f {
  let r = length(local);
  var a = 0.0;
  switch params.pointShape {
    case 1u: { a = exp(-r * r * 3.0); }                        // soft
    case 2u: { a = smoothstep(0.18, 0.0, abs(r - 0.7)); }       // ring
    default: { a = 1.0 - smoothstep(0.85, 1.0, r); }            // disc
  }
  // Alpha is per-pixel: a bigger sprite is a bigger, equally bright blob
  // (overlaps add up and the tonemap handles dense regions). The constant
  // keeps the default 2 px sprite at the brightness it had before.
  return vec4f(0.0, 0.0, 0.0, a * params.pointAlpha * params.exposure * 4.0);
}
