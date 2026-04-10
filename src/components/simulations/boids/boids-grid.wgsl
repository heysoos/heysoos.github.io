// boids-grid.wgsl — GPU counting-sort spatial grid passes (non-editable infrastructure)
//
// Grid: 64×64 = 4096 cells covering NDC [-1,1]²
// Cell size: 2.0/64 = 0.03125 NDC units
//
// Per-frame pass order:
//   1. clearGrid   — zero cellCounts
//   2. gridAssign  — assign each particle to a cell, count particles per cell
//   3. prefixSum   — exclusive scan cellCounts → cellOffsets + cellScatterIdx
//   4. scatter     — build sortedIndices array (particle indices sorted by cell)

const GRID_W: u32 = 64u;
const GRID_H: u32 = 64u;
const GRID_SIZE: u32 = 4096u;  // GRID_W * GRID_H
const CELL_W: f32 = 0.03125;   // 2.0 / 64
const CELL_H: f32 = 0.03125;

// Minimal params struct — only numParticles is needed by grid passes
struct GridParams {
  deltaTime:        f32,
  attractionRadius: f32,
  repulsionRadius:  f32,
  attraction:       f32,
  repulsion:        f32,
  alignment:        f32,
  friction:         f32,
  maxSpeed:         f32,
  numParticles:     u32,
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
@group(0) @binding(6) var<storage, read_write> sortedIndices: array<u32>;

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: clearGrid — zero cellCounts before each frame
// Dispatch: ceil(GRID_SIZE / 256) = 16 workgroups
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= GRID_SIZE) { return; }
  atomicStore(&cellCounts[i], 0u);
  atomicStore(&cellScatterIdx[i], 0u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: gridAssign — compute cell ID for each particle, count per cell
// Dispatch: ceil(numParticles / 256)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(256)
fn gridAssign(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  let pos = particlesRead[index].pos;

  // Map position from NDC [-1,1] to grid cell index, clamped to valid range
  let cellX = clamp(u32((pos.x + 1.0) / CELL_W), 0u, GRID_W - 1u);
  let cellY = clamp(u32((pos.y + 1.0) / CELL_H), 0u, GRID_H - 1u);
  let cellID = cellY * GRID_W + cellX;

  particleCellIDs[index] = cellID;
  atomicAdd(&cellCounts[cellID], 1u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3: prefixSum — exclusive scan of cellCounts → cellOffsets + cellScatterIdx
//
// Uses a two-phase (upsweep + downsweep) work-efficient parallel prefix sum
// over all 4096 cells in a single workgroup of 256 threads.
// Each thread handles 2 elements (stride-based Blelloch scan).
//
// Dispatch: 1 workgroup (handles entire 4096-element array via 16 iterations)
// ─────────────────────────────────────────────────────────────────────────────
var<workgroup> scratch: array<u32, 4096>;

@compute @workgroup_size(256)
fn prefixSum(@builtin(local_invocation_id) lid: vec3u) {
  let t = lid.x;

  // Load cellCounts into shared memory (each thread loads 16 values)
  for (var i = 0u; i < 16u; i++) {
    let idx = t * 16u + i;
    scratch[idx] = atomicLoad(&cellCounts[idx]);
  }
  workgroupBarrier();

  // Upsweep (reduce) phase
  var stride = 1u;
  loop {
    if (stride >= GRID_SIZE) { break; }
    workgroupBarrier();
    let base = (t + 1u) * stride * 2u - 1u;
    if (base < GRID_SIZE) {
      scratch[base] += scratch[base - stride];
    }
    stride *= 2u;
  }

  // Clear last element (makes it exclusive)
  if (t == 0u) { scratch[GRID_SIZE - 1u] = 0u; }
  workgroupBarrier();

  // Downsweep phase
  stride = GRID_SIZE / 2u;
  loop {
    if (stride == 0u) { break; }
    workgroupBarrier();
    let base = (t + 1u) * stride * 2u - 1u;
    if (base < GRID_SIZE) {
      let tmp = scratch[base - stride];
      scratch[base - stride] = scratch[base];
      scratch[base] += tmp;
    }
    stride /= 2u;
  }
  workgroupBarrier();

  // Write results to both cellOffsets (immutable for lookup) and cellScatterIdx (mutable for scatter)
  for (var i = 0u; i < 16u; i++) {
    let idx = t * 16u + i;
    cellOffsets[idx] = scratch[idx];
    atomicStore(&cellScatterIdx[idx], scratch[idx]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4: scatter — place each particle into its sorted position
// Dispatch: ceil(numParticles / 256)
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.numParticles) { return; }

  let cellID = particleCellIDs[index];
  let slot = atomicAdd(&cellScatterIdx[cellID], 1u);
  sortedIndices[slot] = index;
}
