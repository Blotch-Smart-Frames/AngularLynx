// cspell:words halation
import { curveTable } from './curves';
import type { Look } from './looks';
import type { Adjustments } from './settings';
import {
  BLUR_FRAGMENT,
  BRIGHT_FRAGMENT,
  DEVELOP_FRAGMENT,
  QUAD_VERTEX,
} from './shaders';

/** The longest side of the glow's buffers: a glow needs no fine detail. */
const GLOW_SIZE = 384;

/** Where the photo is drawn, as fractions of the canvas, after fitting. */
export type PhotoFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Where to draw within the canvas, in drawing-buffer pixels from its
 * top-left corner, and how the photo fills it.
 */
export type DrawRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `contain` shows the whole photo; `cover` fills the region, cropping. */
  readonly fit?: 'contain' | 'cover';
  /** Clears the whole canvas first: leave it off for every region but one. */
  readonly clear?: boolean;
};

/** What a frame is developed with. */
export type DevelopFrame = {
  readonly look: Look;
  readonly adjustments: Adjustments;
  /** The before/after line as a fraction of the photo's width; -1 for none. */
  readonly split: number;
  /** Changes the grain's pattern; keep it fixed so the grain holds still. */
  readonly seed: number;
};

type Program = {
  readonly program: WebGLProgram;
  readonly uniforms: Map<string, WebGLUniformLocation | null>;
};

type Target = {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
};

/**
 * Develops a photo with WebGL2: plain WebGL, no library, since the work is
 * three short shaders (see shaders.ts). One renderer per canvas; the same
 * class draws the big photo and the test chart beneath it, so the chart
 * shows exactly what the photo gets.
 */
