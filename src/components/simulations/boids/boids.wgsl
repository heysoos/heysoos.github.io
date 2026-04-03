struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Params {
  deltaTime: f32,
  separationDistance: f32,
  alignmentDistance: f32,
  cohesionDistance: f32,
  separationScale: f32,
  alignmentScale: f32,
  cohesionScale: f32,
  numParticles: u32,
  mouseX: f32,
  mouseY: f32,
  mouseActive: f32,
  mouseRadius: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  var pos = particlesA[index].pos;
  var vel = particlesA[index].vel;

  var separation = vec2f(0.0);
  var alignment = vec2f(0.0);
  var cohesion = vec2f(0.0);
  var sepCount = 0u;
  var aliCount = 0u;
  var cohCount = 0u;

  for (var i = 0u; i < params.numParticles; i++) {
    if (i == index) { continue; }
    let other = particlesA[i];
    let diff = pos - other.pos;
    let dist = length(diff);

    if (dist < params.separationDistance && dist > 0.0) {
      separation += normalize(diff) / dist;
      sepCount++;
    }
    if (dist < params.alignmentDistance) {
      alignment += other.vel;
      aliCount++;
    }
    if (dist < params.cohesionDistance) {
      cohesion += other.pos;
      cohCount++;
    }
  }

  if (sepCount > 0u) { vel += normalize(separation) * params.separationScale; }
  if (aliCount > 0u) { vel += normalize(alignment / f32(aliCount) - vel) * params.alignmentScale; }
  if (cohCount > 0u) { vel += normalize(cohesion / f32(cohCount) - pos) * params.cohesionScale; }

  // Mouse interaction
  if (params.mouseActive > 0.5) {
    let mousePos = vec2f(params.mouseX, params.mouseY);
    let toMouse = mousePos - pos;
    let mouseDist = length(toMouse);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0) {
      vel += normalize(toMouse) * 0.001;
    }
  }

  // Clamp speed
  let speed = length(vel);
  if (speed > 0.01) { vel = normalize(vel) * 0.01; }
  if (speed < 0.001) { vel = normalize(vel) * 0.001; }

  // Wrap around edges
  pos = pos + vel * params.deltaTime;
  if (pos.x < -1.0) { pos.x += 2.0; }
  if (pos.x > 1.0)  { pos.x -= 2.0; }
  if (pos.y < -1.0) { pos.y += 2.0; }
  if (pos.y > 1.0)  { pos.y -= 2.0; }

  particlesB[index] = Particle(pos, vel);
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) vertexPos: vec2f,
) -> VertexOutput {
  let angle = atan2(particleVel.y, particleVel.x);
  let cosA = cos(angle);
  let sinA = sin(angle);
  let rotated = vec2f(
    vertexPos.x * cosA - vertexPos.y * sinA,
    vertexPos.x * sinA + vertexPos.y * cosA,
  );
  var out: VertexOutput;
  out.position = vec4f(particlePos + rotated, 0.0, 1.0);
  out.alpha = clamp(length(particleVel) * 100.0, 0.3, 1.0);
  return out;
}

@fragment
fn fragmentMain(@location(0) alpha: f32) -> @location(0) vec4f {
  return vec4f(0.88, 0.63, 0.25, alpha);
}
