// src/lib/webgpu/image-editor/shaders/mode-luminance.wgsl
// mode 0 = attract (toward bright), mode 1 = repel (away from bright)

struct ModeParams { mode: u32, _pad0: u32, _pad1: u32, _pad2: u32 }

@group(0) @binding(0) var<uniform> p:      ModeParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

fn lum(c: vec4f) -> f32 {
  return dot(c.rgb, vec3f(0.299, 0.587, 0.114));
}

@compute @workgroup_size(8, 8)
fn modeMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let c  = textureLoad(inTex, vec2i(id.xy), 0);
  let l  = lum(c);
  let mask = c.a;  // alpha from composite: 1 = has content, 0 = outside image

  // 3×3 Sobel gradient of luminance
  var gx = 0.0; var gy = 0.0;
  let d  = vec2i(dims);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));
      let s     = lum(textureLoad(inTex, coord, 0));
      // Sobel kernels
      let wx = f32(dx) * select(1.0, 2.0, dx == 0); // [-1,0,1; -2,0,2; -1,0,1]
      let wy = f32(dy) * select(1.0, 2.0, dy == 0); // [-1,-2,-1; 0,0,0; 1,2,1]
      gx += s * wx;
      gy += s * wy;
    }
  }

  let gLen = length(vec2f(gx, gy));
  var dir  = vec2f(0.0);
  if (gLen > 0.0001) {
    dir = vec2f(gx, gy) / gLen;
  }

  // mode 1 = repel → negate direction
  if (p.mode == 1u) { dir = -dir; }

  // Encode: rg = dir*0.5+0.5, b = magnitude (luminance), a = mask
  let mag = l;
  let encoded = vec4f(dir * 0.5 + 0.5, mag, mask);
  textureStore(outTex, vec2i(id.xy), encoded);
}
