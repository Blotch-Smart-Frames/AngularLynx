// cspell:words fbm snoise permute taylor Ashima Gustavson granulation fract minnaert Minnaert's tonemapping xxyy xzyw zzww
// cspell:words Encke Cassini ringlets terminator vlocal

/**
 * The orrery's GLSL. three.js's ShaderMaterial adds the matrices, the
 * camera's position and the `position`/`normal`/`uv` attributes, and turns
 * this WebGL1-style GLSL into GLSL ES 3.0. Every fragment shader works in
 * linear light and ends with three's tone mapping and sRGB output, so the
 * Sun can be brighter than white and still roll off like film.
 *
 * Lighting comes from one place: the Sun, at the scene's origin.
 */

/**
 * 3D simplex noise (Ashima Arts and Stefan Gustavson, MIT), and fractal
 * sums of it: the stuff of every cloud, band and boiling cell below.
 */
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  // Four octaves: enough detail for a planet a phone shows at 300px.
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * snoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    return sum;
  }
`;

/** sRGB in, linear out: the maps are photographs in sRGB. */
const COLOR = /* glsl */ `
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
`;

/**
 * Every body's vertex shader: world position and normal for the light,
 * the sphere's own direction (`vLocal`) for procedural surfaces, which
 * turns with the body, and the map's coordinates.
 */
export const BODY_VERTEX = /* glsl */ `
  varying vec3 vPosW;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vLocal = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** The end of every fragment shader: three's tone mapping, then sRGB. */
const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/**
 * The Sun: convection cells that rise and sink over minutes, granulation
 * on top, sunspots that drift, and limb darkening (the edge is cooler gas
 * seen at a slant, so it's darker and redder).
 */
export const SUN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vPosW;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  ${NOISE}
  void main() {
    vec3 p = vLocal;
    float t = uTime;
    // Domain warping makes the cells churn rather than slide.
    vec3 warp = vec3(fbm(p * 2.2 + t * 0.04), fbm(p * 2.2 + 7.0 - t * 0.03), 0.0);
    float cells = fbm(p * 4.0 + warp * 1.6 + vec3(0.0, t * 0.05, 0.0));
    float grain = snoise(p * 34.0 + vec3(t * 0.4)) * 0.5 + 0.5;
    float spots = smoothstep(0.38, 0.5, fbm(p * 1.6 + vec3(t * 0.008, 0.0, 0.0)))
      * smoothstep(0.6, 0.15, abs(p.y));
    float heat = clamp(0.55 + cells * 0.55 + (grain - 0.5) * 0.22 - spots * 0.9, 0.0, 1.0);

    vec3 deep = vec3(0.85, 0.16, 0.02);
    vec3 orange = vec3(1.0, 0.45, 0.07);
    vec3 white = vec3(1.0, 0.86, 0.6);
    vec3 color = mix(deep, orange, smoothstep(0.1, 0.55, heat));
    color = mix(color, white, smoothstep(0.55, 0.95, heat));

    vec3 view = normalize(cameraPosition - vPosW);
    float mu = clamp(dot(normalize(vNormalW), view), 0.0, 1.0);
    vec3 limb = mix(vec3(0.55, 0.28, 0.12), vec3(1.0), pow(mu, 0.45));
    gl_FragColor = vec4(color * limb * 2.4, 1.0);
    ${OUTPUT}
  }
`;

/** A camera-facing square: the corona and glare are drawn on one. */
export const BILLBOARD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    // The square keeps its world size but always faces the camera.
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scale = length(modelMatrix[0].xyz);
    center.xy += position.xy * scale;
    gl_Position = projectionMatrix * center;
  }
`;

/**
 * The corona around the Sun: a glow that falls off with distance, broken
 * into slow streamers by noise around the rim. Added on top of the sky.
 * `uInner` is the Sun's radius as a fraction of the square's half-width.
 */
export const CORONA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uInner;
  uniform float uStrength;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float angle = atan(vUv.y, vUv.x);
    float edge = max(r - uInner, 0.0) / (1.0 - uInner);
    vec2 ring = vec2(cos(angle), sin(angle));
    float streamers = fbm(vec3(ring * 2.6, edge * 1.5 - uTime * 0.05)) * 0.5 + 0.5;
    float glow = exp(-edge * 6.5) * (0.55 + streamers * 0.9) + exp(-edge * 22.0) * 0.9;
    glow *= smoothstep(1.0, 0.7, r);
    vec3 color = mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.8, 0.5), exp(-edge * 10.0));
    gl_FragColor = vec4(color * glow * uStrength, 1.0);
    ${OUTPUT}
  }
