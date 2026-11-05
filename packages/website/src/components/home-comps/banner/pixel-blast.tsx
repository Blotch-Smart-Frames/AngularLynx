import { useEffect, useRef } from 'react';
import styles from './index.module.scss';
import {
  PIXEL_FRAGMENT,
  PIXEL_RIPPLES,
  PIXEL_VERTEX,
} from './pixel-blast-shader';

/** CSS pixels on a side of one square of the pattern. */
const PIXEL_SIZE = 4;
/** How fast the pattern drifts, and the ripples spread. */
const SPEED = 0.5;
/** How large the noise's blobs are: higher makes more, smaller ones. */
const SCALE = 2;
/** How many squares are lit, around 1. */
const DENSITY = 1;
/** How far in from each edge the pattern fades in, as a share of the field. */
const EDGE_FADE = 0.25;
/** How far past the copy's box the thinning eases off, in CSS pixels. */
const QUIET_FEATHER = 64;
/** How much the pattern thins behind the copy: 0 not at all, 1 to nothing. */
const QUIET_STRENGTH = 0.5;

const UNIFORMS = [
  'uResolution',
  'uTime',
  'uScale',
  'uDensity',
  'uEdgeFade',
  'uRipplePos',
  'uRippleTime',
  'uColor',
  'uOpacity',
  'uQuiet',
  'uQuietFeather',
  'uQuietStrength',
] as const;

type Rgb = [number, number, number];

/**
 * Reads a color custom property, as it resolves on an element, as 0–1 sRGB channels.
 */
const cssColor = (element: Element, property: string): Rgb => {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  // A 2D canvas parses any CSS color for us, where a regex would only cover the forms we wrote.
  const probe = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (!probe) return [0, 0, 0];
  probe.fillStyle = value || '#000';
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
};

/**
 * A slow drift of dithered pixels drawn by WebGL2, filling its slot. Its color and opacity come
 * from `--home-banner-pixel-color` and `--home-banner-pixel-opacity`, so they follow the site's
 * light and dark themes.
 *
 * The canvas draws one fragment per square of the pattern and is scaled up without smoothing, so
 * each square stays crisp and the shader runs a fraction as often as it would at screen
 * resolution. It draws only while the slot is on screen.
 *
 * The slot's parent is the banner: a press on it sends a ripple out, and the pattern thins behind
 * its other children, the copy.
 */
class PixelField {
  readonly #slot: HTMLElement;
  readonly #banner: HTMLElement;
  readonly #canvas = document.createElement('canvas');
  readonly #gl: WebGL2RenderingContext;
  readonly #uniforms = {} as Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  readonly #ripples = new Float32Array(PIXEL_RIPPLES * 2).fill(-1);
  readonly #rippleTimes = new Float32Array(PIXEL_RIPPLES);
  readonly #lifecycle = new AbortController();
  readonly #resizer: ResizeObserver;
  readonly #watcher: IntersectionObserver;
  readonly #themeWatcher: MutationObserver;
  readonly #reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  #nextRipple = 0;
  // Start somewhere along the drift, so each visit shows a different pattern.
  #time = Math.random() * 1000;
  #columns = 1;
  #rows = 1;
  #quiet: [number, number, number, number] = [-1e4, -1e4, -1e4, -1e4];
  #color: Rgb = [0, 0, 0];
  #opacity = 0;
  #visible = true;
  #raf = 0;
  #last = 0;

