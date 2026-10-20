import type { Rgba } from './css-color';
import {
  compile,
  createTarget,
  createTexture,
  type Program,
  type Target,
} from './glass-gl';
import {
  BLUR_FRAGMENT_SHADER,
  COPY_FRAGMENT_SHADER,
  GLASS_FRAGMENT_SHADER,
  MAX_GLASS_SHAPES,
} from './glass-shaders';

/** One glass shape, in CSS pixels relative to the group's canvas. */
export type GlassShapeFrame = {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  /** 1 for `regular` (frosted) glass, 0 for `clear`. */
  frost: number;
  tint: Rgba;
};

/** Everything one frame of a glass group draws. */
export type GlassFrame = {
  /** Device pixels per CSS pixel. */
  scale: number;
  /** Canvas size, in CSS pixels. */
  width: number;
  height: number;
  /** Where the canvas's top-left corner sits in the backdrop, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** Smooth-union radius, in CSS pixels: twice the container's `spacing`. */
  smoothing: number;
  /** 1 for the dark material, 0 for light. */
  dark: number;
  /** 1 to draw a soft shadow around the shapes (containers only). */
  shadow: number;
  shapes: readonly GlassShapeFrame[];
  /** Press glow: x and y in CSS pixels, then strength from 0 to 1. */
  pointer: readonly [number, number, number];
};

// Frosted glass blurs a copy of the backdrop at a quarter of its resolution:
// three blur passes there cost little and soften it as much as iOS's material.
const FROST_DOWNSAMPLE = 4;
const FROST_PASSES = 3;

/**
 * Draws Liquid Glass with WebGL 1 for Lynx for Web, where `<blur-view>` only
 * knows `backdrop-filter: blur()`. The backdrop is an image of what sits
 * behind the glass; the group code takes it (see backdrop-snapshot.ts) and the
 * renderer refracts it through the glass shapes.
 */
export class GlassRenderer {
  readonly #gl: WebGLRenderingContext;
  readonly #copy: Program;
  readonly #blur: Program;
  readonly #glass: Program;
  readonly #quad: WebGLBuffer;
  #backdrop: WebGLTexture | null = null;
  #frosted: [Target, Target] | null = null;
  #frostedSize = '';
  #backdropWidth = 1;
  #backdropHeight = 1;

  /**
   * Use `GlassRenderer.create`, which builds the programs this needs.
   */
  constructor(
    gl: WebGLRenderingContext,
    copy: Program,
    blur: Program,
    glass: Program,
  ) {
    this.#gl = gl;
    this.#copy = copy;
    this.#blur = blur;
    this.#glass = glass;
    this.#quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * Null when the browser has no WebGL or can't build the shaders.
   */
  static create(canvas: HTMLCanvasElement): GlassRenderer | null {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return null;
    const copy = compile(gl, COPY_FRAGMENT_SHADER);
    const blur = compile(gl, BLUR_FRAGMENT_SHADER);
    const glass = compile(gl, GLASS_FRAGMENT_SHADER);
    if (!copy || !blur || !glass) return null;
    return new GlassRenderer(gl, copy, blur, glass);
  }

  /**
   * True once the GPU dropped the context; the group then starts over.
   */
  get lost(): boolean {
    return this.#gl.isContextLost();
  }

  /**
   * Uploads a new backdrop image and blurs a copy of it for frosted glass.
   * `width` and `height` are its size in CSS pixels.
   */
  setBackdrop(image: HTMLCanvasElement, width: number, height: number): void {
    const gl = this.#gl;
    this.#backdropWidth = width;
    this.#backdropHeight = height;
    this.#backdrop ??= createTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.#backdrop);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const w = Math.max(1, Math.round(image.width / FROST_DOWNSAMPLE));
    const h = Math.max(1, Math.round(image.height / FROST_DOWNSAMPLE));
    if (this.#frostedSize !== `${w}x${h}`) {
      this.#deleteFrosted();
      this.#frosted = [createTarget(gl, w, h), createTarget(gl, w, h)];
      this.#frostedSize = `${w}x${h}`;
    }
    const [a, b] = this.#frosted!;
    gl.viewport(0, 0, w, h);
    this.#pass(this.#copy, this.#backdrop, a);
    for (let i = 0; i < FROST_PASSES; i++) {
      this.#pass(this.#blur, a.texture, b, [1 / w, 0]);
      this.#pass(this.#blur, b.texture, a, [0, 1 / h]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(frame: GlassFrame): void {
    const gl = this.#gl;
    const { uniform } = this.#glass;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.#backdrop) return;

    gl.useProgram(this.#glass.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#frosted![0].texture);
    gl.uniform1i(uniform('u_frosted'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#backdrop);
    gl.uniform1i(uniform('u_backdrop'), 0);

    gl.uniform2f(uniform('u_size'), frame.width, frame.height);
    gl.uniform2f(uniform('u_offset'), frame.offsetX, frame.offsetY);
    gl.uniform2f(
      uniform('u_backdropSize'),
      this.#backdropWidth,
      this.#backdropHeight,
    );
    gl.uniform1f(uniform('u_scale'), frame.scale);
    gl.uniform1f(uniform('u_smoothing'), frame.smoothing);
    gl.uniform1f(uniform('u_dark'), frame.dark);
    gl.uniform1f(uniform('u_shadow'), frame.shadow);
    gl.uniform3f(uniform('u_pointer'), ...frame.pointer);

    const shapes = frame.shapes.slice(0, MAX_GLASS_SHAPES);
    const bounds = new Float32Array(MAX_GLASS_SHAPES * 4);
    const material = new Float32Array(MAX_GLASS_SHAPES * 4);
    const tint = new Float32Array(MAX_GLASS_SHAPES * 4);
    shapes.forEach((shape, i) => {
      bounds.set(
        [shape.centerX, shape.centerY, shape.halfWidth, shape.halfHeight],
        i * 4,
      );
      material.set([shape.radius, shape.frost, 0, 0], i * 4);
      tint.set(shape.tint, i * 4);
    });
    gl.uniform1i(uniform('u_count'), shapes.length);
    gl.uniform4fv(uniform('u_bounds'), bounds);
    gl.uniform4fv(uniform('u_material'), material);
    gl.uniform4fv(uniform('u_tint'), tint);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.#gl;
    this.#deleteFrosted();
    gl.deleteTexture(this.#backdrop);
    gl.deleteBuffer(this.#quad);
    for (const { program } of [this.#copy, this.#blur, this.#glass]) {
      gl.deleteProgram(program);
    }
    // Browsers cap live WebGL contexts (16 in Chrome); give this one back now
    // instead of waiting for garbage collection.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  #pass(
    program: Program,
    source: WebGLTexture,
    target: Target,
    direction?: readonly [number, number],
  ): void {
    const gl = this.#gl;
    gl.useProgram(program.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(program.uniform('u_source'), 0);
    if (direction) gl.uniform2f(program.uniform('u_direction'), ...direction);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #deleteFrosted(): void {
    for (const target of this.#frosted ?? []) {
      this.#gl.deleteTexture(target.texture);
      this.#gl.deleteFramebuffer(target.framebuffer);
    }
    this.#frosted = null;
  }
}
