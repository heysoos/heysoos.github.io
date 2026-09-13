// field-deposit.wgsl — one instanced quad per particle, additively blended
// into the field texture. Output (w, w·vx, w·vy, 0) where w is a normalised
// gaussian in texel units, so channel r integrates to one particle.
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct DepositOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,   // offset from particle centre, texels
  @location(1) vel: vec2f,
}

@vertex
fn depositVert(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DepositOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  let p = particles[ii];
  let corner = corners[vi];
  // Quad radius = 3 sigma. 2 NDC units span the whole texture.
  let radiusTexels = 3.0 * params.splatSize;
  let halfSize = vec2f(radiusTexels * 2.0 / params.fieldW, radiusTexels * 2.0 / params.fieldH);
  var out: DepositOut;
  out.position = vec4f(p.pos + corner * halfSize, 0.0, 1.0);
  out.local = corner * radiusTexels;
  out.vel = p.vel;
  return out;
}

@fragment
fn depositFrag(@location(0) local: vec2f, @location(1) vel: vec2f) -> @location(0) vec4f {
  let s2 = params.splatSize * params.splatSize;
  let w = exp(-dot(local, local) / (2.0 * s2)) / (6.2831853 * s2);
  return vec4f(w, w * vel.x, w * vel.y, 0.0);
}
