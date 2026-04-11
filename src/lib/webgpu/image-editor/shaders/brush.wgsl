// src/lib/webgpu/image-editor/shaders/brush.wgsl

struct BrushParams {
  centerX:  f32,
  centerY:  f32,
  radius:   f32,
  softness: f32,
  value:    f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
}
@group(0) @binding(0) var<uniform> brush: BrushParams;

struct VertexOut { @builtin(position) pos: vec4f }

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VertexOut {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f(1.0,  1.0),
  );
  return VertexOut(vec4f(pos[vi], 0.0, 1.0));
}

@fragment
fn fsPaint(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let d     = length(fragPos.xy - vec2f(brush.centerX, brush.centerY));
  if (d > brush.radius) { discard; }
  let inner = brush.radius * (1.0 - brush.softness);
  let alpha = 1.0 - smoothstep(inner, brush.radius, d);
  return vec4f(brush.value, brush.value, brush.value, alpha);
}