`;

/** Shared by the planets: the light, the view and a soft terminator. */
const LIGHTING = /* glsl */ `
  uniform float uAmbient;
  varying vec3 vPosW;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying vec2 vUv;

  vec3 sunDirection() { return normalize(-vPosW); }
  vec3 viewDirection() { return normalize(cameraPosition - vPosW); }
  // Light past the terminator for a few degrees: a planet's edge of night
  // is soft, from its own size against the Sun's disc.
  float wrapLight(float ndl, float wrap) {
    return clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  }
`;

/**
 * Mercury, Mars and the Moon: a map, the Sun's light, and Minnaert's
 * darkening toward the limb, which dusty ground has and plastic doesn't.
 */
export const ROCKY_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uAtmosphere;
  ${LIGHTING}
  ${COLOR}
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 l = sunDirection();
    vec3 v = viewDirection();
    vec3 albedo = toLinear(texture2D(uMap, vUv).rgb);
    float ndl = dot(n, l);
    float ndv = max(dot(n, v), 0.0);
    float lit = wrapLight(ndl, 0.04);
    float minnaert = pow(max(ndl, 0.0) * ndv, 0.18);
    vec3 color = albedo * (lit * mix(0.8, 1.15, minnaert) * 1.7 + uAmbient);
    // A thin atmosphere (Mars) shows as a haze on the lit limb.
    float rim = pow(1.0 - ndv, 4.0) * smoothstep(-0.1, 0.4, ndl);
    color += uAtmosphere * rim;
    gl_FragColor = vec4(color, 1.0);
    ${OUTPUT}
  }
`;

/**
 * The Earth: day and night maps meeting at a soft terminator, the city
 * lights only on the night side, clouds that drift and shade the ground
 * beneath them, the Sun's glint on the oceans, and blue sky at the limb
 * that reddens toward the terminator, where sunlight crosses the most air.
 */
export const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform float uHasClouds;
  uniform float uTime;
  ${LIGHTING}
  ${COLOR}
  ${NOISE}

  float cloudsAt(vec2 uv) {
    // The map is a real satellite mosaic: a gray veil of haze and swath
    // edges under the clouds, which the curve drops.
    if (uHasClouds > 0.5) {
      // A gentle curve: thin cloud stays thin, so edges feather.
      return smoothstep(0.2, 1.0, texture2D(uClouds, uv).r) * 0.92;
    }
    // No cloud map: weather from noise, banded like the real circulation.
    float lat = vLocal.y;
    float n = fbm(vLocal * 3.5 + vec3(uTime * 0.01, 0.0, 0.0)) * 0.5 + 0.5;
    float belts = 0.55 + 0.35 * cos(lat * 9.0);
    return smoothstep(0.5, 0.85, n * belts + 0.12);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 l = sunDirection();
    vec3 v = viewDirection();
    float ndl = dot(n, l);
    float ndv = max(dot(n, v), 0.0);

    vec2 drift = vec2(uTime * 0.0006, 0.0);
    vec3 day = toLinear(texture2D(uDay, vUv).rgb);
    float lights = toLinear(texture2D(uNight, vUv).rgb).r;
    float clouds = cloudsAt(vUv + drift);
    // A cloud's shadow falls a little away from the Sun.
    float shade = cloudsAt(vUv + drift + vec2(0.0015, 0.0));

    float dayside = smoothstep(-0.12, 0.18, ndl);
    float lit = wrapLight(ndl, 0.05);

    // Water: darker and bluer than land; it takes the specular glint.
    float water = smoothstep(0.02, -0.04, day.r - day.b * 0.85) * smoothstep(0.25, 0.05, day.g);
    vec3 halfway = normalize(l + v);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(v, halfway), 0.0), 5.0);
    float glint = pow(max(dot(n, halfway), 0.0), 600.0) * water * (1.0 - clouds) * (0.6 + fresnel) * 0.8;

    vec3 ground = day * (1.0 - shade * 0.45) * lit * 1.8;
    vec3 sky = vec3(1.0) * lit * 1.35;
    // Thin cloud lets the ground through; only thick cloud is opaque white.
    vec3 surface = mix(ground, sky, clouds * 0.9) + vec3(1.0, 0.92, 0.8) * glint * lit;
    vec3 city = vec3(1.0, 0.62, 0.26) * pow(lights, 1.3) * 2.2 * (1.0 - clouds * 0.8);
    vec3 color = mix(city, surface, dayside) + day * uAmbient;

    // The atmosphere at the limb: blue in daylight, warm at the terminator.
    float rim = pow(1.0 - ndv, 3.0);
    float twilight = smoothstep(-0.25, 0.1, ndl) * smoothstep(0.45, 0.0, ndl);
    vec3 air = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.45, 0.2), twilight);
    color += air * rim * smoothstep(-0.25, 0.3, ndl) * 1.2;
    gl_FragColor = vec4(color, 1.0);
    ${OUTPUT}
  }
