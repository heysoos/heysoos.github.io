// src/lib/webgpu/image-editor/shaders/composite.wgsl

struct Transform {
  offsetX: f32,
  offsetY: f32,
  scaleX:  f32,
  scaleY:  f32,
}

@group(0) @binding(0) var<uniform> tf: Transform;
@group(0) @binding(1) var srcTex:   texture_2d<f32>;
@group(0) @binding(2) var maskTex:  texture_2d<f32>;
@group(0) @binding(3) var paintTex: texture_2d<f32>;
@group(0) @binding(4) var outTex:   texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn compositeMain(@builtin(global_invocation_id) id: vec3u) {
  let outDims = textureDimensions(outTex);
  if (id.x >= outDims.x || id.y >= outDims.y) { return; }

  // Map output pixel → source image UV via inverse transform
  let cx = f32(id.x);
  let cy = f32(id.y);
  let u  = (cx - tf.offsetX) / tf.scaleX;
  let v  = (cy - tf.offsetY) / tf.scaleY;

  var src = vec4f(0.0);
  if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0 && tf.scaleX != 0.0 && tf.scaleY > 0.0) {
    let srcDims  = textureDimensions(srcTex);
    let srcCoord = vec2u(vec2f(f32(srcDims.x) * u, f32(srcDims.y) * v));
    src = textureLoad(srcTex, clamp(srcCoord, vec2u(0u), srcDims - 1u), 0);
  }

  let mask  = textureLoad(maskTex,  id.xy, 0);
  let paint = textureLoad(paintTex, id.xy, 0);

  // Composite: (source × mask.r) + paint, clamped
  let result = clamp(src * mask.r + paint, vec4f(0.0), vec4f(1.0));
  textureStore(outTex, vec2i(id.xy), result);
}
