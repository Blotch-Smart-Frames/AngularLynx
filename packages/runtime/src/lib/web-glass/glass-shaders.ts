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
 * One horizontal and one vertical pass blur by about 1.7 pixels (the standard
 * deviation), and passes add up as the root of their squares.
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
 * Every number here is fitted to UIKit's Liquid Glass: screenshots of glass
 * shapes on the iOS 27 simulator over flat colors, hard edges and brightness
 * ramps, read pixel by pixel (the method is in
 * investigations/lynx-vs-web-differences.md). The web draws the same shapes
 * over the same backdrops within a few levels of them. What UIKit does, and
 * so what this does:
 *
 * - **Shape.** Each shape is a rounded box signed distance field (SDF). In a
 *   container, a smooth minimum unions them, with the container's `spacing`
 *   as its radius, scaled by how squarely the two surfaces face each other:
 *   two shapes join once the gap between them is under half the spacing, and
 *   the neck between them stays narrower than a plain smooth minimum's,
 *   which bulges where the surfaces run side by side.
 * - **Thickness.** The material follows the shape's shorter side: up to 60px
 *   it's the thin glass of a control, from 105px the dense glass of a panel,
 *   and in between a mix. Thin glass lets a third of the backdrop through
 *   sharp, where it's lighter than the blur behind it (darker, for the dark
 *   material); dense glass frosts it all.
 * - **Frost.** `regular` glass blurs the backdrop by about 12px, with a fifth
 *   of a much wider blur for the light that spills in from further away, and
 *   then lightens it (the light material) or darkens the bright parts (the
 *   dark one) and saturates it. A panel's light glass also takes about a
 *   third of its hue from what's behind the panel as a whole. `clear`
 *   glass keeps the backdrop sharp and only lifts it a little.
 * - **Lens.** Near the rim, the glass shows what lies further inside the
 *   shape, mirrored, like the edge of a thick lens: by up to half the shorter
 *   side at the edge, fading out over a third of it. Frost hides most of it.
 * - **Edge.** Light comes from above and below: the rim is a bright line
 *   along the top and the bottom, and a dark one down the sides, which falls
 *   just outside the shape. Clear glass's bright line is about three times as
 *   strong. The light regular material also has a faint dark line outside
 *   its top and bottom, which is what outlines it over white.
 * - **Shadow.** Regular glass casts one that grows with the shape: barely
 *   there under a control, wide and soft under a panel. Clear glass has none.
 *
 * A container's canvas reaches past its shapes, so the dark line and the
 * shadow are drawn here (`u_outside`). A lone shape's canvas is its own box:
 * its CSS draws them (see glass-host-style.ts), from the same numbers.
 *
 * A pressed shape isn't drawn differently: the manager scales its element,
 * so the shape arrives here larger, and washes it out with CSS, over its
 * content too (see glass-host-style.ts).
 *
 * GLSL ES 1.0 only lets a loop's own counter index the uniform arrays, so
 * every loop over the shapes reads them by its own.
 */