`;

/**
 * Saturn's rings, from the radii Cassini measured (in Saturn radii): the
 * faint C ring, the bright B ring, the Cassini Division, the A ring with
 * the Encke Gap near its edge, and fine ringlets everywhere.
 */
export const RING_DENSITY = /* glsl */ `
  float ringHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  float ringlets(float r) {
    float k = r * 180.0;
    float i = floor(k);
    float f = fract(k);
    return mix(ringHash(i), ringHash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  float ringBand(float r) {
    if (r < 1.239 || r > 2.27) return 0.0;
    float d;
    if (r < 1.527) d = 0.12 + 0.1 * smoothstep(1.239, 1.527, r);
    else if (r < 1.95) d = 0.72 + 0.2 * smoothstep(1.53, 1.75, r);
    else if (r < 2.025) d = 0.06;
    else d = 0.55 - 0.15 * smoothstep(2.1, 2.27, r);
    if (r > 2.212 && r < 2.218) d = 0.02;
    d *= 0.75 + 0.5 * ringlets(r);
    return clamp(d, 0.0, 0.97);
  }
  float ringDensity(float r) { return ringBand(r); }
  // The rings' broad shape alone, with soft edges: what they look like when
  // they're too small on screen for the gaps and ringlets to resolve.
  float ringBroad(float r, float soft) {
    float c = smoothstep(1.239 - soft, 1.239 + soft, r) * 0.16;
    float b = smoothstep(1.527 - soft, 1.527 + soft, r) * 0.66;
    float cassini = smoothstep(1.95 - soft, 1.95 + soft, r) * 0.74;
    float a = smoothstep(2.025 - soft, 2.025 + soft, r) * 0.55;
    float edge = smoothstep(2.27 + soft, 2.27 - soft, r);
    return (c + b - cassini + a) * edge;
  }
  // Detailed where a pixel covers a sliver of ring, broad where it covers a
  // wide band, so a small or edge-on ring doesn't alias into dashes or fur.
  float ringDensityAA(float r, float width) {
    float blend = smoothstep(0.004, 0.03, width);
    return mix(ringBand(r), ringBroad(r, max(width, 0.01)), blend);
  }
`;

/**
 * The gas giants, Venus and the ice giants, all from noise: zones and belts
 * sheared by latitude-dependent winds (each band drifts at its own speed,
 * which is what makes them swirl at their edges), with an optional storm
 * (Jupiter's Great Red Spot, Neptune's dark spot). Venus is the same
 * machine with no belts to speak of and a lot of warp.
 *
 * Saturn's rings cast their shadow on the planet: the shader follows each
 * point's ray to the Sun and darkens it where the ray crosses the rings.
 */
export const GIANT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uZone;
  uniform vec3 uBelt;
  uniform vec3 uAccent;
  uniform vec3 uPolar;
  uniform float uBands;
  uniform float uContrast;
  uniform float uWarp;
  uniform float uWind;
  uniform vec4 uStorm;
  uniform vec3 uStormColor;
  uniform vec3 uHaze;
  uniform float uRings;
  uniform vec3 uCenter;
  uniform vec3 uPole;
  uniform float uRadius;
  ${LIGHTING}
  ${NOISE}

  ${RING_DENSITY}

  vec3 rotateY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 l = sunDirection();
    vec3 v = viewDirection();
    float ndl = dot(n, l);
    float ndv = max(dot(n, v), 0.0);

    vec3 p = vLocal;
    float lat = p.y;
    // Each latitude drifts at its own speed: alternating jets.
    float jet = sin(lat * uBands * 0.5) * uWind;
    vec3 q = rotateY(p, uTime * jet);
    vec3 warp = vec3(
      fbm(q * vec3(2.5, 9.0, 2.5) + uTime * 0.01),
      fbm(q * vec3(2.5, 9.0, 2.5) + 5.2),
      0.0
    );
    float swirl = fbm(q * vec3(3.0, 12.0, 3.0) + warp * uWarp);
    float band = sin(lat * uBands + swirl * 1.8 * uWarp);
    float fine = sin(lat * uBands * 3.7 + swirl * 4.0) * 0.5;
    float tone = clamp(0.5 + (band * 0.42 + fine * 0.12) * uContrast, 0.0, 1.0);
    vec3 color = mix(uBelt, uZone, tone);
    color = mix(color, uAccent, smoothstep(0.2, 0.75, swirl) * 0.35 * uContrast);

    // A storm: an oval vortex, its own color, with a pale collar.
    if (uStorm.z > 0.0) {
      float lon = atan(q.z, q.x);
      vec2 d = vec2((lon - uStorm.y) * 0.55, asin(clamp(lat, -1.0, 1.0)) - uStorm.x);
      d.x = mod(d.x + 1.7278, 3.4557) - 1.7278;
      float e = length(d / vec2(uStorm.z * 1.7, uStorm.z));
      float spin = atan(d.y, d.x) + e * 6.0 - uTime * 0.3;
      float curl = snoise(vec3(cos(spin) * e * 3.0, sin(spin) * e * 3.0, uTime * 0.05));
      float core = smoothstep(1.0, 0.55, e + curl * 0.08);
      float collar = smoothstep(1.35, 1.0, e) * (1.0 - core);
      color = mix(color, uStormColor * (0.85 + curl * 0.2), core * uStorm.w);
      color = mix(color, uZone * 1.05, collar * 0.45 * uStorm.w);
    }

    // The poles: darker and hazier on Jupiter, bluish on Saturn.
    color = mix(color, uPolar, smoothstep(0.72, 0.97, abs(lat)));

    float lit = pow(wrapLight(ndl, 0.03), 0.85);

    // Saturn: the rings' shadow, where the ray toward the Sun crosses them.
    if (uRings > 0.0) {
      float denom = dot(l, uPole);
      if (abs(denom) > 1e-4) {
        float t = dot(uCenter - vPosW, uPole) / denom;
        if (t > 0.0) {
          float r = length(vPosW + l * t - uCenter) / uRadius;
          lit *= 1.0 - ringDensity(r) * 0.85;
        }
      }
    }

    vec3 lin = pow(color, vec3(2.2));
    vec3 outColor = lin * (lit * 1.9 + uAmbient);
    // High haze brightens the limb on the day side.
    outColor += uHaze * pow(1.0 - ndv, 3.0) * smoothstep(-0.2, 0.5, ndl);
    gl_FragColor = vec4(outColor, 1.0);
    ${OUTPUT}
  }
`;

export const RING_VERTEX = /* glsl */ `
  varying vec3 vPosW;
  varying vec2 vPlane;
  void main() {
    vPlane = position.xz;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * The rings: lit from above or below by the Sun at today's angle (it moves
 * through the ring plane every 15 years), glowing through where they're thin
 * when lit from behind, and crossed by the planet's own shadow.
 */
export const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uPole;
  uniform float uRadius;
  uniform float uPlanetRadius;
  uniform float uAmbient;
  varying vec3 vPosW;
  varying vec2 vPlane;
  ${RING_DENSITY}
  void main() {
    float r = length(vPlane) / uPlanetRadius;
    float density = ringDensityAA(r, fwidth(r));
    if (density < 0.01) discard;
    vec3 l = normalize(-vPosW);
    vec3 v = normalize(cameraPosition - vPosW);
    float sunSide = dot(l, uPole);
    float viewSide = dot(v, uPole);
    // Facing the lit face, the rings reflect; from the dark face, light
    // comes through the thin parts.
    float front = step(0.0, sunSide * viewSide);
    float reflected = pow(abs(sunSide), 0.35) * density;
    float through = (1.0 - density) * density * 2.2;
    float light = mix(through, reflected, front);

    // The planet's shadow: does the ray to the Sun hit Saturn?
    vec3 toCenter = uCenter - vPosW;
    float along = dot(toCenter, l);
    float miss = length(toCenter - l * along);
    float shadow = along > 0.0 ? smoothstep(uRadius * 0.97, uRadius * 1.02, miss) : 1.0;

    vec3 tint = mix(vec3(0.62, 0.55, 0.47), vec3(0.95, 0.86, 0.7), smoothstep(1.5, 1.8, r));
    tint = mix(tint, vec3(0.78, 0.72, 0.64), smoothstep(2.0, 2.1, r));
    vec3 color = pow(tint, vec3(2.2)) * (light * shadow * 1.9 + uAmbient);
    gl_FragColor = vec4(color, density);
    ${OUTPUT}
  }
`;

/**
 * An atmosphere's glow beyond the planet's edge: a slightly larger sphere,
 * drawn from inside (its back faces), brightest where it meets the planet
 * and fading to nothing at its own edge, only on the day side.
 */
export const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uEdge;
  varying vec3 vPosW;
  varying vec3 vNormalW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float depth = clamp(-dot(n, v) / uEdge, 0.0, 1.0);
    // Brightest where it meets the planet, so there's no seam between them.
    float glow = pow(depth, 1.6);
    float day = smoothstep(-0.35, 0.45, dot(n, normalize(-vPosW)));
    gl_FragColor = vec4(uColor * glow * day, 1.0);
    ${OUTPUT}
  }
`;

/**
 * The sky behind the orrery: the Milky Way's band where the galaxy really
 * lies against the ecliptic, its dust lanes from noise, very faint so the
 * planets own the frame.
 */
export const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uGalacticPole;
  uniform vec3 uGalacticCenter;
  varying vec3 vLocal;
  ${NOISE}
  void main() {
    vec3 d = normalize(vLocal);
    float height = dot(d, uGalacticPole);
    float core = pow(max(dot(d, uGalacticCenter), 0.0), 3.0);
    float band = exp(-height * height * 28.0) * (0.45 + core * 1.2);
    float dust = smoothstep(-0.1, 0.5, fbm(d * 7.0)) * exp(-height * height * 260.0);
    float clouds = fbm(d * 3.0) * 0.5 + 0.5;
    float glow = band * clouds * (1.0 - dust * 0.75);
    vec3 color = vec3(0.012, 0.014, 0.022) + vec3(0.11, 0.1, 0.09) * glow;
    gl_FragColor = vec4(color, 1.0);
    ${OUTPUT}
  }
`;

export const SKY_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    // The sky follows the camera, so it's always infinitely far.
    vec4 view = modelViewMatrix * vec4(position, 0.0);
    gl_Position = projectionMatrix * vec4(view.xyz, 1.0);
    gl_Position.z = gl_Position.w * 0.9999;
  }
`;

/** Stars: points with a size from their brightness, twinkling a little. */
export const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uSun;
  uniform float uGlare;
  varying vec3 vColor;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 0.0);
    // Stars don't shine through the Sun's glare: each fades as it nears
    // the Sun's direction, within the corona's angular size (uGlare).
    vec3 toSun = normalize(uSun - cameraPosition);
    float apart = acos(clamp(dot(normalize(position), toSun), -1.0, 1.0));
    float glare = smoothstep(uGlare, uGlare * 1.6, apart);
    gl_Position = projectionMatrix * vec4(view.xyz, 1.0);
    gl_Position.z = gl_Position.w * 0.9998;
    float twinkle = 0.8 + 0.2 * sin(uTime * (1.3 + aPhase) + aPhase * 40.0);
    vColor = aColor * twinkle * glare;
    gl_PointSize = aSize * uPixelRatio;
  }
`;

export const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = dot(c, c);
    if (r > 1.0) discard;
    float a = exp(-r * 4.0);
    gl_FragColor = vec4(vColor * a, 1.0);
    ${OUTPUT}
  }
`;
