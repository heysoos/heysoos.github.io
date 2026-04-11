// src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl

struct SdfParams {
  step:      u32,  // current jump step size in pixels
  threshold_bits: u32,
  _pad0: u32, _pad1: u32,
}

@group(0) @binding(0) var<uniform> p:       SdfParams;
@group(0) @binding(1) var          inTex:   texture_2d<f32>;    // source luminance
@group(0) @binding(2) var          pingTex: texture_storage_2d<rgba32float, read_write>; // nearest-coord store
@group(0) @binding(3) var          outTex:  texture_storage_2d<rgba8unorm, write>;       // final output

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

// Pass 1: seed — write pixel coord to pingTex if above threshold, else write sentinel
@compute @workgroup_size(8, 8)
fn sdfSeed(@builtin(global_invocation_id) id: vec3u) {
  let dims      = textureDimensions(inTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let threshold = bitcast<f32>(p.threshold_bits);
  let c         = textureLoad(inTex, vec2i(id.xy), 0);
  let isSeed    = lum(c) > threshold;
  // Store: rg = seed position (normalized), ba = sentinel flag
  if (isSeed) {
    let uv = vec2f(f32(id.x), f32(id.y));
    textureStore(pingTex, vec2i(id.xy), vec4f(uv, 1.0, 1.0));
  } else {
    textureStore(pingTex, vec2i(id.xy), vec4f(-1.0, -1.0, 0.0, 0.0));
  }
}

// Pass 2 (repeated): jump-flood step
@compute @workgroup_size(8, 8)
fn sdfJump(@builtin(global_invocation_id) id: vec3u) {
  let dims  = textureDimensions(inTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let step  = i32(p.step);
  let self  = textureLoad(pingTex, vec2i(id.xy));
  var best  = self;
  var bestDist = 1e9;
  if (self.z > 0.5) {
    let d = vec2f(id.xy) - self.xy;
    bestDist = dot(d, d);
  }

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let nc  = vec2i(i32(id.x) + dx * step, i32(id.y) + dy * step);
      if (any(nc < vec2i(0)) || any(nc >= vec2i(dims))) { continue; }
      let nb  = textureLoad(pingTex, nc);
      if (nb.z < 0.5) { continue; }  // no seed stored
      let dv  = vec2f(id.xy) - nb.xy;
      let d2  = dot(dv, dv);
      if (d2 < bestDist) { bestDist = d2; best = nb; }
    }
  }
  textureStore(pingTex, vec2i(id.xy), best);
}

// Pass 3: finalize — convert nearest-seed distance to force
@compute @workgroup_size(8, 8)
fn sdfFinalize(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let src  = textureLoad(inTex, vec2i(id.xy), 0);
  let mask = src.a;
  let data = textureLoad(pingTex, vec2i(id.xy));

  var dir = vec2f(0.0);
  var mag = 0.0;
  if (data.z > 0.5) {
    let toSeed = data.xy - vec2f(id.xy);
    let dist   = length(toSeed);
    if (dist > 0.5) {
      // Force direction = away from nearest seed (boids orbit the shape boundary)
      dir = -toSeed / dist;
      // Magnitude: strong near seed, falls off with distance
      mag = clamp(1.0 / (1.0 + dist * 0.02), 0.0, 1.0);
    }
  }

  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));
}
