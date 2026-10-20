/**
 * The most glass shapes one group draws. GLSL ES 1.0 (WebGL 1) needs a
 * constant array size and loop bound; a container rarely holds more than a
 * handful of shapes, and any past this aren't drawn.
 */
export const MAX_GLASS_SHAPES = 16;

/** Full-screen quad. `v_uv` runs 0→1 with y pointing up, as GL does. */
export const QUAD_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** Copies a texture, downsampling the backdrop before it is blurred. */
export const COPY_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_source;
void main() {
  gl_FragColor = texture2D(u_source, v_uv);
}`;

/**
 * One direction of a separable Gaussian blur. Sampling between two pixels lets
 * the linear filter average both at once, so five fetches cover nine pixels.
 */
export const BLUR_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_direction;
void main() {
  vec2 near = u_direction * 1.3846153846;
  vec2 far = u_direction * 3.2307692308;
  gl_FragColor = texture2D(u_source, v_uv) * 0.2270270270
    + (texture2D(u_source, v_uv + near) + texture2D(u_source, v_uv - near)) * 0.3162162162
    + (texture2D(u_source, v_uv + far) + texture2D(u_source, v_uv - far)) * 0.0702702703;
}`;

/**
 * Draws every glass shape of a group in one pass, in CSS pixels with y down.
 *
 * GLSL ES 1.0 only lets a loop's own counter index the uniform arrays, so the
 * per-shape distance is written out in each loop rather than in a helper.
 *
 * - Each shape is a rounded box signed distance field (SDF). A smooth minimum
 *   unions them, so shapes closer than the container's `spacing` flow into one
 *   another like iOS 26's glass container.
 * - The lens samples the backdrop outward near the rim, where the glass is
 *   steepest, and slightly inward elsewhere. The rim shows the content just
 *   outside it bent around the edge, and the middle reads a little magnified.
 *   The SDF gradient gives the direction; its length fades the effect where
 *   merged shapes crease, which would otherwise show a seam.
 * - `regular` glass mixes in a blurred, brightened backdrop; `clear` glass
 *   keeps it sharp. Tint, a specular rim lit from the top left, and a press
 *   glow for interactive glass go on top.
 */
export const GLASS_FRAGMENT_SHADER = `
precision highp float;
#define MAX_SHAPES ${MAX_GLASS_SHAPES}
varying vec2 v_uv;
uniform sampler2D u_backdrop;
uniform sampler2D u_frosted;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform vec2 u_backdropSize;
uniform float u_scale;
uniform float u_smoothing;
uniform float u_dark;
uniform float u_shadow;
uniform int u_count;
uniform vec4 u_bounds[MAX_SHAPES];
uniform vec4 u_material[MAX_SHAPES];
uniform vec4 u_tint[MAX_SHAPES];
uniform vec3 u_pointer;

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float smoothUnion(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float scene(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= u_count) break;
    d = smoothUnion(d, roundedBox(p - u_bounds[i].xy, u_bounds[i].zw, u_material[i].x), u_smoothing);
  }
  return d;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;

  // Union the shapes, and blend each shape's material by how close it is, so
  // a merged bridge between two tints shades from one to the other.
  float d = 1e5;
  float weights = 0.0;
  float frost = 0.0;
  float lens = 0.0;
  vec4 tint = vec4(0.0);
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= u_count) break;
    float di = roundedBox(p - u_bounds[i].xy, u_bounds[i].zw, u_material[i].x);
    d = smoothUnion(d, di, u_smoothing);
    float w = exp(-max(di, 0.0) / max(u_smoothing * 0.3, 1.0)) + 1e-6;
    weights += w;
    frost += u_material[i].y * w;
    lens += min(u_bounds[i].z, u_bounds[i].w) * w;
    tint += u_tint[i] * w;
  }
  frost /= weights;
  lens = max(lens / weights, 1.0);
  tint /= weights;

  // One device pixel of anti-aliasing at the edge.
  float coverage = clamp(0.5 - d * u_scale, 0.0, 1.0);
  // A container can hug its shapes, so the shadow fades out before the canvas
  // edge rather than stopping at it in a hard line.
  vec2 inside = min(p, u_size - p);
  float shadow = u_shadow * 0.1 * exp(-max(d, 0.0) / 6.0)
    * smoothstep(0.0, 12.0, min(inside.x, inside.y));
  if (coverage <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, d < 24.0 ? shadow : 0.0);
    return;
  }

  vec2 e = vec2(0.5, 0.0);
  vec2 gradient = vec2(
    scene(p + e.xy) - scene(p - e.xy),
    scene(p + e.yx) - scene(p - e.yx));
  float slope = length(gradient);
  vec2 normal = slope > 0.0 ? gradient / slope : vec2(0.0);
  gradient = normal * min(slope, 1.0);

  float depth = max(-d, 0.0);
  float rim = pow(1.0 - clamp(depth / lens, 0.0, 1.0), 3.0);
  vec2 offset = gradient * (lens * 0.45 * rim - max(lens - depth, 0.0) * 0.05);
  vec2 base = p + u_offset;
  vec2 uv = (base + offset) / u_backdropSize;

  // A touch of dispersion: red bends a little more than blue.
  vec3 sharp = vec3(
    texture2D(u_backdrop, (base + offset * 1.035) / u_backdropSize).r,
    texture2D(u_backdrop, uv).g,
    texture2D(u_backdrop, (base + offset * 0.965) / u_backdropSize).b);
  vec3 color = mix(sharp, texture2D(u_frosted, uv).rgb, frost);

  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(brightness), color, 1.0 + 0.3 * frost);
  color = mix(color, mix(vec3(1.0), vec3(0.12), u_dark), frost * mix(0.22, 0.34, u_dark));
  color *= 1.0 - 0.08 * u_dark * (1.0 - frost);
  color = mix(color, tint.rgb, tint.a);

  vec2 light = normalize(vec2(-0.6, -0.8));
  float facing = dot(normal, light);
  color += (1.0 - smoothstep(0.0, 1.5, depth)) * (0.22 + 0.58 * pow(abs(facing), 1.5)) * mix(0.75, 0.5, u_dark);
  color += (1.0 - smoothstep(0.0, lens * 0.5, depth)) * max(facing, 0.0) * 0.16;
  color += (1.0 - smoothstep(0.0, lens * 0.35, depth)) * max(-facing, 0.0) * 0.07;

  float reach = length(p - u_pointer.xy);
  color += u_pointer.z * 0.2 * exp(-reach * reach / (1.2 * lens * lens));

  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * coverage, coverage + shadow * (1.0 - coverage));
}`;
