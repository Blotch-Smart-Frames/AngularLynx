import {
  afterNextRender,
  Component,
  type ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS, type LynxCanvasElement } from '@blotch/angular-lynx';
import { LibraryFrame } from 'e2e-prebuilt-library';
import { environment } from '../environments/environment';

/** A 1x1 cyan PNG (0, 255, 255). */
const CYAN_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+P//PwAF/wL+Xg47rQAAAABJRU5ErkJggg==';

/**
 * What the Bitmap check reads: green, red, blue, the cleared OffscreenCanvas,
 * red through WebGL, then the WebGL OffscreenCanvas's transferred red, the
 * canvas cleared, and its draw buffer kept, then a bitmaprenderer canvas
 * showing red, the width of the bitmap it was handed, the sizes of its
 * bitmaps (its 2 by 1 bitmap's, not its 4 by 4 size), and the canvas after
 * it's handed null.
 */
const BITMAP_READS =
  '0,128,0,255 255,0,0,255 0,0,255,255 0,0,0,0 255,0,0,255 255,0,0,255 0,0,0,0 none 255,0,0,255 0 2x1 2x1 2x1 0,0,0,0';

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D image;
uniform vec4 tint;
out vec4 color;
void main() {
  color = texture(image, uv) * tint;
}`;

/**
 * A video pixel's color by name: a video's colors are near, not exact,
 * after its YUV encoding.
 */
const colorName = ({ 0: r, 1: g, 2: b }: ArrayLike<number>): string =>
  r > 180 && g < 80 && b < 80
    ? 'red'
    : b > 180 && r < 80 && g < 80
      ? 'blue'
      : `${r} ${g} ${b}`;

/**
 * E2E fixture for `<canvas>` with WebGL2 (issue #211), loaded through
 * `loadComponent` like storage.ts, whose page links here. It draws the
 * canvas full of a texture through a shader, then reads a pixel back and
 * shows it: "WebGL: 0,0,255,255".
 *
 * The texture is a cyan PNG that `createImageBitmap()` decodes (in the
 * shell, on a phone), and the shader multiplies it by a magenta tint, so the
 * pixel is blue only if the shader compiled and linked, the uniforms and the
 * vertex buffer arrived, the image decoded and uploaded, and the pixels read
 * back. A texture that didn't upload reads black (0,0,0,255). The read is
 * made with two GL errors pending, which it must leave for getError(). Hosts
 * without WebGL (Lynx Explorer) show "WebGL: none".
 *
 * Under it, "2D: 0,128,0,255" checks the 2D context (issue #469): a green
 * square drawn on a canvas made with `document.createElement('canvas')`,
 * drawn on a second one with drawImage() through a transform, read back with
 * getImageData(), and uploaded from the second as the WebGL texture, drawn
 * and read back. Both reads have to give the green; when they don't, the line
 * shows each. After them, "filter ok" checks the 2D context's `filter`
 * (issue #698, see #drawFilters).
 *
 * Beside the canvas, under the WebGL line, "Bitmap: ok" checks ImageBitmaps
 * of canvases (issue #697), each drawn on a 2D canvas and read back: one
 * `createImageBitmap()` made of the WebGL canvas as the 2D check left it
 * (green), one of an OffscreenCanvas filled red, one
 * `transferToImageBitmap()` took of it once filled blue, then the
 * OffscreenCanvas itself, which the transfer cleared, and the red bitmap
 * uploaded as the WebGL texture, drawn and read back; then a WebGL2
 * OffscreenCanvas cleared red and transferred while it draws to no color
 * buffer (`drawBuffers([NONE])`): its bitmap, the canvas the transfer
 * cleared, and its draw buffer, still NONE; then an OffscreenCanvas's
 * `bitmaprenderer` context (issue #730) handed a red bitmap with
 * `transferFromImageBitmap()`: the canvas drawn (red), the bitmap's width
 * (0, as the transfer detached it), the sizes of createImageBitmap() of the
 * canvas and of two transferToImageBitmap()s (the 2 by 1 bitmap's, not the
 * 4 by 4 canvas's), and the canvas once handed `null` (transparent). The second canvas in the row shows a red bitmap the same
 * way, which the flow's screenshot shows. When a read is wrong, the line
 * shows them all. It's in the canvas's row, and short, so the page
 * is no taller: the links under it stay on the Android emulator's screen,
 * where the flows tap them.
 *
 * On the 2D line, "Video: 32x64 red,blue / red,blue" checks a `<video>`
 * read as an image (issue #696): fixtures/video.mp4, served by the E2E static
 * server, and shown in the canvas's row, which a row of its own would have
 * pushed the links off the Android emulator's screen. It's stored as a phone
 * stores a portrait recording (issue #725): 64 by 32, red on the left and
 * blue on the right, with a track transform that turns it 90° clockwise, so
 * it shows 32 by 64, red above and blue below. When its first frame shows,
 * paused, its size is read, and it's drawn on a 2D canvas and read back at
 * the top and the bottom right in bindfirstframe, which also checks it's
 * upright and turned, then uploaded as the WebGL texture and drawn, and the
 * pixels read back are the frame's top right and bottom left: a frame read
 * as stored is 64x32, and blue at the top right. The colors are named
 * rather than compared, since a video's are near, not exact, after its YUV
 * encoding.
 *
 * Below it, the prebuilt library fixture (fixtures/prebuilt-library), which
 * the counter page has no room for, and "Open linking" and "Open photo",
 * which open linking.ts and photo.ts.
 */
@Component({
  selector: 'app-canvas',
  imports: [LYNX_ELEMENTS, LibraryFrame, RouterLink],
  template: `
    <view
      style="display: flex; flex-direction: row; align-items: center; margin-top: 16px;"
    >
      <canvas
        #canvas
        width="2"
        height="2"
        style="width: 40px; height: 40px;"
      ></canvas>
      <video
        #video
        [src]="videoUrl"
        [muted]="true"
        style="width: 20px; height: 40px; margin-left: 8px;"
        (bindfirstframe)="drawVideo()"
        (binderror)="resultVideo.set('error')"
      ></video>
      <canvas
        #shown
        width="2"
        height="2"
        style="width: 40px; height: 40px; margin-left: 8px;"
      ></canvas>
      <view style="margin-left: 12px;">
        <text flatten="false">WebGL: {{ result() }}</text>
        <text flatten="false">Bitmap: {{ resultBitmap() }}</text>
      </view>
    </view>
    <text flatten="false"
      >2D: {{ result2D() }}; Video: {{ resultVideo() }}</text
    >
    <e2e-library-frame />
    <view style="display: flex; flex-direction: row; margin-top: 8px;">
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open linking"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0;"
        routerLink="/linking"
      >
        <text>Open linking</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open photo"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0; margin-left: 8px;"
        routerLink="/photo"
      >
        <text>Open photo</text>
      </view>
    </view>
  `,
})
export class CanvasRoute {
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');
  readonly shown = viewChild.required<ElementRef<LynxCanvasElement>>('shown');
  readonly result = signal('…');
  readonly result2D = signal('…');
  readonly resultBitmap = signal('…');
  readonly resultVideo = signal('…');
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly videoUrl = environment.videoUrl;
  #gl: { gl: WebGL2RenderingContext; program: WebGLProgram } | undefined;
  /** The video check's 2D half, made at bindfirstframe. */
  #video2D: string | undefined;

  constructor() {
    afterNextRender(() => {
      this.#draw().then(
        (result) => this.result.set(result),
        (error: Error) => this.result.set(`error ${error.message}`),
      );
    });
  }

  /**
   * The 2D check: getImageData() of a canvas drawn on another, and the same
   * canvas uploaded as a texture into the WebGL context and read back.
   */
  #draw2D(gl: WebGL2RenderingContext, program: WebGLProgram): string {
    const square = document.createElement('canvas');
    square.width = 2;
    square.height = 2;
    const squareContext = square.getContext('2d');
    if (!squareContext) return 'none';
    squareContext.fillStyle = 'rgb(0, 128, 0)';
    squareContext.fillRect(0, 0, 2, 2);
    const target = document.createElement('canvas');
    target.width = 4;
    target.height = 4;
    const context = target.getContext('2d')!;
    // Scaled by 2, the 2 by 2 square covers the 4 by 4 canvas.
    context.scale(2, 2);
    context.imageSmoothingEnabled = false;
    context.drawImage(square, 0, 0);
    const read = Array.from(context.getImageData(1, 1, 1, 1).data).join(',');

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target);
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const uploaded = Array.from(pixel).join(',');
    const reads = read === uploaded ? read : `${read} / ${uploaded}`;
    return `${reads} filter ${this.#drawFilters()}`;
  }

  /**
   * The filter check (issue #698): `filter` applied to what's drawn, read
   * back with getImageData(). A red square through grayscale(1) is the
   * spec's 21% gray; drop-shadow() puts a blue copy of one beside it, and
   * shows through one half see-through (globalAlpha comes first); a
   * filtered square off the canvas casts its canvas shadow onto it; and
   * blur() softens a black square's edge to partly see-through. A string
   * that isn't a filter leaves the last one. Gives "ok", or the reads.
   */
  #drawFilters(): string {
    const make = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas.getContext('2d')!;
    };
    const pixel = (context: CanvasRenderingContext2D, x: number, y: number) =>
      Array.from(context.getImageData(x, y, 1, 1).data);

    const gray = make(2, 2);
    gray.filter = 'grayscale(1)';
    gray.filter = 'nope';
    gray.fillStyle = 'rgb(255, 0, 0)';
    gray.fillRect(0, 0, 2, 2);
    const grayRead = pixel(gray, 0, 0);

    const shadow = make(6, 2);
    shadow.filter = 'drop-shadow(3px 0 blue)';
    shadow.fillStyle = 'rgb(255, 0, 0)';
    shadow.fillRect(0, 0, 2, 2);
    const shadowReads = [pixel(shadow, 0, 0), pixel(shadow, 4, 0)];

    // globalAlpha goes on before the filter (whatwg/html#10674): a half
    // see-through blue square shows its own red drop shadow through it, so
    // its alpha is 0.5 + 0.5 * 0.5.
    const faded = make(2, 2);
    faded.globalAlpha = 0.5;
    faded.filter = 'drop-shadow(0 0 red)';
    faded.fillStyle = 'rgb(0, 0, 255)';
    faded.fillRect(0, 0, 2, 2);
    const fadedAlpha = pixel(faded, 0, 0)[3];

    // A filtered shape just off the canvas still casts its canvas shadow
    // onto it: the filter's layer grows by the shadow's reach.
    const offCanvas = make(8, 2);
    offCanvas.filter = 'grayscale(1)';
    offCanvas.shadowColor = 'rgb(255, 0, 0)';
    offCanvas.shadowOffsetX = 6;
    offCanvas.fillRect(-4, 0, 4, 2);
    const offCanvasRead = pixel(offCanvas, 3, 0);

    const blur = make(12, 12);
    blur.filter = 'blur(2px)';
    blur.fillRect(0, 0, 6, 12);
    const edge = pixel(blur, 6, 6)[3];

    const near = (actual: number[], expected: number[]) =>
      actual.every((value, index) => Math.abs(value - expected[index]) <= 2);
    const ok =
      gray.filter === 'grayscale(1)' &&
      near(grayRead, [54, 54, 54, 255]) &&
      near(shadowReads[0], [255, 0, 0, 255]) &&
      near(shadowReads[1], [0, 0, 255, 255]) &&
      Math.abs(fadedAlpha - 191) <= 3 &&
      near(offCanvasRead, [255, 0, 0, 255]) &&
      edge >= 64 &&
      edge <= 160;
    return ok
      ? 'ok'
      : [
          gray.filter,
          grayRead,
          ...shadowReads,
          fadedAlpha,
          offCanvasRead,
          edge,
        ].join(' ');
  }

  /**
   * The video check, once its first frame shows: drawn on a 2D canvas and
   * read back, and uploaded as a texture into the WebGL context and read
   * back.
   */
  drawVideo(): void {
    // The docs promise the frame can be drawn from bindfirstframe
    // (VideoUI.onFirstFrame, AngularLynxVideo.m), so the 2D draw and its
    // read happen here, at the event, never waited for.
    try {
      this.#video2D = this.#drawVideo2D();
    } catch (error) {
      this.resultVideo.set(`error ${(error as Error).message}`);
      return;
    }
    if (this.#video2D === undefined) {
      this.resultVideo.set('no frame at bindfirstframe');
      return;
    }
    this.#uploadVideo();
  }

  /**
   * The upload needs the page's WebGL context, made after an async decode,
   * which the first frame can come before: it waits for it, for up to 2
   * seconds, and #draw() runs it again once it's there.
   */
  #uploadVideo(tries = 20): void {
    if (!this.#gl && tries > 0) {
      setTimeout(() => this.#uploadVideo(tries - 1), 100);
      return;
    }
    try {
      this.resultVideo.set(`${this.#video2D} / ${this.#uploadVideoNow()}`);
    } catch (error) {
      this.resultVideo.set(`error ${(error as Error).message}`);
    }
  }

  /**
   * The video's size, and its colors at the top and the bottom, or undefined
   * without a frame.
   */
  #drawVideo2D(): string | undefined {
    const video = this.video().nativeElement;
    if (video.videoWidth === 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return 'none';
    context.drawImage(video, 0, 0);
    const middle = Math.floor(canvas.width / 2);
    const top = colorName(context.getImageData(middle, 4, 1, 1).data);
    const bottom = colorName(
      context.getImageData(middle, canvas.height - 4, 1, 1).data,
    );
    return `${canvas.width}x${canvas.height} ${top},${bottom}`;
  }

  /**
   * The video uploaded as the texture, drawn, and read back at the texture's
   * top right and bottom left. The 2 by 2 canvas's bottom row is the
   * texture's first rows, its top.
   */
  #uploadVideoNow(): string {
    const webgl = this.#gl;
    if (!webgl) return 'no WebGL';
    const { gl, program } = webgl;
    const video = this.video().nativeElement;
    // Blue first: the texture may hold the bitmap check's red, which an
    // upload that did nothing would leave to be read back.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 255, 255]),
    );
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const read = (x: number, y: number) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return colorName(pixel);
    };
    return `${read(1, 0)},${read(0, 1)}`;
  }

  /**
   * The ImageBitmap check. The WebGL canvas's bitmap is made first, in the
   * task that drew it: once the frame is shown, its drawing buffer is
   * cleared.
   */
  async #drawBitmaps(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
  ): Promise<string> {
    const ofWebGL = createImageBitmap(gl.canvas as HTMLCanvasElement);
    const source = new OffscreenCanvas(2, 2);
    const sourceContext = source.getContext('2d')!;
    sourceContext.fillStyle = 'rgb(255, 0, 0)';
    sourceContext.fillRect(0, 0, 2, 2);
    const red = createImageBitmap(source);
    sourceContext.fillStyle = 'rgb(0, 0, 255)';
    sourceContext.fillRect(0, 0, 2, 2);
    const blue = source.transferToImageBitmap();
    const cleared = Array.from(sourceContext.getImageData(0, 0, 1, 1).data);

    const target = document.createElement('canvas');
    target.width = 1;
    target.height = 1;
    const context = target.getContext('2d')!;
    const read = (bitmap: ImageBitmap | OffscreenCanvas) => {
      context.clearRect(0, 0, 1, 1);
      context.drawImage(bitmap, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).join(',');
    };
    const redBitmap = await red;
    const reads = [
      read(await ofWebGL),
      read(redBitmap),
      read(blue),
      cleared.join(','),
    ];

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      redBitmap,
    );
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    reads.push(Array.from(pixel).join(','));

    // A WebGL2 OffscreenCanvas, transferred while it draws to no color
    // buffer: the bitmap has its red, the canvas is cleared all the same,
    // and its draw buffer is still the app's NONE.
    const glSource = new OffscreenCanvas(1, 1);
    const glSourceContext = glSource.getContext('webgl2');
    if (!glSourceContext) return 'no WebGL2 OffscreenCanvas';
    glSourceContext.clearColor(1, 0, 0, 1);
    glSourceContext.clear(glSourceContext.COLOR_BUFFER_BIT);
    glSourceContext.drawBuffers([glSourceContext.NONE]);
    const transferred = glSource.transferToImageBitmap();
    const after = new Uint8Array(4);
    glSourceContext.readPixels(
      0,
      0,
      1,
      1,
      glSourceContext.RGBA,
      glSourceContext.UNSIGNED_BYTE,
      after,
    );
    const drawBuffer = glSourceContext.getParameter(
      glSourceContext.DRAW_BUFFER0,
    );
    reads.push(
      read(transferred),
      Array.from(after).join(','),
      drawBuffer === glSourceContext.NONE ? 'none' : `${drawBuffer}`,
    );

    // A bitmaprenderer context shows an OffscreenCanvas's frame, as web
    // code does: transferToImageBitmap() off screen, then
    // transferFromImageBitmap() on the canvas that shows it.
    const redFrame = (width: number, height: number) => {
      const frame = new OffscreenCanvas(width, height);
      const frameContext = frame.getContext('2d')!;
      frameContext.fillStyle = 'rgb(255, 0, 0)';
      frameContext.fillRect(0, 0, width, height);
      return frame.transferToImageBitmap();
    };
    // A bitmap smaller than its canvas: the canvas reads as the bitmap, at
    // the bitmap's size, which the shell answers with, and a transfer leaves
    // it a blank of that size, as the HTML spec has it.
    const shownOffscreen = new OffscreenCanvas(4, 4);
    const renderer = shownOffscreen.getContext('bitmaprenderer');
    if (!renderer) return 'no bitmaprenderer';
    const handed = redFrame(2, 1);
    renderer.transferFromImageBitmap(handed);
    reads.push(read(shownOffscreen), `${handed.width}`);
    const size = (bitmap: ImageBitmap) => `${bitmap.width}x${bitmap.height}`;
    reads.push(
      size(await createImageBitmap(shownOffscreen)),
      size(shownOffscreen.transferToImageBitmap()),
      size(shownOffscreen.transferToImageBitmap()),
    );
    // Red again first: the transfers left the canvas transparent, so null
    // has to be what clears it.
    renderer.transferFromImageBitmap(redFrame(2, 1));
    renderer.transferFromImageBitmap(null);
    reads.push(read(shownOffscreen));
    const shown = this.shown().nativeElement as unknown as HTMLCanvasElement;
    const shownRenderer = shown.getContext('bitmaprenderer');
    if (!shownRenderer) return 'no bitmaprenderer on <canvas>';
    shownRenderer.transferFromImageBitmap(redFrame(2, 2));

    const all = reads.join(' ');
    return all === BITMAP_READS ? 'ok' : all;
  }

  async #draw(): Promise<string> {
    const canvas = this.canvas().nativeElement as unknown as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'none';

    const shader = (type: number, source: string) => {
      const created = gl.createShader(type)!;
      gl.shaderSource(created, source);
      gl.compileShader(created);
      return created;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return `link failed ${gl.getProgramInfoLog(program)}`;
    }
    gl.useProgram(program);

    // One triangle that covers the canvas.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const png = Uint8Array.from(atob(CYAN_PNG), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([png], { type: 'image/png' }),
    );
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), 1, 0, 1, 1);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Two calls GL rejects, with different errors, which nothing asks for
    // before the read. The iOS shell takes the pending errors off GL to
    // learn whether the read itself failed, and when it took only one, the
    // other made a read that worked look failed: the pixel stayed 0,0,0,0.
    gl.enable(0);
    gl.lineWidth(0);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    // The errors are still the app's to ask for. Which comes first, and
    // whether GL kept the second, is up to the GL.
    if (gl.getError() === gl.NO_ERROR) return 'errors lost';
    while (gl.getError() !== gl.NO_ERROR);
    this.#gl = { gl, program };
    // A video check that ran out of tries before the context was there runs
    // again with it.
    if (this.resultVideo().endsWith('no WebGL')) this.#uploadVideo();
    try {
      this.result2D.set(this.#draw2D(gl, program));
    } catch (error) {
      this.result2D.set(`error ${(error as Error).message}`);
    }
    // Started in this task, as the 2D check left the WebGL canvas.
    this.#drawBitmaps(gl, program).then(
      (result) => this.resultBitmap.set(result),
      (error: Error) => this.resultBitmap.set(`error ${error.message}`),
    );
    return Array.from(pixel).join(',');
  }
}
