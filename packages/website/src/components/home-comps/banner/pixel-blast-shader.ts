/**
 * The banner's pixel field shaders: a slow drift of dithered pixels in one color, thinned out
 * behind the copy and faded out towards the edges.
 *
 * Ported from Pixel Blast by React Bits (https://reactbits.dev/backgrounds/pixel-blast), inspired
 * by https://github.com/zavalit/bayer-dithering-webgl-demo.
 * MIT + Commons Clause License Condition v1.0, Copyright (c) 2026 David Haz.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, and distribute the
 * Software as part of an application, website, or product, subject to the following conditions: the
 * above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software. Commons Clause Restriction: you may use this Software, including for any
 * commercial purpose, so long as you do not sell, sublicense, or redistribute the components
 * themselves, whether alone, in a bundle, or as a ported version. THE SOFTWARE IS PROVIDED "AS IS",
 * WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
 * THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** How many ripples can spread at once; a new one replaces the oldest. */
export const PIXEL_RIPPLES = 10;

export const PIXEL_VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const PIXEL_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uScale;
uniform float uDensity;
uniform float uEdgeFade;
uniform vec2 uRipplePos[${PIXEL_RIPPLES}];
uniform float uRippleTime[${PIXEL_RIPPLES}];
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uQuiet;
uniform float uQuietFeather;
uniform float uQuietStrength;

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5 * (a)) * 0.25 + Bayer2(a))

float hash11(float n) { return fract(sin(n) * 43758.5453); }

float valueNoise(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  const vec3 k = vec3(1.0, 57.0, 113.0);
  float n000 = hash11(dot(ip, k));
  float n100 = hash11(dot(ip + vec3(1.0, 0.0, 0.0), k));
  float n010 = hash11(dot(ip + vec3(0.0, 1.0, 0.0), k));
  float n110 = hash11(dot(ip + vec3(1.0, 1.0, 0.0), k));
  float n001 = hash11(dot(ip + vec3(0.0, 0.0, 1.0), k));
  float n101 = hash11(dot(ip + vec3(1.0, 0.0, 1.0), k));
  float n011 = hash11(dot(ip + vec3(0.0, 1.0, 1.0), k));
  float n111 = hash11(dot(ip + vec3(1.0, 1.0, 1.0), k));
  vec3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  float y0 = mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y);
  float y1 = mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t) {
  vec3 p = vec3(uv * uScale, t);
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < 5; ++i) {
    sum += valueNoise(p * freq);
    freq *= 1.25;
  }
  return sum * 0.5 + 0.5;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspect = uResolution.x / uResolution.y;
  const float cell = 8.0;
  vec2 uv = floor(fragCoord / cell) * cell / uResolution * vec2(aspect, 1.0);

  float feed = fbm2(uv, uTime * 0.05) * 0.5 - 0.65 + (uDensity - 0.5) * 0.3;

  for (int i = 0; i < ${PIXEL_RIPPLES}; ++i) {
    vec2 pos = uRipplePos[i];
    if (pos.x < 0.0) continue;
    vec2 center = ((pos - uResolution * .5 - cell * .5) / uResolution) * vec2(aspect, 1.0);
    float t = max(uTime - uRippleTime[i], 0.0);
    float r = distance(uv, center);
    float ring = exp(-pow((r - 0.3 * t) / 0.1, 2.0));
    feed = max(feed, ring * exp(-t) * exp(-10.0 * r));
  }

  float on = step(0.5, feed + Bayer8(fragCoord) - 0.5);

  vec2 norm = gl_FragCoord.xy / uResolution;
  float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
  float fade = uEdgeFade > 0.0 ? smoothstep(0.0, uEdgeFade, edge) : 1.0;

  // Thinner behind the copy, so the words always read first.
  vec2 outside = max(max(uQuiet.xy - gl_FragCoord.xy, gl_FragCoord.xy - uQuiet.zw), 0.0);
  float quiet = 1.0 - uQuietStrength * (1.0 - smoothstep(0.0, uQuietFeather, length(outside)));

  float alpha = on * fade * quiet * uOpacity;
  fragColor = vec4(uColor * alpha, alpha);
}
`;
