// Shared vertex shader for fullscreen quad passes.
// Covers clip space using a 6-vertex triangle list (no vertex buffer needed).
struct QuadOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn quadVert(@builtin(vertex_index) vi: u32) -> QuadOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  // UV: (0,0) top-left → (1,1) bottom-right, flipped y for texture coordinates
  var uv = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
  );
  var out: QuadOutput;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}

// Fade pass: sample trail texture, decay toward bgColor.
//   params.rgb = bgColor (the target color trails fade back to — page background)
//   params.a   = decayFactor (multiplier per frame applied to (c - bgColor))
@group(0) @binding(0) var fadeSampler: sampler;
@group(0) @binding(1) var fadeTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: vec4f;

@fragment
fn fadeFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c     = textureSample(fadeTex, fadeSampler, uv);
  let bg    = params.rgb;
  let decay = params.a;
  // Operate on the delta from bg so the asymptote is bg, not 0. Subtract half a
  // quantization step in the direction of bg after decaying. Without this, small
  // |delta| values round back to themselves in bgra8unorm storage and never reach
  // bg. select() clamps any component that crossed bg this frame.
  let delta  = c.rgb - bg;
  let faded  = delta * decay;
  let biased = faded - sign(faded) * vec3f(0.5 / 255.0);
  let snapped = select(biased, vec3f(0.0), sign(biased) != sign(faded));
  return vec4f(bg + snapped, 1.0);
}

// Blit pass: copy trail texture to swapchain unchanged.
@group(0) @binding(0) var blitSampler: sampler;
@group(0) @binding(1) var blitTex: texture_2d<f32>;

@fragment
fn blitFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(blitTex, blitSampler, uv);
}
