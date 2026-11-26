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
 * shows each.
 *
 * Then "Video: red,blue / red" checks a `<video>` read as an image (issue
 * #696): fixtures/video.mp4 is red above and blue below, served by the E2E
 * static server. Once its first frame shows, paused, it's drawn on a 2D
 * canvas and read back at the top and the bottom, which also checks it's
 * upright, then uploaded as the WebGL texture and drawn, and the pixel read
 * back is the frame's first row, the top. The colors are named rather than
 * compared, since a video's are near, not exact, after its YUV encoding.
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
      <text flatten="false" style="margin-left: 12px;"
        >WebGL: {{ result() }}</text
      >
    </view>
    <text flatten="false">2D: {{ result2D() }}</text>
    <view
      style="display: flex; flex-direction: row; align-items: center; margin-top: 8px;"
    >
      <video
        #video
        [src]="videoUrl"
        [muted]="true"
        style="width: 64px; height: 32px;"
        (bindfirstframe)="drawVideo()"
        (binderror)="resultVideo.set('error')"
      ></video>
      <text flatten="false" style="margin-left: 12px;"
        >Video: {{ resultVideo() }}</text
      >
    </view>
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
  readonly result = signal('…');
  readonly result2D = signal('…');
  readonly resultVideo = signal('…');
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly videoUrl = environment.videoUrl;
  #gl: { gl: WebGL2RenderingContext; program: WebGLProgram } | undefined;

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
    return read === uploaded ? read : `${read} / ${uploaded}`;
  }

  /**
   * The video check, once its first frame shows: drawn on a 2D canvas and
   * read back, and uploaded as a texture into the WebGL context and read
   * back.
   */
  drawVideo(tries = 20): void {
    // The check needs the frame and the WebGL context, which the page makes
    // after an async decode: the first frame can come before either is
    // there, so it tries again for up to 2 seconds.
    const ready = this.video().nativeElement.videoWidth > 0 && this.#gl;
    if (!ready && tries > 0) {
      setTimeout(() => this.drawVideo(tries - 1), 100);
      return;
    }
    try {
      this.resultVideo.set(this.#drawVideo());
    } catch (error) {
      this.resultVideo.set(`error ${(error as Error).message}`);
    }
  }

  #drawVideo(): string {
    const video = this.video().nativeElement;
    const name = ({ 0: r, 1: g, 2: b }: ArrayLike<number>) =>
      r > 180 && g < 80 && b < 80
        ? 'red'
        : b > 180 && r < 80 && g < 80
          ? 'blue'
          : `${r} ${g} ${b}`;
    if (video.videoWidth === 0) return 'no frame';
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return 'none';
    context.drawImage(video, 0, 0);
    const top = name(context.getImageData(32, 4, 1, 1).data);
    const bottom = name(context.getImageData(32, canvas.height - 4, 1, 1).data);
    const webgl = this.#gl;
    if (!webgl) return `${top},${bottom} / no WebGL`;
    const { gl, program } = webgl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return `${top},${bottom} / ${name(pixel)}`;
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
    if (this.resultVideo().endsWith('no WebGL')) this.drawVideo();
    try {
      this.result2D.set(this.#draw2D(gl, program));
    } catch (error) {
      this.result2D.set(`error ${(error as Error).message}`);
    }
    return Array.from(pixel).join(',');
  }
}
