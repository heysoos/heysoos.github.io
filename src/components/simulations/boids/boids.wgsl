struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Params {
  deltaTime:        f32,  // 0
  attractionRadius: f32,  // 4  — attraction + alignment range
  repulsionRadius:  f32,  // 8  — repulsion range
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
  opacity:      f32,  // 80 — global opacity multiplier
  opacityMode:  u32,  // 84 — 0=velocity-based, 1=uniform
  gridDim:      u32,  // 88 — active grid dimension (4–64)
  tick:         u32,  // 92 — frame counter for noise seed
  imageStrength:  f32,  // 96 — 0.0 = feature disabled
  imageForceMode: u32,  // 100
  imageInvert:    u32,  // 104
  noise:          f32,  // 108 — random velocity perturbation magnitude per frame
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;

struct Obstacles {
  rects: array<vec4f, 16>,  // x=cx, y=cy, z=hw, w=hh in NDC
  count: u32,
}

@group(0) @binding(3) var<uniform> obstacles: Obstacles;

// Grid lookup buffers (written by boids-grid.wgsl passes 1-4)
@group(0) @binding(4) var<storage, read> cellOffsets:   array<u32>;
@group(0) @binding(5) var<storage, read> cellCounts:    array<u32>;
@group(0) @binding(6) var<storage, read> sortedIndices: array<u32>;
@group(0) @binding(7) var imageTexture: texture_2d<f32>;
@group(0) @binding(8) var imageSampler: sampler;

// PCG hash (well-distributed, GPU-safe integer arithmetic)
fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (w >> 22u) ^ w;
}

// Random vec2f in [-1,1]² from particle index + frame tick
fn rand2(index: u32, tick: u32) -> vec2f {
  let s1 = pcg(index ^ (tick * 2654435761u));
  let s2 = pcg(s1 + 1u);
  return vec2f(f32(s1), f32(s2)) / f32(0xffffffffu) * 2.0 - vec2f(1.0);
}

fn obstacleForce(pos: vec2f) -> vec2f {
  var force = vec2f(0.0);
  let falloffRadius = 0.12;  // NDC units — tunable

  for (var i = 0u; i < obstacles.count; i++) {
    let r = obstacles.rects[i];
    let center = r.xy;
    let half   = r.zw;

    // Signed distance to nearest rect edge (negative = inside rect)
    let d    = abs(pos - center) - half;
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);

    if (dist < falloffRadius) {
      // smoothstep: 1.0 at rect edge, 0.0 at falloffRadius — C¹ continuous
      let t      = smoothstep(falloffRadius, 0.0, dist);
      let strength = t * t;  // squared for softer onset, steeper near edge

      // Direction: away from nearest point on rect surface.
      // For exterior points, this is simply (pos - nearest) / dist.
      // For interior points (nearest == pos), push toward the nearest edge.
      let nearest = clamp(pos, center - half, center + half);
      let away    = pos - nearest;
      let awayLen = length(away);
      var awayDir: vec2f;
      if (awayLen > 0.0001) {
        awayDir = away / awayLen;
      } else {
        // Inside rect: signed clearance to each wall (negative = inside, closest to 0 = nearest wall)
        let toEdge = abs(pos - center) - half;
        if (toEdge.x > toEdge.y) {
          awayDir = vec2f(select(-1.0, 1.0, pos.x > center.x), 0.0);
        } else {
          awayDir = vec2f(0.0, select(-1.0, 1.0, pos.y > center.y));
        }
      }
      force += awayDir * strength * 1.;
    }
  }
  return force;
}

fn decodeForce(s: vec4f) -> vec2f {
  // a < 0.01 means outside image bounds — no force
  if (s.a < 0.01) { return vec2f(0.0); }
  // rg encodes direction: (dir * 0.5 + 0.5) → decode to [-1, 1]
  let dir = (s.rg * 2.0 - vec2f(1.0)) * s.b;
  return dir;
}

