const r=`struct Particle {\r
  pos: vec2f,\r
  vel: vec2f,\r
}\r
\r
struct Params {\r
  deltaTime:        f32,  // 0\r
  attractionRadius: f32,  // 4  — attraction + alignment range\r
  repulsionRadius:  f32,  // 8  — repulsion range\r
  attraction:   f32,  // 12\r
  repulsion:    f32,  // 16\r
  alignment:    f32,  // 20\r
  friction:     f32,  // 24 — quadratic drag coefficient\r
  maxSpeed:     f32,  // 28\r
  numParticles: u32,  // 32\r
  mouseX:       f32,  // 36\r
  mouseY:       f32,  // 40\r
  mouseActive:  f32,  // 44\r
  mouseRadius:  f32,  // 48\r
  coneAngle:    f32,  // 52 — FOV threshold\r
  aspect:       f32,  // 56 — canvas width/height\r
  size:         f32,  // 60 — particle scale (default 0.02)\r
  shapeId:      u32,  // 64 — 0=triangle 1=circle 2=diamond 3=blob\r
  colorR:       f32,  // 68\r
  colorG:       f32,  // 72\r
  colorB:       f32,  // 76\r
  opacity:      f32,  // 80 — global opacity multiplier\r
  opacityMode:  u32,  // 84 — 0=velocity-based, 1=uniform\r
  gridDim:      u32,  // 88 — active grid dimension (4–64)\r
  tick:         u32,  // 92 — frame counter for noise seed\r
  imageStrength:  f32,  // 96 — 0.0 = feature disabled\r
  imageForceMode: u32,  // 100\r
  imageInvert:    u32,  // 104\r
  noise:          f32,  // 108 — random velocity perturbation magnitude per frame\r
  mouseDX:        f32,  // 112 — pointer displacement this step (NDC), for drag-to-carry\r
  mouseDY:        f32,  // 116\r
  _pad0:          f32,  // 120\r
  _pad1:          f32,  // 124\r
}\r
\r
@group(0) @binding(0) var<uniform> params: Params;\r
@group(0) @binding(1) var<storage, read> particlesA: array<Particle>;\r
@group(0) @binding(2) var<storage, read_write> particlesB: array<Particle>;\r
\r
struct Obstacles {\r
  rects: array<vec4f, 16>,  // x=cx, y=cy, z=hw, w=hh in NDC\r
  count: u32,\r
}\r
\r
@group(0) @binding(3) var<uniform> obstacles: Obstacles;\r
\r
// Grid lookup buffers (written by boids-grid.wgsl passes 1-4)\r
@group(0) @binding(4) var<storage, read> cellOffsets:   array<u32>;\r
@group(0) @binding(5) var<storage, read> cellCounts:    array<u32>;\r
@group(0) @binding(6) var<storage, read> sortedParticles: array<Particle>;\r
@group(0) @binding(7) var imageTexture: texture_2d<f32>;\r
@group(0) @binding(8) var imageSampler: sampler;\r
\r
// PCG hash (well-distributed, GPU-safe integer arithmetic)\r
fn pcg(n: u32) -> u32 {\r
  var x = n * 747796405u + 2891336453u;\r
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;\r
  return (w >> 22u) ^ w;\r
}\r
\r
// Random vec2f in [-1,1]² from particle index + frame tick\r
fn rand2(index: u32, tick: u32) -> vec2f {\r
  let s1 = pcg(index ^ (tick * 2654435761u));\r
  let s2 = pcg(s1 + 1u);\r
  return vec2f(f32(s1), f32(s2)) / f32(0xffffffffu) * 2.0 - vec2f(1.0);\r
}\r
\r
fn obstacleForce(pos: vec2f) -> vec2f {\r
  var force = vec2f(0.0);\r
  let falloffRadius = 0.12;  // NDC units — tunable\r
\r
  for (var i = 0u; i < obstacles.count; i++) {\r
    let r = obstacles.rects[i];\r
    let center = r.xy;\r
    let half   = r.zw;\r
\r
    // Signed distance to nearest rect edge (negative = inside rect)\r
    let d    = abs(pos - center) - half;\r
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);\r
\r
    if (dist < falloffRadius) {\r
      // smoothstep: 1.0 at rect edge, 0.0 at falloffRadius — C¹ continuous\r
      let t      = smoothstep(falloffRadius, 0.0, dist);\r
      let strength = t * t;  // squared for softer onset, steeper near edge\r
\r
      // Direction: away from nearest point on rect surface.\r
      // For exterior points, this is simply (pos - nearest) / dist.\r
      // For interior points (nearest == pos), push toward the nearest edge.\r
      let nearest = clamp(pos, center - half, center + half);\r
      let away    = pos - nearest;\r
      let awayLen = length(away);\r
      var awayDir: vec2f;\r
      if (awayLen > 0.0001) {\r
        awayDir = away / awayLen;\r
      } else {\r
        // Inside rect: signed clearance to each wall (negative = inside, closest to 0 = nearest wall)\r
        let toEdge = abs(pos - center) - half;\r
        if (toEdge.x > toEdge.y) {\r
          awayDir = vec2f(select(-1.0, 1.0, pos.x > center.x), 0.0);\r
        } else {\r
          awayDir = vec2f(0.0, select(-1.0, 1.0, pos.y > center.y));\r
        }\r
      }\r
      force += awayDir * strength * 1.;\r
    }\r
  }\r
  return force;\r
}\r
\r
fn decodeForce(s: vec4f) -> vec2f {\r
  // a < 0.01 means outside image bounds — no force\r
  if (s.a < 0.01) { return vec2f(0.0); }\r
  // rg encodes direction: (dir * 0.5 + 0.5) → decode to [-1, 1]\r
  let dir = (s.rg * 2.0 - vec2f(1.0)) * s.b;\r
  return dir;\r
}\r
\r
@compute @workgroup_size(64)\r
fn computeMain(@builtin(global_invocation_id) id: vec3u) {\r
  let index = id.x;\r
  if (index >= params.numParticles) { return; }\r
\r
  var pos = particlesA[index].pos;\r
  var vel = particlesA[index].vel;\r
\r
  // Screen-space velocity (aspect-corrected) used for FOV checks so the\r
  // cone angle is isotropic regardless of canvas shape.\r
  let velS = vec2f(vel.x * params.aspect, vel.y);\r
  let speedS = length(velS);\r
\r
  // Spatial forces (attraction/repulsion) are accumulated in screen space,\r
  // then converted back to clip space when applied to velocity.\r
  // Alignment is accumulated in clip space (velocity-matching, not positional).\r
  var spatial_force = vec2f(0.0);  // screen space\r
  var align_force   = vec2f(0.0);  // clip space\r
\r
  // Adaptive grid: cell size = 2.0 / gridDim (set each frame so cell ≈ attractionRadius)\r
  let gDim = i32(params.gridDim);\r
  let cellW = 2.0 / f32(gDim);\r
\r
  // Determine this particle's grid cell\r
  let myCellX = i32(clamp(u32((pos.x + 1.0) / cellW), 0u, params.gridDim - 1u));\r
  let myCellY = i32(clamp(u32((pos.y + 1.0) / cellW), 0u, params.gridDim - 1u));\r
\r
  // Search radius in cells — with adaptive grid, attractionRadius ≈ cellW, so searchR ≈ 1\r
  let searchR = max(1i, i32(ceil(params.attractionRadius / cellW)));\r
\r
  for (var dy = -searchR; dy <= searchR; dy++) {\r
    for (var dx = -searchR; dx <= searchR; dx++) {\r
      // Torus wrapping for cell indices\r
      let nx = u32((myCellX + dx + gDim) % gDim);\r
      let ny = u32((myCellY + dy + gDim) % gDim);\r
      let cellID = u32(ny) * params.gridDim + u32(nx);\r
\r
      let start = cellOffsets[cellID];\r
      let end   = start + cellCounts[cellID];\r
\r
      for (var k = start; k < end; k++) {\r
        let other = sortedParticles[k];\r
        var diff = other.pos - pos;\r
        // Minimum image convention: wrap diff into [-1,1] across the period-2 torus\r
        // — branchless equivalent of four \`if (diff.* > 1)\` / \`< -1\` checks.\r
        diff -= round(diff * 0.5) * 2.0;\r
        // Aspect-correct for isotropic screen-space distances\r
        let diffS = vec2f(diff.x * params.aspect, diff.y);\r
        let rSq = dot(diffS, diffS);\r
        // r is floored at ~1e-4 so dir is well-defined for self/coincident\r
        // (where notCoincident below masks the contribution to zero anyway).\r
        let r   = sqrt(rSq + 1.0e-8);\r
        let dir = diffS / r;\r
\r
        // Branchless FOV: safe-speed avoids div-by-zero without an \`if\`.\r
        let speedSafe = max(speedS, 1.0e-4);\r
        let pointing  = dot(velS / speedSafe, dir);\r
\r
        // Branchless range + FOV gates as 0/1 masks (step(e,x) = 1 iff x>=e).\r
        // notCoincident drops self / coincident-position pairs (rSq < 1e-8).\r
        let notCoincident = step(1.0e-8, rSq);\r
        let attractGate   = step(r, params.attractionRadius)\r
                            * step(params.coneAngle, pointing)\r
                            * notCoincident;\r
        let repulseGate   = step(r, params.repulsionRadius) * notCoincident;\r
\r
        spatial_force += attractGate * params.attraction * dir;\r
        align_force   += attractGate * params.alignment * (other.vel - vel);\r
        spatial_force -= repulseGate * params.repulsion * dir;\r
      }\r
    }\r
  }\r
\r
  // Convert spatial force from screen space back to clip space, then combine\r
  let force = vec2f(spatial_force.x / params.aspect, spatial_force.y) + align_force;\r
\r
  // Quadratic friction (from reference: -F * sign(vel) * vel^2)\r
  let friction = -params.friction * sign(vel) * vel * vel;\r
\r
  // Obstacle repulsion applied before the main integrate+clamp so it\r
  // participates in the speed limit and steers rather than just boosting speed.\r
  vel = vel + params.deltaTime * (force + friction);\r
\r
  // Clamp to maxSpeed\r
  let sp = length(vel);\r
  if (sp > params.maxSpeed && sp > 0.0001) {\r
    vel = vel * (params.maxSpeed / sp);\r
  }\r
  vel = vel + obstacleForce(pos);\r
\r
  // Mouse attraction (use screen-space distance for isotropic mouseRadius)\r
  if (params.mouseActive > 0.5) {\r
    let toMouse = vec2f(params.mouseX, params.mouseY) - pos;\r
    let toMouseS = vec2f(toMouse.x * params.aspect, toMouse.y);\r
    let mouseDist = length(toMouseS);\r
    if (mouseDist < params.mouseRadius && mouseDist > 0.0001) {\r
      // Screen-space direction converted back to clip space: aspect cancels\r
      vel += 0.005 * normalize(toMouse) / mouseDist ;\r
    }\r
  }\r
\r
  // Image force field\r
  if (params.imageStrength > 0.0) {\r
    // Map boid NDC position [-1,1] → UV [0,1], flipping Y (NDC y-up, texture y-down)\r
    let uv      = pos * vec2f(0.5, -0.5) + vec2f(0.5);\r
    let sample  = textureSampleLevel(imageTexture, imageSampler, uv, 0.0);\r
    var imgForce = decodeForce(sample);\r
    if (params.imageInvert == 1u) { imgForce = -imgForce; }\r
    // Convert canvas-space force (y-down) back to clip-space (y-up)\r
    vel += vec2f(imgForce.x, -imgForce.y) * params.imageStrength;\r
  }\r
\r
  // Random noise perturbation (applied last so it doesn't interfere with steering)\r
  if (params.noise > 0.0) {\r
    vel += rand2(index, params.tick) * params.noise;\r
    let nsp = length(vel);\r
    if (nsp > params.maxSpeed && nsp > 0.0001) {\r
      vel = vel * (params.maxSpeed / nsp);\r
    }\r
  }\r
\r
  // Drag-to-carry: the pointer's displacement this step is added to the\r
  // position of particles inside mouseRadius (of the old or new pointer\r
  // position), so a drag moves the clump regardless of maxSpeed; 30% also\r
  // goes into velocity so they coast when the finger stops.\r
  if (params.mouseActive > 0.5) {\r
    let carry = vec2f(params.mouseDX, params.mouseDY);\r
    let m = vec2f(params.mouseX, params.mouseY);\r
    let dNew = m - pos;\r
    let dOld = m - carry - pos;\r
    let sNew = length(vec2f(dNew.x * params.aspect, dNew.y));\r
    let sOld = length(vec2f(dOld.x * params.aspect, dOld.y));\r
    if (min(sNew, sOld) < params.mouseRadius) {\r
      pos += carry;\r
      vel += carry * 0.3 / max(params.deltaTime, 0.0001);\r
    }\r
  }\r
\r
  // Integrate position\r
  pos = pos + vel * params.deltaTime;\r
\r
  // Wrap edges\r
  if (pos.x < -1.0) { pos.x += 2.0; }\r
  if (pos.x > 1.0)  { pos.x -= 2.0; }\r
  if (pos.y < -1.0) { pos.y += 2.0; }\r
  if (pos.y > 1.0)  { pos.y -= 2.0; }\r
\r
  particlesB[index] = Particle(pos, vel);\r
}\r
\r
// --- Render ---\r
\r
struct VertexOutput {\r
  @builtin(position) position: vec4f,\r
  @location(0) speed: f32,\r
  @location(1) uv: vec2f,\r
}\r
\r
@vertex\r
fn vertexMain(\r
  @location(0) particlePos: vec2f,\r
  @location(1) particleVel: vec2f,\r
  @location(2) vertexPos: vec2f,\r
) -> VertexOutput {\r
  // Subtract π/2 so tip (starting at +y) aligns with velocity\r
  let angle = atan2(particleVel.y, particleVel.x) - 1.5707963;\r
  let cosA = cos(angle);\r
  let sinA = sin(angle);\r
  let scaled = vertexPos * params.size;\r
  let rotated = vec2f(\r
    scaled.x * cosA - scaled.y * sinA,\r
    scaled.x * sinA + scaled.y * cosA,\r
  );\r
  var out: VertexOutput;\r
  out.position = vec4f(particlePos + vec2f(rotated.x / params.aspect, rotated.y), 0.0, 1.0);\r
  out.speed = length(particleVel);\r
  out.uv = vertexPos; // pre-rotation UV for SDF (-1..1)\r
  return out;\r
}\r
\r
// Equilateral triangle SDF (IQ), inside <= 0, pointing +y\r
fn sdTriangle(p: vec2f) -> f32 {\r
  let k = sqrt(3.0);\r
  var q = vec2f(abs(p.x) - 1.0, p.y + 1.0 / k);\r
  if q.x + k * q.y > 0.0 {\r
    q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0;\r
  }\r
  q.x = q.x - clamp(q.x, -2.0, 0.0);\r
  return -length(q) * sign(q.y);\r
}\r
\r
@fragment\r
fn fragmentMain(@location(0) speed: f32, @location(1) uv: vec2f) -> @location(0) vec4f {\r
  var mask: f32 = 1.0;\r
\r
  switch params.shapeId {\r
    case 0u: { // triangle\r
      if sdTriangle(uv) > 0.0 { discard; }\r
    }\r
    case 1u: { // circle\r
      if length(uv) > 1.0 { discard; }\r
    }\r
    case 2u: { // diamond\r
      if abs(uv.x) + abs(uv.y) > 1.0 { discard; }\r
    }\r
    case 3u: { // soft blob — feathered circle\r
      let d = length(uv);\r
      if d > 1.0 { discard; }\r
      mask = 1.0 - smoothstep(0.4, 1.0, d);\r
    }\r
    default: {}\r
  }\r
\r
  var finalAlpha: f32;\r
  if (params.opacityMode == 1u) {\r
    // Uniform: flat opacity\r
    finalAlpha = params.opacity;\r
  } else {\r
    // Velocity-based (default): brighter = faster\r
    finalAlpha = clamp(speed * 5.0, 0.3, 1.0) * params.opacity;\r
  }\r
\r
  return vec4f(params.colorR, params.colorG, params.colorB, finalAlpha * mask);\r
}\r
`,s=[{id:"old-default",name:"Old Default",isDefault:!1,params:{dt:.016,numParticles:200,attractionRadius:.2,repulsionRadius:.05,attraction:.3,repulsion:1.5,alignment:.1,friction:2,maxSpeed:.22,mouseRadius:.15,coneAngle:-.5,size:.02,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0},trailsEnabled:!1,trailDecay:.92},{id:"pink-metal-1775549969719",name:"Pink Metal",params:{dt:.016,numParticles:2e3,attractionRadius:.2,repulsionRadius:.05,attraction:.3,repulsion:1.5,alignment:.1,friction:2,maxSpeed:.22,mouseRadius:.15,coneAngle:-.5,size:.005,shapeId:0,colorR:.88,colorG:.31,colorB:.5,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1},{id:"metropolitan",name:"Metropolitan",params:{dt:.016,numParticles:2e3,attractionRadius:.6,repulsionRadius:.02,attraction:.42,repulsion:1.85,alignment:.15,friction:2,maxSpeed:.16,mouseRadius:.15,coneAngle:.8,size:.005,shapeId:0,colorR:.49411764705882355,colorG:.7372549019607844,colorB:.8862745098039215,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1},{id:"porosity",name:"Porosity",params:{dt:.016,numParticles:2e3,attractionRadius:.08,repulsionRadius:.03,attraction:.68,repulsion:5,alignment:.15,friction:2,maxSpeed:.15,mouseRadius:.5,coneAngle:-.2,size:.005,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1},{id:"oscillator",name:"Oscillator",params:{dt:.016,numParticles:5e3,attractionRadius:.05,repulsionRadius:.03,attraction:.21,repulsion:4.9,alignment:.48,friction:2,maxSpeed:.15,mouseRadius:.5,coneAngle:.6,size:.005,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"oscillator2",name:"Oscillator2",params:{dt:.016,numParticles:5e3,attractionRadius:.1,repulsionRadius:.03,attraction:.21,repulsion:4.9,alignment:1,friction:2,maxSpeed:.15,mouseRadius:.5,coneAngle:.95,size:.005,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"chain-link",name:"Chain Link",params:{dt:.016,numParticles:5e3,attractionRadius:.44,repulsionRadius:.155,attraction:.9,repulsion:1.75,alignment:.39,friction:2,maxSpeed:.18,mouseRadius:.5,coneAngle:.4,size:.005,shapeId:0,colorR:1,colorG:1,colorB:1,opacity:1,opacityMode:0},trailsEnabled:!1,trailDecay:.95,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"abstract-jellyfish",name:"Abstract Jellyfish",params:{dt:.019,numParticles:1e3,attractionRadius:.6,repulsionRadius:.3,attraction:1.66,repulsion:2.15,alignment:1,friction:2,maxSpeed:.18,mouseRadius:.5,coneAngle:-.7,size:.005,shapeId:1,colorR:.88,colorG:.31,colorB:.5,opacity:1,opacityMode:0},trailsEnabled:!1,trailDecay:.95,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"fishonium",name:"Fishonium",params:{dt:.019,numParticles:500,attractionRadius:.44,repulsionRadius:.135,attraction:.21,repulsion:.4,alignment:.29,friction:6,maxSpeed:.15,mouseRadius:.5,coneAngle:-.7,size:.005,shapeId:1,colorR:.31,colorG:.78,colorB:.47,opacity:1,opacityMode:0},trailsEnabled:!1,trailDecay:.95,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"snake",name:"Snake",params:{dt:.016,numParticles:3575,attractionRadius:.2,repulsionRadius:.03,attraction:2,repulsion:1.85,alignment:.19,friction:2,maxSpeed:.22,mouseRadius:.15,coneAngle:.55,size:.005,shapeId:0,colorR:.88,colorG:.63,colorB:.25,opacity:1,opacityMode:0},trailsEnabled:!1,trailDecay:.92,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"particlebahn",name:"ParticleBahn",params:{dt:.016,numParticles:2e3,attractionRadius:.22,repulsionRadius:.265,attraction:2,repulsion:2.55,alignment:.98,friction:2,maxSpeed:.2,mouseRadius:.15,coneAngle:-.5,size:.005,shapeId:0,colorR:.1450980392156863,colorG:.09803921568627451,colorB:.4823529411764706,opacity:1,opacityMode:0},trailsEnabled:!0,trailDecay:.92,isDefault:!1,shaderFile:"boids-linear",shader:r},{id:"bokeh",name:"Bokeh",params:{dt:.01,numParticles:200,attractionRadius:.16,repulsionRadius:.065,attraction:1.58,repulsion:2.7,alignment:.42,friction:2,maxSpeed:.2,mouseRadius:.15,coneAngle:-.35,size:.063,shapeId:1,colorR:.615686274509804,colorG:.3568627450980392,colorB:.1843137254901961,opacity:.03,opacityMode:1},trailsEnabled:!0,trailDecay:.94,isDefault:!0},{id:"bokeh-chained",name:"Bokeh Chained",params:{dt:.01,numParticles:200,attractionRadius:.16,repulsionRadius:.065,attraction:.12,repulsion:2.7,alignment:.42,friction:2,maxSpeed:.2,mouseRadius:.15,coneAngle:-.35,size:.063,shapeId:1,colorR:.615686274509804,colorG:.3568627450980392,colorB:.1843137254901961,opacity:.03,opacityMode:1},trailsEnabled:!0,trailDecay:.94,isDefault:!1},{id:"space-worms",name:"Space Worms",params:{dt:.016,numParticles:4e3,attractionRadius:.05,repulsionRadius:.015,attraction:2,repulsion:.15,alignment:1,friction:10,maxSpeed:.16,mouseRadius:.15,coneAngle:.8,size:.012,shapeId:1,colorR:.88,colorG:.31,colorB:.5,opacity:.01,opacityMode:1},trailsEnabled:!0,trailDecay:.98,isDefault:!1}],t=e=>e.replace(/\r\n?/g,`
`);async function o(e,a,i){Object.assign(e.params,a.params),e.trailsEnabled=a.trailsEnabled,e.trailDecay=a.trailDecay;const n=a.shader??e.defaultShaderSource;t(n)!==t(e.shaderSource)&&await e.reloadShader(n),i?.(n)}function l(e,a){const n={params:{...a??e.params},trailsEnabled:e.trailsEnabled,trailDecay:e.trailDecay};return t(e.shaderSource)!==t(e.defaultShaderSource)&&(n.shader=e.shaderSource),n}export{s as B,o as a,l as c};
