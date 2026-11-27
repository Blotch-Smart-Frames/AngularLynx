import { experiments } from '@rspack/core';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LAYERS, applyLayers } from './layers.js';
import { splitPrivateChains } from './private-methods.js';
import { lowerYieldingDefaultChains } from './yielding-defaults.js';

/**
 * The options layers.ts gives SWC, by `oneOf` branch (`main`,
 * `main-third-party`, …): every call of the chain is recorded, and
 * `options()` is kept for the branch it belongs to.
 */
const swcOptions = (): Record<string, object> => {
  const options: Record<string, object> = {};
  let branch = '';
  const step = (method: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => step(String(property)),
      apply: (_target, _this, args: unknown[]) => {
        if (method === 'oneOf') branch = args[0] as string;
        if (method === 'options') options[branch] = args[0] as object;
        return step('');
      },
    });
  applyLayers({
    modifyBundlerChain: (handler: (chain: unknown) => void) =>
      handler(step('')),
  } as never);
  return options;
};
const SWC_OPTIONS = swcOptions();

/** The app's code and another package's, each compiled as layers.ts does. */
const BRANCHES = [
  LAYERS.MAIN_THREAD,
  LAYERS.BACKGROUND,
  `${LAYERS.MAIN_THREAD}-third-party`,
  `${LAYERS.BACKGROUND}-third-party`,
];

const compile = (code: string, branch: string): string =>
  experiments.swc.transformSync(code, SWC_OPTIONS[branch] as never).code;

const FILE = '/app/src/app/list.ts';
const lower = (code: string): string => lowerYieldingDefaultChains(code, FILE);

/**
 * What `code` gives, settled, as an async fixture gives a promise.
 */
const settle = async (code: string) => {
  try {
    return { value: await runInNewContext(code) };
  } catch (error) {
    return { error: String(error) };
  }
};

/**
 * Fixtures run natively and after this pass (and splitPrivateChains, as
 * the app's modules get it) and SWC. Each reads through every shape it
 * names with nullish and non-nullish values, and records what runs.
 */
const FIXTURES: Record<string, string> = {
  'array patterns in a generator, declared and assigned': `
    const log = [];
    const obj = (name, value) => ({
      get b() { log.push('get ' + name); return value; },
      c(x) { log.push('c ' + name + ' ' + x); return [this === value2, x]; },
    });
    const value2 = obj('inner', null);
    function* g(a) {
      const [v = a.b?.c(yield 1)] = [];
      let w;
      [w = (a.b?.c(1), yield 2)] = [];
      for (const [x = a.b?.c(yield 3)] of [[]]) log.push(x);
      return [v, w];
    }
    const run = (a) => {
      const it = g(a);
      const out = [it.next().value, it.next('y1').value, it.next('y2').value];
      out.push(it.next('y3').value);
      return out;
    };
    [run({ get b() { log.push('get outer'); return value2; } }), run({ b: null }), log];
  `,
  'calls on their receivers, and chains of `?.`': `
    const log = [];
    const node = (name, next) => ({
      name,
      next,
      get(x) { log.push(name + ' ' + x); return this; },
      f: function (x) { return [this && this.name, x]; },
    });
    async function g(a) {
      const [p = a?.next?.get(await 'p')] = [];
      const [q = a.get?.(await 'q').next?.name] = [];
      const [r = a?.next.f?.(await 'r')] = [];
      const [s = a?.next?.f?.(await 's')] = [];
      const [t = a?.['next']?.[await 'name']] = [];
      const [u = (a.next)?.f(await 'u')] = [];
      const [v = a?.missing?.(await 'v')] = [];
      return [p && p.name, q, r, s, t, u, v];
    }
    (async () => [
      await g(node('a', node('b'))),
      // \`a?.next.f\` throws, as natively.
      await g(node('c')).catch((error) => error.constructor.name),
      await g({ get: null, next: null }).catch((error) => error.constructor.name),
      log,
    ])();
  `,
  'a private member in an object pattern and an array pattern': `
    class Node {
      #name;
      #next;
      constructor(name, next) { this.#name = name; this.#next = next; }
      #label(suffix) { return this.#name + suffix + (this instanceof Node); }
      static *labels(node) {
        const [a = node?.#next?.#label(yield 'a')] = [];
        const { b = node?.#next.#name + (yield 'b') } = {};
        const [c = node?.#next?.#label?.call(node.#next, yield 'c')] = [];
        return [a, b, c];
      }
    }
    const run = (node) => {
      const it = Node.labels(node);
      it.next();
      it.next('!');
      it.next('?');
      return it.next('.').value;
    };
    [run(new Node('a', new Node('b'))), run(null)];
  `,
  'chains in parentheses that are called, and tag a template': `
    'use strict';
    const node = (name, next) => ({
      name,
      next,
      m(x) { return [this && this.name, x]; },
      tag(strings, x) { return [this && this.name, strings[0], x]; },
    });
    // Calling the chain throws when it's nullish, as natively.
    async function g(a) {
      const [p = (a?.m)(await 'p')] = [];
      const [s = (a?.tag)\`s\${await 's'}\`] = [];
      return [p, s];
    }
    async function h(a) {
      const [q = (a?.next.m)?.(await 'q')] = [];
      const [r = (a?.next?.['m'])?.(await 'r')] = [];
      return [q, r];
    }
    const name = (error) => error.constructor.name;
    (async () => [
      await g(node('a')),
      await g(null).catch(name),
      await h(node('a', node('b'))),
      await h(null),
      await h(node('c', null)).catch(name),
      await h({ next: { m: null } }),
    ])();
  `,
  '`delete` of a chain': `
    async function g(a) {
      const [d = delete a?.b.c[await 'c']] = [];
      const [e = delete (a?.x?.y[await 'y'])] = [];
      return [d, e, JSON.stringify(a)];
    }
    (async () => [
      await g({ b: { c: { c: 1, k: 2 } }, x: { y: { y: 3 } } }),
      await g({ b: { c: {} }, x: null }),
      await g(null),
    ])();
  `,
  'a default value in an async arrow function and a method of `super`': `
    class Base { m(x) { return [this.tag, x]; } }
    class Child extends Base {
      tag = 'child';
      async f(a) {
        const [v = super.m?.(await a?.x)] = [];
        return v;
      }
    }
    const g = async (a) => [a = a?.b?.(await 1)] = [];
    (async () => [
      await new Child().f({ x: 1 }),
      await new Child().f(null),
      await g({ b() { return 2; } }),
      await g(null),
    ])();
  `,
};

