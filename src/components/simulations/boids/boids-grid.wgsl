// boids-grid.wgsl — GPU counting-sort spatial grid passes (non-editable infrastructure)
//
// Grid: gridDim×gridDim cells (adaptive, 4–64) covering NDC [-1,1]²
// Cell size: 2.0/gridDim NDC units — set each frame so cell ≈ attractionRadius,
// keeping the neighbor search to ≤3×3 = 9 cells in most cases.
//
// Per-frame pass order:
//   1. clearGrid   — zero first gridDim² cells of cellCounts/cellScatterIdx
//   2. gridAssign  — assign each particle to a cell, count particles per cell
//   3. prefixSum   — exclusive scan cellCounts → cellOffsets + cellScatterIdx
//   4. scatter     — build sortedIndices array (particle indices sorted by cell)

// Full params struct — mirrors boids.wgsl exactly so the shared uniform works
struct GridParams {
  deltaTime:        f32,  // 0
  attractionRadius: f32,  // 4
  repulsionRadius:  f32,  // 8
  attraction:       f32,  // 12
  repulsion:        f32,  // 16
  alignment:        f32,  // 20
  friction:         f32,  // 24
  maxSpeed:         f32,  // 28
  numParticles:     u32,  // 32
  mouseX:           f32,  // 36
  mouseY:           f32,  // 40
  mouseActive:      f32,  // 44
  mouseRadius:      f32,  // 48
  coneAngle:        f32,  // 52
  aspect:           f32,  // 56
  size:             f32,  // 60
  shapeId:          u32,  // 64
  colorR:           f32,  // 68
  colorG:           f32,  // 72
  colorB:           f32,  // 76
  opacity:          f32,  // 80
  opacityMode:      u32,  // 84
  gridDim:          u32,  // 88 — active grid dimension (4–64)
}

struct Particle {
  pos: vec2f,
  vel: vec2f,
}

@group(0) @binding(0) var<uniform>           params:         GridParams;
@group(0) @binding(1) var<storage, read>     particlesRead:  array<Particle>;
@group(0) @binding(2) var<storage, read_write> particleCellIDs: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCounts:    array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellOffsets:   array<u32>;
@group(0) @binding(5) var<storage, read_write> cellScatterIdx: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sortedIndices:   array<u32>;
@group(0) @binding(7) var<storage, read_write> sortedParticles: array<Particle>;

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: clearGrid — zero active cells before each frame
// Dispatch: ceil(gridDim² / 64)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn clearGrid(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.gridDim * params.gridDim) { return; }
  atomicStore(&cellCounts[i], 0u);
  atomicStore(&cellScatterIdx[i], 0u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: gridAssign — compute cell ID for each particle, count per cell
// Dispatch: ceil(numParticles / 64)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn gridAssign(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  let pos = particlesRead[index].pos;
  let gDim = params.gridDim;

  // Map position from NDC [-1,1] to grid cell index, clamped to valid range
  let cellX = clamp(u32((pos.x + 1.0) * f32(gDim) * 0.5), 0u, gDim - 1u);
  let cellY = clamp(u32((pos.y + 1.0) * f32(gDim) * 0.5), 0u, gDim - 1u);
  let cellID = cellY * gDim + cellX;

  particleCellIDs[index] = cellID;
  atomicAdd(&cellCounts[cellID], 1u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3: prefixSum — exclusive scan of cellCounts → cellOffsets + cellScatterIdx
//
// Sequential single-thread scan over active gridDim² cells.
// At max 4096 iterations this is negligible GPU work.
//
// Dispatch: 1 workgroup of 1 thread
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(1)
fn prefixSum(@builtin(global_invocation_id) id: vec3u) {
  let gridSize = params.gridDim * params.gridDim;
  var sum = 0u;
  for (var i = 0u; i < gridSize; i++) {
    let count = atomicLoad(&cellCounts[i]);
    cellOffsets[i] = sum;
    atomicStore(&cellScatterIdx[i], sum);
    sum += count;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4: scatter — place each particle into its sorted position
// Dispatch: ceil(numParticles / 64)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  let cellID = particleCellIDs[index];
  let slot = atomicAdd(&cellScatterIdx[cellID], 1u);
  sortedIndices[slot] = index;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 5: scatterData — copy particle data into cell-sorted order
// Enables sequential memory access in the boids compute pass instead of
// scattered reads via sortedIndices[k] → particlesA[i].
// Dispatch: ceil(numParticles / 64)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(64)
fn scatterData(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }
  sortedParticles[index] = particlesRead[sortedIndices[index]];
}
