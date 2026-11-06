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
 * back. A texture that didn't upload reads black (0,0,0,255). Hosts without
 * WebGL (Lynx Explorer) show "WebGL: none".
 *
 * Below it, the prebuilt library fixture (fixtures/prebuilt-library), which
 * the counter page has no room for, and "Open photo", which opens photo.ts.
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
    <e2e-library-frame />
    <view
      [flatten]="false"
      [accessibility-element]="true"
      accessibility-label="Open photo"
      accessibility-traits="button"
      style="margin-top: 8px; padding: 12px; background-color: #e0e0e0; align-self: flex-start;"
      routerLink="/photo"
    >
      <text>Open photo</text>
    </view>
  `,
})
export class CanvasRoute {
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');
  readonly result = signal('…');

  constructor() {
    afterNextRender(() => {
      this.#draw().then(
        (result) => this.result.set(result),
        (error: Error) => this.result.set(`error ${error.message}`),
      );
    });
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
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel).join(',');
  }
}