export class DevelopRenderer {
  readonly #gl: WebGL2RenderingContext;
  readonly #bright: Program;
  readonly #blur: Program;
  readonly #develop: Program;
  readonly #quad: WebGLBuffer;
  readonly #vao: WebGLVertexArrayObject;
  readonly #photo: WebGLTexture;
  readonly #curves: WebGLTexture;
  #glowA: Target | null = null;
  #glowB: Target | null = null;
  #glowWidth = 0;
  #glowHeight = 0;
  #photoWidth = 0;
  #photoHeight = 0;
  #lookId = '';

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#bright = this.#program(BRIGHT_FRAGMENT);
    this.#blur = this.#program(BLUR_FRAGMENT);
    this.#develop = this.#program(DEVELOP_FRAGMENT);

    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    this.#quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    // Every program binds a_position to 0 (see #program), so one layout
    // serves all three.
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.#photo = this.#texture(gl.LINEAR);
    this.#curves = this.#texture(gl.LINEAR);
  }

  /**
   * The photo's size, once one is set.
   */
  get size(): { width: number; height: number } {
    return { width: this.#photoWidth, height: this.#photoHeight };
  }

  /**
   * Sets the photo: an image (a bundled photo, or one the person picked),
   * or raw RGBA pixels (the test chart, drawn sharp with `nearest`).
   */
  setPhoto(
    source:
      | TexImageSource
      | { width: number; height: number; pixels: Uint8Array },
    width: number,
    height: number,
    nearest = false,
  ): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#photo);
    const filter = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if ('pixels' in source) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.pixels,
      );
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
    }
    this.#photoWidth = width;
    this.#photoHeight = height;
    this.#sizeGlow();
  }

  /**
   * Where the photo lands in a canvas of this size: fitted whole, centered.
   * The comparison handle and the crop marks are laid out from it.
   */
  frameIn(
    canvasWidth: number,
    canvasHeight: number,
    fit: 'contain' | 'cover' = 'contain',
  ): PhotoFrame {
    if (!this.#photoWidth || !canvasWidth || !canvasHeight) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    const photoAspect = this.#photoWidth / this.#photoHeight;
    const canvasAspect = canvasWidth / canvasHeight;
    // Wider than the canvas: fit its width (contain) or its height (cover).
    const wide = photoAspect > canvasAspect === (fit === 'contain');
    const width = wide ? 1 : photoAspect / canvasAspect;
    const height = wide ? canvasAspect / photoAspect : 1;
    return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
  }

  /**
   * Draws a frame into the canvas's drawing buffer, `width` by `height`
   * pixels: the glow first, into its own small buffers, then the photo.
   */
  render(
    frame: DevelopFrame,
    canvasWidth: number,
    canvasHeight: number,
    region: DrawRegion = {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      clear: true,
    },
  ): void {
    const gl = this.#gl;
    const { width, height } = region;
    if (!this.#photoWidth || !width || !height) return;
    const { look, adjustments: a } = frame;
    const c = look.character;
    this.#setLook(look);

    const exposure = a.exposure;
    const halation = clamp01((c.halation ?? 0) + a.halation);

    gl.bindVertexArray(this.#vao);
    gl.disable(gl.BLEND);

    // 1. The highlights, then 2. their glow, across and down, twice: four
    // cheap passes on a buffer a few hundred pixels wide. Skipped when
    // nothing glows.
    if (halation > 0 && this.#glowA && this.#glowB) {
      this.#use(this.#bright, [1, 1]);
      this.#bindTexture(0, this.#photo);
      gl.uniform1i(this.#u(this.#bright, 'u_photo'), 0);
      gl.uniform1f(this.#u(this.#bright, 'u_exposure'), exposure);
      gl.uniform1f(this.#u(this.#bright, 'u_threshold'), 0.62);
      this.#drawInto(this.#glowA, this.#glowWidth, this.#glowHeight);

      this.#use(this.#blur, [1, 1]);
      gl.uniform1i(this.#u(this.#blur, 'u_source'), 0);
      for (let pass = 0; pass < 2; pass++) {
        this.#bindTexture(0, this.#glowA.texture);
        gl.uniform2f(
          this.#u(this.#blur, 'u_step'),
          (1 + pass) / this.#glowWidth,
          0,
        );
        this.#drawInto(this.#glowB, this.#glowWidth, this.#glowHeight);
        this.#bindTexture(0, this.#glowB.texture);
        gl.uniform2f(
          this.#u(this.#blur, 'u_step'),
          0,
          (1 + pass) / this.#glowHeight,
        );
        this.#drawInto(this.#glowA, this.#glowWidth, this.#glowHeight);
      }
    }

    // 3. The photo, developed, fitted into the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (region.clear) {
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      // The canvas around the photo stays clear: the page's own surround
      // shows through.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    // GL counts rows from the bottom; regions are given from the top.
    // Clip space is the viewport, so a covering photo is cropped to it.
    gl.viewport(region.x, canvasHeight - region.y - height, width, height);

    const fit = this.frameIn(width, height, region.fit);
    const p = this.#develop;
    this.#use(p, [fit.width, fit.height], true);
    this.#bindTexture(0, this.#photo);
    this.#bindTexture(1, this.#glowA?.texture ?? this.#photo);
    this.#bindTexture(2, this.#curves);
    gl.uniform1i(this.#u(p, 'u_photo'), 0);
    gl.uniform1i(this.#u(p, 'u_glow'), 1);
    gl.uniform1i(this.#u(p, 'u_curves'), 2);
    gl.uniform1f(this.#u(p, 'u_exposure'), exposure);
    gl.uniform1f(
      this.#u(p, 'u_contrast'),
      clampSigned((c.contrast ?? 0) + a.contrast),
    );
    gl.uniform1f(this.#u(p, 'u_highlights'), a.highlights);
    gl.uniform1f(this.#u(p, 'u_shadows'), a.shadows);
    gl.uniform1f(
      this.#u(p, 'u_temperature'),
      clampSigned((c.temperature ?? 0) + a.temperature),
    );
    gl.uniform1f(this.#u(p, 'u_tint'), a.tint);
    gl.uniform1f(
      this.#u(p, 'u_saturation'),
      clampSigned((c.saturation ?? 0) + a.saturation),
    );
    gl.uniform1f(this.#u(p, 'u_fade'), clamp01((c.fade ?? 0) + a.fade));
    gl.uniform1f(this.#u(p, 'u_halation'), halation);
    gl.uniform1f(
      this.#u(p, 'u_vignette'),
      clamp01((c.vignette ?? 0) + a.vignette),
    );
    gl.uniform1f(this.#u(p, 'u_grain'), clamp01((c.grain ?? 0) + a.grain));
    // Grain clumps scale with the photo as it's shown, so a full-size
    // export has the same grain, relative to the picture, as the screen.
    gl.uniform1f(
      this.#u(p, 'u_grainSize'),
      Math.max(1, (fit.width * width) / 700),
    );
    gl.uniform1f(this.#u(p, 'u_monochrome'), c.monochrome ?? 0);
    gl.uniform1f(this.#u(p, 'u_seed'), frame.seed);
    gl.uniform1f(this.#u(p, 'u_split'), frame.split);
    gl.uniform2f(this.#u(p, 'u_size'), fit.width * width, fit.height * height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Frees the GL objects; the canvas's context goes with its element.
   */
  dispose(): void {
    const gl = this.#gl;
    for (const target of [this.#glowA, this.#glowB]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    gl.deleteTexture(this.#photo);
    gl.deleteTexture(this.#curves);
    gl.deleteBuffer(this.#quad);
    gl.deleteVertexArray(this.#vao);
    for (const { program } of [this.#bright, this.#blur, this.#develop]) {
      gl.deleteProgram(program);
    }
  }

  #setLook(look: Look): void {
    if (look.id === this.#lookId) return;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#curves);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      curveTable(look),
    );
    this.#lookId = look.id;
  }

  /**
   * The glow's buffers, at the photo's aspect, at most GLOW_SIZE wide.
   */
  #sizeGlow(): void {
    const gl = this.#gl;
    const scale = GLOW_SIZE / Math.max(this.#photoWidth, this.#photoHeight);
    const width = Math.max(
      1,
      Math.round(this.#photoWidth * Math.min(1, scale)),
    );
    const height = Math.max(
      1,
      Math.round(this.#photoHeight * Math.min(1, scale)),
    );
    if (width === this.#glowWidth && height === this.#glowHeight) return;
    this.#glowWidth = width;
    this.#glowHeight = height;
    for (const key of ['a', 'b'] as const) {
      const old = key === 'a' ? this.#glowA : this.#glowB;
      if (old) {
        gl.deleteFramebuffer(old.framebuffer);
        gl.deleteTexture(old.texture);
      }
      const texture = this.#texture(gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      const target = { texture, framebuffer };
      if (key === 'a') this.#glowA = target;
      else this.#glowB = target;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #drawInto(target: Target, width: number, height: number): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  #use(program: Program, scale: [number, number], flip = false): void {
    this.#gl.useProgram(program.program);
    this.#gl.uniform2f(this.#u(program, 'u_scale'), scale[0], scale[1]);
    this.#gl.uniform1f(this.#u(program, 'u_flip'), flip ? 1 : 0);
  }

  #bindTexture(unit: number, texture: WebGLTexture): void {
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  /**
   * A uniform's location, looked up once per program.
   */
  #u(program: Program, name: string): WebGLUniformLocation | null {
    if (!program.uniforms.has(name)) {
      program.uniforms.set(
        name,
        this.#gl.getUniformLocation(program.program, name),
      );
    }
    return program.uniforms.get(name)!;
  }

  #texture(filter: number): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  #program(fragment: string): Program {
    const gl = this.#gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
      }
      return shader;
    };
    const program = gl.createProgram()!;
    const vertex = compile(gl.VERTEX_SHADER, QUAD_VERTEX);
    const frag = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    }
    // The program keeps the compiled code; the shader objects can go.
    gl.deleteShader(vertex);
    gl.deleteShader(frag);
    return { program, uniforms: new Map() };
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clampSigned = (value: number) => Math.min(1, Math.max(-1, value));
