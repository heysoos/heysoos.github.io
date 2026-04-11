// src/lib/webgpu/image-editor/shaders/mode-threshold.wgsl
// Applies a hard luminance threshold, then computes gradient of the thresholded field.
// Boids feel force at the boundary between above/below-threshold regions.

struct ModeParams { mode: u32, _pad0: u32, threshold_bits: u32, _pad1: u32 }

@group(0) @binding(0) var<uniform> p:      ModeParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }

@compute @workgroup_size(8, 8)
fn modeMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let c         = textureLoad(inTex, vec2i(id.xy), 0);
  let mask      = c.a;
  let threshold = bitcast<f32>(p.threshold_bits);
  let d         = vec2i(dims);

  // Sobel on thresholded luminance
  var gx = 0.0; var gy = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));
      let s     = select(0.0, 1.0, lum(textureLoad(inTex, coord, 0)) > threshold);
      let wx    = f32(dx) * select(1.0, 2.0, dy == 0); // Sobel Gx: center row weighted ×2
      let wy    = f32(dy) * select(1.0, 2.0, dx == 0); // Sobel Gy: center col weighted ×2
      gx += s * wx;
      gy += s * wy;
    }
  }

  let gLen = length(vec2f(gx, gy));
  var dir  = vec2f(0.0);
  if (gLen > 0.0001) { dir = vec2f(gx, gy) / gLen; }
  let mag = clamp(gLen / 4.0, 0.0, 1.0);

  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));
}
