struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Params {
  deltaTime:    f32,  // 0
  outerRadius:  f32,  // 4  — attraction + alignment range
  innerRadius:  f32,  // 8  — repulsion range
  attraction:   f32,  // 12
  repulsion:    f32,  // 16
  alignment:    f32,  // 20
  friction:     f32,  // 24 — quadratic drag coefficient
  maxSpeed:     f32,  // 28
  numParticles: u32,  // 32
  mouseX:       f32,  // 36
  mouseY:       f32,  // 40
  mouseActive:  f32,  // 44
  mouseRadius:  f32,  // 48
  coneAngle:    f32,  // 52 — FOV threshold
  aspect:       f32,  // 56 — canvas width/height
  size:         f32,  // 60 — particle scale (default 0.02)
  shapeId:      u32,  // 64 — 0=triangle 1=circle 2=diamond 3=blob
  colorR:       f32,  // 68
  colorG:       f32,  // 72
  colorB:       f32,  // 76
  _pad0:        f32,  // 80
  _pad1:        f32,  // 84
  _pad2:        f32,  // 88
  _pad3:        f32,  // 92
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

  var force = vec2f(0.0);
  let speed = length(vel);
  let has_vel = speed > 0.0001;

  for (var i = 0u; i < params.numParticles; i++) {
    if (i == index) { continue; }
    let other = particlesA[i];
    let diff = other.pos - pos;
    let r = length(diff);
    if (r < 0.0001) { continue; }

    let diff_dir = diff / r;

    // Field-of-view: dot product of velocity direction with direction to neighbor.
    // pointing > -1.0 means the neighbor is not directly behind (almost omnidirectional).
    var pointing = 0.0;
    if (has_vel) {
      pointing = dot(vel / speed, diff_dir);
    }

    // Outer radius: attraction + velocity alignment (respects field of view)
    if (r < params.outerRadius && pointing > params.coneAngle) {
      force += params.attraction * diff_dir / (r * r + 0.001);
      force += params.alignment * (other.vel - vel);
    }

    // Inner radius: short-range repulsion (omnidirectional)
    if (r < params.innerRadius) {
      force -= params.repulsion * diff_dir / (r * r + 0.0001);
    }
  }

  // Quadratic friction (from reference: -F * sign(vel) * vel^2)
  let friction = -params.friction * sign(vel) * vel * vel;

  vel = vel + params.deltaTime * (force + friction);

  // Clamp to maxSpeed
  let sp = length(vel);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vel = vel * (params.maxSpeed / sp);
  }

  // Mouse attraction
  if (params.mouseActive > 0.5) {
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;
    let mouseDist = length(toMouse);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      vel += normalize(toMouse) * 0.005;
    }
  }

  // Integrate position
  pos = pos + vel * params.deltaTime;

  // Wrap edges
  if (pos.x < -1.0) { pos.x += 2.0; }
  if (pos.x > 1.0)  { pos.x -= 2.0; }
  if (pos.y < -1.0) { pos.y += 2.0; }
  if (pos.y > 1.0)  { pos.y -= 2.0; }

  particlesB[index] = Particle(pos, vel);
}

// --- Render ---

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) uv: vec2f,
}

@vertex
fn vertexMain(
  @location(0) particlePos: vec2f,
  @location(1) particleVel: vec2f,
  @location(2) vertexPos: vec2f,
) -> VertexOutput {
  // Subtract π/2 so tip (starting at +y) aligns with velocity
  let angle = atan2(particleVel.y, particleVel.x) - 1.5707963;
  let cosA = cos(angle);
  let sinA = sin(angle);
  let scaled = vertexPos * params.size;
  let rotated = vec2f(
    scaled.x * cosA - scaled.y * sinA,
    scaled.x * sinA + scaled.y * cosA,
  );
  var out: VertexOutput;
  out.position = vec4f(particlePos + vec2f(rotated.x / params.aspect, rotated.y), 0.0, 1.0);
  out.alpha = clamp(length(particleVel) * 5.0, 0.3, 1.0);
  out.uv = vertexPos; // pre-rotation UV for SDF (-1..1)
  return out;
}

// Equilateral triangle SDF (IQ), inside <= 0, pointing +y
fn sdTriangle(p: vec2f) -> f32 {
  let k = sqrt(3.0);
  var q = vec2f(abs(p.x) - 1.0, p.y + 1.0 / k);
  if q.x + k * q.y > 0.0 {
    q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0;
  }
  q.x = q.x - clamp(q.x, -2.0, 0.0);
  return -length(q) * sign(q.y);
}

@fragment
fn fragmentMain(@location(0) alpha: f32, @location(1) uv: vec2f) -> @location(0) vec4f {
  var mask: f32 = 1.0;

  switch params.shapeId {
    case 0u: { // triangle
      if sdTriangle(uv) > 0.0 { discard; }
    }
    case 1u: { // circle
      if length(uv) > 1.0 { discard; }
    }
    case 2u: { // diamond
      if abs(uv.x) + abs(uv.y) > 1.0 { discard; }
    }
    case 3u: { // soft blob — feathered circle
      let d = length(uv);
      if d > 1.0 { discard; }
      mask = 1.0 - smoothstep(0.4, 1.0, d);
    }
    default: {}
  }

  return vec4f(params.colorR, params.colorG, params.colorB, alpha * mask);
}
