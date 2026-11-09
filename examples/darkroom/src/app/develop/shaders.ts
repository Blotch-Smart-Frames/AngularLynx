// cspell:words halation fract

/**
 * The GLSL behind Darkroom: three short programs that develop a photo the way
 * a lab would, in the order light goes through film.
 *
 * 1. `BRIGHT`: the photo's highlights, at a quarter of its size. Real film
 *    glows red around bright lights (halation: light goes through the
 *    emulsion, bounces off the film's base and exposes it again from behind),
 *    so the develop pass needs to know where the bright lights are.
 * 2. `BLUR`: a separable Gaussian, run across then down, that spreads those
 *    highlights into a glow. At a quarter size, nine taps reach far.
 * 3. `DEVELOP`: everything else in one pass, so a slider costs one draw.
 *
 * Every program shares one vertex shader that draws a quad, scaled so the
 * photo fits the canvas without being cropped (`u_scale`).
 */

/** The quad: two triangles over clip space, scaled to the photo's aspect. */
export const QUAD_VERTEX = `#version 300 es
in vec2 a_position;
uniform vec2 u_scale;
uniform float u_flip;
out vec2 v_uv;
void main() {
  // Photos are stored top row first, and GL draws the bottom row first, so
  // the pass that puts the photo on screen flips it. The glow's passes don't:
  // their buffers keep the photo's own texture coordinates.
  vec2 uv = a_position * 0.5 + 0.5;
  v_uv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flip));
  gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
}`;

/** Shared color helpers: the photo is sRGB; light adds up in linear. */
const COLOR = `
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toGamma(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * The highlights that will glow: what's left above `u_threshold` once the
 * exposure is applied, so pushing the exposure makes more of the photo glow,
 * as it would on film.
 */
export const BRIGHT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_photo;
uniform float u_exposure;
uniform float u_threshold;
out vec4 outColor;
${COLOR}
void main() {
  vec3 linear = toLinear(texture(u_photo, v_uv).rgb) * exp2(u_exposure);
  float over = max(luminance(linear) - u_threshold, 0.0);
  outColor = vec4(linear * over / max(luminance(linear), 1e-4), 1.0);
}`;

/** One direction of a 9-tap Gaussian (σ ≈ 2 pixels of the glow's buffer), weights summing to 1. */
export const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_step;
out vec4 outColor;
void main() {
  // The 9-tap kernel folded into 5 bilinear reads.
  vec3 sum = texture(u_source, v_uv).rgb * 0.2270270270;
  sum += texture(u_source, v_uv + u_step * 1.3846153846).rgb * 0.3162162162;
  sum += texture(u_source, v_uv - u_step * 1.3846153846).rgb * 0.3162162162;
  sum += texture(u_source, v_uv + u_step * 3.2307692308).rgb * 0.0702702703;
  sum += texture(u_source, v_uv - u_step * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(sum, 1.0);
}`;

/**
 * The darkroom itself. In order, as light meets film and paper:
 * exposure and white balance (in linear light), halation, the stock's
 * characteristic curves (a lookup table per channel), contrast around middle
 * gray, the highlights and shadows, saturation, the fade of a print's
 * blacks, the vignette of a lens, then grain, which sits on top of it all.
 *
 * `u_split` is the before/after line, as a fraction of the photo's width: the
 * photo shows unchanged to its left. It's -1 when the split is off.
 */
export const DEVELOP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_photo;
uniform sampler2D u_glow;
uniform sampler2D u_curves;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_temperature;
uniform float u_tint;
uniform float u_saturation;
uniform float u_fade;
uniform float u_halation;
uniform float u_vignette;
uniform float u_grain;
uniform float u_grainSize;
uniform float u_monochrome;
uniform float u_seed;
uniform float u_split;
uniform vec2 u_size;
out vec4 outColor;
${COLOR}

// A cheap, stable hash: the same grain on every frame for the same seed, so
// it doesn't crawl while a slider moves.
float hash(vec2 p) {
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

// Grain in clumps the size of u_grainSize pixels: value noise, smoothed.
float grain(vec2 pixel) {
  vec2 cell = pixel / u_grainSize + u_seed;
  vec2 i = floor(cell);
  vec2 f = fract(cell);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) - 0.5;
}

vec3 curve(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  // Half a texel in from each end, so 0 and 1 land on the table's ends.
  vec3 x = c * (255.0 / 256.0) + 0.5 / 256.0;
  return vec3(
    texture(u_curves, vec2(x.r, 0.5)).r,
    texture(u_curves, vec2(x.g, 0.5)).g,
    texture(u_curves, vec2(x.b, 0.5)).b
  );
}

void main() {
  vec3 original = texture(u_photo, v_uv).rgb;
  if (v_uv.x < u_split) {
    outColor = vec4(original, 1.0);
    return;
  }

  // Exposure, in stops, and white balance: warmer adds red and takes blue,
  // tint trades green for magenta. Both in linear light, as a filter would.
  vec3 linear = toLinear(original) * exp2(u_exposure);
  linear *= vec3(1.0 + u_temperature * 0.3, 1.0 - u_tint * 0.2, 1.0 - u_temperature * 0.3);

  // Halation: the red-orange glow film throws around bright lights.
  vec3 glow = texture(u_glow, v_uv).rgb;
  linear += luminance(glow) * vec3(1.0, 0.28, 0.08) * u_halation * 2.5;

  vec3 c = toGamma(linear);

  // Black and white: luminance, before the curves give it a stock's tone.
  c = mix(c, vec3(luminance(c)), u_monochrome);

  c = curve(c);

  // Contrast, pivoting on middle gray.
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;

  // Highlights and shadows: each moves only its own end of the scale.
  float l = luminance(clamp(c, 0.0, 1.0));
  float highMask = smoothstep(0.45, 1.0, l);
  float shadowMask = 1.0 - smoothstep(0.0, 0.55, l);
  c += u_highlights * 0.35 * highMask;
  c += u_shadows * 0.35 * shadowMask;

  // Saturation, around each pixel's own luminance.
  c = mix(vec3(luminance(c)), c, 1.0 + u_saturation);

  // Fade: a print's blacks lifted toward a warm gray, as a matte paper's are.
  c = mix(c, vec3(0.16, 0.15, 0.14) + c * 0.84, u_fade);

  // Vignette: the corners lose light, as through an old lens.
  vec2 centered = (v_uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
  float falloff = dot(centered, centered);
  c *= 1.0 - u_vignette * smoothstep(0.05, 0.9, falloff) * 0.85;

  // Grain: strongest in the mid-tones, where film shows it.
  float midTones = 1.0 - abs(luminance(clamp(c, 0.0, 1.0)) * 2.0 - 1.0);
  c += grain(v_uv * u_size) * u_grain * (0.35 + 0.65 * midTones) * 0.6;

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
