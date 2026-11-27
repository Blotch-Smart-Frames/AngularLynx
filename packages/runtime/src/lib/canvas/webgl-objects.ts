import { WEBGL_OBJECT } from './webgl2-brand';

/**
 * WebGL's object types, as the native context hands them out. Each is a
 * handle: an id the JavaScript side picks when the object is created, which
 * the shell maps to the GL name it made. Picking ids here means `createBuffer()`
 * and friends return at once, with no round trip to native.
 *
 * Ids are unique across every kind of object in a context, and never reused,
 * so a stale handle can't reach a newer object.
 *
 * Each class names the WebGL interface it stands for under `WEBGL_OBJECT`, a
 * getter on its prototype, which is how the `WebGLTexture` global and the
 * rest know its instances on iOS and Android (see webgl2-brand.ts). A getter,
 * so it's part of the class rather than a statement the module runs.
 */
export class WebGLObjectHandle {
  /** Set by delete*(): WebGL ignores a deleted object, and is*() is false. */
  deleted = false;
  constructor(
    /** @internal */ readonly id: number,
    /** @internal The context that made it, which alone may use it. */
    readonly owner: object,
  ) {}
}

export class LynxWebGLBuffer extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLBuffer' {
    return 'WebGLBuffer';
  }
}
export class LynxWebGLFramebuffer extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLFramebuffer' {
    return 'WebGLFramebuffer';
  }
}
export class LynxWebGLRenderbuffer extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLRenderbuffer' {
    return 'WebGLRenderbuffer';
  }
}
export class LynxWebGLTexture extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLTexture' {
    return 'WebGLTexture';
  }
}
export class LynxWebGLVertexArrayObject extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLVertexArrayObject' {
    return 'WebGLVertexArrayObject';
  }

  /**
   * The ELEMENT_ARRAY_BUFFER binding is part of a vertex array, so
   * `getParameter(ELEMENT_ARRAY_BUFFER_BINDING)` answers from the bound one.
   */
  elementArrayBuffer: LynxWebGLBuffer | null = null;
}
export class LynxWebGLQuery extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLQuery' {
    return 'WebGLQuery';
  }
}
export class LynxWebGLSampler extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLSampler' {
    return 'WebGLSampler';
  }
}
export class LynxWebGLSync extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLSync' {
    return 'WebGLSync';
  }
}
export class LynxWebGLTransformFeedback extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLTransformFeedback' {
    return 'WebGLTransformFeedback';
  }
}

export class LynxWebGLShader extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLShader' {
    return 'WebGLShader';
  }

  source = '';
  /**
   * The compile status and log, fetched from native once after each
   * `compileShader` (see LynxWebGL2RenderingContext.#shaderInfo).
   */
  info: { compiled: boolean; log: string } | null = null;
  constructor(
    id: number,
    owner: object,
    readonly type: number,
  ) {
    super(id, owner);
  }
}

/** One of `getProgramInfo`'s active uniforms or attributes. */
export type ActiveVariable = [
  name: string,
  size: number,
  type: number,
  location: number,
];

/**
 * A program's link results and reflection, fetched in one call after each
 * `linkProgram` instead of one call per `getActiveUniform` and
 * `getUniformLocation`: three.js asks for every uniform of every program.
 */
export type ProgramInfo = {
  linked: boolean;
  log: string;
  uniforms: ActiveVariable[];
  attributes: ActiveVariable[];
  uniformBlocks: number;
  transformFeedbackVaryings: number;
};

export class LynxWebGLProgram extends WebGLObjectHandle {
  get [WEBGL_OBJECT](): 'WebGLProgram' {
    return 'WebGLProgram';
  }

  shaders: LynxWebGLShader[] = [];
  info: ProgramInfo | null = null;
  /** Validation's result, which only validateProgram() updates. */
  validated = false;
  /** Uniform locations by name, for names reflection didn't list. */
  locations = new Map<string, LynxWebGLUniformLocation | null>();
  /** Bumped by each link, which invalidates the old locations. */
  linkCount = 0;
}

/** A uniform's location: opaque to the app, the GL location to native. */
export class LynxWebGLUniformLocation {
  get [WEBGL_OBJECT](): 'WebGLUniformLocation' {
    return 'WebGLUniformLocation';
  }

  constructor(
    /** @internal */ readonly program: LynxWebGLProgram,
    /** @internal */ readonly location: number,
    /** @internal */ readonly linkCount: number,
  ) {}
}

export class LynxWebGLActiveInfo {
  get [WEBGL_OBJECT](): 'WebGLActiveInfo' {
    return 'WebGLActiveInfo';
  }

  constructor(
    readonly name: string,
    readonly size: number,
    readonly type: number,
  ) {}
}

export class LynxWebGLShaderPrecisionFormat {
  get [WEBGL_OBJECT](): 'WebGLShaderPrecisionFormat' {
    return 'WebGLShaderPrecisionFormat';
  }

  constructor(
    readonly rangeMin: number,
    readonly rangeMax: number,
    readonly precision: number,
  ) {}
}
