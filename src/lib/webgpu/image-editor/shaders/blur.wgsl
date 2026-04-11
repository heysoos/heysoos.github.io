// src/lib/webgpu/image-editor/shaders/blur.wgsl

struct BlurParams {
  radius:    u32,   // kernel half-width in pixels
  horizontal: u32,  // 1 = H pass, 0 = V pass
}

@group(0) @binding(0) var<uniform> p:      BlurParams;
@group(0) @binding(1) var          inTex:  texture_2d<f32>;
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn blurMain(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r     = i32(p.radius);
  var accum = vec4f(0.0);
  var total = 0.0;

  // Gaussian weights: w(i) = exp(-i*i / (2*sigma^2)), sigma = radius/2
  let sigma2 = f32(r) * f32(r) * 0.25 + 0.001;

  for (var i = -r; i <= r; i++) {
    var coord: vec2i;
    if (p.horizontal == 1u) {
      coord = vec2i(i32(id.x) + i, i32(id.y));
    } else {
      coord = vec2i(i32(id.x), i32(id.y) + i);
    }
    let clamped = clamp(coord, vec2i(0), vec2i(dims) - vec2i(1));
    let w  = exp(-f32(i * i) / (2.0 * sigma2));
    accum += textureLoad(inTex, clamped, 0) * w;
    total += w;
  }

  textureStore(outTex, vec2i(id.xy), accum / total);
}
