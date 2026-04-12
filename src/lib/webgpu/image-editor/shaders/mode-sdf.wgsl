// src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl
//
// Jump-flood SDF using separate read/write textures (ping-pong).
// rgba32float is unfilterable (sampleType:'unfilterable-float') and can't be
// used as texture_2d<f32> with auto-layout.  rgba16float is filterable and
// supports both TEXTURE_BINDING (read via textureLoad) and STORAGE_BINDING
// (write via textureStore) without any WebGPU extensions.

struct SdfParams {
  step:           u32,
  threshold_bits: u32,
  _pad0: u32, _pad1: u32,
}

@group(0) @binding(0) var<uniform> p:      SdfParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;                        // source luminance (read)
@group(0) @binding(2) var          srcTex: texture_2d<f32>;                        // JFA read source  (ping or pong)
@group(0) @binding(3) var          dstTex: texture_storage_2d<rgba16float, write>; // JFA write dest
@group(0) @binding(4) var          outTex: texture_storage_2d<rgba8unorm,  write>; // final force-field output

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

// Pass 1: seed
// Writes pixel coordinate (as seed) or sentinel into dstTex.
// srcTex (binding 2) is not used — no entry in the auto bind-group layout.
@compute @workgroup_size(8, 8)
fn sdfSeed(@builtin(global_invocation_id) id: vec3u) {
  let dims      = textureDimensions(inTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let threshold = bitcast<f32>(p.threshold_bits);
  let c         = textureLoad(inTex, vec2i(id.xy), 0);
  if (lum(c) > threshold) {
    textureStore(dstTex, vec2i(id.xy), vec4f(f32(id.x), f32(id.y), 1.0, 1.0));
  } else {
    textureStore(dstTex, vec2i(id.xy), vec4f(-1.0, -1.0, 0.0, 0.0));
  }
}

// Pass 2 (repeated): jump-flood step.
// Reads from srcTex, writes to dstTex.  Caller alternates ping/pong between invocations.
// inTex (binding 1) and outTex (binding 4) are not used here.
@compute @workgroup_size(8, 8)
fn sdfJump(@builtin(global_invocation_id) id: vec3u) {
  let dims     = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let step     = i32(p.step);
  let cur      = textureLoad(srcTex, vec2i(id.xy), 0);
  var best     = cur;
  var bestDist = 1e9;
  if (cur.z > 0.5) {
    let d = vec2f(id.xy) - cur.xy;
    bestDist = dot(d, d);
  }
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let nc = vec2i(i32(id.x) + dx * step, i32(id.y) + dy * step);
      if (any(nc < vec2i(0)) || any(nc >= vec2i(dims))) { continue; }
      let nb = textureLoad(srcTex, nc, 0);
      if (nb.z < 0.5) { continue; }
      let dv = vec2f(id.xy) - nb.xy;
      let d2 = dot(dv, dv);
      if (d2 < bestDist) { bestDist = d2; best = nb; }
    }
  }
  textureStore(dstTex, vec2i(id.xy), best);
}

// Pass 3: finalize — convert nearest-seed coordinate to force vector.
// dstTex (binding 3) is not used here.
@compute @workgroup_size(8, 8)
fn sdfFinalize(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let src  = textureLoad(inTex, vec2i(id.xy), 0);
  let data = textureLoad(srcTex, vec2i(id.xy), 0);
  var dir  = vec2f(0.0);
  var mag  = 0.0;
  if (data.z > 0.5) {
    let toSeed = data.xy - vec2f(id.xy);
    let dist   = length(toSeed);
    if (dist > 0.5) {
      dir = -toSeed / dist;
      mag = clamp(1.0 / (1.0 + dist * 0.02), 0.0, 1.0);
    }
  }
  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, src.a));
}
