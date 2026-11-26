import { describe, expect, it } from 'vitest';
import { wrapPureClasses } from './pure-classes.js';

const FILE = '/proj/node_modules/lib/index.mjs';
const wrap = (code: string): string => wrapPureClasses(code, FILE);

describe('wrapPureClasses', () => {
  it('wraps a class expression with private fields in a pure IIFE', () => {
    expect(wrap('var Renderer = class { #document; #data = {}; };')).toBe(
      'var Renderer = /*#__PURE__*/ (() => class { #document; #data = {}; })();',
    );
  });

  it('wraps a class declaration with static fields, keeping its name and scoping', () => {
    expect(wrap('class Element { static #byId = new Map(); }')).toBe(
      'let Element = /*#__PURE__*/ (() => class Element { static #byId = new Map(); })();',
    );
  });

  it('keeps an exported class exported', () => {
    expect(wrap('export class Ref { #value; }')).toBe(
      'export let Ref = /*#__PURE__*/ (() => class Ref { #value; })();',
    );
    expect(wrap('export default class Ref { #value; }')).toBe(
      'let Ref = /*#__PURE__*/ (() => class Ref { #value; })();\nexport { Ref as default };',
    );
  });

  it('keeps the class working', () => {
    const code = wrap(
      'var Counter = class { #count = 0; static start = 1; next() { return Counter.start + this.#count++; } };',
    );
    const Counter = new Function(`${code}; return Counter;`)();
    const counter = new Counter();
    counter.next();
    expect(counter.next()).toBe(2);
  });

  // Angular's development output keeps types, which SWC strips later. Read as
  // JavaScript, `resource<Data>(…)` ended the class at the `>` (issue #84).
  it('reads a .ts module as TypeScript', () => {
    const code = [
      'export class Page {',
      '  readonly #resource = httpResource<Data>(() => URL, ...(ngDevMode ? [{ debugName: "#resource" }] : []));',
      '  ask(ref: unknown): void {}',
      '}',
    ].join('\n');
    expect(wrapPureClasses(code, '/proj/src/app/page.ts')).toBe(
      `export let Page = /*#__PURE__*/ (() => ${code.slice('export '.length)})();`,
    );
  });

  it('wraps a class whose base is a reference', () => {
    expect(wrap('var B = class extends lib.A { #x; };')).toContain(
      '/*#__PURE__*/ (() => class extends lib.A',
    );
  });

  // Static initializers that only create a value.
  it('wraps a class whose static members are pure', () => {
    const code = [
      'static a = 1;',
      'static b = `t`;',
      'static c = name;',
      'static d = () => 1;',
      'static e = function () {};',
      'static f = true;',
      'static g = false;',
      'static h = null;',
      'static i = void 0;',
      'static j = (1);',
      'static k = -1;',
      'static l = [1, [2]];',
      'static m = { a: 1, b: { c: 2 } };',
      'static n = new WeakMap([[1, 2]]);',
      'static o;',
      'static q = new Set;',
      "static r = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((id) => id) : null;",
      'static s = a && b || c ?? d;',
      'static t = new WeakRef(name);',
      '[Symbol.iterator]() {}',
      'static p() {}',
    ].join(' ');
    expect(wrap(`var X = class { ${code} };`)).toContain('/*#__PURE__*/');
  });

  // Each of these could do something when the class is defined.
  it.each([
    ['a call in a static field', 'static a = make();'],
    [
      'a constructor that is not a built-in collection',
      'static a = new Foo();',
    ],
    ['a built-in collection built from a call', 'static a = new Map(make());'],
    ['a spread in an array', 'static a = [...items];'],
    ['a computed key in an object', 'static a = { [key]: 1 };'],
    ['a method in an object', 'static a = { m() {} };'],
    ['a static block', 'static { init(); }'],
    ['a computed member name', '[key] = 1; static a = 1;'],
    ['a computed member name read from an object', '[keys.a]() {}'],
    ['a comparison that converts', 'static a = b < c;'],
    ['a conditional with a call', 'static a = b ? make() : null;'],
  ])('leaves a class alone with %s', (_label, members) => {
    const code = `var X = class { ${members} };`;
    expect(wrap(code)).toBe(code);
  });

  // A well-known symbol's key is computed, which SWC lowers to a call outside
  // the class, so the class needs the IIFE as much as a private member does.
  it('wraps a class whose only lowered member is a well-known symbol key', () => {
    expect(wrap('var Headers = class { [Symbol.iterator]() {} };')).toBe(
      'var Headers = /*#__PURE__*/ (() => class { [Symbol.iterator]() {} })();',
    );
  });

  // The package's build names a class that refers to itself `_a` as well, and
  // assigns that after it. The assignment kept the runtime's LynxElement.
  it("moves a class's alias assignment into its IIFE", () => {
    const code = [
      'var _a;',
      'var Element = class { static #byId = new Map(); static get(id) { return _a.#byId.get(id); } };',
      '_a = Element;',
      'var after = 1;',
    ].join('\n');
    expect(wrap(code)).toBe(
      [
        'var _a;',
        'var Element = /*#__PURE__*/ (() => _a = class { static #byId = new Map(); static get(id) { return _a.#byId.get(id); } })();',
        'var after = 1;',
      ].join('\n'),
    );
    const Element = new Function(`${wrap(code)}; return Element;`)();
    expect(Element.get(1)).toBeUndefined();
  });

  it('leaves an alias alone that is assigned more than once', () => {
    const code = [
      'var _a;',
      'var Element = class { #x; };',
      '_a = Element;',
      '_a = other;',
    ].join('\n');
    expect(wrap(code)).toContain('\n_a = Element;');
  });

  it('leaves an assignment alone to a variable that has a value', () => {
    const code = [
      'var _a = 1;',
      'var Element = class { #x; };',
      '_a = Element;',
    ].join('\n');
    expect(wrap(code)).toContain('\n_a = Element;');
    expect(wrap(code)).toContain('(() => class');
  });

  it('leaves a class alone whose base is computed', () => {
    const code = 'var X = class extends mixin(Base) { #a; };';
    expect(wrap(code)).toBe(code);
  });

  it('leaves a decorated class alone', () => {
    const code = '@register class X { #a; }';
    expect(wrap(code)).toBe(code);
  });

  // Nothing is lowered, so the bundler can drop them already.
  it('leaves a class without private or static members alone', () => {
    const code = 'var X = class { a = 1; run() {} };\nclass Y {}';
    expect(wrap(code)).toBe(code);
  });

  it('leaves other statements alone', () => {
    const code = [
      'var a = 1, B = class { #x; };',
      'var c;',
      'var d = make();',
      'export default class { #x; }',
      'install(class { #x; });',
    ].join('\n');
    expect(wrap(code)).toBe(code);
  });

  it('returns code without classes untouched', () => {
    const code = 'export const x = 1;';
    expect(wrap(code)).toBe(code);
  });
});
