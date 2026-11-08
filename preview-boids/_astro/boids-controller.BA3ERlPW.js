import{i as V}from"./device.zTc-m6mA.js";import{c as k,a as I}from"./utils.DCtYZSmS.js";const U=`struct Particle {
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
  mouseDX:        f32,  // 112 — pointer displacement this step (NDC), for drag-to-carry
  mouseDY:        f32,  // 116
  _pad0:          f32,  // 120
  _pad1:          f32,  // 124
  viewZoom:       f32,  // 128 — view magnification (1 = whole torus on screen)
  viewCx:         f32,  // 132 — world position at screen centre
  viewCy:         f32,  // 136
  _pad2:          f32,  // 140
}

/// Shortest offset on the [-1,1) torus.
fn wrapD2(d: vec2f) -> vec2f { return d - 2.0 * round(d * 0.5); }

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
@group(0) @binding(6) var<storage, read> sortedParticles: array<Particle>;
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

@compute @workgroup_size(64)
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

  // Adaptive grid: cell size = 2.0 / gridDim (set each frame so cell ≈ max(attractionRadius, repulsionRadius))
  let gDim = i32(params.gridDim);
  let cellW = 2.0 / f32(gDim);

  // Determine this particle's grid cell
  let myCellX = i32(clamp(u32((pos.x + 1.0) / cellW), 0u, params.gridDim - 1u));
  let myCellY = i32(clamp(u32((pos.y + 1.0) / cellW), 0u, params.gridDim - 1u));

  // Search radius in cells — covers whichever radius is larger. The radii
  // are screen-space, cells are clip-space: a clip unit of x spans \`aspect\`
  // screen units, so x needs radius/aspect clip units (more cells on a
  // portrait canvas). Capped so no cell is visited twice round the torus.
  let maxR = max(params.attractionRadius, params.repulsionRadius);
  let halfG = max(1i, (gDim - 1) / 2);
  let searchRx = clamp(i32(ceil(maxR / (cellW * params.aspect))), 1i, halfG);
  let searchRy = clamp(i32(ceil(maxR / cellW)), 1i, halfG);

  for (var dy = -searchRy; dy <= searchRy; dy++) {
    for (var dx = -searchRx; dx <= searchRx; dx++) {
      // Torus wrapping for cell indices
      let nx = u32((myCellX + dx + gDim) % gDim);
      let ny = u32((myCellY + dy + gDim) % gDim);
      let cellID = u32(ny) * params.gridDim + u32(nx);

      let start = cellOffsets[cellID];
      let end   = start + cellCounts[cellID];

      for (var k = start; k < end; k++) {
        let other = sortedParticles[k];
        var diff = other.pos - pos;
        // Minimum image convention: wrap diff into [-1,1] across the period-2 torus
        // — branchless equivalent of four \`if (diff.* > 1)\` / \`< -1\` checks.
        diff -= round(diff * 0.5) * 2.0;
        // Aspect-correct for isotropic screen-space distances
        let diffS = vec2f(diff.x * params.aspect, diff.y);
        let rSq = dot(diffS, diffS);
        // r is floored at ~1e-4 so dir is well-defined for self/coincident
        // (where notCoincident below masks the contribution to zero anyway).
        let r   = sqrt(rSq + 1.0e-8);
        let dir = diffS / r;

        // Branchless FOV: safe-speed avoids div-by-zero without an \`if\`.
        let speedSafe = max(speedS, 1.0e-4);
        let pointing  = dot(velS / speedSafe, dir);

        // Branchless range + FOV gates as 0/1 masks (step(e,x) = 1 iff x>=e).
        // notCoincident drops self / coincident-position pairs (rSq < 1e-8).
        let notCoincident = step(1.0e-8, rSq);
        let attractGate   = step(r, params.attractionRadius)
                            * step(params.coneAngle, pointing)
                            * notCoincident;
        let repulseGate   = step(r, params.repulsionRadius) * notCoincident;

        spatial_force += attractGate * params.attraction * dir / (rSq + 0.001);
        align_force   += attractGate * params.alignment * (other.vel - vel);
        spatial_force -= repulseGate * params.repulsion * dir / (rSq + 0.0001);
      }
    }
  }

  // Velocity dynamics in screen space (x scaled by aspect), so friction,
  // the speed cap, the pointer force and noise are isotropic on screen.
  // In clip space a unit of x covers \`aspect\` times the pixels of a unit
  // of y, which stretched everything along the long axis of the canvas.
  let asp = vec2f(params.aspect, 1.0);
  var vS = vel * asp;
  let forceS = spatial_force + align_force * asp;

  // Quadratic friction (from reference: -F * sign(vel) * vel^2)
  let frictionS = -params.friction * sign(vS) * vS * vS;

  vS = vS + params.deltaTime * (forceS + frictionS);

  // Clamp to maxSpeed
  let sp = length(vS);
  if (sp > params.maxSpeed && sp > 0.0001) {
    vS = vS * (params.maxSpeed / sp);
  }
  vS = vS + obstacleForce(pos) * asp;

  // Mouse attraction (screen-space distance and direction: isotropic radius)
  if (params.mouseActive > 0.5) {
    let toMouse = wrapD2(vec2f(params.mouseX, params.mouseY) - pos);
    let toMouseS = toMouse * asp;
    let mouseDist = length(toMouseS);
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {
      vS += 0.005 * toMouseS / (mouseDist * mouseDist);
    }
  }
  vel = vS / asp;

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

  // Random noise perturbation (applied last so it doesn't interfere with
  // steering), isotropic on screen like the rest.
  if (params.noise > 0.0) {
    var nS = vel * asp + rand2(index, params.tick) * params.noise;
    let nsp = length(nS);
    if (nsp > params.maxSpeed && nsp > 0.0001) {
      nS = nS * (params.maxSpeed / nsp);
    }
    vel = nS / asp;
  }

  // Drag-to-carry: the pointer's displacement this step is added to the
  // position of particles inside mouseRadius (of the old or new pointer
  // position), so a drag moves the clump regardless of maxSpeed; 30% also
  // goes into velocity so they coast when the finger stops.
  if (params.mouseActive > 0.5) {
    let carry = vec2f(params.mouseDX, params.mouseDY);
    let m = vec2f(params.mouseX, params.mouseY);
    let dNew = wrapD2(m - pos);
    let dOld = wrapD2(m - carry - pos);
    let sNew = length(vec2f(dNew.x * params.aspect, dNew.y));
    let sOld = length(vec2f(dOld.x * params.aspect, dOld.y));
    let sMin = min(sNew, sOld);
    if (sMin < params.mouseRadius) {
      // Soft brush: full carry under the finger, fading to nothing at the
      // radius (same falloff as field-boids), so the edge is not a hard wall.
      let w = sqrt(1.0 - sMin / params.mouseRadius);
      pos += carry * w;
      vel += carry * w * 0.3 / max(params.deltaTime, 0.0001);
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
  // View: world → screen along the shortest torus path, sprites magnified
  // with the zoom so zooming in enlarges the pattern rather than thinning it.
  let rel = wrapD2(particlePos - vec2f(params.viewCx, params.viewCy)) * params.viewZoom;
  let sz = rotated * params.viewZoom;
  var out: VertexOutput;
  out.position = vec4f(rel + vec2f(sz.x / params.aspect, sz.y), 0.0, 1.0);
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
`,X=`// boids-grid.wgsl — GPU counting-sort spatial grid passes (non-editable infrastructure)\r
//\r
// Grid: gridDim×gridDim cells (adaptive, 4–64) covering NDC [-1,1]²\r
// Cell size: 2.0/gridDim NDC units — set each frame so cell ≈ attractionRadius,\r
// keeping the neighbor search to ≤3×3 = 9 cells in most cases.\r
//\r
// Per-frame pass order:\r
//   1. clearGrid   — zero first gridDim² cells of cellCounts/cellScatterIdx\r
//   2. gridAssign  — assign each particle to a cell, count particles per cell\r
//   3. prefixSum   — exclusive scan cellCounts → cellOffsets + cellScatterIdx\r
//   4. scatter     — build sortedIndices array (particle indices sorted by cell)\r
\r
// Full params struct — mirrors boids.wgsl exactly so the shared uniform works\r
struct GridParams {\r
  deltaTime:        f32,  // 0\r
  attractionRadius: f32,  // 4\r
  repulsionRadius:  f32,  // 8\r
  attraction:       f32,  // 12\r
  repulsion:        f32,  // 16\r
  alignment:        f32,  // 20\r
  friction:         f32,  // 24\r
  maxSpeed:         f32,  // 28\r
  numParticles:     u32,  // 32\r
  mouseX:           f32,  // 36\r
  mouseY:           f32,  // 40\r
  mouseActive:      f32,  // 44\r
  mouseRadius:      f32,  // 48\r
  coneAngle:        f32,  // 52\r
  aspect:           f32,  // 56\r
  size:             f32,  // 60\r
  shapeId:          u32,  // 64\r
  colorR:           f32,  // 68\r
  colorG:           f32,  // 72\r
  colorB:           f32,  // 76\r
  opacity:          f32,  // 80\r
  opacityMode:      u32,  // 84\r
  gridDim:          u32,  // 88 — active grid dimension (4–64)\r
}\r
\r
struct Particle {\r
  pos: vec2f,\r
  vel: vec2f,\r
}\r
\r
@group(0) @binding(0) var<uniform>           params:         GridParams;\r
@group(0) @binding(1) var<storage, read>     particlesRead:  array<Particle>;\r
@group(0) @binding(2) var<storage, read_write> particleCellIDs: array<u32>;\r
@group(0) @binding(3) var<storage, read_write> cellCounts:    array<atomic<u32>>;\r
@group(0) @binding(4) var<storage, read_write> cellOffsets:   array<u32>;\r
@group(0) @binding(5) var<storage, read_write> cellScatterIdx: array<atomic<u32>>;\r
@group(0) @binding(6) var<storage, read_write> sortedIndices:   array<u32>;\r
@group(0) @binding(7) var<storage, read_write> sortedParticles: array<Particle>;\r
\r
// ─────────────────────────────────────────────────────────────────────────────\r
// Pass 1: clearGrid — zero active cells before each frame\r
// Dispatch: ceil(gridDim² / 64)\r
// ─────────────────────────────────────────────────────────────────────────────\r
@compute @workgroup_size(64)\r
fn clearGrid(@builtin(global_invocation_id) id: vec3u) {\r
  let i = id.x;\r
  if (i >= params.gridDim * params.gridDim) { return; }\r
  atomicStore(&cellCounts[i], 0u);\r
  atomicStore(&cellScatterIdx[i], 0u);\r
}\r
\r
// ─────────────────────────────────────────────────────────────────────────────\r
// Pass 2: gridAssign — compute cell ID for each particle, count per cell\r
// Dispatch: ceil(numParticles / 64)\r
// ─────────────────────────────────────────────────────────────────────────────\r
@compute @workgroup_size(64)\r
fn gridAssign(@builtin(global_invocation_id) id: vec3u) {\r
  let index = id.x;\r
  if (index >= params.numParticles) { return; }\r
\r
  let pos = particlesRead[index].pos;\r
  let gDim = params.gridDim;\r
\r
  // Map position from NDC [-1,1] to grid cell index, clamped to valid range\r
  let cellX = clamp(u32((pos.x + 1.0) * f32(gDim) * 0.5), 0u, gDim - 1u);\r
  let cellY = clamp(u32((pos.y + 1.0) * f32(gDim) * 0.5), 0u, gDim - 1u);\r
  let cellID = cellY * gDim + cellX;\r
\r
  particleCellIDs[index] = cellID;\r
  atomicAdd(&cellCounts[cellID], 1u);\r
}\r
\r
// ─────────────────────────────────────────────────────────────────────────────\r
// Pass 3: prefixSum — exclusive scan of cellCounts → cellOffsets + cellScatterIdx\r
//\r
// Single-workgroup parallel scan: 256 threads × TILE_SIZE=16 elements each\r
// covers gridSize ≤ 4096 (MAX_GRID_DIM² = 64² = 4096). Three phases:\r
//   1. Each thread sums its tile sequentially → partials[tid]\r
//   2. Hillis-Steele inclusive scan across partials[256] (log2(256)=8 steps)\r
//   3. Each thread writes per-element exclusive prefix from its tile base\r
//\r
// Dispatch: 1 workgroup (256 threads).\r
// ─────────────────────────────────────────────────────────────────────────────\r
const PREFIX_WG_SIZE: u32 = 256u;\r
const PREFIX_TILE:    u32 = 16u;  // PREFIX_WG_SIZE * PREFIX_TILE = 4096 = MAX gridSize\r
\r
var<workgroup> partials: array<u32, 256>;\r
\r
@compute @workgroup_size(256)\r
fn prefixSum(@builtin(local_invocation_id) lid: vec3u) {\r
  let tid      = lid.x;\r
  let gridSize = params.gridDim * params.gridDim;\r
  let base     = tid * PREFIX_TILE;\r
\r
  // Phase 1: per-thread sum of the 16-element tile\r
  var local_sum = 0u;\r
  for (var i = 0u; i < PREFIX_TILE; i++) {\r
    let idx = base + i;\r
    if (idx < gridSize) {\r
      local_sum += atomicLoad(&cellCounts[idx]);\r
    }\r
  }\r
  partials[tid] = local_sum;\r
  workgroupBarrier();\r
\r
  // Phase 2: Hillis-Steele inclusive scan across partials[]\r
  // After log2(WG_SIZE) iterations, partials[i] = sum(partials_initial[0..=i])\r
  for (var step = 1u; step < PREFIX_WG_SIZE; step = step << 1u) {\r
    let v = select(0u, partials[tid - step], tid >= step);\r
    workgroupBarrier();\r
    partials[tid] = partials[tid] + v;\r
    workgroupBarrier();\r
  }\r
  // Convert inclusive → exclusive at the *tile* boundary\r
  let prefix = select(0u, partials[tid - 1u], tid > 0u);\r
\r
  // Phase 3: per-element exclusive prefix within this thread's tile\r
  var run = prefix;\r
  for (var i = 0u; i < PREFIX_TILE; i++) {\r
    let idx = base + i;\r
    if (idx < gridSize) {\r
      cellOffsets[idx] = run;\r
      atomicStore(&cellScatterIdx[idx], run);\r
      run = run + atomicLoad(&cellCounts[idx]);\r
    }\r
  }\r
}\r
\r
// ─────────────────────────────────────────────────────────────────────────────\r
// Pass 4: scatter — place each particle into its sorted position\r
// Dispatch: ceil(numParticles / 64)\r
// ─────────────────────────────────────────────────────────────────────────────\r
@compute @workgroup_size(64)\r
fn scatter(@builtin(global_invocation_id) id: vec3u) {\r
  let index = id.x;\r
  if (index >= params.numParticles) { return; }\r
\r
  let cellID = particleCellIDs[index];\r
  let slot = atomicAdd(&cellScatterIdx[cellID], 1u);\r
  sortedIndices[slot] = index;\r
}\r
\r
// ─────────────────────────────────────────────────────────────────────────────\r
// Pass 5: scatterData — copy particle data into cell-sorted order\r
// Enables sequential memory access in the boids compute pass instead of\r
// scattered reads via sortedIndices[k] → particlesA[i].\r
// Dispatch: ceil(numParticles / 64)\r
// ─────────────────────────────────────────────────────────────────────────────\r
@compute @workgroup_size(64)\r
fn scatterData(@builtin(global_invocation_id) id: vec3u) {\r
  let index = id.x;\r
  if (index >= params.numParticles) { return; }\r
  sortedParticles[index] = particlesRead[sortedIndices[index]];\r
}\r
`,Y=`// Shared vertex shader for fullscreen quad passes.\r
// Covers clip space using a 6-vertex triangle list (no vertex buffer needed).\r
struct QuadOutput {\r
  @builtin(position) position: vec4f,\r
  @location(0) uv: vec2f,\r
}\r
\r
@vertex\r
fn quadVert(@builtin(vertex_index) vi: u32) -> QuadOutput {\r
  var pos = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),\r
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),\r
  );\r
  // UV: (0,0) top-left → (1,1) bottom-right, flipped y for texture coordinates\r
  var uv = array<vec2f, 6>(\r
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),\r
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),\r
  );\r
  var out: QuadOutput;\r
  out.position = vec4f(pos[vi], 0.0, 1.0);\r
  out.uv = uv[vi];\r
  return out;\r
}\r
\r
// Fade pass: sample trail texture, decay toward bgColor.\r
//   params.rgb = bgColor (the target color trails fade back to — page background)\r
//   params.a   = decayFactor (multiplier per frame applied to (c - bgColor))\r
@group(0) @binding(0) var fadeSampler: sampler;\r
@group(0) @binding(1) var fadeTex: texture_2d<f32>;\r
@group(0) @binding(2) var<uniform> params: vec4f;\r
\r
@fragment\r
fn fadeFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  let c     = textureSample(fadeTex, fadeSampler, uv);\r
  let bg    = params.rgb;\r
  let decay = params.a;\r
  // Operate on the delta from bg so the asymptote is bg, not 0. Subtract half a\r
  // quantization step in the direction of bg after decaying. Without this, small\r
  // |delta| values round back to themselves in bgra8unorm storage and never reach\r
  // bg. select() clamps any component that crossed bg this frame.\r
  let delta  = c.rgb - bg;\r
  let faded  = delta * decay;\r
  let biased = faded - sign(faded) * vec3f(0.5 / 255.0);\r
  let snapped = select(biased, vec3f(0.0), sign(biased) != sign(faded));\r
  return vec4f(bg + snapped, 1.0);\r
}\r
\r
// Blit pass: copy trail texture to swapchain unchanged.\r
@group(0) @binding(0) var blitSampler: sampler;\r
@group(0) @binding(1) var blitTex: texture_2d<f32>;\r
\r
@fragment\r
fn blitFrag(@location(0) uv: vec2f) -> @location(0) vec4f {\r
  return textureSample(blitTex, blitSampler, uv);\r
}\r
`;class q{fadePipeline;blitPipeline;sampler;decayBuffer;trailTextures=[];trailViews=[];fadeBindGroups=[];blitBindGroups=[];readIdx=0;writeIdx=1;format="bgra8unorm";init(e,r,t,i){this.format=r;const s=e.createShaderModule({code:Y});this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.decayBuffer=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.fadePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:s,entryPoint:"quadVert"},fragment:{module:s,entryPoint:"fadeFrag",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.blitPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:s,entryPoint:"quadVert"},fragment:{module:s,entryPoint:"blitFrag",targets:[{format:r}]},primitive:{topology:"triangle-list"}}),this._createTextures(e,t,i)}_createTextures(e,r,t){this.trailTextures.forEach(s=>s.destroy());const i={size:[r,t],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING};this.trailTextures=[e.createTexture(i),e.createTexture(i)],this.trailViews=this.trailTextures.map(s=>s.createView()),this.fadeBindGroups=[0,1].map(s=>e.createBindGroup({layout:this.fadePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.trailViews[s]},{binding:2,resource:{buffer:this.decayBuffer}}]})),this.blitBindGroups=[0,1].map(s=>e.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:this.trailViews[s]}]})),this.readIdx=0,this.writeIdx=1}resize(e,r,t){this._createTextures(e,r,t)}primeBg(e,r){const t=e.createCommandEncoder();for(const i of this.trailViews)t.beginRenderPass({colorAttachments:[{view:i,loadOp:"clear",storeOp:"store",clearValue:r}]}).end();e.queue.submit([t.finish()])}render(e,r,t,i,s,o){if(!i){const d=e.createCommandEncoder();o(d,r.getCurrentTexture().createView(),"clear"),e.queue.submit([d.finish()]);return}const a=s;e.queue.writeBuffer(this.decayBuffer,0,new Float32Array([a.r,a.g,a.b,t]));const p=e.createCommandEncoder();{const d=p.beginRenderPass({colorAttachments:[{view:this.trailViews[this.writeIdx],loadOp:"clear",storeOp:"store",clearValue:s}]});d.setPipeline(this.fadePipeline),d.setBindGroup(0,this.fadeBindGroups[this.readIdx]),d.draw(6),d.end()}o(p,this.trailViews[this.writeIdx],"load");{const d=p.beginRenderPass({colorAttachments:[{view:r.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:s}]});d.setPipeline(this.blitPipeline),d.setBindGroup(0,this.blitBindGroups[this.writeIdx]),d.draw(6),d.end()}e.queue.submit([p.finish()]),this.readIdx=this.writeIdx,this.writeIdx=1-this.writeIdx}destroy(){this.trailTextures.forEach(e=>e.destroy())}}const O={LuminanceAttract:0,GradientAttract:3,SDF:5},C={Paint:"paint",ErasePaint:"erase-paint",MaskImage:"mask-image",Blur:"blur"},N=`// src/lib/webgpu/image-editor/shaders/brush.wgsl\r
\r
struct BrushParams {\r
  centerX:  f32,\r
  centerY:  f32,\r
  radius:   f32,\r
  softness: f32,\r
  value:    f32,\r
  _pad0: f32, _pad1: f32, _pad2: f32,\r
}\r
@group(0) @binding(0) var<uniform> brush: BrushParams;\r
\r
struct VertexOut { @builtin(position) pos: vec4f }\r
\r
@vertex\r
fn vsMain(@builtin(vertex_index) vi: u32) -> VertexOut {\r
  var pos = array<vec2f, 6>(\r
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),\r
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f(1.0,  1.0),\r
  );\r
  return VertexOut(vec4f(pos[vi], 0.0, 1.0));\r
}\r
\r
@fragment\r
fn fsPaint(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {\r
  let d     = length(fragPos.xy - vec2f(brush.centerX, brush.centerY));\r
  if (d > brush.radius) { discard; }\r
  let inner = brush.radius * (1.0 - brush.softness);\r
  let alpha = 1.0 - smoothstep(inner, brush.radius, d);\r
  return vec4f(brush.value, brush.value, brush.value, alpha);\r
}\r
`,z=`// src/lib/webgpu/image-editor/shaders/blur.wgsl\r
\r
struct BlurParams {\r
  radius:    u32,   // kernel half-width in pixels\r
  horizontal: u32,  // 1 = H pass, 0 = V pass\r
}\r
\r
@group(0) @binding(0) var<uniform> p:      BlurParams;\r
@group(0) @binding(1) var          inTex:  texture_2d<f32>;\r
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;\r
\r
@compute @workgroup_size(8, 8)\r
fn blurMain(@builtin(global_invocation_id) id: vec3u) {\r
  let dims = textureDimensions(outTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
\r
  let r     = i32(p.radius);\r
  var accum = vec4f(0.0);\r
  var total = 0.0;\r
\r
  // Gaussian weights: w(i) = exp(-i*i / (2*sigma^2)), sigma = radius/2\r
  let sigma2 = f32(r) * f32(r) * 0.25 + 0.001;\r
\r
  for (var i = -r; i <= r; i++) {\r
    var coord: vec2i;\r
    if (p.horizontal == 1u) {\r
      coord = vec2i(i32(id.x) + i, i32(id.y));\r
    } else {\r
      coord = vec2i(i32(id.x), i32(id.y) + i);\r
    }\r
    let clamped = clamp(coord, vec2i(0), vec2i(dims) - vec2i(1));\r
    let w  = exp(-f32(i * i) / (2.0 * sigma2));\r
    accum += textureLoad(inTex, clamped, 0) * w;\r
    total += w;\r
  }\r
\r
  textureStore(outTex, vec2i(id.xy), accum / total);\r
}\r
`;class W{device;brushUniform;paintPipeline;erasePipeline;blurComputePipeline;blurUniform;init(e){this.device=e;const r=e.createShaderModule({code:N}),t=e.createShaderModule({code:z});this.brushUniform=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.blurUniform=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.paintPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vsMain"},fragment:{module:r,entryPoint:"fsPaint",targets:[{format:"rgba8unorm",blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.erasePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vsMain"},fragment:{module:r,entryPoint:"fsPaint",targets:[{format:"rgba8unorm",blend:{color:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.blurComputePipeline=e.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:"blurMain"}})}stroke(e,r,t){const{mode:i,x:s,y:o,radius:a,softness:p}=e;if(i===C.Blur){if(!t)return;this._applyBlur(r,t,s,o,a,p);return}const d=i===C.ErasePaint||i===C.MaskImage,l=d?0:1,v=new Float32Array([s,o,a,p,l,0,0,0]);this.device.queue.writeBuffer(this.brushUniform,0,v);const b=d?this.erasePipeline:this.paintPipeline,x=this.device.createBindGroup({layout:b.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.brushUniform}}]}),h=r.createView(),y=this.device.createCommandEncoder(),m=y.beginRenderPass({colorAttachments:[{view:h,loadOp:"load",storeOp:"store"}]});m.setPipeline(b),m.setBindGroup(0,x),m.draw(6),m.end(),this.device.queue.submit([y.finish()])}_applyBlur(e,r,t,i,s,o){const{width:a,height:p}=e,d=Math.max(1,Math.round(s/4)),l=(x,h)=>{const y=new Uint32Array([x,h,0,0]);this.device.queue.writeBuffer(this.blurUniform,0,y)},v=this.device.createCommandEncoder();v.copyTextureToTexture({texture:e},{texture:r},[a,p,1]),this.device.queue.submit([v.finish()]),l(d,1),this._dispatchBlur(r,e,a,p);const b=this.device.createCommandEncoder();b.copyTextureToTexture({texture:e},{texture:r},[a,p,1]),this.device.queue.submit([b.finish()]),l(d,0),this._dispatchBlur(r,e,a,p)}_dispatchBlur(e,r,t,i){const s=this.device.createBindGroup({layout:this.blurComputePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.blurUniform}},{binding:1,resource:e.createView()},{binding:2,resource:r.createView()}]}),o=this.device.createCommandEncoder(),a=o.beginComputePass();a.setPipeline(this.blurComputePipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(Math.ceil(t/8),Math.ceil(i/8)),a.end(),this.device.queue.submit([o.finish()])}destroy(){this.brushUniform.destroy(),this.blurUniform.destroy()}}const H=`// src/lib/webgpu/image-editor/shaders/composite.wgsl\r
\r
struct Transform {\r
  offsetX: f32,\r
  offsetY: f32,\r
  scaleX:  f32,\r
  scaleY:  f32,\r
}\r
\r
@group(0) @binding(0) var<uniform> tf: Transform;\r
@group(0) @binding(1) var srcTex:   texture_2d<f32>;\r
@group(0) @binding(2) var maskTex:  texture_2d<f32>;\r
@group(0) @binding(3) var paintTex: texture_2d<f32>;\r
@group(0) @binding(4) var outTex:   texture_storage_2d<rgba8unorm, write>;\r
\r
@compute @workgroup_size(8, 8)\r
fn compositeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let outDims = textureDimensions(outTex);\r
  if (id.x >= outDims.x || id.y >= outDims.y) { return; }\r
\r
  // Map output pixel → source image UV via inverse transform\r
  let cx = f32(id.x);\r
  let cy = f32(id.y);\r
  let u  = (cx - tf.offsetX) / tf.scaleX;\r
  let v  = (cy - tf.offsetY) / tf.scaleY;\r
\r
  var src = vec4f(0.0);\r
  if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0 && tf.scaleX != 0.0 && tf.scaleY > 0.0) {\r
    let srcDims  = textureDimensions(srcTex);\r
    let srcCoord = vec2u(vec2f(f32(srcDims.x) * u, f32(srcDims.y) * v));\r
    src = textureLoad(srcTex, clamp(srcCoord, vec2u(0u), srcDims - 1u), 0);\r
  }\r
\r
  let mask  = textureLoad(maskTex,  id.xy, 0);\r
  let paint = textureLoad(paintTex, id.xy, 0);\r
\r
  // Composite: (source × mask.r) + paint, clamped\r
  let result = clamp(src * mask.r + paint, vec4f(0.0), vec4f(1.0));\r
  textureStore(outTex, vec2i(id.xy), result);\r
}\r
`,Z=`// src/lib/webgpu/image-editor/shaders/mode-luminance.wgsl\r
// mode 0 = attract (toward bright), mode 1 = repel (away from bright)\r
\r
struct ModeParams { mode: u32, _pad0: u32, _pad1: u32, _pad2: u32 }\r
\r
@group(0) @binding(0) var<uniform> p:      ModeParams;\r
@group(0) @binding(1) var          inTex:  texture_2d<f32>;\r
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;\r
\r
fn lum(c: vec4f) -> f32 {\r
  return dot(c.rgb, vec3f(0.299, 0.587, 0.114));\r
}\r
\r
@compute @workgroup_size(8, 8)\r
fn modeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let dims = textureDimensions(outTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
\r
  let c  = textureLoad(inTex, vec2i(id.xy), 0);\r
  let l  = lum(c);\r
  let mask = c.a;  // alpha from composite: 1 = has content, 0 = outside image\r
\r
  // 3×3 Sobel gradient of luminance\r
  var gx = 0.0; var gy = 0.0;\r
  let d  = vec2i(dims);\r
  for (var dy = -1; dy <= 1; dy++) {\r
    for (var dx = -1; dx <= 1; dx++) {\r
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));\r
      let s     = lum(textureLoad(inTex, coord, 0));\r
      // Sobel kernels\r
      let wx = f32(dx) * select(1.0, 2.0, dy == 0); // Sobel Gx: center row weighted ×2\r
      let wy = f32(dy) * select(1.0, 2.0, dx == 0); // Sobel Gy: center col weighted ×2\r
      gx += s * wx;\r
      gy += s * wy;\r
    }\r
  }\r
\r
  let gLen = length(vec2f(gx, gy));\r
  var dir  = vec2f(0.0);\r
  if (gLen > 0.0001) {\r
    dir = vec2f(gx, gy) / gLen;\r
  }\r
\r
  // mode 1 = repel → negate direction\r
  if (p.mode == 1u) { dir = -dir; }\r
\r
  // Encode: rg = dir*0.5+0.5, b = magnitude (luminance), a = mask\r
  let mag = l;\r
  let encoded = vec4f(dir * 0.5 + 0.5, mag, mask);\r
  textureStore(outTex, vec2i(id.xy), encoded);\r
}\r
`,J=`// src/lib/webgpu/image-editor/shaders/mode-gradient.wgsl\r
// mode 2 = gradient flow (along contours), mode 3 = gradient attract (toward edges)\r
\r
struct ModeParams { mode: u32, _pad0: u32, _pad1: u32, _pad2: u32 }\r
\r
@group(0) @binding(0) var<uniform> p:      ModeParams;\r
@group(0) @binding(1) var          inTex:  texture_2d<f32>;\r
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;\r
\r
fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }\r
\r
@compute @workgroup_size(8, 8)\r
fn modeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let dims = textureDimensions(outTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
\r
  let c    = textureLoad(inTex, vec2i(id.xy), 0);\r
  let mask = c.a;\r
  let d    = vec2i(dims);\r
\r
  var gx = 0.0; var gy = 0.0;\r
  for (var dy = -1; dy <= 1; dy++) {\r
    for (var dx = -1; dx <= 1; dx++) {\r
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));\r
      let s     = lum(textureLoad(inTex, coord, 0));\r
      let wx    = f32(dx) * select(1.0, 2.0, dy == 0); // Sobel Gx: center row weighted ×2\r
      let wy    = f32(dy) * select(1.0, 2.0, dx == 0); // Sobel Gy: center col weighted ×2\r
      gx += s * wx;\r
      gy += s * wy;\r
    }\r
  }\r
\r
  let gLen = length(vec2f(gx, gy));\r
  var dir  = vec2f(0.0);\r
  if (gLen > 0.0001) {\r
    let norm = vec2f(gx, gy) / gLen;\r
    if (p.mode == 2u) {\r
      dir = vec2f(-norm.y, norm.x);  // tangent: flow along contours\r
    } else {\r
      dir = norm;                     // normal: attract toward edges\r
    }\r
  }\r
\r
  // magnitude = edge strength (gradient magnitude), normalized to ~[0,1]\r
  let mag = clamp(gLen / 4.0, 0.0, 1.0);\r
  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));\r
}\r
`,j=`// src/lib/webgpu/image-editor/shaders/mode-threshold.wgsl\r
// Applies a hard luminance threshold, then computes gradient of the thresholded field.\r
// Boids feel force at the boundary between above/below-threshold regions.\r
\r
struct ModeParams { mode: u32, _pad0: u32, threshold_bits: u32, _pad1: u32 }\r
\r
@group(0) @binding(0) var<uniform> p:      ModeParams;\r
@group(0) @binding(1) var          inTex:  texture_2d<f32>;\r
@group(0) @binding(2) var          outTex: texture_storage_2d<rgba8unorm, write>;\r
\r
fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }\r
\r
@compute @workgroup_size(8, 8)\r
fn modeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let dims = textureDimensions(outTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
\r
  let c         = textureLoad(inTex, vec2i(id.xy), 0);\r
  let mask      = c.a;\r
  let threshold = bitcast<f32>(p.threshold_bits);\r
  let d         = vec2i(dims);\r
\r
  // Sobel on thresholded luminance\r
  var gx = 0.0; var gy = 0.0;\r
  for (var dy = -1; dy <= 1; dy++) {\r
    for (var dx = -1; dx <= 1; dx++) {\r
      let coord = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), d - vec2i(1));\r
      let s     = select(0.0, 1.0, lum(textureLoad(inTex, coord, 0)) > threshold);\r
      let wx    = f32(dx) * select(1.0, 2.0, dy == 0); // Sobel Gx: center row weighted ×2\r
      let wy    = f32(dy) * select(1.0, 2.0, dx == 0); // Sobel Gy: center col weighted ×2\r
      gx += s * wx;\r
      gy += s * wy;\r
    }\r
  }\r
\r
  let gLen = length(vec2f(gx, gy));\r
  var dir  = vec2f(0.0);\r
  if (gLen > 0.0001) { dir = vec2f(gx, gy) / gLen; }\r
  let mag = clamp(gLen / 4.0, 0.0, 1.0);\r
\r
  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, mask));\r
}\r
`,E=`// src/lib/webgpu/image-editor/shaders/mode-sdf.wgsl\r
//\r
// Jump-flood SDF using separate read/write textures (ping-pong).\r
// rgba32float is unfilterable (sampleType:'unfilterable-float') and can't be\r
// used as texture_2d<f32> with auto-layout.  rgba16float is filterable and\r
// supports both TEXTURE_BINDING (read via textureLoad) and STORAGE_BINDING\r
// (write via textureStore) without any WebGPU extensions.\r
\r
struct SdfParams {\r
  step:           u32,\r
  threshold_bits: u32,\r
  _pad0: u32, _pad1: u32,\r
}\r
\r
@group(0) @binding(0) var<uniform> p:      SdfParams;\r
@group(0) @binding(1) var          inTex:  texture_2d<f32>;                        // source luminance (read)\r
@group(0) @binding(2) var          srcTex: texture_2d<f32>;                        // JFA read source  (ping or pong)\r
@group(0) @binding(3) var          dstTex: texture_storage_2d<rgba16float, write>; // JFA write dest\r
@group(0) @binding(4) var          outTex: texture_storage_2d<rgba8unorm,  write>; // final force-field output\r
\r
fn lum(c: vec4f) -> f32 { return dot(c.rgb, vec3f(0.299, 0.587, 0.114)); }\r
\r
// Pass 1: seed\r
// Writes pixel coordinate (as seed) or sentinel into dstTex.\r
// srcTex (binding 2) is not used — no entry in the auto bind-group layout.\r
@compute @workgroup_size(8, 8)\r
fn sdfSeed(@builtin(global_invocation_id) id: vec3u) {\r
  let dims      = textureDimensions(inTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
  let threshold = bitcast<f32>(p.threshold_bits);\r
  let c         = textureLoad(inTex, vec2i(id.xy), 0);\r
  if (lum(c) > threshold) {\r
    textureStore(dstTex, vec2i(id.xy), vec4f(f32(id.x), f32(id.y), 1.0, 1.0));\r
  } else {\r
    textureStore(dstTex, vec2i(id.xy), vec4f(-1.0, -1.0, 0.0, 0.0));\r
  }\r
}\r
\r
// Pass 2 (repeated): jump-flood step.\r
// Reads from srcTex, writes to dstTex.  Caller alternates ping/pong between invocations.\r
// inTex (binding 1) and outTex (binding 4) are not used here.\r
@compute @workgroup_size(8, 8)\r
fn sdfJump(@builtin(global_invocation_id) id: vec3u) {\r
  let dims     = textureDimensions(srcTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
  let step     = i32(p.step);\r
  let cur      = textureLoad(srcTex, vec2i(id.xy), 0);\r
  var best     = cur;\r
  var bestDist = 1e9;\r
  if (cur.z > 0.5) {\r
    let d = vec2f(id.xy) - cur.xy;\r
    bestDist = dot(d, d);\r
  }\r
  for (var dy = -1; dy <= 1; dy++) {\r
    for (var dx = -1; dx <= 1; dx++) {\r
      if (dx == 0 && dy == 0) { continue; }\r
      let nc = vec2i(i32(id.x) + dx * step, i32(id.y) + dy * step);\r
      if (any(nc < vec2i(0)) || any(nc >= vec2i(dims))) { continue; }\r
      let nb = textureLoad(srcTex, nc, 0);\r
      if (nb.z < 0.5) { continue; }\r
      let dv = vec2f(id.xy) - nb.xy;\r
      let d2 = dot(dv, dv);\r
      if (d2 < bestDist) { bestDist = d2; best = nb; }\r
    }\r
  }\r
  textureStore(dstTex, vec2i(id.xy), best);\r
}\r
\r
// Pass 3: finalize — convert nearest-seed coordinate to force vector.\r
// dstTex (binding 3) is not used here.\r
@compute @workgroup_size(8, 8)\r
fn sdfFinalize(@builtin(global_invocation_id) id: vec3u) {\r
  let dims = textureDimensions(outTex);\r
  if (id.x >= dims.x || id.y >= dims.y) { return; }\r
  let src  = textureLoad(inTex, vec2i(id.xy), 0);\r
  let data = textureLoad(srcTex, vec2i(id.xy), 0);\r
  var dir  = vec2f(0.0);\r
  var mag  = 0.0;\r
  if (data.z > 0.5) {\r
    let toSeed = data.xy - vec2f(id.xy);\r
    let dist   = length(toSeed);\r
    if (dist > 0.5) {\r
      dir = -toSeed / dist;\r
      mag = clamp(1.0 / (1.0 + dist * 0.02), 0.0, 1.0);\r
    }\r
  }\r
  textureStore(outTex, vec2i(id.xy), vec4f(dir * 0.5 + 0.5, mag, src.a));\r
}\r
`,M=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC,F=GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST,A=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.STORAGE_BINDING;class Q{device;brush;sampler;sourceTexture;imageMaskTexture;paintCanvasTexture;compositedTexture;blurTempTexture;processedTexture;sdfPingTexture;sdfPongTexture;compositePipeline;blurPipeline;modeLuminancePipeline;modeGradientPipeline;modeThresholdPipeline;sdfSeedPipeline;sdfJumpPipeline;sdfFinalizePipeline;transformUniform;blurUniformH;blurUniformV;modeUniform;sdfUniform;_compositeBG=null;_blurBGH=null;_blurBGV=null;_modeBG=null;_cachedModePipeline=null;_bgsDirty=!0;width=1;height=1;imageWidth=1;imageHeight=1;hasPaint=!1;hasImage=!1;_flipX=!1;transform={offsetX:0,offsetY:0,scaleX:1,scaleY:1};params={mode:O.LuminanceAttract,blurRadius:0,threshold:.5,invert:!1};thumbnailContext=null;previewContext=null;blitPipeline=null;init(e){this.device=e,this.brush=new W,this.brush.init(e),this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.transformUniform=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.blurUniformH=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.blurUniformV=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.modeUniform=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sdfUniform=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const r=(t,i)=>e.createComputePipeline({layout:"auto",compute:{module:e.createShaderModule({code:t}),entryPoint:i}});this.compositePipeline=r(H,"compositeMain"),this.blurPipeline=r(z,"blurMain"),this.modeLuminancePipeline=r(Z,"modeMain"),this.modeGradientPipeline=r(J,"modeMain"),this.modeThresholdPipeline=r(j,"modeMain"),this.sdfSeedPipeline=r(E,"sdfSeed"),this.sdfJumpPipeline=r(E,"sdfJump"),this.sdfFinalizePipeline=r(E,"sdfFinalize"),this._allocateTextures(1,1),this._clearMaskToOnes(),this._triggerReprocess()}_allocateTextures(e,r){const t=this.device,i=(o,a="rgba8unorm")=>t.createTexture({size:[e,r,1],format:a,usage:o});this.sourceTexture||(this.sourceTexture=t.createTexture({size:[1,1,1],format:"rgba8unorm",usage:M})),this.imageMaskTexture?.destroy(),this.paintCanvasTexture?.destroy(),this.compositedTexture?.destroy(),this.blurTempTexture?.destroy(),this.processedTexture?.destroy(),this.sdfPingTexture?.destroy(),this.sdfPongTexture?.destroy(),this.imageMaskTexture=i(A),this.paintCanvasTexture=i(A),this.compositedTexture=i(F),this.blurTempTexture=i(F),this.processedTexture=i(F);const s=GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING;this.sdfPingTexture=i(s,"rgba16float"),this.sdfPongTexture=i(s,"rgba16float"),this.width=e,this.height=r,this._bgsDirty=!0,this._modeBG=null}_clearMaskToOnes(){const e=this.device.createCommandEncoder();e.beginRenderPass({colorAttachments:[{view:this.imageMaskTexture.createView(),loadOp:"clear",clearValue:{r:1,g:1,b:1,a:1},storeOp:"store"}]}).end(),this.device.queue.submit([e.finish()])}loadImage(e){const{device:r}=this;this.imageWidth=e.width,this.imageHeight=e.height,this.hasImage=!0,this.sourceTexture.destroy(),this.sourceTexture=r.createTexture({size:[e.width,e.height,1],format:"rgba8unorm",usage:M|GPUTextureUsage.RENDER_ATTACHMENT}),r.queue.copyExternalImageToTexture({source:e},{texture:this.sourceTexture},[e.width,e.height]),this._bgsDirty=!0,this._applyContainTransform(),this._triggerReprocess()}clearImage(){this.hasImage=!1,this._flipX=!1,this.sourceTexture.destroy(),this.sourceTexture=this.device.createTexture({size:[1,1,1],format:"rgba8unorm",usage:M}),this._bgsDirty=!0,this._clearMaskToOnes(),this.transform={offsetX:0,offsetY:0,scaleX:this.width,scaleY:this.height},this._triggerReprocess()}resetPaint(){const e=this.device.createCommandEncoder();e.beginRenderPass({colorAttachments:[{view:this.paintCanvasTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]}).end(),this.device.queue.submit([e.finish()]),this.hasPaint=!1,this._triggerReprocess()}setTransform(e){this.transform=e,this._triggerReprocess()}setMode(e){this.params.mode=e,this._triggerReprocess()}setBlurRadius(e){this.params.blurRadius=e,this._triggerReprocess()}setThreshold(e){this.params.threshold=e,this._triggerReprocess()}setInvert(e){this.params.invert=e,this._triggerReprocess()}brushStroke(e){const r=e.mode===C.MaskImage?this.imageMaskTexture:this.paintCanvasTexture;this.brush.stroke(e,r,this.blurTempTexture),e.mode!==C.MaskImage&&(this.hasPaint=!0),this._triggerReprocess()}resize(e,r){e===this.width&&r===this.height||(this._allocateTextures(e,r),this._clearMaskToOnes(),this.hasImage&&this._applyContainTransform(),this._triggerReprocess())}getOutputTexture(){return this.processedTexture}getCompositedTexture(){return this.compositedTexture}getOutputSampler(){return this.sampler}get canvasWidth(){return this.width}get canvasHeight(){return this.height}writeVideoFrame(e,r=!1){if(e instanceof HTMLVideoElement&&e.readyState<2)return;const{device:t}=this,i=e instanceof HTMLVideoElement?e.videoWidth:e.width,s=e instanceof HTMLVideoElement?e.videoHeight:e.height;if(!(i===0||s===0)){(!this.hasImage||this.imageWidth!==i||this.imageHeight!==s)&&(this.sourceTexture.destroy(),this.sourceTexture=t.createTexture({size:[i,s,1],format:"rgba8unorm",usage:M|GPUTextureUsage.RENDER_ATTACHMENT}),this.imageWidth=i,this.imageHeight=s,this.hasImage=!0,this._bgsDirty=!0,this._applyContainTransform()),this._flipX=r;try{t.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.sourceTexture},[i,s])}catch(o){console.warn("[ImageProcessor] copyExternalImageToTexture failed, frame skipped:",o);return}this._triggerReprocess()}}setThumbnailContext(e){this.thumbnailContext=e;const r=navigator.gpu.getPreferredCanvasFormat();e.configure({device:this.device,format:r,alphaMode:"premultiplied"}),this._buildBlitPipeline(r),this.renderThumbnail()}renderThumbnail(){this._blitToContext(this.thumbnailContext,this.processedTexture)}setPreviewContext(e){this.previewContext=e;const r=navigator.gpu.getPreferredCanvasFormat();e.configure({device:this.device,format:r,alphaMode:"premultiplied"}),this.blitPipeline||this._buildBlitPipeline(r)}clearPreviewContext(){this.previewContext=null}renderPreview(e){const r=e?this.processedTexture:this.compositedTexture;this._blitToContext(this.previewContext,r)}_blitToContext(e,r){if(!e||!this.blitPipeline)return;const t=e.getCurrentTexture(),i=this.device.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},{binding:1,resource:r.createView()}]}),s=this.device.createCommandEncoder(),o=s.beginRenderPass({colorAttachments:[{view:t.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:1},storeOp:"store"}]});o.setPipeline(this.blitPipeline),o.setBindGroup(0,i),o.draw(6),o.end(),this.device.queue.submit([s.finish()])}_buildBlitPipeline(e){const t=this.device.createShaderModule({code:`
      @group(0) @binding(0) var s: sampler;
      @group(0) @binding(1) var t: texture_2d<f32>;
      struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        var pos = array<vec2f,6>(
          vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
          vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        return V(vec4f(pos[i],0,1), pos[i]*0.5+0.5);
      }
      @fragment fn fs(v: V) -> @location(0) vec4f {
        return textureSample(t, s, vec2f(v.uv.x, 1.0 - v.uv.y));
      }
    `});this.blitPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:t,entryPoint:"vs"},fragment:{module:t,entryPoint:"fs",targets:[{format:e}]},primitive:{topology:"triangle-list"}})}_applyContainTransform(){const e=this.imageWidth/this.imageHeight,r=this.width/this.height;let t,i;e>r?(t=this.width,i=t/e):(i=this.height,t=i*e),this.transform={offsetX:(this.width-t)/2,offsetY:(this.height-i)/2,scaleX:t,scaleY:i}}_rebuildBindGroups(){const{device:e}=this;this._compositeBG=e.createBindGroup({layout:this.compositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.transformUniform}},{binding:1,resource:this.sourceTexture.createView()},{binding:2,resource:this.imageMaskTexture.createView()},{binding:3,resource:this.paintCanvasTexture.createView()},{binding:4,resource:this.compositedTexture.createView()}]}),this._blurBGH=e.createBindGroup({layout:this.blurPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.blurUniformH}},{binding:1,resource:this.compositedTexture.createView()},{binding:2,resource:this.blurTempTexture.createView()}]}),this._blurBGV=e.createBindGroup({layout:this.blurPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.blurUniformV}},{binding:1,resource:this.blurTempTexture.createView()},{binding:2,resource:this.compositedTexture.createView()}]}),this._bgsDirty=!1}_rebuildModeBG(e){this._modeBG=this.device.createBindGroup({layout:e.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.modeUniform}},{binding:1,resource:this.compositedTexture.createView()},{binding:2,resource:this.processedTexture.createView()}]}),this._cachedModePipeline=e}_triggerReprocess(){const{device:e,width:r,height:t}=this,i=m=>Math.ceil(m/8),{offsetX:s,offsetY:o,scaleX:a,scaleY:p}=this.transform,d=this._flipX?s+a:s,l=this._flipX?-a:a;e.queue.writeBuffer(this.transformUniform,0,new Float32Array([d,o,l,p]));const v=this.params.mode,b=new ArrayBuffer(16),x=new DataView(b);x.setUint32(0,v,!0),x.setFloat32(8,this.params.threshold,!0),e.queue.writeBuffer(this.modeUniform,0,b),this._bgsDirty&&this._rebuildBindGroups();const h=e.createCommandEncoder(),y=h.beginComputePass();if(y.setPipeline(this.compositePipeline),y.setBindGroup(0,this._compositeBG),y.dispatchWorkgroups(i(r),i(t)),y.end(),this.params.blurRadius>0){const m=Math.round(this.params.blurRadius);e.queue.writeBuffer(this.blurUniformH,0,new Uint32Array([m,1,0,0])),e.queue.writeBuffer(this.blurUniformV,0,new Uint32Array([m,0,0,0]));const f=h.beginComputePass();f.setPipeline(this.blurPipeline),f.setBindGroup(0,this._blurBGH),f.dispatchWorkgroups(i(r),i(t)),f.end();const n=h.beginComputePass();n.setPipeline(this.blurPipeline),n.setBindGroup(0,this._blurBGV),n.dispatchWorkgroups(i(r),i(t)),n.end()}if(v===O.SDF)e.queue.submit([h.finish()]),this._runSdfPipeline(r,t);else{const m=v<=1?this.modeLuminancePipeline:v<=3?this.modeGradientPipeline:this.modeThresholdPipeline;(!this._modeBG||m!==this._cachedModePipeline)&&this._rebuildModeBG(m);const f=h.beginComputePass();f.setPipeline(m),f.setBindGroup(0,this._modeBG),f.dispatchWorkgroups(i(r),i(t)),f.end(),e.queue.submit([h.finish()])}this.renderThumbnail()}_runSdfPipeline(e,r){const{device:t}=this,i=f=>Math.ceil(f/8),s=f=>{const n=new ArrayBuffer(16),u=new DataView(n);u.setUint32(0,f,!0);const g=new Float32Array([this.params.threshold]);u.setUint32(4,new Uint32Array(g.buffer)[0],!0),t.queue.writeBuffer(this.sdfUniform,0,n)},o=f=>t.createBindGroup({layout:this.sdfSeedPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.sdfUniform}},{binding:1,resource:this.compositedTexture.createView()},{binding:3,resource:f.createView()}]}),a=(f,n)=>t.createBindGroup({layout:this.sdfJumpPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.sdfUniform}},{binding:2,resource:f.createView()},{binding:3,resource:n.createView()}]}),p=f=>t.createBindGroup({layout:this.sdfFinalizePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.sdfUniform}},{binding:1,resource:this.compositedTexture.createView()},{binding:2,resource:f.createView()},{binding:4,resource:this.processedTexture.createView()}]});s(0);const d=t.createCommandEncoder(),l=d.beginComputePass();l.setPipeline(this.sdfSeedPipeline),l.setBindGroup(0,o(this.sdfPingTexture)),l.dispatchWorkgroups(i(e),i(r)),l.end(),t.queue.submit([d.finish()]);const v=Math.max(e,r);let b=Math.pow(2,Math.ceil(Math.log2(v))),x=this.sdfPingTexture,h=this.sdfPongTexture;for(;b>=1;){s(Math.round(b));const f=t.createCommandEncoder(),n=f.beginComputePass();n.setPipeline(this.sdfJumpPipeline),n.setBindGroup(0,a(x,h)),n.dispatchWorkgroups(i(e),i(r)),n.end(),t.queue.submit([f.finish()]),[x,h]=[h,x],b/=2}const y=t.createCommandEncoder(),m=y.beginComputePass();m.setPipeline(this.sdfFinalizePipeline),m.setBindGroup(0,p(x)),m.dispatchWorkgroups(i(e),i(r)),m.end(),t.queue.submit([y.finish()])}destroy(){this.brush.destroy(),this.transformUniform.destroy(),this.blurUniformH.destroy(),this.blurUniformV.destroy(),this.modeUniform.destroy(),this.sdfUniform.destroy();for(const e of[this.sourceTexture,this.imageMaskTexture,this.paintCanvasTexture,this.compositedTexture,this.blurTempTexture,this.processedTexture,this.sdfPingTexture,this.sdfPongTexture])e?.destroy()}}class K{device;processor;dummyTexture;_strength=.5;_forceMode=O.LuminanceAttract;_invert=!1;_enabled=!0;_showOverlay=!0;init(e,r){this.device=e,this.processor=r,this.dummyTexture=e.createTexture({size:[1,1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})}buildBindGroupEntries(){return[{binding:7,resource:this.processor.getOutputTexture().createView()},{binding:8,resource:this.processor.getOutputSampler()}]}getExtraParams(){return{imageStrength:this._enabled&&(this.processor.hasImage||this.processor.hasPaint)?this._strength:0,imageForceMode:this._forceMode,imageInvert:this._invert?1:0}}setStrength(e){this._strength=e}setForceMode(e){this._forceMode=e}setInvert(e){this._invert=e}setEnabled(e){this._enabled=e}setShowOverlay(e){this._showOverlay=e}getStrength(){return this._strength}getForceMode(){return this._forceMode}getInvert(){return this._invert}getEnabled(){return this._enabled}get showOverlay(){return this._showOverlay}isActive(){return this._enabled&&(this.processor.hasImage||this.processor.hasPaint)}destroy(){this.dummyTexture.destroy()}}class ${status="idle";lastError="";targetFps=30;mirrored=!0;availableCameras=[];activeCameraId=null;video=null;stream=null;lastFrameTime=0;async enumerateCameras(){const e=await navigator.mediaDevices.enumerateDevices();return this.availableCameras=e.filter(r=>r.kind==="videoinput"),this.availableCameras}async start(e){this.lastError="",this.stop();try{await this.enumerateCameras();const r=e??this.activeCameraId??void 0;this.stream=await navigator.mediaDevices.getUserMedia({video:r?{deviceId:{exact:r}}:!0});const t=this.stream.getVideoTracks()[0];this.activeCameraId=t.getSettings().deviceId??null,this.video=document.createElement("video"),this.video.srcObject=this.stream,this.video.playsInline=!0,this.video.muted=!0,await this.video.play(),t.addEventListener("ended",()=>{this.lastError="Camera disconnected",this.stop(),this.status="error"}),this.status="active",this.lastFrameTime=0}catch(r){this.lastError=r instanceof Error?r.message:String(r),this.stop(),this.status="error"}}stop(){this.stream?.getTracks().forEach(e=>e.stop()),this.stream=null,this.video=null,this.status!=="error"&&(this.status="idle")}tick(e){if(!this.video||this.status!=="active")return;const r=performance.now();r-this.lastFrameTime<1e3/this.targetFps||(this.lastFrameTime=r,e.writeVideoFrame(this.video,this.mirrored))}destroy(){this.stop(),this.status="idle"}}const S=5e5,D=64,R=D*D,ee=1,re=12,te=4,G=w=>w-2*Math.floor((w+1)/2),L=w=>w-2*Math.round(w/2),ie=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),se={dt:.016,numParticles:200,attractionRadius:.2,repulsionRadius:.05,attraction:.3,repulsion:1.5,alignment:.1,friction:2,maxSpeed:.22,mouseRadius:.15,coneAngle:-.5,size:.02,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0,noise:0};class ne{gpu=null;computePipeline;renderPipeline;boidsBindGroupLayout;boidsBindGroups;renderParamsBindGroup;clearGridPipeline;gridAssignPipeline;prefixSumPipeline;scatterPipeline;scatterDataPipeline;gridBindGroupLayout;gridBindGroups;particleBuffers;particleCellIDsBuffer;cellCountsBuffer;cellOffsetsBuffer;cellScatterIdxBuffer;sortedIndicesBuffer;sortedParticlesBuffer;uniformBuffer;obstacleBuffer;vertexBuffer;frame=0;running=!1;animId=0;lastFrameTime=0;maxFps=1/0;tickCount=0;onFrameComplete=null;mouseX=0;mouseY=0;mouseActive=!1;mouseDX=0;mouseDY=0;pointers=new Map;gesture=null;spaceHeld=!1;viewZoom=1;viewCx=0;viewCy=0;zoomAt(e,r,t){const i=this.viewZoom,s=Math.min(re,Math.max(ee,i*e));if(s===i)return;const o=this.viewCx+r/i,a=this.viewCy+t/i;this.viewZoom=s,this.viewCx=G(o-r/s),this.viewCy=G(a-t/s)}panBy(e,r){this.viewCx=G(this.viewCx-e/this.viewZoom),this.viewCy=G(this.viewCy-r/this.viewZoom)}resetView(){this.viewZoom=1,this.viewCx=0,this.viewCy=0}pointerRadiusPx(){const e=this.gpu?.canvas;return(e?e.clientHeight:0)*.5*this.params.mouseRadius}onPointers;trailRenderer=new q;bgColor={r:.039,g:.031,b:.016,a:1};_isLight=!1;_themeObserver=null;imageProcessor=new Q;imageForce=new K;webcam=new $;overlayPipeline=null;overlayBindGroup=null;prevCanvasWidth=0;prevCanvasHeight=0;params={...se};trailsEnabled=!1;trailDecay=.92;defaultShaderSource=U;shaderSource=U;boidsWorkgroupSize=64;async init(e){try{if(this.gpu=await V(e),!this.gpu)return!1;const{device:r}=this.gpu;this.uniformBuffer=k(r,144),this.obstacleBuffer=k(r,272);const t=new Float32Array(S*4);for(let l=0;l<S;l++)t[l*4+0]=(Math.random()-.5)*2,t[l*4+1]=(Math.random()-.5)*2,t[l*4+2]=(Math.random()-.5)*.1,t[l*4+3]=(Math.random()-.5)*.1;const i=GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST;this.particleBuffers=[I(r,t,i),I(r,t,i)],this.vertexBuffer=I(r,ie,GPUBufferUsage.VERTEX);const s=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;this.particleCellIDsBuffer=r.createBuffer({size:S*4,usage:s}),this.cellCountsBuffer=r.createBuffer({size:R*4,usage:s}),this.cellOffsetsBuffer=r.createBuffer({size:R*4,usage:s}),this.cellScatterIdxBuffer=r.createBuffer({size:R*4,usage:s}),this.sortedIndicesBuffer=r.createBuffer({size:S*4,usage:s}),this.sortedParticlesBuffer=r.createBuffer({size:S*16,usage:s});const o=r.createShaderModule({code:X});this.gridBindGroupLayout=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]});const a=r.createPipelineLayout({bindGroupLayouts:[this.gridBindGroupLayout]});this.clearGridPipeline=r.createComputePipeline({layout:a,compute:{module:o,entryPoint:"clearGrid"}}),this.gridAssignPipeline=r.createComputePipeline({layout:a,compute:{module:o,entryPoint:"gridAssign"}}),this.prefixSumPipeline=r.createComputePipeline({layout:a,compute:{module:o,entryPoint:"prefixSum"}}),this.scatterPipeline=r.createComputePipeline({layout:a,compute:{module:o,entryPoint:"scatter"}}),this.scatterDataPipeline=r.createComputePipeline({layout:a,compute:{module:o,entryPoint:"scatterData"}}),this.gridBindGroups=this._buildBindGroupPair(this.gridBindGroupLayout,[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[0]}},{binding:2,resource:{buffer:this.particleCellIDsBuffer}},{binding:3,resource:{buffer:this.cellCountsBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellScatterIdxBuffer}},{binding:6,resource:{buffer:this.sortedIndicesBuffer}},{binding:7,resource:{buffer:this.sortedParticlesBuffer}}],[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[1]}},{binding:2,resource:{buffer:this.particleCellIDsBuffer}},{binding:3,resource:{buffer:this.cellCountsBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellScatterIdxBuffer}},{binding:6,resource:{buffer:this.sortedIndicesBuffer}},{binding:7,resource:{buffer:this.sortedParticlesBuffer}}]),this.imageProcessor.init(r),this.imageForce.init(r,this.imageProcessor),this._buildOverlayPipeline(this.gpu.format),this._readBgColor(),this.boidsWorkgroupSize=this._parseWorkgroupSize(U);const p=r.createShaderModule({code:U});return this._createBoidsPipelines(p),this.trailRenderer.init(r,this.gpu.format,e.width||1,e.height||1),this.trailRenderer.primeBg(r,this.bgColor),this.prevCanvasWidth=e.width,this.prevCanvasHeight=e.height,this._initThemeObserver(),this.bindPointer(e),new ResizeObserver(l=>{const v=l[0];if(!v)return;const b=window.devicePixelRatio||1,x=Math.floor(v.contentRect.width*b),h=Math.floor(v.contentRect.height*b);x>0&&h>0&&(e.width!==x||e.height!==h)&&(e.width=x,e.height=h)}).observe(e),!0}catch(r){return console.error("BoidsController init error:",r),!1}}_parseWorkgroupSize(e){const r=e.match(/@workgroup_size\s*\(\s*(\d+)/);return r?parseInt(r[1],10):64}_createBoidsPipelines(e){const{device:r,format:t}=this.gpu;this.boidsBindGroupLayout=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE|GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}},{binding:8,visibility:GPUShaderStage.COMPUTE,sampler:{type:"filtering"}}]});const i=this.imageForce.buildBindGroupEntries();this.boidsBindGroups=this._buildBindGroupPair(this.boidsBindGroupLayout,[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[0]}},{binding:2,resource:{buffer:this.particleBuffers[1]}},{binding:3,resource:{buffer:this.obstacleBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellCountsBuffer}},{binding:6,resource:{buffer:this.sortedParticlesBuffer}},...i],[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[1]}},{binding:2,resource:{buffer:this.particleBuffers[0]}},{binding:3,resource:{buffer:this.obstacleBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellCountsBuffer}},{binding:6,resource:{buffer:this.sortedParticlesBuffer}},...i]);const s=r.createPipelineLayout({bindGroupLayouts:[this.boidsBindGroupLayout]});this.computePipeline=r.createComputePipeline({layout:s,compute:{module:e,entryPoint:"computeMain"}}),this.renderPipeline=r.createRenderPipeline({layout:"auto",vertex:{module:e,entryPoint:"vertexMain",buffers:[{arrayStride:16,stepMode:"instance",attributes:[{shaderLocation:0,offset:0,format:"float32x2"},{shaderLocation:1,offset:8,format:"float32x2"}]},{arrayStride:8,stepMode:"vertex",attributes:[{shaderLocation:2,offset:0,format:"float32x2"}]}]},fragment:{module:e,entryPoint:"fragmentMain",targets:[{format:t,blend:this._isLight?{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.renderParamsBindGroup=r.createBindGroup({layout:this.renderPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]})}async reloadShader(e){if(!this.gpu)return{success:!1,error:"GPU not initialized"};try{const{device:r}=this.gpu,t={computePipeline:this.computePipeline,renderPipeline:this.renderPipeline,boidsBindGroupLayout:this.boidsBindGroupLayout,boidsBindGroups:this.boidsBindGroups,renderParamsBindGroup:this.renderParamsBindGroup,boidsWorkgroupSize:this.boidsWorkgroupSize};r.pushErrorScope("validation");const i=r.createShaderModule({code:e});this.boidsWorkgroupSize=this._parseWorkgroupSize(e),this._createBoidsPipelines(i);const s=await r.popErrorScope();return s?(Object.assign(this,t),{success:!1,error:s.message}):(this.shaderSource=e,{success:!0,error:""})}catch(r){return{success:!1,error:String(r)}}}start(){this.running||(this.running=!0,this.tick())}stop(){this.running=!1,cancelAnimationFrame(this.animId),clearTimeout(this.animId)}reset(){if(!this.gpu)return;const{device:e}=this.gpu,r=new Float32Array(S*4);for(let t=0;t<S;t++)r[t*4+0]=(Math.random()-.5)*2,r[t*4+1]=(Math.random()-.5)*2,r[t*4+2]=(Math.random()-.5)*.1,r[t*4+3]=(Math.random()-.5)*.1;e.queue.writeBuffer(this.particleBuffers[0],0,r),e.queue.writeBuffer(this.particleBuffers[1],0,r),this.frame=0}setObstacles(e,r){if(!this.gpu)return;const t=new ArrayBuffer(272),i=new Float32Array(t),s=new Uint32Array(t);i.set(e.subarray(0,r*4),0),s[64]=r,this.gpu.device.queue.writeBuffer(this.obstacleBuffer,0,t)}bindPointer(e,r={}){const t=this.gpu?.canvas;if(!t)return;const i=r.hover??!0,s=r.view??!0,o=n=>{const u=t.getBoundingClientRect();return[(n.clientX-u.left)/u.width*2-1,-((n.clientY-u.top)/u.height*2-1)]},a=(n,u)=>[G(this.viewCx+n/this.viewZoom),G(this.viewCy+u/this.viewZoom)],p=()=>[...this.pointers.values()].filter(n=>n.type!=="mouse"),d=(n,u)=>({mx:(n.sx+u.sx)/2,my:(n.sy+u.sy)/2,d:Math.max(.001,Math.hypot(n.sx-u.sx,n.sy-u.sy))}),l=()=>this.onPointers?.(this.gesture?[]:[...this.pointers].filter(([,n])=>!n.pan&&n.engaged).map(([n,u])=>({id:n,clientX:u.clientX,clientY:u.clientY,strength:1,type:u.type}))),v=(n,u,g)=>{n.engaged=!0,n.x=u,n.y=g,this.mouseX=u,this.mouseY=g,this.mouseDX=0,this.mouseDY=0,this.mouseActive=!0},b=n=>{if(!s&&!n.isPrimary||this.pointers.size>=te||this.pointers.has(n.pointerId))return;const[u,g]=o(n),[c,B]=a(u,g),T=s&&n.pointerType==="mouse"&&(this.spaceHeld||n.altKey||n.button===1),_={sx:u,sy:g,x:c,y:B,clientX:n.clientX,clientY:n.clientY,type:n.pointerType,pan:T,engaged:!1};if(this.pointers.set(n.pointerId,_),s){try{t.setPointerCapture(n.pointerId)}catch{}T&&n.preventDefault();const P=p();if(P.length>=2){this.gesture=d(P[0],P[1]),this.mouseActive=!1,l();return}}!T&&(s||n.pointerType!=="touch")&&v(_,c,B),l()},x=n=>{const[u,g]=o(n),c=this.pointers.get(n.pointerId);if(!c){if(i&&n.pointerType==="mouse"&&this.pointers.size===0){const[_,P]=a(u,g);this.mouseX=_,this.mouseY=P,this.mouseActive=!0}return}if(c.pan){this.panBy(u-c.sx,g-c.sy),c.sx=u,c.sy=g,c.clientX=n.clientX,c.clientY=n.clientY;return}if(c.sx=u,c.sy=g,c.clientX=n.clientX,c.clientY=n.clientY,this.gesture){const _=p();if(_.length>=2){const P=d(_[0],_[1]);this.zoomAt(P.d/this.gesture.d,P.mx,P.my),this.panBy(P.mx-this.gesture.mx,P.my-this.gesture.my),this.gesture=P}return}const[B,T]=a(u,g);if(!c.engaged){v(c,B,T),l();return}this.mouseActive&&(this.mouseDX+=L(B-this.mouseX),this.mouseDY+=L(T-this.mouseY)),c.x=B,c.y=T,this.mouseX=B,this.mouseY=T,this.mouseActive=!0,l()},h=n=>{if(!this.pointers.delete(n.pointerId))return;const u=p();if(this.gesture&&u.length<2){this.gesture=null;for(const c of u){const[B,T]=a(c.sx,c.sy);c.x=B,c.y=T,c.engaged=!0}}const g=this.gesture?void 0:[...this.pointers.values()].find(c=>!c.pan&&c.engaged);g?(this.mouseX=g.x,this.mouseY=g.y,this.mouseActive=!0):this.mouseActive=!1,this.mouseDX=0,this.mouseDY=0,l()},y=()=>{this.pointers.size===0&&(this.mouseActive=!1)},m=()=>{this.pointers.clear(),this.gesture=null,this.mouseActive=!1,this.mouseDX=0,this.mouseDY=0,l()};if(e.addEventListener("pointerdown",b),e.addEventListener("pointermove",x),e.addEventListener("pointerup",h),e.addEventListener("pointercancel",h),e===window?e.addEventListener("blur",m):e.addEventListener("pointerleave",y),!s)return;t.addEventListener("lostpointercapture",h),t.addEventListener("wheel",n=>{n.preventDefault();const[u,g]=o(n);this.zoomAt(Math.exp(-n.deltaY*.0015),u,g)},{passive:!1});const f=n=>n instanceof HTMLElement&&(n.tagName==="INPUT"||n.tagName==="TEXTAREA"||n.isContentEditable);window.addEventListener("keydown",n=>{n.code!=="Space"||f(n.target)||(n.preventDefault(),!n.repeat&&(this.spaceHeld=!0,t.style.cursor="grab"))}),window.addEventListener("keyup",n=>{n.code!=="Space"||f(n.target)||(n.preventDefault(),this.spaceHeld=!1,t.style.cursor="")}),t.addEventListener("auxclick",n=>{n.button===1&&n.preventDefault()})}_packUniforms(e){const r=new ArrayBuffer(144),t=new DataView(r);t.setFloat32(0,this.params.dt,!0),t.setFloat32(4,this.params.attractionRadius,!0),t.setFloat32(8,this.params.repulsionRadius,!0),t.setFloat32(12,this.params.attraction,!0),t.setFloat32(16,this.params.repulsion,!0),t.setFloat32(20,this.params.alignment,!0),t.setFloat32(24,this.params.friction,!0),t.setFloat32(28,this.params.maxSpeed,!0),t.setUint32(32,this.params.numParticles,!0),t.setFloat32(36,this.mouseX,!0),t.setFloat32(40,this.mouseY,!0),t.setFloat32(44,this.mouseActive?1:0,!0),t.setFloat32(48,this.params.mouseRadius/this.viewZoom,!0),t.setFloat32(52,this.params.coneAngle,!0),t.setFloat32(56,e,!0),t.setFloat32(60,this.params.size,!0),t.setUint32(64,this.params.shapeId,!0),t.setFloat32(68,this.params.colorR,!0),t.setFloat32(72,this.params.colorG,!0),t.setFloat32(76,this.params.colorB,!0),t.setFloat32(80,this.params.opacity,!0),t.setUint32(84,this.params.opacityMode,!0);const i=Math.max(4,Math.min(D,Math.floor(2/Math.max(this.params.attractionRadius,this.params.repulsionRadius))));t.setUint32(88,i,!0),t.setUint32(92,this.frame,!0);const s=this.imageForce.getExtraParams();return t.setFloat32(96,s.imageStrength,!0),t.setUint32(100,s.imageForceMode,!0),t.setUint32(104,s.imageInvert,!0),t.setFloat32(108,this.params.noise??0,!0),t.setFloat32(112,this.mouseDX,!0),t.setFloat32(116,this.mouseDY,!0),this.mouseDX=0,this.mouseDY=0,t.setFloat32(128,this.viewZoom,!0),t.setFloat32(132,this.viewCx,!0),t.setFloat32(136,this.viewCy,!0),r}_buildBindGroupPair(e,r,t){const{device:i}=this.gpu;return[i.createBindGroup({layout:e,entries:r}),i.createBindGroup({layout:e,entries:t})]}_preFrameSetup(){const{device:e,context:r,canvas:t}=this.gpu;(t.width!==this.prevCanvasWidth||t.height!==this.prevCanvasHeight)&&(this.trailRenderer.resize(e,t.width,t.height),this.trailRenderer.primeBg(e,this.bgColor),this.imageProcessor.resize(t.width,t.height),this.rebuildBoidsBindGroups(),this.overlayBindGroup=null,this.prevCanvasWidth=t.width,this.prevCanvasHeight=t.height),this.webcam.status==="active"&&this.webcam.tick(this.imageProcessor);const s=t.width>0&&t.height>0?t.width/t.height:1;return{device:e,context:r,canvas:t,aspect:s}}_runComputePasses(e,r,t,i){const s=this.gridBindGroups[this.frame%2],o=e.createCommandEncoder(),a=o.beginComputePass();a.setPipeline(this.clearGridPipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(Math.ceil(i/64)),a.setPipeline(this.gridAssignPipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(Math.ceil(r/64)),a.setPipeline(this.prefixSumPipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(1),a.setPipeline(this.scatterPipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(Math.ceil(r/64)),a.setPipeline(this.scatterDataPipeline),a.setBindGroup(0,s),a.dispatchWorkgroups(Math.ceil(r/64)),a.setPipeline(this.computePipeline),a.setBindGroup(0,this.boidsBindGroups[this.frame%2]),a.dispatchWorkgroups(Math.ceil(r/this.boidsWorkgroupSize)),a.end(),e.queue.submit([o.finish()])}_renderFrame(e,r,t){if(this.trailRenderer.render(e,r,this.trailDecay,this.trailsEnabled,this.bgColor,(i,s,o)=>{const a=i.beginRenderPass({colorAttachments:[{view:s,clearValue:this.bgColor,loadOp:o,storeOp:"store"}]});a.setPipeline(this.renderPipeline),a.setBindGroup(0,this.renderParamsBindGroup),a.setVertexBuffer(0,this.particleBuffers[(this.frame+1)%2]),a.setVertexBuffer(1,this.vertexBuffer),a.draw(6,t),a.end()}),this.imageForce.isActive()&&this.imageForce.showOverlay&&this.overlayPipeline){this.overlayBindGroup||(this.overlayBindGroup=e.createBindGroup({layout:this.overlayPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.imageProcessor.getOutputSampler()},{binding:1,resource:this.imageProcessor.getCompositedTexture().createView()}]}));const i=e.createCommandEncoder(),s=i.beginRenderPass({colorAttachments:[{view:r.getCurrentTexture().createView(),loadOp:"load",storeOp:"store"}]});s.setPipeline(this.overlayPipeline),s.setBindGroup(0,this.overlayBindGroup),s.draw(6),s.end(),e.queue.submit([i.finish()])}}tick=()=>{if(!this.running||!this.gpu)return;if(Number.isFinite(this.maxFps)){const a=performance.now();if(a-this.lastFrameTime<1e3/this.maxFps-1){this.animId=requestAnimationFrame(this.tick);return}this.lastFrameTime=a}const{device:e,context:r,aspect:t}=this._preFrameSetup();e.queue.writeBuffer(this.uniformBuffer,0,this._packUniforms(t));const i=this.params.numParticles,s=Math.max(4,Math.min(D,Math.floor(2/Math.max(this.params.attractionRadius,this.params.repulsionRadius)))),o=s*s;this._runComputePasses(e,i,s,o),this._renderFrame(e,r,i),this.frame++,e.queue.onSubmittedWorkDone().then(()=>{this.running&&(this.tickCount++,this.onFrameComplete?.(performance.now()),Number.isFinite(this.maxFps)?this.animId=window.setTimeout(this.tick,0):this.animId=requestAnimationFrame(this.tick))})};_buildOverlayPipeline(e){const{device:r}=this.gpu,i=r.createShaderModule({code:`
      @group(0) @binding(0) var s: sampler;
      @group(0) @binding(1) var t: texture_2d<f32>;
      struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        var pos = array<vec2f,6>(
          vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
          vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        let p = pos[i];
        return V(vec4f(p,0,1), p * vec2f(0.5,-0.5) + vec2f(0.5));
      }
      @fragment fn fs(v: V) -> @location(0) vec4f {
        let c = textureSample(t, s, v.uv);
        return vec4f(c.rgb, c.a * 0.45);
      }
    `});this.overlayPipeline=r.createRenderPipeline({layout:"auto",vertex:{module:i,entryPoint:"vs"},fragment:{module:i,entryPoint:"fs",targets:[{format:e,blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}})}rebuildBoidsBindGroups(){if(!this.gpu||!this.boidsBindGroupLayout)return;const{device:e}=this.gpu,r=this.imageForce.buildBindGroupEntries();this.boidsBindGroups=this._buildBindGroupPair(this.boidsBindGroupLayout,[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[0]}},{binding:2,resource:{buffer:this.particleBuffers[1]}},{binding:3,resource:{buffer:this.obstacleBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellCountsBuffer}},{binding:6,resource:{buffer:this.sortedParticlesBuffer}},...r],[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particleBuffers[1]}},{binding:2,resource:{buffer:this.particleBuffers[0]}},{binding:3,resource:{buffer:this.obstacleBuffer}},{binding:4,resource:{buffer:this.cellOffsetsBuffer}},{binding:5,resource:{buffer:this.cellCountsBuffer}},{binding:6,resource:{buffer:this.sortedParticlesBuffer}},...r])}destroy(){this.webcam.destroy(),this.imageProcessor.destroy(),this.imageForce.destroy(),this._themeObserver?.disconnect(),this._themeObserver=null}_readBgColor(){if(typeof document>"u")return;let r=getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim().replace(/^#/,"");if(r.length===3&&(r=r.split("").map(i=>i+i).join("")),!/^[0-9a-fA-F]{6}$/.test(r))return;this.bgColor={r:parseInt(r.slice(0,2),16)/255,g:parseInt(r.slice(2,4),16)/255,b:parseInt(r.slice(4,6),16)/255,a:1};const t=this.bgColor.r+this.bgColor.g+this.bgColor.b>1.5;if(t!==this._isLight&&(this._isLight=t,this.gpu)){const i=this.gpu.device.createShaderModule({code:this.shaderSource});this._createBoidsPipelines(i)}}_initThemeObserver(){typeof MutationObserver>"u"||typeof document>"u"||(this._themeObserver=new MutationObserver(()=>this._readBgColor()),this._themeObserver.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}))}}const ue=Object.freeze(Object.defineProperty({__proto__:null,BoidsController:ne},Symbol.toStringTag,{value:"Module"}));export{ne as B,O as P,C as a,ue as b};
