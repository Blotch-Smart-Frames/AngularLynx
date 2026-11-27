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

  // Dropped, the call wouldn't register the function on the background
  // thread, and a main-thread call of it would find nothing there.
  it.each([
    [
      'an aliased background function',
      "import { backgroundFn as bg } from '@blotch/angular-lynx';\nexport const task = bg(() => 1, 'id');",
    ],
    [
      'an aliased main-thread ref',
      "import { createMainThreadRef as ref } from '@blotch/angular-lynx';\nconst a = ref(0, 'id');",
    ],
    [
      "a namespace import's background function",
      "import * as lynx from '@blotch/angular-lynx';\nconst task = lynx.backgroundFn(() => 1, 'id');",
    ],
    [
      'a background function inside a value',
      "import { backgroundFn as bg } from '@blotch/angular-lynx';\nconst tasks = [bg(() => 1, 'a'), make()];",
    ],
  ])('leaves alone %s', (_label, code) => {
    expect(wrap(code)).toBe(code);
  });

  it("wraps a call of the runtime's other functions", () => {
    expect(
      wrap(
        "import { backgroundFn as bg, other } from '@blotch/angular-lynx';\nconst a = other();\nconst b = bg(() => 1, 'id');",
      ),
    ).toBe(
      "import { backgroundFn as bg, other } from '@blotch/angular-lynx';\nconst a = /*#__PURE__*/ (() => (other()))();\nconst b = bg(() => 1, 'id');",
    );
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

  // The minifier doesn't know a built-in constructor does nothing else, so
  // with its constant gone it kept the `new` as a statement, and what its
  // arguments read: the image registry's `releaseImage()` brought the WebGL
  // bridge's loader (issue #764).
  it.each([
    [
      'a collection',
      'const a = new Set();',
      'const a = /*#__PURE__*/ new Set();',
    ],
    [
      'a check',
      "const a = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry(release) : null;",
      "const a = typeof FinalizationRegistry === 'function' ? /*#__PURE__*/ new FinalizationRegistry(release) : null;",
    ],
    [
      'collections inside collections',
      'const a = new Map([[1, new Set()]]);',
      'const a = /*#__PURE__*/ new Map([[1, /*#__PURE__*/ new Set()]]);',
    ],
    [
      'collections in an object',
      'const a = { refs: new WeakMap(), ids: [new WeakSet()] };',
      'const a = { refs: /*#__PURE__*/ new WeakMap(), ids: [/*#__PURE__*/ new WeakSet()] };',
    ],
    [
      'each declaration of a statement',
      'let a = new Set(), b = new WeakRef(c);',
      'let a = /*#__PURE__*/ new Set(), b = /*#__PURE__*/ new WeakRef(c);',
    ],
  ])('marks pure the `new` of %s', (_label, code, expected) => {
    expect(wrap(code)).toBe(expected);
  });

  it.each([
    ['already annotated', 'const a = /* @__PURE__ */ new Set();'],
    ['already annotated with #', 'const a = /*#__PURE__*/ new Set();'],
    ['inside a function', 'const a = () => new Set();'],
  ])('leaves alone a collection %s', (_label, code) => {
    expect(wrap(code)).toBe(code);
  });

  it("leaves unmarked a wrapped value's collections", () => {
    // The IIFE's annotation drops the whole value. Only a pure value, which
    // isn't wrapped, needs its own.
    expect(wrap('const a = make(new Set());')).toBe(
      'const a = /*#__PURE__*/ (() => (make(new Set())))();',
    );
  });

  it('keeps the annotated value', () => {
    const code = wrap(
      "const a = typeof WeakRef === 'function' ? new WeakRef(globalThis) : null;",
    );
    expect(new Function(`${code}; return a;`)()?.deref()).toBe(globalThis);
  });

  it('wraps a call annotated pure whose arguments are not', () => {
    expect(
      wrap('const a = /* @__PURE__ */ new Set(LIST.filter(f));'),
    ).toContain('/*#__PURE__*/ (() => (');
  });
});