describe('lowerYieldingDefaultChains', () => {
  it("leaves code SWC can't compile without it", () => {
    // What it's for: the `yield` ends up in an arrow function.
    const code = 'function* g(a) { const [v = a.b()?.c(yield 1)] = []; }';
    for (const branch of BRANCHES) {
      // Thrown in the context's realm, so not this one's SyntaxError.
      expect(() => runInNewContext(compile(code, branch))).toThrow(
        expect.objectContaining({ name: 'SyntaxError' }),
      );
      expect(() => runInNewContext(compile(lower(code), branch))).not.toThrow();
    }
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`runs as natively: ${name}`, async () => {
      const expected = await settle(fixture);
      expect(expected).not.toHaveProperty('error');
      const result = lower(fixture);
      expect(result).not.toBe(fixture);
      expect(result.split('\n')).toHaveLength(fixture.split('\n').length);
      for (const branch of BRANCHES) {
        const code = branch.endsWith('third-party')
          ? result
          : splitPrivateChains(result, FILE);
        expect(await settle(compile(code, branch))).toEqual(expected);
      }
    });
  }

  it('reads what each `?.` is on into a variable, declared in the function', () => {
    expect(
      lower('function* g(a) { const [v = a.b()?.c(yield 1)] = []; }'),
    ).toBe(
      'function* g(a) { var __chain0; const [v = ((__chain0 = a.b()) == null ? void 0 : __chain0.c(yield 1))] = []; }',
    );
    // Each link reads what the one before it gave.
    expect(
      lower('async function g(a) { let v; [v = a?.b[0]?.[await 1]] = []; }'),
    ).toBe(
      'async function g(a) { var __chain0, __chain1; let v; [v = ((__chain0 = a) == null ? void 0 : ((__chain1 = __chain0.b[0]) == null ? void 0 : __chain1[await 1]))] = []; }',
    );
  });

  it('calls a member through `call`, on its receiver, read once', () => {
    expect(lower('async (a) => { const [v = a.b.c?.(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = ((__chain0 = (__chain1 = a.b).c) == null ? void 0 : __chain0.call(__chain1, await 1))] = []; }',
    );
    // The previous link's read is the receiver.
    expect(lower('async (a) => { const [v = a?.b?.(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = ((__chain0 = a) == null ? void 0 : ((__chain1 = __chain0.b) == null ? void 0 : __chain1.call(__chain0, await 1)))] = []; }',
    );
    // A receiver after a `?.`, in parentheses, of `super`, and none.
    expect(lower('async (a) => { const [v = a?.b.c?.(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1, __chain2; const [v = ((__chain0 = a) == null ? void 0 : ((__chain1 = (__chain2 = __chain0.b).c) == null ? void 0 : __chain1.call(__chain2, await 1)))] = []; }',
    );
    expect(lower('async (a) => { const [v = (a.b)?.(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = ((__chain0 = ((__chain1 = a).b)) == null ? void 0 : __chain0.call(__chain1, await 1))] = []; }',
    );
    expect(
      lower(
        'class A extends B { async f() { const [v = super.m?.(await 1)] = []; } }',
      ),
    ).toBe(
      'class A extends B { async f() { var __chain0; const [v = ((__chain0 = super.m) == null ? void 0 : __chain0.call(this, await 1))] = []; } }',
    );
    expect(
      lower('async (a) => { const [v = a()?.(await 1), w = a?.()] = []; }'),
    ).toBe(
      'async (a) => { var __chain0; const [v = ((__chain0 = a()) == null ? void 0 : __chain0(await 1)), w = a?.()] = []; }',
    );
    // A `delete` deletes from the last link.
    expect(
      lower('async (a) => { const [v = delete a?.b?.[await 1]] = []; }'),
    ).toBe(
      'async (a) => { var __chain0, __chain1; const [v =  ((__chain0 = a) == null ? true : ((__chain1 = __chain0.b) == null ? true : delete __chain1[await 1]))] = []; }',
    );
    // A non-null assertion, in a .ts module, keeps it.
    expect(lower('async (a) => { const [v = a.b!?.(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = ((__chain0 = (__chain1 = a).b!) == null ? void 0 : __chain0.call(__chain1, await 1))] = []; }',
    );
    // A call with no arguments gets only the receiver.
    expect(lower('async (a) => { const [v = (await a).b?.()] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = ((__chain0 = (__chain1 = (await a)).b) == null ? void 0 : __chain0.call(__chain1))] = []; }',
    );
  });

  it('declares the variables where each run of the default value has its own', () => {
    // An arrow function's expression body becomes a block.
    expect(lower('const g = async (a) => [a = a?.b(await 1)] = [];')).toBe(
      'const g = async (a) => { var __chain0; return [a = ((__chain0 = a) == null ? void 0 : __chain0.b(await 1))] = [] };',
    );
    // The module's top level, with a top-level `await`.
    expect(lower('const [v = a?.b(await 1)] = [];')).toBe(
      'const [v = ((__chain0 = a) == null ? void 0 : __chain0.b(await 1))] = [];;var __chain0;',
    );
    // A name the module already uses is passed over.
    expect(lower('const __chain0 = 1; const [v = a?.b(await 1)] = [];')).toBe(
      'const __chain0 = 1; const [v = ((___chain0 = a) == null ? void 0 : ___chain0.b(await 1))] = [];;var ___chain0;',
    );
  });

  it('compiles chains inside the chain, and leaves those that run in a function of their own', () => {
    expect(
      lower(
        'async (a) => { const [v = a?.b(a?.c, () => a?.d)[a?.e]] = [await 1]; }',
      ),
    ).toBe(
      'async (a) => { const [v = a?.b(a?.c, () => a?.d)[a?.e]] = [await 1]; }',
    );
    expect(
      lower(
        'async (a) => { const [v = a?.b(a?.c, () => a?.d, await 1)[a?.e]] = []; }',
      ),
    ).toBe(
      'async (a) => { var __chain0, __chain1, __chain2; const [v = ((__chain0 = a) == null ? void 0 : __chain0.b(((__chain1 = a) == null ? void 0 : __chain1.c), () => a?.d, await 1)[((__chain2 = a) == null ? void 0 : __chain2.e)])] = []; }',
    );
    // What a class or a method in it runs as it's made counts; their bodies
    // don't.
    expect(
      lower(
        'async (a) => { const [v = class extends a?.b(await 1) { [a?.c]() { a?.d; } e = a?.f; }] = []; }',
      ),
    ).toBe(
      'async (a) => { var __chain0, __chain1; const [v = class extends ((__chain0 = a) == null ? void 0 : __chain0.b(await 1)) { [((__chain1 = a) == null ? void 0 : __chain1.c)]() { a?.d; } e = a?.f; }] = []; }',
    );
    // So does an object literal's method's computed name.
    expect(
      lower(
        'async (a) => { const [v = { [a?.c]() { a?.d; } }[await 1]] = []; }',
      ),
    ).toBe(
      'async (a) => { var __chain0; const [v = { [((__chain0 = a) == null ? void 0 : __chain0.c)]() { a?.d; } }[await 1]] = []; }',
    );
    // A default value inside a generator inside the default value is its own.
    expect(
      lower(
        'async (a) => { const [v = (await 1, function* () { const [w = a?.b(yield)] = []; })] = []; }',
      ),
    ).toBe(
      'async (a) => { const [v = (await 1, function* () { var __chain0; const [w = ((__chain0 = a) == null ? void 0 : __chain0.b(yield))] = []; })] = []; }',
    );
  });

  it('gives a chain in parentheses that is called its receiver', () => {
    // The last link's read is the object.
    expect(lower('async (a) => { const [v = (a?.m)(await 1)] = []; }')).toBe(
      'async (a) => { var __chain0, __chain1; const [v = (((__chain1 = a) == null ? void 0 : (__chain0 = __chain1).m)).call(__chain0, await 1)] = []; }',
    );
    // The object is read where the last link's part of the chain starts.
    expect(
      lower('async (a) => { const [v = (a?.b.c)?.(await 1)] = []; }'),
    ).toBe(
      'async (a) => { var __chain0, __chain1, __chain2; const [v = ((__chain0 = (((__chain2 = a) == null ? void 0 : (__chain1 = __chain2.b).c))) == null ? void 0 : __chain0.call(__chain1, await 1))] = []; }',
    );
    // A tag gets it through `bind`, and a call of another kind of link needs
    // none.
    expect(
      lower(
        'async (a) => { const [v = (a?.[0])`${await 1}`, w = (a?.f())(await 1)] = []; }',
      ),
    ).toBe(
      'async (a) => { var __chain0, __chain1, __chain2; const [v = (((__chain1 = a) == null ? void 0 : (__chain0 = __chain1)[0])).bind(__chain0)`${await 1}`, w = (((__chain2 = a) == null ? void 0 : __chain2.f()))(await 1)] = []; }',
    );
    // Outside such a default value, it's left alone.
    expect(lower('async (a) => { const [v = (a?.m)()] = [await 1]; }')).toBe(
      'async (a) => { const [v = (a?.m)()] = [await 1]; }',
    );
    // A call with no arguments gets only the receiver.
    expect(
      lower('async (a) => { const [v = (a?.m)() + (await 1)] = []; }'),
    ).toBe(
      'async (a) => { var __chain0, __chain1; const [v = (((__chain1 = a) == null ? void 0 : (__chain0 = __chain1).m)).call(__chain0) + (await 1)] = []; }',
    );
  });

  it('leaves modules without such a default value', () => {
    for (const code of [
      // No `yield` or `await` in it, or none at all.
      'async (a) => { const [v = a?.b] = [await 1]; }',
      'const [v = a?.b] = [];',
      'const v = a?.b(await 1);',
    ]) {
      expect(lower(code)).toBe(code);
    }
  });

  it('keeps an inline source map in step', () => {
    // A map as TypeScript writes it, which has a segment for each name.
    const source =
      'async function g(a: any) { const [v = a?.b(await later)] = []; }';
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        inlineSourceMap: true,
      },
      fileName: 'list.ts',
    });
    const result = lower(outputText);
    expect(result).toContain('__chain0');
    // Where `later` is in the source, and in the code the map is for, on
    // the line after TypeScript's `"use strict"`.
    const segment = lineSegments(result, 1).find(
      ([, , , sourceColumn]) => sourceColumn === source.indexOf('later'),
    );
    expect(segment?.[0]).toBe(result.split('\n')[1]!.indexOf('later'));
  });
});

/**
 * One line's segments in a module's inline source map, each with its
 * generated column and its source, line and column, made absolute.
 */
const lineSegments = (code: string, line: number): number[][] => {
  const base64 = /base64,([A-Za-z0-9+/]+=*)/.exec(code)![1]!;
  const { mappings } = JSON.parse(
    Buffer.from(base64, 'base64').toString('utf8'),
  ) as { mappings: string };
  const digits =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // The source fields carry on from line to line; the column starts again.
  const fields = [0, 0, 0, 0];
  const lines = mappings.split(';').map((text) => {
    fields[0] = 0;
    return text
      .split(',')
      .filter(Boolean)
      .map((segment) => {
        const values: number[] = [];
        let value = 0;
        let shift = 0;
        for (const char of segment) {
          const digit = digits.indexOf(char);
          value += (digit & 31) << shift;
          shift += 5;
          if (!(digit & 32)) {
            values.push(value & 1 ? -(value >> 1) : value >> 1);
            value = 0;
            shift = 0;
          }
        }
        return values.map((delta, index) => (fields[index]! += delta));
      });
  });
  return lines[line]!;
};
