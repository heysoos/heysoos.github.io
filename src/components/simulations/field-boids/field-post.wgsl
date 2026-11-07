// field-post.wgsl — display passes. Own bind group layout (binding 3 is the
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