  constructor(slot: HTMLElement) {
    this.#slot = slot;
    this.#banner = slot.parentElement ?? slot;
    this.#canvas.className = styles['banner-pixels-canvas'];
    const gl = this.#canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.#gl = gl;
    const program = this.#compile();
    for (const name of UNIFORMS) {
      this.#uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.#readColors();
    slot.append(this.#canvas);

    const { signal } = this.#lifecycle;
    // The theme toggle swaps the `dark` class on <html>, and the colors with it.
    this.#themeWatcher = new MutationObserver(() => {
      this.#readColors();
      this.#request();
    });
    this.#themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    this.#reducedMotion.addEventListener('change', () => this.#request(), {
      signal,
    });
    this.#banner.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Element;
        if (this.#reducedMotion.matches || target.closest('a, button')) return;
        this.#ripple(event.clientX, event.clientY);
      },
      { passive: true, signal },
    );

    // The copy can reflow without the slot changing size, as when the web font loads.
    this.#resizer = new ResizeObserver(() => this.#resize());
    this.#resizer.observe(slot);
    for (const child of this.#copy()) this.#resizer.observe(child);
    this.#watcher = new IntersectionObserver((entries) => {
      this.#visible = entries.some((entry) => entry.isIntersecting);
      this.#request();
    });
    this.#watcher.observe(slot);
    this.#resize();
  }

  destroy() {
    cancelAnimationFrame(this.#raf);
    this.#lifecycle.abort();
    this.#themeWatcher.disconnect();
    this.#resizer.disconnect();
    this.#watcher.disconnect();
    // Free the context now, rather than when it's collected: browsers cap how many can be live,
    // and each client-side visit to the home page makes another.
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.#canvas.remove();
  }

  #compile() {
    const gl = this.#gl;
    const shader = (type: number, source: string) => {
      const unit = gl.createShader(type);
      if (!unit) throw new Error('shader');
      gl.shaderSource(unit, source);
      gl.compileShader(unit);
      if (!gl.getShaderParameter(unit, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(unit) || 'shader');
      }
      return unit;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('program');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, PIXEL_VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, PIXEL_FRAGMENT));
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program');
    }
    gl.useProgram(program);
    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return program;
  }

  /**
   * The banner's children other than the slot: the copy the pattern thins behind.
   */
  #copy() {
    return Array.from(this.#banner.children).filter(
      (child) => child !== this.#slot,
    );
  }

  #readColors() {
    this.#color = cssColor(this.#banner, '--home-banner-pixel-color');
    const opacity = Number.parseFloat(
      getComputedStyle(this.#banner).getPropertyValue(
        '--home-banner-pixel-opacity',
      ),
    );
    this.#opacity = Number.isFinite(opacity) ? opacity : 0.1;
  }

  #resize() {
    const slot = this.#slot.getBoundingClientRect();
    if (slot.width < 1 || slot.height < 1) return;
    this.#columns = Math.ceil(slot.width / PIXEL_SIZE);
    this.#rows = Math.ceil(slot.height / PIXEL_SIZE);
    this.#canvas.width = this.#columns;
    this.#canvas.height = this.#rows;
    this.#canvas.style.width = `${this.#columns * PIXEL_SIZE}px`;
    this.#canvas.style.height = `${this.#rows * PIXEL_SIZE}px`;
    this.#gl.viewport(0, 0, this.#columns, this.#rows);

    // The copy's box, in squares from the canvas's bottom left, as gl_FragCoord counts them.
    const boxes = this.#copy().map((child) => child.getBoundingClientRect());
    if (boxes.length > 0) {
      const top = Math.min(...boxes.map((box) => box.top));
      const right = Math.max(...boxes.map((box) => box.right));
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      const left = Math.min(...boxes.map((box) => box.left));
      this.#quiet = [
        (left - slot.left) / PIXEL_SIZE,
        this.#rows - (bottom - slot.top) / PIXEL_SIZE,
        (right - slot.left) / PIXEL_SIZE,
        this.#rows - (top - slot.top) / PIXEL_SIZE,
      ];
    }
    this.#request();
  }

  /**
   * Sends a ripple out from a point on the page.
   */
  #ripple(clientX: number, clientY: number) {
    const slot = this.#slot.getBoundingClientRect();
    const i = this.#nextRipple;
    this.#ripples[i * 2] = (clientX - slot.left) / PIXEL_SIZE;
    this.#ripples[i * 2 + 1] = this.#rows - (clientY - slot.top) / PIXEL_SIZE;
    this.#rippleTimes[i] = this.#time;
    this.#nextRipple = (i + 1) % PIXEL_RIPPLES;
    this.#request();
  }

  #request() {
    if (this.#raf || !this.#visible) return;
    this.#raf = requestAnimationFrame((now) => this.#frame(now));
  }

  #frame(now: number) {
    this.#raf = 0;
    // With reduced motion the pattern holds still: it's drawn once for each change and left.
    const running = !this.#reducedMotion.matches;
    // Cap the step, so the pattern doesn't leap after the tab or the banner was out of sight.
    const delta = this.#last ? Math.min((now - this.#last) / 1000, 0.05) : 0;
    this.#last = running ? now : 0;
    if (running) this.#time += delta * SPEED;
    this.#draw();
    if (running) this.#request();
  }

  #draw() {
    const gl = this.#gl;
    const u = this.#uniforms;
    gl.uniform2f(u.uResolution, this.#columns, this.#rows);
    gl.uniform1f(u.uTime, this.#time);
    gl.uniform1f(u.uScale, SCALE);
    gl.uniform1f(u.uDensity, DENSITY);
    gl.uniform1f(u.uEdgeFade, EDGE_FADE);
    gl.uniform2fv(u.uRipplePos, this.#ripples);
    gl.uniform1fv(u.uRippleTime, this.#rippleTimes);
    gl.uniform3fv(u.uColor, this.#color);
    gl.uniform1f(u.uOpacity, this.#opacity);
    gl.uniform4f(u.uQuiet, ...this.#quiet);
    gl.uniform1f(u.uQuietFeather, QUIET_FEATHER / PIXEL_SIZE);
    gl.uniform1f(u.uQuietStrength, QUIET_STRENGTH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * The banner's backdrop: Pixel Blast's drift of dithered pixels, kept faint.
 */
export const PixelBlast = () => {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    let field: PixelField;
    try {
      field = new PixelField(slot);
    } catch {
      // No WebGL2, or the shader didn't compile: the banner reads fine on its own.
      return;
    }
    return () => field.destroy();
  }, []);

  return (
    <div ref={slotRef} className={styles['banner-pixels']} aria-hidden="true" />
  );
};
