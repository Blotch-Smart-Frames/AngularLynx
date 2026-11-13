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
  /**
   * 1 to draw what falls outside the shapes, their shadow and the dark line
   * down their sides: containers only, whose canvas reaches past them.
   */
  outside: number;
  /** How bright what's behind the glass is, from 0 to 1. */
  luminance: number;
  shapes: readonly GlassShapeFrame[];
};

// Regular glass blurs the backdrop by about 12 CSS pixels, as UIKit's does
// (measured across a hard edge). The blur runs on a copy with one pixel for
// every four CSS pixels, whatever the image's own resolution: three passes of
// about 1.7 pixels each there add up to 2.9, which is 12 CSS pixels.
const FROST_PIXEL = 4;
const FROST_PASSES = 3;
// A fifth of what regular glass shows is a much wider blur, the light that
// spills in from further away: UIKit's blur has a tail no single Gaussian
// has. It's the frosted copy at half the size again, blurred four more times,
// about 30 CSS pixels in all.
const HAZE_PIXEL = 8;
const HAZE_PASSES = 4;
// A panel's light glass also takes on the color of what's behind the whole
// of it: across a hard edge between two colors, UIKit's hue changes over the
// panel's width while its brightness changes over the blur's. So the haze is
// shrunk to a third and blurred again, to about 85 CSS pixels, for the color
// alone.
const WASH_PIXEL = 24;
const WASH_PASSES = 4;

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
  /**
   * The copies of the backdrop: the steps that halve it down to the frosted
   * size, the two the frost blurs between, and the two the haze does.
   */
  #copies: {
    steps: Target[];
    frosted: [Target, Target];
    haze: [Target, Target];
    wash: [Target, Target];
  } | null = null;
  #copiesSize = '';
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
      // Glass that floats over other glass shows it, as UIKit's does: the
      // backdrop's copy reads this canvas as a picture (see mediaSource in
      // backdrop-clone.ts), and without this a WebGL canvas is blank once
      // the browser has put its frame on screen.
      preserveDrawingBuffer: true,
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
    const backdrop = (this.#backdrop ??= createTexture(gl));
    gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const size = (pixel: number): [number, number] => [
      Math.max(1, Math.round(width / pixel)),
      Math.max(1, Math.round(height / pixel)),
    ];
    const [w, h] = size(FROST_PIXEL);
    const [hazeW, hazeH] = size(HAZE_PIXEL);
    const [washW, washH] = size(WASH_PIXEL);
    // The image is halved until it's within twice the frosted size. One copy
    // straight down to it would read four pixels of every sixty-four, and
    // fine stripes in the backdrop would shimmer through the blur.
    const steps: [number, number][] = [];
    let stepW = image.width;
    let stepH = image.height;
    while (stepW > 2 * w || stepH > 2 * h) {
      stepW = Math.ceil(stepW / 2);
      stepH = Math.ceil(stepH / 2);
      steps.push([stepW, stepH]);
    }
    const key = `${image.width}x${image.height}:${w}x${h}`;
    if (this.#copiesSize !== key) {
      this.#deleteCopies();
      this.#copies = {
        steps: steps.map(([sw, sh]) => createTarget(gl, sw, sh)),
        frosted: [createTarget(gl, w, h), createTarget(gl, w, h)],
        haze: [createTarget(gl, hazeW, hazeH), createTarget(gl, hazeW, hazeH)],
        wash: [createTarget(gl, washW, washH), createTarget(gl, washW, washH)],
      };
      this.#copiesSize = key;
    }
    const copies = this.#copies!;
    let source = backdrop;
    steps.forEach(([sw, sh], i) => {
      gl.viewport(0, 0, sw, sh);
      this.#pass(this.#copy, source, copies.steps[i]!);
      source = copies.steps[i]!.texture;
    });
    const [a, b] = copies.frosted;
    gl.viewport(0, 0, w, h);
    this.#pass(this.#copy, source, a);
    for (let i = 0; i < FROST_PASSES; i++) {
      this.#pass(this.#blur, a.texture, b, [1 / w, 0]);
      this.#pass(this.#blur, b.texture, a, [0, 1 / h]);
    }
    const [c, d] = copies.haze;
    gl.viewport(0, 0, hazeW, hazeH);
    this.#pass(this.#copy, a.texture, c);
    for (let i = 0; i < HAZE_PASSES; i++) {
      this.#pass(this.#blur, c.texture, d, [1 / hazeW, 0]);
      this.#pass(this.#blur, d.texture, c, [0, 1 / hazeH]);
    }
    const [e, f] = copies.wash;
    gl.viewport(0, 0, washW, washH);
    this.#pass(this.#copy, c.texture, e);
    for (let i = 0; i < WASH_PASSES; i++) {
      this.#pass(this.#blur, e.texture, f, [1 / washW, 0]);
      this.#pass(this.#blur, f.texture, e, [0, 1 / washH]);
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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.#copies!.wash[0].texture);
    gl.uniform1i(uniform('u_wash'), 3);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#copies!.haze[0].texture);
    gl.uniform1i(uniform('u_haze'), 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#copies!.frosted[0].texture);
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
    gl.uniform1f(uniform('u_outside'), frame.outside);
    gl.uniform1f(uniform('u_luminance'), frame.luminance);

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
    this.#deleteCopies();
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

  #deleteCopies(): void {
    const copies = this.#copies;
    if (!copies) return;
    for (const target of [
      ...copies.steps,
      ...copies.frosted,
      ...copies.haze,
      ...copies.wash,
    ]) {
      this.#gl.deleteTexture(target.texture);
      this.#gl.deleteFramebuffer(target.framebuffer);
    }
    this.#copies = null;
  }
}
