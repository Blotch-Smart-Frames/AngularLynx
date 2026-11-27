/**
 * The key under which a WebGL2 context made by the runtime says it's one.
 *
 * The `WebGL2RenderingContext` global (dom-globals.ts) recognizes a context
 * by it, rather than by `instanceof LynxWebGL2RenderingContext`: the
 * context's class is in the build only when a module names `'webgl2'` (see
 * enable-webgl2.ts), and the global is installed in every app, so it mustn't
 * import the class. `Symbol.for()`, so a second copy of the runtime's context
 * is recognized too, as `CANVAS_SOURCE` is.
 */
export const WEBGL2_CONTEXT = Symbol.for('angular-lynx.webgl2Context');

/**
 * The key under which an object the runtime's WebGL2 context hands out (a
 * buffer, a texture, a uniform's location and so on, see webgl-objects.ts)
 * says which of WebGL's interfaces it is: its value is the interface's name,
 * such as `'WebGLTexture'`.
 *
 * The globals of those names (dom-globals.ts) recognize the objects by it,
 * for the reason `WEBGL2_CONTEXT` gives: the objects' classes come with the
 * context, which is in the build only when a module names `'webgl2'`, and
 * the globals are in every app.
 */
export const WEBGL_OBJECT = Symbol.for('angular-lynx.webglObject');

/**
 * WebGL2's object interfaces, each a global in a browser that the objects a
 * context makes are instances of. WebGL helper libraries tell what they were
 * given by them: twgl.js's `isTexture()` is `typeof WebGLTexture !==
 * 'undefined' && t instanceof WebGLTexture`.
 */
export const WEBGL_OBJECT_NAMES = [
  'WebGLBuffer',
  'WebGLFramebuffer',
  'WebGLRenderbuffer',
  'WebGLTexture',
  'WebGLProgram',
  'WebGLShader',
  'WebGLUniformLocation',
  'WebGLVertexArrayObject',
  'WebGLQuery',
  'WebGLSampler',
  'WebGLSync',
  'WebGLTransformFeedback',
  'WebGLActiveInfo',
  'WebGLShaderPrecisionFormat',
] as const;

export type WebGLObjectName = (typeof WEBGL_OBJECT_NAMES)[number];
