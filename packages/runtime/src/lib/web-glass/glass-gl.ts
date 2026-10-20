import { QUAD_VERTEX_SHADER } from './glass-shaders';

export type Program = {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
};

export type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
};

export const compile = (
  gl: WebGLRenderingContext,
  fragmentSource: string,
): Program | null => {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, QUAD_VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  // Every program shares the one quad buffer bound to attribute 0.
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const locations = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!locations.has(name)) {
      locations.set(name, gl.getUniformLocation(program, name));
    }
    return locations.get(name)!;
  };
  return { program, uniform };
};

export const createTexture = (gl: WebGLRenderingContext): WebGLTexture => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // WebGL 1 can't mipmap or repeat non-power-of-two textures; clamping also
  // stretches the backdrop's edge when the lens samples past it.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

export const createTarget = (
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): Target => {
  const texture = createTexture(gl);
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
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  return { texture, framebuffer };
};
