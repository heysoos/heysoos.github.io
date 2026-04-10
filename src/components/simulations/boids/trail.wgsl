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

// Fade pass: sample trail texture, multiply by decay factor.
@group(0) @binding(0) var fadeSampler: sampler;
@group(0) @binding(1) var fadeTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> decayFactor: f32;

@fragment
fn fadeFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(fadeTex, fadeSampler, uv);
  // Subtract half a quantization step after multiplying. Without this, small values
  // (e.g. 6/255 × 0.92 = 5.52/255) round back to themselves in bgra8unorm storage
  // and never reach zero. The 0.5/255 bias guarantees strict monotone decrease for
  // any decay < 1, regardless of the decay value chosen.
  let faded = max(c.rgb * decayFactor - vec3f(0.5 / 255.0), vec3f(0.0));
  return vec4f(faded, 1.0);
}

// Blit pass: copy trail texture to swapchain unchanged.
@group(0) @binding(0) var blitSampler: sampler;
@group(0) @binding(1) var blitTex: texture_2d<f32>;

@fragment
fn blitFrag(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(blitTex, blitSampler, uv);
}
