// A WebGL 1 context that records every call, for the web glass renderer's
// specs: jsdom has no WebGL. Constants read back as their own names (so
// `gl.TEXTURE_2D` is 'TEXTURE_2D'), which keeps call assertions readable.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
export type FakeWebGLOptions = {
  /** Whether the nth program (counting from 1) links. All do by default. */
  links?: (program: number) => boolean;
  lost?: boolean;
  /** Whether WEBGL_lose_context is available. It is by default. */
  loseContext?: boolean;
};

export type FakeWebGLCall = [method: string, ...args: unknown[]];

export const createFakeWebGL = (options: FakeWebGLOptions = {}) => {
  const calls: FakeWebGLCall[] = [];
  const loseContext = { loseContext: () => calls.push(['loseContext']) };
  let ids = 0;
  let programs = 0;
  const results: Record<string, (...args: any[]) => unknown> = {
    createProgram: () => ({ program: ++programs }),
    createShader: () => ({ shader: ++ids }),
    createTexture: () => ({ texture: ++ids }),
    createFramebuffer: () => ({ framebuffer: ++ids }),
    createBuffer: () => ({ buffer: ++ids }),
    getProgramParameter: (program: { program: number }) =>
      options.links?.(program.program) ?? true,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    isContextLost: () => options.lost ?? false,
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' && options.loseContext !== false
        ? loseContext
        : null,
  };
  const state: Record<string, unknown> = {
    drawingBufferWidth: 200,
    drawingBufferHeight: 100,
  };
  const gl = new Proxy(state, {
    get(target, property: string) {
      if (property in target) return target[property];
      if (/^[A-Z][A-Z0-9_]*$/.test(property)) return property;
      return (...args: unknown[]) => {
        calls.push([property, ...args]);
        return results[property]?.(...args);
      };
    },
  }) as unknown as WebGLRenderingContext;
  const callsTo = (method: string) =>
    calls.filter(([name]) => name === method).map(([, ...args]) => args);
  return { gl, calls, callsTo };
};