export const GLASS_FRAGMENT_SHADER = `
precision highp float;
#define MAX_SHAPES ${MAX_GLASS_SHAPES}
varying vec2 v_uv;
uniform sampler2D u_backdrop;
uniform sampler2D u_frosted;
uniform sampler2D u_haze;
uniform sampler2D u_wash;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform vec2 u_backdropSize;
uniform float u_scale;
uniform float u_smoothing;
uniform float u_dark;
uniform float u_outside;
uniform float u_luminance;
uniform int u_count;
uniform vec4 u_bounds[MAX_SHAPES];
uniform vec4 u_material[MAX_SHAPES];
uniform vec4 u_tint[MAX_SHAPES];

const vec3 LUMINANCE = vec3(0.2126, 0.7152, 0.0722);

// A rounded box: its outward unit normal in xy, and the signed distance to
// its edge in z. Deep inside, the nearest side changes along the diagonals of
// the corners, so the normal turns from one to the other over a few pixels
// rather than at once, which would crease the lens there.
vec3 roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  vec2 side = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  float nearest = max(q.x, q.y);
  if (nearest <= 0.0) {
    float turn = clamp(0.5 + (q.x - q.y) * 0.125, 0.0, 1.0);
    return vec3(normalize(side * vec2(turn, 1.0 - turn)), nearest - radius);
  }
  vec2 corner = max(q, 0.0);
  float reach = length(corner);
  return vec3(side * corner / reach, reach - radius);
}

// Joins two fields as UIKit's glass container does. The polynomial smooth
// minimum alone merges two shapes at the right gap (half of k), but swells
// wherever they come close, even side by side. UIKit's neck is as wide as
// the smooth minimum's only where the surfaces face each other squarely, so
// the radius shrinks as they turn away. Shrinking the radius, rather than
// what the minimum takes off, keeps the edge of the neck a smooth curve.
vec3 join(vec3 a, vec3 b, float k) {
  k *= pow(clamp(0.5 - 0.5 * dot(a.xy, b.xy), 0.0, 1.0), 0.85);
  if (k <= 1e-3) return a.z < b.z ? a : b;
  float h = max(k - abs(a.z - b.z), 0.0) / k;
  float nearer = clamp(0.5 + 0.5 * (b.z - a.z) / k, 0.0, 1.0);
  vec2 normal = mix(b.xy, a.xy, nearer);
  float size = length(normal);
  return vec3(
    size > 1e-4 ? normal / size : a.xy,
    min(a.z, b.z) - h * h * k * 0.25);
}

// The joined field alone, without the materials: for its slope where shapes
// merge, and for the shadow.
float fieldAt(vec2 p) {
  vec3 field = vec3(0.0, 0.0, 1e5);
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= u_count) break;
    vec3 shape = roundedBox(p - u_bounds[i].xy, u_bounds[i].zw, u_material[i].x);
    field = i == 0 ? shape : join(field, shape, u_smoothing);
  }
  return field.z;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;

  // Union the shapes, and blend each shape's material by how close it is, so
  // a merged bridge between two tints shades from one to the other.
  vec3 field = vec3(0.0, 0.0, 1e5);
  float weights = 0.0;
  float frost = 0.0;
  float shorter = 0.0;
  vec4 tint = vec4(0.0);
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= u_count) break;
    vec3 shape = roundedBox(p - u_bounds[i].xy, u_bounds[i].zw, u_material[i].x);
    field = i == 0 ? shape : join(field, shape, u_smoothing);
    float w = exp(-max(shape.z, 0.0) / max(u_smoothing * 0.3, 1.0)) + 1e-6;
    weights += w;
    frost += u_material[i].y * w;
    shorter += 2.0 * min(u_bounds[i].z, u_bounds[i].w) * w;
    tint += u_tint[i] * w;
  }
  // A group with no shape to draw (all of them collapsed) has no weights.
  weights = max(weights, 1e-6);
  frost /= weights;
  shorter = max(shorter / weights, 1.0);
  tint /= weights;
  float d = field.z;
  vec2 normal = field.xy;
  // Where shapes merge, the field is no longer a distance: across a bridge
  // it's nearly flat, so everything measured from the edge (the rim's lines,
  // the lens) would fill the bridge. Dividing by its slope gives the
  // distance back, to first order, and the slope's direction is the normal
  // of the merged outline rather than of either shape.
  if (u_smoothing > 0.0 && u_count > 1) {
    vec2 e = vec2(0.5, 0.0);
    vec2 gradient = vec2(
      fieldAt(p + e.xy) - fieldAt(p - e.xy),
      fieldAt(p + e.yx) - fieldAt(p - e.yx));
    float slope = length(gradient);
    if (slope > 1e-4) normal = gradient / slope;
    d /= clamp(slope, 0.2, 1.0);
  }
  // 0 for a control's thin glass, 1 for a panel's dense glass.
  float dense = clamp((shorter - 60.0) / 45.0, 0.0, 1.0);

  // One device pixel of anti-aliasing at the edge.
  float coverage = clamp(0.5 - d * u_scale, 0.0, 1.0);

  // Outside the shapes: the shadow, and over it the lines at the edge.
  vec4 outside = vec4(0.0);
  if (u_outside > 0.0 && coverage < 1.0) {
    // The shadow is the shapes' own outline, moved down and blurred: a
    // logistic curve stands in for the blurred edge. It grows with the shape
    // until its shorter side is 150px. The dark material's is half as strong
    // again under a panel.
    float grown = clamp((shorter - 60.0) / 90.0, 0.0, 1.0);
    float strength = mix(0.013, 0.105, grown) * (1.0 + 0.45 * u_dark * grown) * frost;
    float blur = mix(3.0, 17.0, grown);
    float below = fieldAt(p - vec2(0.0, mix(7.0, 10.0, grown)));
    // A container can hug its shapes, so the shadow fades out before the
    // canvas edge rather than stopping at it in a hard line.
    vec2 inside = min(p, u_size - p);
    float shadow = strength / (1.0 + exp(min(1.702 * below / blur, 30.0)))
      * smoothstep(0.0, 12.0, min(inside.x, inside.y));

    // The line down the sides is thickest where the edge is upright, two
    // thirds of a pixel, and gone by 60 degrees from it. It's darker over a
    // dark backdrop. The light regular material has a fainter one along the
    // top and the bottom, shaped the same way, and a tint fills the whole
    // band with its color.
    float sides = max(1.3333 * abs(normal.x) - 0.6667, 0.0);
    float sideLine = (0.67 - 0.44 * u_luminance)
      * clamp((sides - d) * u_scale + 0.5, 0.0, 1.0) * step(0.001, sides);
    float lit = frost * (1.0 - u_dark);
    float ends = max(1.3333 * abs(normal.y) - 0.6667, 0.0);
    float endLine = (0.215 - 0.14 * u_luminance) * lit * (1.0 - tint.a)
      * clamp((ends - d) * u_scale + 0.5, 0.0, 1.0) * step(0.001, ends);
    float tinted = 0.8 * lit * tint.a * clamp((0.6667 - d) * u_scale + 0.5, 0.0, 1.0);

    float alpha = 1.0 - (1.0 - shadow) * (1.0 - endLine) * (1.0 - tinted) * (1.0 - sideLine);
    outside = vec4(tint.rgb * tinted * (1.0 - sideLine), alpha);
  }
  if (coverage <= 0.0) {
    gl_FragColor = outside;
    return;
  }

  float depth = max(-d, 0.0);

  // The lens: toward the rim the glass shows the backdrop from further in.
  float lens = min(shorter, 87.0) * 0.5;
  float rim = clamp(1.0 - depth / min(shorter / 3.0, 19.5), 0.0, 1.0);
  float bend = lens * (0.84 * rim * rim + 0.27 * exp(-depth / 1.1)) * mix(1.0, 0.3, frost);
  vec2 uv = (p + u_offset - normal * bend) / u_backdropSize;

  // Clear glass softens the backdrop by about a pixel. What shows through
  // thin regular glass stays crisp.
  vec2 soft = vec2(0.9) / u_backdropSize;
  vec3 sharp = texture2D(u_backdrop, uv).rgb;
  vec3 softened = sharp * 0.4
    + (texture2D(u_backdrop, uv + soft).rgb + texture2D(u_backdrop, uv - soft).rgb
      + texture2D(u_backdrop, uv + vec2(soft.x, -soft.y)).rgb
      + texture2D(u_backdrop, uv + vec2(-soft.x, soft.y)).rgb) * 0.15;
  vec3 haze = texture2D(u_haze, uv).rgb;
  float panel = clamp((shorter - 60.0) / 90.0, 0.0, 1.0);
  // The fifth of a wider blur, less in a panel's dark glass, which spreads
  // further still (below).
  vec3 blurred = mix(texture2D(u_frosted, uv).rgb, haze, 0.2 - 0.15 * panel * panel * u_dark);
  // A panel's light glass takes its hue from much further away than its
  // brightness: about a third of it is the color of what's behind the
  // panel as a whole, averaged over a span that grows with the panel. The
  // brightness stays the blur's own.
  vec3 wash = texture2D(u_wash, uv).rgb;
  vec3 far = mix(haze, wash, clamp((shorter * 0.29 - 30.0) / 56.0, 0.0, 1.0));
  blurred += 0.32 * panel * panel * (1.0 - u_dark)
    * ((far - dot(far, LUMINANCE)) - (blurred - dot(blurred, LUMINANCE)));
  // A panel's dark glass spreads everything that far, brightness too, by
  // about a sixth: light reaches well into the dark side of an edge.
  blurred = mix(blurred, wash, 0.17 * panel * panel * u_dark);

  // Regular glass: the blur, with the sharp backdrop showing through where
  // it's lighter (the light material) or darker (the dark one).
  vec3 lighter = max(sharp - blurred, 0.0);
  vec3 darker = max(blurred - sharp, 0.0);
  vec3 regular = blurred
    + mix(mix(0.53, 0.08, dense), 0.06, u_dark) * lighter
    - u_dark * mix(0.5, 0.08, dense) * darker;
  // The light material lifts everything toward white. The dark one keeps the
  // dark parts and dims the bright ones, a panel's more than a control's.
  float brightness = dot(regular, LUMINANCE);
  vec3 light = mix(0.5216, 0.533, dense)
    + regular * (mix(0.49, 0.585, dense) - mix(0.02, 0.122, dense) * brightness);
  vec3 dark = 0.125
    + regular * (mix(1.0, 0.976, dense) - mix(0.4, 0.626, dense) * brightness);
  regular = mix(light, dark, u_dark);
  brightness = dot(regular, LUMINANCE);
  regular = brightness + (regular - brightness) * mix(1.9, 1.4, u_dark);

  vec3 clear = softened * 0.955 + 0.1255;
  brightness = dot(clear, LUMINANCE);
  clear = brightness + (clear - brightness) * 1.115;

  vec3 color = clamp(mix(clear, regular, frost), 0.0, 1.0);

  // A tint all but replaces the glass: what's behind only shades it a little
  // (the light material), or it's lightened a little (the dark one).
  brightness = dot(color, LUMINANCE);
  vec3 tinted = mix(tint.rgb * (0.55 + 0.45 * brightness), mix(tint.rgb, vec3(1.0), 0.13), u_dark);
  color = mix(color, tinted, tint.a);

  // The bright line along the top and the bottom, two thirds of a pixel
  // wide, and a glow under it that only the very top and bottom have. Clear
  // glass's is stronger, and stronger still over a bright backdrop.
  float upright = abs(normal.y);
  float line = 0.086 * pow(upright, 1.67) * (1.0 - smoothstep(0.55, 1.0, depth));
  float glow = pow(upright, 8.0) * (0.035 * exp(-depth / 0.27) + 0.045 * exp(-depth / 2.2));
  brightness = dot(color, LUMINANCE);
  color += (line + glow) * mix(2.1 * (1.0 + 1.3 * brightness), 1.0, frost);

  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(
    color * coverage + outside.rgb * (1.0 - coverage),
    coverage + outside.a * (1.0 - coverage));
}`;