@compute @workgroup_size(256)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  var pos = particlesA[index].pos;
  var vel = particlesA[index].vel;

  // Screen-space velocity (aspect-corrected) used for FOV checks so the
  // cone angle is isotropic regardless of canvas shape.
  let velS = vec2f(vel.x * params.aspect, vel.y);
  let speedS = length(velS);

  // Spatial forces (attraction/repulsion) are accumulated in screen space,
  // then converted back to clip space when applied to velocity.
  // Alignment is accumulated in clip space (velocity-matching, not positional).
  var spatial_force = vec2f(0.0);  // screen space
  var align_force   = vec2f(0.0);  // clip space

  // Adaptive grid: cell size = 2.0 / gridDim (set each frame so cell ≈ attractionRadius)
  let gDim = i32(params.gridDim);
  let cellW = 2.0 / f32(gDim);

  // Determine this particle's grid cell
  let myCellX = i32(clamp(u32((pos.x + 1.0) / cellW), 0u, params.gridDim - 1u));
  let myCellY = i32(clamp(u32((pos.y + 1.0) / cellW), 0u, params.gridDim - 1u));

  // Search radius in cells — with adaptive grid, attractionRadius ≈ cellW, so searchR ≈ 1
  let searchR = max(1i, i32(ceil(params.attractionRadius / cellW)));

  for (var dy = -searchR; dy <= searchR; dy++) {
    for (var dx = -searchR; dx <= searchR; dx++) {
      // Torus wrapping for cell indices
      let nx = u32((myCellX + dx + gDim) % gDim);
      let ny = u32((myCellY + dy + gDim) % gDim);
      let cellID = u32(ny) * params.gridDim + u32(nx);

      let start = cellOffsets[cellID];
      let end   = start + cellCounts[cellID];

      for (var k = start; k < end; k++) {
        let i = sortedIndices[k];
        if (i == index) { continue; }
        let other = particlesA[i];
        var diff = other.pos - pos;
        // Minimum image convention: use shortest path across periodic boundaries
        if (diff.x >  1.0) { diff.x -= 2.0; }
        if (diff.x < -1.0) { diff.x += 2.0; }
        if (diff.y >  1.0) { diff.y -= 2.0; }
        if (diff.y < -1.0) { diff.y += 2.0; }
        // Aspect-correct for isotropic screen-space distances
        let diffS = vec2f(diff.x * params.aspect, diff.y);
        let r = length(diffS);
        if (r < 0.0001) { continue; }

        let dir = diffS / r;  // unit direction in screen space

        // Field-of-view check using screen-space velocity direction
        var pointing = 0.0;
        if (speedS > 0.0001) {
          pointing = dot(velS / speedS, dir);
        }

        // Attraction radius: cohesion + velocity alignment (respects field of view)
        if (r < params.attractionRadius && pointing > params.coneAngle) {
          spatial_force += params.attraction * dir / (r * r + 0.001);
          align_force   += params.alignment * (other.vel - vel);
        }

        // Repulsion radius: short-range repulsion (omnidirectional)
        if (r < params.repulsionRadius) {
          spatial_force -= params.repulsion * dir / (r * r + 0.0001);
        }
      }
    }
  }

  // Convert spatial force from screen space back to clip space, then combine
  let force = vec2f(spatial_force.x / params.aspect, spatial_force.y) + align_force;

  // Quadratic friction (from reference: -F * sign(vel) * vel^2)
  let friction = -params.friction * sign(vel) * vel * vel;

  // Obstacle repulsion applied before the main integrate+clamp so it
  // participates in the speed limit and steers rather than just boosting speed.
  vel = vel + params.deltaTime * (force + friction);

  // Clamp to maxSpeed
  let sp = length(vel);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vel = vel * (params.maxSpeed / sp);
  }
  vel = vel + obstacleForce(pos);

  // Mouse attraction (use screen-space distance for isotropic mouseRadius)
  if (params.mouseActive > 0.5) {
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;
    let toMouseS = vec2f(toMouse.x * params.aspect, toMouse.y);
    let mouseDist = length(toMouseS);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      // Screen-space direction converted back to clip space: aspect cancels
      vel += 0.005 * normalize(toMouse) / mouseDist ;
    }
  }

  // Image force field
  if (params.imageStrength > 0.0) {
    // Map boid NDC position [-1,1] → UV [0,1], flipping Y (NDC y-up, texture y-down)
    let uv      = pos * vec2f(0.5, -0.5) + vec2f(0.5);
    let sample  = textureSampleLevel(imageTexture, imageSampler, uv, 0.0);
    var imgForce = decodeForce(sample);
    if (params.imageInvert == 1u) { imgForce = -imgForce; }
    // Convert canvas-space force (y-down) back to clip-space (y-up)
    vel += vec2f(imgForce.x, -imgForce.y) * params.imageStrength;
  }

  // Random noise perturbation (applied last so it doesn't interfere with steering)
  if (params.noise > 0.0) {
    vel += rand2(index, params.tick) * params.noise;
    let nsp = length(vel);
    if (nsp > params.maxSpeed && nsp > 0.0001) {
      vel = vel * (params.maxSpeed / nsp);
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
  @location(0) speed: f32,
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
  out.speed = length(particleVel);
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
fn fragmentMain(@location(0) speed: f32, @location(1) uv: vec2f) -> @location(0) vec4f {
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

  var finalAlpha: f32;
  if (params.opacityMode == 1u) {
    // Uniform: flat opacity
    finalAlpha = params.opacity;
  } else {
    // Velocity-based (default): brighter = faster
    finalAlpha = clamp(speed * 5.0, 0.3, 1.0) * params.opacity;
  }

  return vec4f(params.colorR, params.colorG, params.colorB, finalAlpha * mask);
}
