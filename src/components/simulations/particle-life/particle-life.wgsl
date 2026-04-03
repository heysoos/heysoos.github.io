struct Particle {
  pos: vec2f,
  vel: vec2f,
  species: f32,
  _pad: f32,
}

struct Params {
  deltaTime: f32,
  numParticles: u32,
  numSpecies: u32,
  friction: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.numParticles) { return; }

  var p = particlesIn[i];
  var force = vec2f(0.0);

  for (var j = 0u; j < params.numParticles; j++) {
    if (i == j) { continue; }
    let other = particlesIn[j];
    let diff = other.pos - p.pos;
    let dist = length(diff);
    if (dist > 0.0 && dist < 0.3) {
      let f = select(0.01, -0.01, dist < 0.05) / dist;
      force += normalize(diff) * f;
    }
  }

  p.vel = (p.vel + force) * params.friction;
  p.pos = p.pos + p.vel * params.deltaTime;

  if (p.pos.x < -1.0) { p.pos.x += 2.0; }
  if (p.pos.x > 1.0)  { p.pos.x -= 2.0; }
  if (p.pos.y < -1.0) { p.pos.y += 2.0; }
  if (p.pos.y > 1.0)  { p.pos.y -= 2.0; }

  particlesOut[i] = p;
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) species: f32,
  @location(3) vertexPos: vec2f,
) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(particlePos + vertexPos * 0.004, 0.0, 1.0);
  let hue = species / 6.0;
  out.color = vec3f(
    abs(hue * 6.0 - 3.0) - 1.0,
    2.0 - abs(hue * 6.0 - 2.0),
    2.0 - abs(hue * 6.0 - 4.0),
  );
  return out;
}

@fragment
fn fragmentMain(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
