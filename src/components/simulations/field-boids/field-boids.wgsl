// field-boids.wgsl — sense + integrate. One thread per particle. The
// neighbour sum of boids.wgsl is replaced by a fixed stencil of texture taps
// over the (density, momentum) field written by field-deposit.wgsl.
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;
@group(0) @binding(3) var fieldTex: texture_2d<f32>;
@group(0) @binding(4) var fieldSampler: sampler;

// PCG hash (well-distributed, GPU-safe integer arithmetic)
fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rand2(index: u32, tick: u32) -> vec2f {
  let s1 = pcg(index ^ (tick * 2654435761u));
  let s2 = pcg(s1 + 1u);
  return vec2f(f32(s1), f32(s2)) / f32(0xffffffffu) * 2.0 - vec2f(1.0);
}

// One tap. `offS` is a screen-space offset from pos, `areaS` the patch this
// tap stands for (screen units²). The mip level is chosen so one sampled
// texel covers roughly that patch. Returns (count, Σvx, Σvy) over the patch:
// density × area gives a particle count, momentum × area gives Σ velocity.
fn tap(pos: vec2f, offS: vec2f, areaS: f32) -> vec3f {
  let texPerUnit = params.fieldH * 0.5;       // 2 NDC units of y = fieldH texels
  let areaTex = areaS * texPerUnit * texPerUnit;
  let lod = clamp(0.5 * log2(max(areaTex, 1.0)), 0.0, params.maxLod);
  let p = pos + vec2f(offS.x / params.aspect, offS.y);
  let f = textureSampleLevel(fieldTex, fieldSampler, ndcToUv(p), lod);
  return vec3f(f.r, f.g, f.b) * areaTex;
}

const RINGS: i32 = 3;
const TAPS_PER_RING: i32 = 5;
const REPULSE_TAPS: i32 = 6;
const PI: f32 = 3.14159265;
const TAU: f32 = 6.2831853;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  var pos = particlesA[index].pos;
  var vel = particlesA[index].vel;

  // Screen-space heading so the cone is isotropic on any canvas shape.
  let velS = vec2f(vel.x * params.aspect, vel.y);
  let speedS = length(velS);
  let heading = select(vec2f(1.0, 0.0), velS / max(speedS, 1e-4), speedS > 1e-4);
  let headAngle = atan2(heading.y, heading.x);
  let coneHalf = acos(clamp(params.coneAngle, -1.0, 1.0));

  var spatial_force = vec2f(0.0);   // screen space
  var align_force   = vec2f(0.0);   // clip space
  var repulse_force = vec2f(0.0);   // screen space
  var coneCount     = 0.0;
  var repulseCount  = 0.0;

  // Cone stencil: RINGS rings × TAPS_PER_RING taps spanning ±coneHalf.
  // No centre tap, so a particle never reads its own splat here.
  let dr = params.attractionRadius / f32(RINGS);
  let dTheta = 2.0 * coneHalf / f32(TAPS_PER_RING);
  for (var i = 0; i < RINGS; i++) {
    let r = dr * (f32(i) + 0.5);
    let area = dr * r * dTheta;
    for (var j = 0; j < TAPS_PER_RING; j++) {
      let theta = headAngle + (f32(j) - 0.5 * f32(TAPS_PER_RING - 1)) * dTheta;
      let dir = vec2f(cos(theta), sin(theta));
      let t = tap(pos, dir * r, area);
      let n = t.x;
      coneCount     += n;
      spatial_force += n * dir / (r * r + 0.001);
      align_force   += t.yz - n * vel;          // Σ (v_j − v)
    }
  }

  // Repulsion stencil: a full ring at half the repulsion radius. The
  // particle's own splat lands symmetrically in all taps and cancels.
  let rr = 0.5 * params.repulsionRadius;
  let areaR = PI * params.repulsionRadius * params.repulsionRadius / f32(REPULSE_TAPS);
  for (var j = 0; j < REPULSE_TAPS; j++) {
    let theta = headAngle + f32(j) * TAU / f32(REPULSE_TAPS);
    let dir = vec2f(cos(theta), sin(theta));
    let t = tap(pos, dir * rr, areaR);
    repulseCount  += t.x;
    repulse_force -= t.x * dir / (rr * rr + 0.0001);
  }

  // Mean-field normalisation: divide by neighbour count so slider values
  // mean the same thing from 1k to 2M particles. One neighbour reproduces
  // the pairwise boids force exactly.
  let cn = max(coneCount, 1.0);
  let rn = max(repulseCount, 1.0);
  spatial_force = params.attraction * spatial_force / cn
                + params.repulsion  * repulse_force / rn;
  align_force   = params.alignment  * align_force   / cn;

  let force = vec2f(spatial_force.x / params.aspect, spatial_force.y) + align_force;
  let friction = -params.friction * sign(vel) * vel * vel;
  vel = vel + params.deltaTime * (force + friction);

  let sp = length(vel);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vel = vel * (params.maxSpeed / sp);
  }

  // Mouse attraction (screen-space distance for an isotropic radius)
  if (params.mouseActive > 0.5) {
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;
    let toMouseS = vec2f(toMouse.x * params.aspect, toMouse.y);
    let mouseDist = length(toMouseS);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      vel += 0.005 * normalize(toMouse) / mouseDist;
    }
  }

  // Noise, applied last so it does not interfere with steering
  if (params.noise > 0.0) {
    vel += rand2(index, params.tick) * params.noise;
    let nsp = length(vel);
    if (nsp > params.maxSpeed && nsp > 0.0001) {
      vel = vel * (params.maxSpeed / nsp);
    }
  }

  pos = pos + vel * params.deltaTime;
  // Torus wrap into [-1, 1)
  pos = pos - floor((pos + 1.0) * 0.5) * 2.0;

  particlesB[index] = Particle(pos, vel);
}
