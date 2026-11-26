import { describe, expect, it } from 'vitest';
import { wrapPureInitializers } from './pure-initializers.js';

const FILE = '/proj/node_modules/@blotch/angular-lynx/fesm2022/index.mjs';
const wrap = (code: string): string => wrapPureInitializers(code, FILE);

describe('wrapPureInitializers', () => {
  // Each of these kept what it read in the background bundle (issue #710).
  it.each([
    ['a method call', 'const readonly = preference.asReadonly();'],
    ['a property read', 'const FLIP = GL.UNPACK_FLIP_Y_WEBGL;'],
    ['a collection built from a call', 'const TAGS = new Set(LIST.filter(f));'],
    ['an array of property reads', 'const TYPES = [GL.A, GL.B];'],
    [
      'a class with side effects of its own',
      'var X = class { static a = make(); };',
    ],
  ])('wraps %s in a pure IIFE', (_label, code) => {
    const [, name, value] = /^((?:const|var) \w+ = )(.*);$/.exec(code)!;
    expect(wrap(code)).toBe(`${name}/*#__PURE__*/ (() => (${value}))();`);
  });

  it('keeps the value', () => {
    const code = wrap(
      'const GL = { A: 1 };\nconst A = GL.A;\nconst B = [A, GL.A];',
    );
    expect(new Function(`${code}; return B;`)()).toEqual([1, 1]);
  });

  it('wraps each declaration of a statement', () => {
    expect(wrap('let a = f(), b = 1, c = g();')).toBe(
      'let a = /*#__PURE__*/ (() => (f()))(), b = 1, c = /*#__PURE__*/ (() => (g()))();',
    );
  });

  // The minifier inlines a small IIFE and then keeps what was in it.
  it.each([
    ['a literal', 'const a = 1;'],
    ['a function', 'const a = () => f();'],
    ['a collection', 'const a = new Set();'],
    [
      'a check',
      "const a = typeof WeakRef === 'function' ? new WeakRef(b) : null;",
    ],
    ['a call annotated pure', 'const a = /* @__PURE__ */ f(1);'],
    [
      'a call annotated pure in parentheses',
      'const a = (/* @__PURE__ */ f(1));',
    ],
    ['an annotated call in parentheses', 'const a = /* @__PURE__ */ (f(1));'],
    [
      'a `new` annotated pure without arguments',
      'const a = /* @__PURE__ */ new Foo;',
    ],
    ['a pure IIFE', 'const a = /*#__PURE__*/ (() => class { #x; })();'],
    ['a destructuring', 'const { a } = f();'],
    ['an await', 'const a = await f();'],
    ['a background function', 'const a = backgroundFn(() => 1, "id");'],
    ['a main-thread ref', 'const a = new MainThreadRef(0, "id");'],
    ['a declaration without a value', 'let a;'],
  ])('leaves alone %s', (_label, code) => {
    expect(wrap(code)).toBe(code);
  });

  it('leaves other statements alone', () => {
    const code = 'install();\nif (a) b = c();\nfunction f() { const x = g(); }';
    expect(wrap(code)).toBe(code);
  });

  it('wraps an await inside a function of its own', () => {
    expect(wrap('const a = make(async () => await f());')).toContain(
      '/*#__PURE__*/ (() => (make(',
    );
  });

  it('wraps a call annotated pure whose arguments are not', () => {
    expect(
      wrap('const a = /* @__PURE__ */ new Set(LIST.filter(f));'),
    ).toContain('/*#__PURE__*/ (() => (');
  });
});
