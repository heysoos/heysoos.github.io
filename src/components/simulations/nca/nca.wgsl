// NCA stub — to be implemented with user's reference scripts
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
  return vec4f(uv.x * 0.3, uv.y * 0.2, 0.1, 1.0);
}
