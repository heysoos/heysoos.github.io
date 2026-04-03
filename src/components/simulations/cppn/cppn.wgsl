// CPPN stub — to be implemented with user's reference scripts
@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1),
  );
  return vec4f(pos[i], 0, 1);
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(800.0, 600.0);
  let r = sin(uv.x * 10.0) * 0.5 + 0.5;
  let g = cos(uv.y * 8.0 + uv.x * 3.0) * 0.5 + 0.5;
  let b = sin((uv.x + uv.y) * 6.0) * 0.5 + 0.5;
  return vec4f(r * 0.6, g * 0.4, b * 0.3, 1.0);
}
