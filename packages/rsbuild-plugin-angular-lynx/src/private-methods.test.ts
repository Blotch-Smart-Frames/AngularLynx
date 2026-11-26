import { experiments } from '@rspack/core';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LAYERS, applyLayers, isAngularLynxPackageModule } from './layers.js';
import {
  compilesPrivatesAsProperties,
  hidePrivateMethods,
  isAppModule,
  renamePrivateMethods,
  splitPrivateChains,
  transformPrivateMethods,
} from './private-methods.js';
import { JavaScriptTransformer } from './utils/angular/build-internals.js';

const ROOT = '/app';
const FILE = '/app/node_modules/@blotch/angular-lynx/fesm2022/index.mjs';
const rename = (code: string, file = FILE): string =>
  renamePrivateMethods(code, file, { root: ROOT });

/**
 * The new name the module gave `#name`, e.g. `__m_3f9a1c0`.
 */
const renamed = (code: string, name: string): string[] => [
  ...new Set(code.match(new RegExp(`__${name}_[0-9a-f]{6}\\d+`, 'g'))),
];

/**
 * The options layers.ts gives SWC for AngularLynx's own code and the app's,
 * by layer: every call of the chain is recorded, and `options()` is kept for
 * the `oneOf` branch it belongs to.
 */
const firstPartySwcOptions = (): Record<string, object> => {
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
const SWC_OPTIONS = firstPartySwcOptions();

/**
 * SWC's output for `code` on the layer, as the plugin compiles it.
 */
const compile = (code: string, layer: string): string =>
  experiments.swc.transformSync(code, SWC_OPTIONS[layer] as never).code;

/** Where SWC defines a member on each instance in its constructor. */
const PER_INSTANCE_METHOD =
  /defineProperty\(this, [\w$]+, \{\s*(?:value|get|set):/;

/**
 * Each fixture's result, run natively (ES2022 private methods) and after this
 * pass and SWC with the main thread's options, the layer transformModule()
 * runs the pass on.
 */
const FIXTURES: Record<string, string> = {
  'private fields, out of keys, JSON and spreads': `
    class Point {
      #x = 1;
      y = 2;
      #label = 'p';
      read() { return [this.#x, this.#label]; }
      move(by) { this.#x += by; this.#label ??= 'q'; return this.#x; }
    }
    const point = new Point();
    const spread = { ...point };
    const keys = [];
    for (const key in point) keys.push(key);
    [point.move(2), point.read(), Object.keys(point), JSON.stringify(point), Object.keys(spread), keys];
  `,
  'field initializers in order, public and private': `
    class Order {
      a = 1;
      #b = this.a + 1;
      c = this.#b + 1;
      #d = this.c * 2;
      all() { return [this.a, this.#b, this.c, this.#d]; }
    }
    new Order().all();
  `,
  "a subclass's private field with its base's name": `
    class Base { #v = 'base'; base() { return this.#v; } }
    class Sub extends Base {
      #v = 'sub';
      sub() { return this.#v; }
      both(other) { return [this.#v, other.#v]; }
    }
    const sub = new Sub();
    [sub.base(), sub.sub(), sub.both(new Sub())];
  `,
  'private fields through optional chaining, on other instances and in static code': `
    class Node {
      #next = null;
      #value;
      constructor(value) { this.#value = value; }
      link(next) { this.#next = next; return this; }
      second() { return this.#next?.#value; }
      static valueOf(node) { return node?.#value; }
    }
    const list = new Node(1).link(new Node(2));
    [list.second(), new Node(3).second(), Node.valueOf(list), Node.valueOf(null)];
  `,
  'instance methods': `
    class Counter {
      #count = 0;
      #step(by) { this.#count += by; return this.#count; }
      next() { return this.#step(1); }
    }
    const counter = new Counter();
    [counter.next(), counter.next(), Object.keys(counter)];
  `,
  'getters and setters': `
    class Box {
      #value = 1;
      get #double() { return this.#value * 2; }
      set #double(next) { this.#value = next / 2; }
      get #only() { return 'read'; }
      run() {
        const out = [this.#double, this.#only];
        this.#double = 10; out.push(this.#value);
        this.#double += 2; out.push(this.#value);
        this.#double++; out.push(this.#value);
        [this.#double] = [20]; out.push(this.#value);
        ({ a: this.#double } = { a: 30 }); out.push(this.#value);
        for (this.#double of [40]) {} out.push(this.#value);
        try { this.#only = 1; } catch (error) { out.push(error instanceof TypeError); }
        return out;
      }
    }
    new Box().run();
  `,
  'other receivers and optional chains': `
    class Node {
      #name;
      constructor(name) { this.#name = name; }
      #label(suffix) { return this.#name + suffix; }
      #pair() { return [this.#name, this.#name.length]; }
      static label(node) { return node?.#label('!'); }
      peer(other) { return other.#label('?'); }
      maybe() { return this.#label?.('.'); }
      second() { return this.#pair?.()[1]; }
    }
    const a = new Node('a');
    const b = new Node('bb');
    [a.peer(b), Node.label(a), Node.label(null), a.maybe(), b.second()];
  `,
  'a method as a value': `
    class Handler {
      #count = 0;
      #handle() { return ++this.#count; }
      bound() { return this.#handle.bind(this); }
      same(other) { return this.#handle === other.#handle; }
    }
    const handler = new Handler();
    const handle = handler.bound();
    [handle(), handle(), handler.same(new Handler()), handle.name.length > 0];
  `,
  'a base and a subclass with the same private name': `
    class Base { #m() { return 'base'; } base() { return this.#m(); } }
    class Derived extends Base {
      #m() { return 'derived'; }
      derived() { return this.#m(); }
    }
    const derived = new Derived();
    [derived.base(), derived.derived(), new Base().base()];
  `,
  'a nested class that shadows a private name': `
    const log = [];
    class Outer {
      #m() { return 'outer'; }
      #only() { return 'only outer'; }
      // Made once, as Outer is, so its own names are renamed too.
      // \`extends\` sees Outer's names, the body Inner's.
      static Inner = class Inner extends (log.push(new Outer().#m()), Object) {
        #m() { return 'inner'; }
        [\`key \${new Outer().#only()}\`]() { return 'computed'; }
        run(outer) { return [this.#m(), outer.#only()]; }
      };
      shadowedKey() {
        const outer = this;
        try {
          // A computed key is evaluated with the class's own names.
          void class { #m() {} [outer.#m()]() {} };
        } catch (error) {
          return error instanceof TypeError;
        }
      }
    }
    const outer = new Outer();
    const inner = new Outer.Inner();
    [log, inner.run(outer), inner['key only outer'](), outer.shadowedKey()];
  `,
  'a subclass a method makes, which shadows a private name': `
    const log = [];
    class Outer {
      #m() { return 'outer'; }
      #only() { return 'only outer'; }
      make() {
        const outer = this;
        // \`extends\` sees Outer's names, the body Inner's.
        class Inner extends (log.push(outer.#m()), Object) {
          #m() { return 'inner'; }
          [\`key \${outer.#only()}\`]() { return 'computed'; }
          run() { return [this.#m(), outer.#only()]; }
        }
        return new Inner();
      }
      shadowedKey() {
        const outer = this;
        try {
          // A computed key is evaluated with the class's own names.
          void class { #m() {} [outer.#m()]() {} };
        } catch (error) {
          return error instanceof TypeError;
        }
      }
    }
    const outer = new Outer();
    const inner = outer.make();
    [log, inner.run(), inner['key only outer'](), outer.shadowedKey()];
  `,
  'static private methods': `
    class Registry {
      static #items = new Map();
      static #key(id) { return 'k' + id; }
      static add(id, value) {
        Registry.#items.set(Registry.#key(id), value);
        return Registry.#items.size;
      }
      #own() { return Registry.#key(2); }
      get own() { return this.#own(); }
    }
    // A spread copies an enumerable symbol-keyed property, but no private one.
    [Registry.add(1, 'a'), new Registry().own, Object.getOwnPropertySymbols({ ...Registry })];
  `,
  'a static private field of a class named Object': `
    // Inside a function, so SWC's helpers at the top level still see the
    // global Object. The class's own static blocks would see the class.
    (() => {
      class Object {
        static #x = 1;
        static read() { return this.#x; }
      }
      return [Object.read(), globalThis.Object.getOwnPropertySymbols({ ...Object })];
    })();
  `,
  'a static private field without a semicolon': `
    class Counter {
      static #count = 0
      static next() { return ++Counter.#count; }
    }
    [Counter.next(), Counter.next(), Object.getOwnPropertySymbols({ ...Counter })];
  `,
  'async and generator methods': `
    class Source {
      #items = [1, 2, 3];
      *#each() { yield* this.#items; }
      async #double(x) { await null; return x * 2; }
      async *#stream() { for (const x of this.#each()) yield await this.#double(x); }
      async collect() {
        const out = [...this.#each()];
        for await (const x of this.#stream()) out.push(x);
        return out;
      }
    }
    new Source().collect();
  `,
  'super in a private method': `
    class A { greet() { return 'A'; } }
    class B extends A {
      #greet() { return super.greet() + 'B'; }
      greet() { return this.#greet(); }
    }
    new B().greet();
  `,
  'a field initializer that calls a private method': `
    class Field {
      #seed = 2;
      made = this.#make();
      #make() { return 'made ' + this.#seed; }
    }
    new Field().made;
  `,
  'a receiver that is not an instance': `
    class Guarded { #m() { return 1; } call(x) { return x.#m(); } }
    let threw;
    try { new Guarded().call({}); } catch (error) { threw = error instanceof TypeError; }
    threw;
  `,
  'a class in a pure IIFE, as Angular wraps one': `
    let Wrapped = /*#__PURE__*/ (() => {
      class Wrapped {
        static ɵfac = () => new Wrapped();
        #m() { return 'wrapped'; }
        run() { return this.#m(); }
      }
      return Wrapped;
    })();
    var Expression = class { #m() { return 'expression'; } run() { return this.#m(); } };
    [Wrapped.ɵfac().run(), new Expression().run()];
  `,
  'reflection on an instance': `
    class Shape {
      constructor() { this.name = 'shape'; }
      #area() { return 1; }
      get #sides() { return 4; }
      area() { return this.#area() + this.#sides; }
    }
    const shape = new Shape();
    [Object.getOwnPropertyNames(shape), Object.keys(shape), JSON.stringify(shape), shape.area()];
  `,
  'a subclass in a pure IIFE, as Angular wraps one': `
    let Base = /*#__PURE__*/ (() => {
      class Base { #m() { return 'base'; } base() { return this.#m(); } }
      return Base;
    })();
    let Derived = /*#__PURE__*/ (() => {
      class Derived extends Base {
        #m() { return 'derived'; }
        derived() { return this.#m(); }
      }
      return Derived;
    })();
    const derived = new Derived();
    [derived.base(), derived.derived()];
  `,
  'a class factory made from its own class': `
    const make = (Base, label) => class extends Base {
      #who() { return label; }
      who() { return this.#who(); }
    };
    class Root {}
    const One = make(Root, 'one');
    const Two = make(One, 'two');
    [One.prototype.who.call(new Two()), new Two().who(), new One().who()];
  `,
  'a mixin applied twice, whose constructor calls its own private method': `
    const log = [];
    const Mixin = (Base, label) => class extends Base {
      constructor(...args) { super(...args); log.push(this.#init()); }
      #init() { return label; }
    };
    class Root {}
    class App extends Mixin(Mixin(Root, 'inner'), 'outer') {}
    new App();
    log;
  `,
  'classes a factory makes without extends': `
    const make = (label) => class { #who() { return label; } who() { return this.#who(); } };
    const A = make('a');
    const B = make('b');
    [new A().who(), new B().who()];
  `,
  'a named function called at once, then again by its name': `
    let again;
    const C1 = (function setup(tag) {
      again = setup;
      return class { #m() { return tag; } f() { return this.#m(); } };
    })('first');
    const C2 = again('second');
    [new C1().f(), new C2().f()];
  `,
  'a named function called at once, which calls itself': `
    const made = [];
    (function make(n) {
      class A { #n = n; #m() { return this.#n; } f() { return this.#m(); } }
      made.push(A);
      if (n > 0) make(n - 1);
    })(2);
    made.map((A) => new A().f());
  `,
  'a class a named function called at once makes again, from its own class': `
    const made = [];
    const Last = (function self(Base, depth) {
      const C = class extends Base { #who() { return depth; } who() { return this.#who(); } };
      made.push(C);
      return depth ? self(C, depth - 1) : C;
    })(class {}, 1);
    [made[0].prototype.who.call(new Last()), new Last().who()];
  `,
};

/**
 * The fixtures whose classes keep native private methods (see
 * renamePrivateMethods), which SWC then defines on each instance.
 */
const KEPT_NATIVE = new Set([
  'a subclass a method makes, which shadows a private name',
  'a class factory made from its own class',
  'a mixin applied twice, whose constructor calls its own private method',
  'a class a named function called at once makes again, from its own class',
]);

describe('renamePrivateMethods over ES2022 fixtures', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`matches native private methods: ${name}`, async () => {
      const expected = await runInNewContext(fixture);
      const main = compile(rename(fixture), LAYERS.MAIN_THREAD);
      expect(PER_INSTANCE_METHOD.test(main)).toBe(KEPT_NATIVE.has(name));
      expect(await runInNewContext(main)).toEqual(expected);
    });
  }

  it('defines private methods on each instance without the pass', () => {
    // What the pass is for: the same fixture, compiled as it was.
    expect(compile(FIXTURES['instance methods']!, LAYERS.MAIN_THREAD)).toMatch(
      PER_INSTANCE_METHOD,
    );
    expect(
      runInNewContext(
        compile(FIXTURES['reflection on an instance']!, LAYERS.MAIN_THREAD),
      )[0],
    ).toHaveLength(3);
  });

  it('leaves no instance method in the own property names', () => {
    const [ownNames] = runInNewContext(
      compile(
        rename(FIXTURES['reflection on an instance']!),
        LAYERS.MAIN_THREAD,
      ),
    );
    // As natively, where private methods aren't properties at all.
    expect(ownNames).toEqual(['name']);
  });
});

const APP_FILE = '/app/src/app/sheet.ts';
const hide = (code: string, file = APP_FILE): string =>
  hidePrivateMethods(code, file, { root: ROOT });

/**
 * Where SWC defines a private method (not a getter or setter) on each
 * instance.
 */
const PER_INSTANCE_PRIVATE_METHOD = /defineProperty\(this, [\w$]+, \{\s*value:/;

/**
 * Fixtures for what app code does that AngularLynx's packages don't, run
 * natively and after hidePrivateMethods and SWC with the main thread's
 * options.
 */
const APP_FIXTURES: Record<string, string> = {
  "reflection on the prototype, as auto-binding and Angular's component IDs do": `
    // As Angular's getComponentId() hashes a component's prototype.
    const ids = [];
    const defineComponent = (def) => {
      ids.push(Object.getOwnPropertyNames(def.type.prototype).join('|'));
      return def;
    };
    const autoBind = (self) => {
      for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(self))) {
        if (key !== 'constructor' && typeof self[key] === 'function') {
          self[key] = self[key].bind(self);
        }
      }
      return self;
    };
    class Panel {
      #open = false;
      constructor() { autoBind(this); }
      #toggle() { this.#open = !this.#open; return this.#open; }
      #label() { return this.#open ? 'open' : 'closed'; }
      tap() { this.#toggle(); return this.#label(); }
      static ɵfac = function Panel_Factory(t) { return new (t || Panel)(); };
      static ɵcmp = defineComponent({ type: Panel });
    }
    const panel = Panel.ɵfac();
    const inherited = [];
    for (const key in panel) inherited.push(key);
    const tap = panel.tap;
    [
      ids,
      Reflect.ownKeys(Panel.prototype),
      Object.keys(Object.getOwnPropertyDescriptors(Panel.prototype)),
      Object.keys(panel),
      inherited,
      tap(),
      // The field stays a property (issue #237); a method left on the
      // instance would show here.
      Object.getOwnPropertyNames(panel).filter((name) => !name.endsWith('_open')),
    ];
  `,
  'a static initializer before a method, which makes an instance': `
    const log = [];
    class Registry {
      static shared = new Registry('shared');
      #name;
      constructor(name) { this.#name = name; log.push(this.#describe()); }
      #describe() { return 'registry ' + this.#name; }
    }
    class Literal {
      static size = (3);
      static make = () => new Literal();
      #count() { return Literal.size; }
      count() { return this.#count(); }
    }
    new Registry('own');
    [log, Literal.make().count()];
  `,
  'a static block after a method, which calls it': `
    class Config {
      #parse(text) { return text.split(','); }
      static defaults;
      static { Config.defaults = new Config().load('a,b'); }
      load(text) { return this.#parse(text); }
    }
    Config.defaults;
  `,
  'a brand check that catches the TypeError': `
    class Token {
      #id() { return 1; }
      static is(value) { try { value.#id(); return true; } catch { return false; } }
      id() { return this.#id(); }
    }
    class Read {
      #id() { return 1; }
      static is(value) { try { value.#id; return true; } catch { return false; } }
      id() { return this.#id(); }
    }
    [Token.is(new Token()), Token.is({}), Read.is(new Read()), Read.is({}), new Token().id()];
  `,
  'arrow functions, a constructor, field initializers and parameters': `
    class Feed {
      #items = [];
      #seed = this.#make(1);
      onAdd = (x) => this.#add(x);
      constructor(first = this.#make(2)) { this.#add(first); }
      #make(n) { return n * 10; }
      #add(x) { this.#items.push(x); return this.#items.length; }
      later() { return [1, 2].map((n) => this.#make(n)); }
      get size() { return this.#count(); }
      #count() { return this.#items.length; }
      #recurse(n) { return n === 0 ? 0 : 1 + this.#recurse(n - 1); }
      depth() { return this.#recurse(3); }
      snapshot() { return [this.#seed, ...this.#items, arguments.length]; }
    }
    const feed = new Feed();
    const onAdd = feed.onAdd;
    onAdd(5);
    [feed.snapshot(1, 2), feed.later(), feed.size, feed.depth()];
  `,
  'methods with the same name in a class and the class in its static field': `
    class List {
      #render() { return 'list'; }
      static Item = class {
        #render() { return 'item'; }
        run() { return this.#render(); }
      };
      run() { return [this.#render(), new List.Item().run()]; }
    }
    new List().run();
  `,
  'arguments, new.target and this in a method': `
    class Probe {
      #probe(...rest) {
        return [arguments.length, rest, new.target === undefined, this instanceof Probe];
      }
      run() { return this.#probe(1, 2); }
    }
    new Probe().run();
  `,
};

/**
 * The fixtures with a method that stays a private method (see
 * hidePrivateMethods), which SWC then defines on each instance.
 */
const HIDE_KEPT_NATIVE = new Set([
  'other receivers and optional chains',
  'a method as a value',
  'a nested class that shadows a private name',
  'a subclass a method makes, which shadows a private name',
  'super in a private method',
  'a receiver that is not an instance',
  'a class factory made from its own class',
  'a mixin applied twice, whose constructor calls its own private method',
  'classes a factory makes without extends',
  'a static initializer before a method, which makes an instance',
  'a brand check that catches the TypeError',
  // `static #items = new Map()` comes before `#own`.
  'static private methods',
  'a named function called at once, then again by its name',
  'a named function called at once, which calls itself',
  'a class a named function called at once makes again, from its own class',
]);

/**
 * The variables a static block assigns that no `var` at the top level of
 * the code declares.
 */
const undeclared = (code: string): string[] => {
  const sourceFile = ts.createSourceFile(
    'a.js',
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const declared = new Set(
    sourceFile.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) =>
        statement.declarationList.declarations.map((declaration) =>
          declaration.name.getText(sourceFile),
        ),
      ),
  );
  return [...code.matchAll(/static \{ (__\w+) = \{/g)]
    .map((match) => match[1]!)
    .filter((name) => !declared.has(name));
};

/**
 * What running the code gives, or the error it throws, so a fixture that
 * throws can be compared too.
 */
const settle = async (code: string) => {
  try {
    return { value: await runInNewContext(code) };
  } catch (error) {
    return { error: String(error) };
  }
};

describe('hidePrivateMethods over ES2022 fixtures', () => {
  const fixtures = { ...FIXTURES, ...APP_FIXTURES };
  // Its private getter stays an own property, as SWC's lowering makes it;
  // the reflection fixture above checks methods.
  delete fixtures['reflection on an instance'];
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`matches native private methods: ${name}`, async () => {
      // As transformPrivateMethods runs it, splitting what stays private.
      const hidden = splitPrivateChains(hide(fixture), APP_FILE);
      expect(undeclared(hidden)).toEqual([]);
      // Strict, as a module is: assigning a variable nothing declared
      // throws, where a sloppy script would make it a global.
      const main = `"use strict";\n${compile(hidden, LAYERS.MAIN_THREAD)}`;
      expect(PER_INSTANCE_PRIVATE_METHOD.test(main)).toBe(
        HIDE_KEPT_NATIVE.has(name),
      );
      expect(await settle(main)).toEqual(await settle(fixture));
    });
  }

  it('leaves the prototype as it was, where renamed methods would show', () => {
    const fixture =
      APP_FIXTURES[
        "reflection on the prototype, as auto-binding and Angular's component IDs do"
      ]!;
    const expected = runInNewContext(fixture);
    const hidden = runInNewContext(compile(hide(fixture), LAYERS.MAIN_THREAD));
    const renamed = runInNewContext(
      compile(rename(fixture), LAYERS.MAIN_THREAD),
    );
    // The component ID's input, the prototype's keys, and what auto-binding
    // made own properties.
    expect(hidden[0]).toEqual(expected[0]);
    expect(renamed[0]).not.toEqual(expected[0]);
    expect(Object.keys(renamed[3]).length).toBeGreaterThan(
      Object.keys(expected[3]).length,
    );
  });

  it('runs a method called on the wrong `this`, where natively it throws', () => {
    // An unbound callback, which TypeScript rejects. Documented on
    // hidePrivateMethods.
    const fixture = `
      class A { #m() { return 'ran'; } f() { return this.#m(); } }
      let out;
      try { out = A.prototype.f.call({}); } catch (error) { out = error instanceof TypeError; }
      out;
    `;
    expect(runInNewContext(fixture)).toBe(true);
    expect(runInNewContext(compile(rename(fixture), LAYERS.MAIN_THREAD))).toBe(
      true,
    );
    expect(runInNewContext(compile(hide(fixture), LAYERS.MAIN_THREAD))).toBe(
      'ran',
    );
  });
});

describe('hidePrivateMethods', () => {
  /**
   * The variable the module gave `#name`, e.g. `__m_3f9a1c0`.
   */
  const variable = (code: string, name: string): string =>
    code.match(new RegExp(`__${name}_[0-9a-f]{6}\\d+`))![0];

  it('turns the method into a function its calls use with `this`', () => {
    const code =
      'class A { #m(a) { return a; } f() { return [this.#m(1), this.#m?.(2), this.#m()]; } }';
    const result = hide(code);
    const m = variable(result, 'm');
    expect(result).toBe(
      `class A { static { ${m} = { m(a) { return a; } }.m; } f() { return [${m}.call(this, 1), ${m}.call(this, 2), ${m}.call(this)]; } };var ${m};`,
    );
  });

  it('keeps async and generator markers, types and type parameters', () => {
    const result = hide(
      [
        'class A {',
        '  async #a(x: number): Promise<number> { return x; }',
        '  *#g<T>(t: T): Generator<T> { yield t; }',
        '  async *#ag() {}',
        "  f(): void { this.#a(1); this.#g<string>('x'); this.#ag(); }",
        '}',
      ].join('\n'),
    );
    const [a, g, ag] = ['a', 'g', 'ag'].map((name) => variable(result, name));
    expect(result).toContain(
      `static { ${a} = { async a(x: number): Promise<number> { return x; } }.a; }`,
    );
    expect(result).toContain(
      `static { ${g} = { *g<T>(t: T): Generator<T> { yield t; } }.g; }`,
    );
    expect(result).toContain(`static { ${ag} = { async *ag() {} }.ag; }`);
    expect(result).toContain(
      `${a}.call(this, 1); ${g}.call(this, 'x'); ${ag}.call(this);`,
    );
  });

  it('decides for each method, and gives each class its own variables', () => {
    const result = hide(
      'class A { #a() {} #b() {} f(o) { this.#a(); o.#b(); } static B = class { #a() {} g() { this.#a(); } }; }',
    );
    // A's `#a` and B's, each declared and called once, then listed at the end.
    const [outer, , inner, , ...listed] = result.match(/__a_[0-9a-f]{6}\d+/g)!;
    expect(outer).toMatch(/0$/);
    expect(inner).toMatch(/1$/);
    expect(listed).toEqual([outer, inner]);
    expect(result).toContain('#b() {}');
    expect(result).toContain('o.#b()');
    expect(result).toMatch(/\};var __a_\w+0, __a_\w+1;$/);
  });

  it('adds no line, declaring the variables after the last statement', () => {
    const code = [
      'class A {',
      '  #m() {',
      '    return 1;',
      '  }',
      '  f() {',
      '    return this.#m();',
      '  }',
      '}',
    ].join('\n');
    const result = hide(code);
    const lines = result.split('\n');
    expect(lines).toHaveLength(code.split('\n').length);
    expect(lines[1]).toMatch(/^ {2}static \{ __m_\w+ = \{ m\(\) \{$/);
    expect(lines[3]).toBe('  } }.m; }');
    expect(lines[5]).toMatch(/^ {4}return __m_\w+\.call\(this\);$/);
    expect(lines[7]).toMatch(/^\};var __m_\w+;$/);
    // A last statement written without its `;` still ends.
    expect(hide(`${code}\nexport default A`)).toMatch(
      /\nexport default A;var __m_\w+;$/,
    );
  });

  it.each([
    [
      'private fields and colors',
      "const c = '#fff'; class A { #f = 1; g() { return this.#f; } }",
    ],
    [
      'a getter and setter',
      'class A { get #x() { return 1; } set #x(v) {} f() { this.#x = this.#x; } }',
    ],
    [
      'a static private method',
      'class A { static #m() {} static f() { return A.#m(); } }',
    ],
    ['a method nothing calls', 'class A { #m() {} }'],
    ['a call on another object', 'class A { #m() {} f(o) { return o.#m(); } }'],
    [
      'a read without a call',
      'class A { #m() {} f() { return this.#m.bind(this); } }',
    ],
    ['an optional receiver', 'class A { #m() {} f() { return this?.#m(); } }'],
    ['a tagged template', 'class A { #m() {} f() { return this.#m`x`; } }'],
    ['a non-null assertion', 'class A { #m() {} f() { return this.#m!(); } }'],
    [
      'a function',
      'class A { #m() {} f() { return function () { return this.#m(); }; } }',
    ],
    [
      'an object literal method',
      'class A { #m() {} f() { return { g() { return this.#m(); } }; } }',
    ],
    ['a static method', 'class A { #m() {} static f() { return this.#m(); } }'],
    ['a static field', 'class A { #m() {} static f = () => this.#m(); }'],
    [
      'a static block',
      'class A { #m() {} static { try { this.#m(); } catch {} } }',
    ],
    ['a computed key', 'class A { #m() {} [this.#m()]() {} }'],
    [
      'a class inside, whose `this` it is',
      'class A { #m() {} f() { return class { g() { return this.#m(); } }; } }',
    ],
    [
      'a method passed as an argument',
      'class A { #m() {} f() { return g(this.#m); } }',
    ],
    [
      'a function declaration',
      'class A { #m() {} f() { function g() { return this.#m(); } return g; } }',
    ],
    [
      "an inner class's decorator",
      'class A { #m() {} f() { return class { @d(this.#m()) g() {} }; } }',
    ],
    [
      "an inner class's `extends`",
      'class A { #m() {} f() { return class extends (this.#m(), Object) {}; } }',
    ],
    ['a method without a body', 'class A { #m(): void; f() { this.#m(); } }'],
    [
      'a call across lines',
      'class A { #m() {} f() { return this\n  .#m(); } }',
    ],
    [
      'super',
      'class A extends B { #m() { return super.m(); } f() { return this.#m(); } }',
    ],
    [
      'super in an arrow function',
      'class A extends B { #m() { return () => super.m(); } f() { return this.#m(); } }',
    ],
    [
      'a static initializer that runs code before it',
      'class A { static a = make(); #m() {} f() { return this.#m(); } }',
    ],
    [
      'a static block before it',
      'class A { static {} #m() {} f() { return this.#m(); } }',
    ],
    ['a decorator', 'class A { @log #m() {} f() { return this.#m(); } }'],
    [
      'an overload',
      "class A { #m(a: string): void; #m(a: any) {} f() { this.#m('x'); } }",
    ],
    ['an optional method', 'class A { #m?() {} f() { this.#m(); } }'],
    [
      '`#name in object`',
      'class A { #m() {} f(o) { this.#m(); return #m in o; } }',
    ],
    [
      'a class made in a function',
      'const make = () => class { #m() {} f() { return this.#m(); } };',
    ],
    [
      'a class made in a loop',
      'for (const x of xs) list.push(class { #m() {} f() { return this.#m(); } });',
    ],
  ])('leaves %s as it is', (_, code) => {
    expect(hide(code)).toBe(code);
  });

  it.each([
    'static a = 1;',
    "static a = 'x';",
    'static a = `x`;',
    'static a = 1n;',
    'static a = /x/;',
    'static a = true;',
    'static a = false;',
    'static a = null;',
    'static a = () => new A();',
    'static a = function () { return new A(); };',
    'static a = (1);',
    'static a = 1 as number;',
    'static a = 1 satisfies number;',
    'static a = <number>1;',
    'static a = null!;',
    'static a;',
    'static f() { return new A(); }',
    'b = new A();',
  ])('turns a method after `%s` into a function', (member) => {
    const result = hide(
      `class A { ${member} #m() {} f() { return this.#m(); } }`,
    );
    expect(result).toContain(
      `static { ${variable(result, 'm')} = { m() {} }.m; }`,
    );
  });
});

describe('renamePrivateMethods', () => {
  it('renames the declaration and every reference, keeping `?.`', () => {
    const code = rename(
      'class A { #m() { return 1; } f(o) { return [this.#m(), o?.#m(), this.#m?.()]; } }',
    );
    const [name] = renamed(code, 'm');
    expect(renamed(code, 'm')).toHaveLength(1);
    expect(code).toBe(
      `class A { ${name}() { return 1; } f(o) { return [this.${name}(), o?.${name}(), this.${name}?.()]; } }`,
    );
  });

  it('gives a getter and setter one name, and keeps their keywords', () => {
    const code = rename(
      'class A { get #x() { return 1; } set #x(v) {} static f(a) { a.#x = a.#x; } }',
    );
    const [name] = renamed(code, 'x');
    expect(code).toBe(
      `class A { get ${name}() { return 1; } set ${name}(v) {} static f(a) { a.${name} = a.${name}; } }`,
    );
  });

  it('keeps async and generator markers', () => {
    const code = rename(
      'class A { async #a() {} *#g() {} async *#ag() {} f() { this.#a(); this.#g(); this.#ag(); } }',
    );
    expect(code).toMatch(/async __a_[0-9a-f]{6}0\(\)/);
    expect(code).toMatch(/\*__g_[0-9a-f]{6}0\(\)/);
    expect(code).toMatch(/async \*__ag_[0-9a-f]{6}0\(\)/);
  });

  it('keys an instance private field by a symbol', () => {
    const code = rename(
      'class A { #f = 1; g(o) { return this.#f + o?.#f + this\n  .#f; } }',
    );
    const [name] = renamed(code, 'f');
    expect(code).toBe(
      `var ${name} = Symbol("f"); class A { [${name}] = 1; g(o) { return this[${name}] + o?.[${name}] + this\n  [${name}]; } }`,
    );
  });

  it('declares the symbols after a hashbang', () => {
    const code = rename(
      '#!/usr/bin/env node\nclass A { #f = 1; g() { return this.#f; } }',
    );
    expect(code).toMatch(
      /^#!\/usr\/bin\/env node\nvar __f_[0-9a-f]{6}0 = Symbol\("f"\); class A/,
    );
  });

  it('renames a static private method and keys a static private field by a symbol', () => {
    // Each read of a static one went through SWC's brand check too.
    const code = rename(
      'class A { static #s() { return 1; } static #t = 2; static f() { return A.#s() + this.#t; } }',
    );
    const [s] = renamed(code, 's');
    const [t] = renamed(code, 't');
    expect(code).toBe(
      `var ${t} = Symbol("t"); class A { static ${s}() { return 1; } static [${t}] = 2;; static { Object.defineProperty(this, ${t}, { enumerable: false }); } static f() { return A.${s}() + this[${t}]; } }`,
    );
  });

  it('leaves private fields in a module that binds Symbol, and renames its methods', () => {
    const code = rename(
      'const Symbol = globalThis.Symbol; class A { #f = 1; static #t = 2; #m() { return this.#f + A.#t; } g() { return this.#m(); } }',
    );
    const [m] = renamed(code, 'm');
    expect(code).toBe(
      `const Symbol = globalThis.Symbol; class A { #f = 1; static #t = 2; ${m}() { return this.#f + A.#t; } g() { return this.${m}(); } }`,
    );
  });

  it('leaves a static field private in a module that binds Object', () => {
    for (const binding of [
      'class Object {}',
      'const Object = {};',
      'function f(Object) {}',
      "import { Thing as Object } from 'x';",
    ]) {
      const code = `${binding} class A { static #t = 2; static f() { return A.#t; } }`;
      expect(rename(code)).toBe(code);
    }
    // A property or method named Object binds nothing.
    expect(
      rename(
        'const o = { Object: 1 }; class A { Object() {} static #t = 2; static f() { return A.#t + o.Object; } }',
      ),
    ).toContain('defineProperty');
  });

  it('leaves auto-accessors and decorated fields alone', () => {
    const code =
      'class A { static accessor #s = 1; accessor #a = 3; @tracked #d = 4; g() { return A.#s + this.#a + this.#d; } }';
    expect(rename(code)).toBe(code);
  });

  it("leaves a field with a use it can't key", () => {
    const code = 'class A { #f = 1; g() { return this./* f */ #f; } }';
    expect(rename(code)).toBe(code);
  });

  it('gives each class its own names, numbered in source order', () => {
    const code = rename(
      'class A { #m() {} a() { this.#m(); } } class B extends A { #m() {} b() { this.#m(); } }',
    );
    const names = renamed(code, 'm');
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/0$/);
    expect(names[1]).toMatch(/1$/);
  });

  it('gives the same class different names in different files', () => {
    const code = 'class A { #m() {} a() { this.#m(); } }';
    const first = renamed(rename(code), 'm');
    expect(renamed(rename(code), 'm')).toEqual(first);
    expect(
      renamed(rename(code, '/app/node_modules/@blotch/other/index.mjs'), 'm'),
    ).not.toEqual(first);
  });

  it('leaves a class that checks `#name in object` as it is, and the classes around it', () => {
    const code = [
      'class Outer {',
      '  #o() {}',
      '  make() {',
      '    return class Branded {',
      '      #m() {}',
      '      static is(x) { return #m in x; }',
      '      run() { this.#m(); }',
      '    };',
      '  }',
      '  o() { this.#o(); }',
      '}',
      'class Other { #m() {} run() { this.#m(); } }',
    ].join('\n');
    const result = rename(code);
    expect(result).toBe(
      code.replace(/#m\(\) \{\} run\(\) \{ this\.#m\(\)/, (match) =>
        match.replaceAll('#m', renamed(result, 'm')[0]!),
      ),
    );
    expect(renamed(result, 'm')).toHaveLength(1);
    expect(renamed(result, 'o')).toEqual([]);
  });

  it.each([
    ['a function', 'function make(B) { return CLASS; }'],
    ['an arrow function', 'const make = (B) => CLASS;'],
    ['a method', 'const o = { make(B) { return CLASS; } };'],
    ['a function called later', 'const later = (() => () => CLASS)();'],
    ['a loop', 'for (const B of bases) list.push(CLASS);'],
    ['an instance field', 'class Holder { made = CLASS; }'],
    // Called at once, but its name can call it again.
    [
      'a named function called at once',
      'const C = (function make(B) { return CLASS; })(Base);',
    ],
    // As `arguments.callee` can, in sloppy code.
    [
      'a function called at once that uses `arguments`',
      'const C = (function () { const B = arguments[0]; return CLASS; })(Base);',
    ],
  ])(
    'keeps native private methods in a class with extends made more than once, in %s',
    (_, around) => {
      // Every class it makes would share one name, and one made from
      // another would override its base's method.
      const subclass =
        'class extends B { #m() { return 1; } run() { return this.#m(); } }';
      const kept = around.replace('CLASS', subclass);
      expect(rename(kept)).toBe(kept);
      // Without extends, it can't be made from another: renamed.
      const plain = around.replace(
        'CLASS',
        'class { #m() { return 1; } run() { return this.#m(); } }',
      );
      expect(renamed(rename(plain), 'm')).toHaveLength(1);
    },
  );

  it.each([
    ['the top level', 'const C = CLASS;'],
    ['a function called at once', 'const C = /*#__PURE__*/ (() => CLASS)();'],
    [
      'a function called at once, inside its parentheses',
      'const C = (function () { return CLASS; }());',
    ],
    ['a static field', 'class Holder { static made = CLASS; }'],
  ])(
    'renames the private methods of a class with extends made once, in %s',
    (_, around) => {
      const code = around.replace(
        'CLASS',
        'class extends Base { #m() { return 1; } run() { return this.#m(); } }',
      );
      expect(renamed(rename(code), 'm')).toHaveLength(1);
    },
  );

  // A syntax error, which SWC reports; the pass only mustn't trip on it.
  it('leaves a private name that no class declares', () => {
    const code = rename('class A { #m() {} f() { return this.#missing; } }');
    expect(code).toContain('this.#missing');
    expect(renamed(code, 'm')).toHaveLength(1);
  });

  it('returns the same string when nothing applies', () => {
    const plain = 'export const a = 1;';
    expect(rename(plain)).toBe(plain);
    const colors =
      "const c = '#fff'; class A { f = 1; m() { return this.f; } }";
    expect(rename(colors)).toBe(colors);
  });

  it('reads a .ts module as TypeScript', () => {
    const code = rename(
      'export class Page { #load<T>(value: T): T { return value; } run(): number { return this.#load<number>(1); } }',
      '/app/node_modules/@blotch/angular-lynx/src/page.ts',
    );
    const [name] = renamed(code, 'load');
    expect(code).toContain(`${name}<T>(value: T): T`);
    expect(code).toContain(`this.${name}<number>(1)`);
  });
});

describe('renamePrivateMethods and hidePrivateMethods with an inline source map', () => {
  const PREFIX =
    '//# sourceMappingURL=data:application/json;charset=utf-8;base64,';
  const withMap = (code: string, map: object, prefix = PREFIX): string =>
    `${code}\n${prefix}${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
  const mapOf = (code: string): { mappings: string } =>
    JSON.parse(
      Buffer.from(
        code.slice(code.lastIndexOf('base64,') + 7),
        'base64',
      ).toString(),
    );

  const DIGITS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  /**
   * A map's `mappings` as numbers: each line's segments, with their fields
   * counted from the start (the column from the line's, the others from the
   * file's) rather than from the segment before.
   */
  const decodeMappings = (mappings: string): number[][][] => {
    const totals = [0, 0, 0, 0, 0];
    return mappings.split(';').map((line) => {
      totals[0] = 0;
      if (line === '') return [];
      return line.split(',').map((segment) => {
        const fields: number[] = [];
        let value = 0;
        let shift = 0;
        for (const char of segment) {
          const digit = DIGITS.indexOf(char);
          value += (digit & 31) << shift;
          shift += 5;
          if (digit & 32) continue;
          const index = fields.length;
          totals[index]! += value & 1 ? -(value >> 1) : value >> 1;
          fields.push(totals[index]!);
          value = 0;
          shift = 0;
        }
        return fields;
      });
    });
  };

  /**
   * The other way round.
   */
  const encodeMappings = (lines: number[][][]): string => {
    const totals = [0, 0, 0, 0, 0];
    return lines
      .map((segments) => {
        totals[0] = 0;
        return segments
          .map((fields) =>
            fields
              .map((field, index) => {
                const delta = field - totals[index]!;
                totals[index] = field;
                let vlq = delta < 0 ? (-delta << 1) | 1 : delta << 1;
                let text = '';
                do {
                  const digit = vlq & 31;
                  vlq >>>= 5;
                  text += DIGITS[vlq ? digit | 32 : digit];
                } while (vlq);
                return text;
              })
              .join(''),
          )
          .join(',');
      })
      .join(';');
  };

  /**
   * `code` with the private names put back.
   */
  const withPrivateNames = (code: string): string =>
    code
      // A field's: `[__x_<key>0]` for `#x` in its declaration, and for `.#x`
      // in a use, whose `.` goes (see samePrivateNames).
      .replace(/\[__(\w+?)_[0-9a-f]{6}\d+\]/g, '#$1')
      // A method's.
      .replace(/__(\w+?)_[0-9a-f]{6}\d+/g, '#$1');

  /**
   * `code` with a field's `.#x` written `#x`, as withPrivateNames writes
   * both. A segment can start at the `.`, which the field's key replaces.
   */
  const samePrivateNames = (code: string): string => code.replace(/\.#/g, '#');

  it("keeps TypeScript's map pointing at the same code", () => {
    const source = [
      'export class Counter {',
      '  #count = 0;',
      '  #step(by: number): number { return (this.#count += by); }',
      '  get #double(): number { return this.#count * 2; }',
      '  next(): number { return this.#step(1) + this.#double; }',
      '}',
    ].join('\n');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        inlineSourceMap: true,
      },
      fileName: 'counter.ts',
    });
    const result = rename(outputText);
    expect(renamed(result, 'step')).toHaveLength(1);
    expect(renamed(result, 'double')).toHaveLength(1);

    const before = decodeMappings(mapOf(outputText).mappings);
    const after = decodeMappings(mapOf(result).mappings);
    const sourceFields = (lines: number[][][]) =>
      lines.map((segments) => segments.map((fields) => fields.slice(1)));
    // The same segments, pointing at the same places in counter.ts…
    expect(sourceFields(after)).toEqual(sourceFields(before));
    // …from the same code: with the names put back, the rest of the line
    // from each segment's new column is the rest of the old one.
    const inputLines = outputText.split('\n');
    const outputLines = result.split('\n');
    let moved = 0;
    before.forEach((segments, line) =>
      segments.forEach(([column], index) => {
        const shifted = after[line]![index]![0]!;
        if (shifted !== column) moved++;
        expect(
          samePrivateNames(withPrivateNames(outputLines[line]!.slice(shifted))),
        ).toBe(samePrivateNames(inputLines[line]!.slice(column)));
      }),
    );
    expect(moved).toBeGreaterThan(0);
  });

  // `#m` (2 characters) becomes `__m_<key>0` (11), so columns after each
  // `#m` on its line move 9 to the right.
  const LINE = 'class A { #m() { return this.#m; } }';
  const mapWith = (lines: number[][][]) => ({
    version: 3,
    sources: ['a.ts'],
    names: [],
    mappings: encodeMappings(lines),
  });
  const columnsOf = (code: string): number[][] =>
    decodeMappings(mapOf(code).mappings).map((segments) =>
      segments.map(([column]) => column!),
    );

  it('moves a column inside a renamed name to its start', () => {
    // Columns 0, 10 (`#m`), 11 (inside it), 12 (after it), 29 (the second
    // `#m`) and 31 (after it), and a line with no edits.
    const segments = [0, 10, 11, 12, 29, 31].map((column) => [
      column,
      0,
      0,
      column,
    ]);
    const result = rename(
      withMap(`${LINE}\nconst b = 1;`, mapWith([segments, [[6, 0, 1, 6]]])),
    );
    expect(columnsOf(result)).toEqual([[0, 10, 10, 21, 38, 49], [6]]);
    expect(result.endsWith('\n')).toBe(true);
  });

  it("reads TypeScript's inline map too, and a line with no segments", () => {
    const result = rename(
      withMap(
        LINE,
        mapWith([[], [[0, 0, 0, 0]]]),
        '//# sourceMappingURL=data:application/json;base64,',
      ),
    );
    expect(result).toContain('sourceMappingURL=data:application/json;base64,');
    expect(columnsOf(result)).toEqual([[], [0]]);
  });

  it('keeps segments in the order they came, even out of column order', () => {
    const result = rename(
      withMap(
        LINE,
        mapWith([
          [
            [31, 0, 0, 31],
            [10, 0, 0, 10],
          ],
        ]),
      ),
    );
    expect(columnsOf(result)).toEqual([[49, 10]]);
  });

  it("leaves a map it can't read", () => {
    const notJson = `${PREFIX}${Buffer.from('not json').toString('base64')}\n`;
    const result = rename(`${LINE}\n${notJson}`);
    expect(result.endsWith(notJson)).toBe(true);
    expect(result).not.toContain('#m');

    const sections = withMap(LINE, { version: 3, sections: [] });
    expect(rename(sections).slice(rename(sections).indexOf('//#'))).toBe(
      sections.slice(sections.indexOf('//#')),
    );

    // A character that isn't base64, and a value whose last digit says
    // another follows: neither may stop the build, nor keep it reading.
    for (const mappings of ['A!AA', 'g']) {
      const invalid = withMap(LINE, { version: 3, mappings });
      const renamedCode = rename(invalid);
      expect(renamedCode).not.toContain('#m');
      expect(mapOf(renamedCode).mappings).toBe(mappings);
    }
  });

  it('moves columns past the code hidePrivateMethods inserts and replaces', () => {
    const line = 'class A { #m() { return 1; } f() { return this.#m(); } }';
    const at = (text: string, from = 0) => line.indexOf(text, from);
    // `class`, the declaration's name, its `return`, `f`, the call's `this`,
    // its `#m` (inside the code the call's edit replaces) and its `)`.
    const columns = [
      0,
      at('#m'),
      at('return'),
      at('f()'),
      at('this'),
      at('#m', at('this')),
      at(');'),
    ];
    const result = hide(
      withMap(line, mapWith([columns.map((column) => [column, 0, 0, column])])),
    );
    const [output, map] = result.split('\n');
    const out = (text: string, from = 0) => output!.indexOf(text, from);
    const call = out('__m', out('return __m'));
    expect(columnsOf(result)).toEqual([
      [0, out('m() {'), out('return'), out('f()'), call, call, out(');')],
    ]);
    // After the class, on its line, and the map on the next.
    expect(output).toMatch(/\};var __m_\w+;$/);
    expect(map).toMatch(/^\/\/# sourceMappingURL=/);
  });

  it('moves columns past the parentheses splitPrivateChains inserts', () => {
    const line = 'class A { #a; #b() {} f() { return this.#a.#b(); } }';
    // `class`, the chain's `this`, and its `#b`.
    const columns = [0, line.indexOf('this'), line.indexOf('#b()')];
    const result = splitPrivateChains(
      withMap(line, mapWith([columns.map((column) => [column, 0, 0, column])])),
      APP_FILE,
    );
    const output = result.split('\n')[0]!;
    expect(output).toContain('return (0, this.#a).#b();');
    expect(columnsOf(result)).toEqual([
      [0, output.indexOf('this'), output.indexOf('#b()')],
    ]);
  });

  it('finds the map before the code the plugin appends after it', () => {
    // As addHotAccept() does in a development build.
    const hot = 'if (import.meta.webpackHot) {}';
    const line = 'class A { #m() { return this.#m(); } }';
    const column = line.indexOf('this');
    const code = `${withMap(line, mapWith([[[column, 0, 0, column]]]))}${hot}\n`;
    const result = hide(code);
    const lines = result.split('\n');
    expect(lines[1]).toMatch(/^\/\/# sourceMappingURL=/);
    // After the last statement, the appended code's.
    expect(lines.slice(2)).toEqual([
      expect.stringMatching(/^if .*\};var __m_\w+;$/),
      '',
    ]);
    const map = JSON.parse(
      Buffer.from(
        lines[1]!.slice(lines[1]!.indexOf(',') + 1),
        'base64',
      ).toString(),
    );
    // The call's segment moved past the static block's start.
    expect(map.mappings).not.toBe(mapWith([[[column, 0, 0, column]]]).mappings);
    expect(
      lines[0]!.slice(columnsOf(`${lines[0]}\n${lines[1]}`)[0]![0]!),
    ).toMatch(/^__m_\w+\.call\(this\)/);
  });

  it("doesn't take a map in a string or a block comment for the module's", () => {
    // The reviewer's case: no inline map, as in a production build, but a
    // template literal with a line that reads like one.
    // Built in pieces, so no line of this file reads as a map comment.
    const fake = `${'//'}# sourceMappingURL=data:application/json;base64,${Buffer.from(
      JSON.stringify({ version: 3, mappings: 'AAAA;AAAA;AAAA' }, null, 1),
    ).toString('base64')}`;
    const code = [
      `const snippet = \`x\n${fake}\`;`,
      `/*\n${fake}\n*/`,
      'class A { #m() { return snippet; } f() { return this.#m(); } }',
      'new A().f() === snippet;',
    ].join('\n');
    const hidden = hide(code);
    expect(hidden.split(fake)).toHaveLength(3);
    expect(hidden).toMatch(/\nnew A\(\)\.f\(\) === snippet;;var __m_\w+;$/);
    expect(
      runInNewContext(`"use strict";\n${compile(hidden, LAYERS.MAIN_THREAD)}`),
    ).toBe(true);
    // Nor does the rename re-encode it.
    expect(rename(code).split(fake)).toHaveLength(3);
  });
});

describe('isAngularLynxPackageModule', () => {
  it.each([
    '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
    '/app/node_modules/.pnpm/@blotch+angular-lynx@22.2.10/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
    'C:\\app\\node_modules\\@blotch\\angular-lynx\\fesm2022\\blotch-angular-lynx.mjs',
    '/app/node_modules/@blotch/rsbuild-plugin-angular-lynx/dist/polyfills.js',
  ])('matches an installed AngularLynx package: %s', (file) => {
    expect(isAngularLynxPackageModule(file, '/nowhere')).toBe(true);
  });

  it('matches the build output of a package next to this one', () => {
    expect(
      isAngularLynxPackageModule(
        '/repo/packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs',
        '/repo/packages',
      ),
    ).toBe(true);
    // By default, the folder this plugin's own package is in.
    const packages = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../..',
    );
    expect(
      isAngularLynxPackageModule(
        path.join(packages, 'runtime/dist/fesm2022/blotch-angular-lynx.mjs'),
      ),
    ).toBe(true);
  });

  it.each([
    '/app/src/app/app.ts',
    '/app/src/components/ui/button/button.ts',
    '/app/node_modules/rxjs/dist/esm/index.js',
    '/app/node_modules/@blotch/angular-lynx/node_modules/dep/index.js',
    '/repo/packages/ui/src/lib/components/button/button.ts',
    '/repo/packages/runtime/dist/node_modules/dep/index.js',
    '/repo/packages/dist/index.js',
    '/repo/dist/index.js',
    '/repo/examples/counter/src/app/app.ts',
  ])("doesn't match the app or other packages: %s", (file) => {
    expect(isAngularLynxPackageModule(file, '/repo/packages')).toBe(false);
  });
});

describe('isAppModule', () => {
  it.each([
    '/app/src/app/app.ts',
    '/app/src/components/ui/bottom-sheet/bottom-sheet.ts',
    '/app/src/legacy.mjs',
    'C:\\app\\src\\app\\app.ts',
    '/repo/examples/counter/src/app/app.ts',
    '/repo/packages/ui/src/lib/components/button/button.ts',
  ])("matches the app's own code: %s", (file) => {
    expect(isAppModule(file, '/repo/packages')).toBe(true);
  });

  it.each([
    '/app/node_modules/rxjs/dist/esm/index.js',
    '/app/node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm/index.js',
    '/app/node_modules/.cache/angular-lynx/entry.js',
    '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
    '/app/node_modules/@blotch/angular-lynx/node_modules/dep/index.js',
    '/repo/packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs',
  ])("doesn't match a package: %s", (file) => {
    expect(isAppModule(file, '/repo/packages')).toBe(false);
  });
});

/**
 * Chained private member reads (`a.#b.#c`), each run natively and after
 * splitPrivateChains and SWC with each thread's options. Every member stays
 * private, as it does in a class renamePrivateMethods leaves (one that checks
 * `#name in object`) or a method hidePrivateMethods can't turn into a
 * function, so SWC compiles them all.
 */
const CHAIN_FIXTURES: Record<string, string> = {
  'a method of a field, a field of a field, and the `this` a call gets': `
    class Node {
      #parent;
      #name;
      constructor(name, parent) { this.#name = name; this.#parent = parent; }
      #depth() { return this.#parent ? 1 + this.#parent.#depth() : 0; }
      #self() { return this; }
      read() {
        return [
          this.#depth(),
          this.#parent ? this.#parent.#name : null,
          this.#parent?.#parent?.#name ?? null,
          this.#parent ? this.#parent.#self() === this.#parent : null,
          this.#parent && (this.#parent).#name,
        ];
      }
    }
    const root = new Node('root');
    const child = new Node('child', root);
    const leaf = new Node('leaf', child);
    [root.read(), child.read(), leaf.read()];
  `,
  'writes through a chain': `
    class Box {
      #inner;
      #count = 0;
      constructor(inner) { this.#inner = inner; }
      bump() {
        this.#inner.#count = 5;
        this.#inner.#count += 2;
        this.#inner.#count++;
        [this.#inner.#count] = [this.#inner.#count * 2];
        ({ value: this.#inner.#count } = { value: this.#inner.#count + 1 });
        return this.#inner.#count;
      }
    }
    new Box(new Box()).bump();
  `,
  'three links, over lines and comments': `
    class Link {
      #next;
      #label;
      constructor(label, next) { this.#label = label; this.#next = next; }
      third() {
        return this.#next
          // the second
          .#next /* the third */ .#label;
      }
      #tag(strings) { return strings[0] + this.#label; }
      tagged() { return this.#next.#next.#tag\`t:\`; }
    }
    const list = new Link('a', new Link('b', new Link('c')));
    [list.third(), list.tagged()];
  `,
  'an optional chain before the chain': `
    class Maybe {
      #next;
      #label = 'm';
      constructor(next) { this.#next = next; }
      static read(maybe) { return maybe?.#next.#label; }
      static deep(maybe) { return maybe?.#next.#next.#label; }
    }
    const three = new Maybe(new Maybe(new Maybe()));
    [Maybe.read(undefined), Maybe.read(three), Maybe.deep(null), Maybe.deep(three)];
  `,
  'calls and links after a private member inside an optional chain': `
    class Node {
      #name;
      #next;
      #fn;
      constructor(name, next, fn) { this.#name = name; this.#next = next; this.#fn = fn; }
      #label(suffix) { return this === undefined ? 'no this' : this.#name + suffix; }
      #pair() { return [this.#name, this.#name.length]; }
      get #getter() { return this.#name; }
      static call(node) { return node?.#label('!'); }
      static optionalCall(node) { return node?.#label?.('?'); }
      static next(node) { return node?.#next.#label('>'); }
      static nextOptional(node) { return node?.#next?.#label('>>'); }
      static public(node) { return node?.box.#label('.'); }
      static calls(node, log) { return node?.#next.#label(log.push('arg')); }
      static then(node) { return node?.#pair()[1].toFixed(1); }
      static link(node) { return node?.#name.length; }
      static index(node) { return node?.#name[0]; }
      static getter(node) { return node?.#getter.length; }
      static fnIndex(node, key) { return node.#fn?.()[key]; }
      static fnLink(node) { return node.#fn?.().length; }
      static receivers(log) {
        const node = new Node('r');
        const get = () => { log.push('get'); return node; };
        return get()?.#label('#');
      }
      static nextLine(node) {
        return node
          ?.#next /* a comment */
          .#label(
            ',',
          );
      }
    }
    const leaf = new Node('leaf');
    const root = new Node('root', leaf, () => 'xy');
    root.box = leaf;
    const log = [];
    const out = [];
    for (const node of [root, leaf, null, undefined]) {
      out.push([Node.call(node), Node.optionalCall(node), Node.then(node), Node.link(node), Node.index(node), Node.getter(node)]);
    }
    for (const node of [root, null]) {
      out.push([Node.next(node), Node.nextOptional(node), Node.public(node), Node.calls(node, log), Node.nextLine(node)]);
    }
    out.push(Node.nextOptional(leaf), Node.fnIndex(root, 1), Node.fnIndex(leaf, 1), Node.fnLink(root), Node.fnLink(leaf));
    out.push(Node.receivers(log), Node.receivers(log), log);
    out;
  `,
  'a private getter that runs the call again, or assigns its receiver': `
    class Node {
      #name;
      constructor(name) { this.#name = name; }
      get #fn() {
        if (this.#name === 'a') {
          Node.reenter = Node.invoke(Node.other);
          current = Node.other;
        }
        return function () { return this.#name; };
      }
      static invoke(node) { return [node][0]?.#fn(); }
      static current() { return current?.#fn(); }
    }
    Node.other = new Node('b');
    let current = new Node('a');
    const first = new Node('a');
    [Node.invoke(first), Node.reenter, Node.current()];
  `,
  'a call in a default value, and in a field that ends with an arrow function': `
    let peer;
    class Node {
      #name;
      constructor(name) { this.#name = name; }
      get #fn() {
        if (this.#name === 'a') Node.reenter = Node.run(Node.other);
        return function () { return this.#name; };
      }
      static run(node, value = node?.#fn()) { return value; }
      label = peer?.#fn() ? () => 1 : () => peer?.#fn();
    }
    Node.other = new Node('b');
    const first = Node.run(new Node('a'));
    peer = new Node('p');
    const field = new Node('q').label;
    [first, Node.reenter, Node.run(null), field(), new Node('r').label()];
  `,
};

describe('splitPrivateChains', () => {
  const split = (code: string, file = APP_FILE) =>
    splitPrivateChains(code, file);

  it("leaves code SWC can't compile without it", () => {
    // What it's for: SWC lowers the outer read and leaves the inner one,
    // whose class no longer declares it.
    const fixture = CHAIN_FIXTURES['writes through a chain']!;
    for (const layer of [LAYERS.MAIN_THREAD, LAYERS.BACKGROUND]) {
      expect(() => runInNewContext(compile(fixture, layer))).toThrow(
        /Private field '#inner' must be declared in an enclosing class/,
      );
    }
  });

  it('leaves an optional chain SWC compiles wrong without it', async () => {
    // SWC ends the short-circuit at the private member, and calls a private
    // method there without its receiver.
    const fixture =
      CHAIN_FIXTURES[
        'calls and links after a private member inside an optional chain'
      ]!;
    for (const layer of [LAYERS.MAIN_THREAD, LAYERS.BACKGROUND]) {
      expect(await settle(compile(fixture, layer))).not.toEqual(
        await settle(fixture),
      );
    }
    const call = `
      class A { #m() { return this; } static f(a) { return a?.#m(); } }
      const a = new A();
      A.f(a) === a;
    `;
    expect(runInNewContext(call)).toBe(true);
    expect(runInNewContext(compile(call, LAYERS.MAIN_THREAD))).toBe(false);
  });

  for (const [name, fixture] of Object.entries(CHAIN_FIXTURES)) {
    it(`matches native private members: ${name}`, async () => {
      const expected = runInNewContext(fixture);
      const result = split(fixture);
      expect(result.split('\n')).toHaveLength(fixture.split('\n').length);
      for (const layer of [LAYERS.MAIN_THREAD, LAYERS.BACKGROUND]) {
        expect(runInNewContext(compile(result, layer))).toEqual(expected);
      }
    });
  }

  it('wraps the object in a comma expression, and nests them for longer chains', () => {
    expect(split('class A { #a; #b() {} f() { this.#a.#b(); } }')).toBe(
      'class A { #a; #b() {} f() { (0, this.#a).#b(); } }',
    );
    expect(split('class A { #a; f() { return (this.#a).#a.#a; } }')).toBe(
      'class A { #a; f() { return (0, (0, (this.#a)).#a).#a; } }',
    );
  });

  it('turns the next `.` of an optional chain into `?.`', () => {
    expect(split('class A { #a; f(x) { return x?.#a /* . */ .#a.#a; } }')).toBe(
      'class A { #a; f(x) { return x?.#a /* . */ ?.#a?.#a; } }',
    );
  });

  it('calls a private method in an optional chain through `call`, on its receiver', () => {
    expect(split('class A { #m() {} f(x) { return x?.#m(1); } }')).toBe(
      'class A { #m() {} f(x) { var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0, 1); } }',
    );
    expect(split('class A { #m() {} f(x) { return x?.#m?.(); } }')).toBe(
      'class A { #m() {} f(x) { var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0); } }',
    );
    // `this` can't change, so it's read again.
    expect(split('class A { #f; f(k) { return this.#f?.()[k]; } }')).toBe(
      'class A { #f; f(k) { return this.#f?.call(this)[k]; } }',
    );
    // A call written over lines keeps them.
    expect(
      split('class A { #m() {} f() { return this?.#m /* c */\n(\n1); } }'),
    ).toBe(
      'class A { #m() {} f() { return this?.#m?.call /* c */\n(this, \n1); } }',
    );
  });

  it('reads the receiver once, before the member, into a variable', () => {
    expect(split('class A { #m() {} f() { return g()?.a.#m(1); } }')).toBe(
      'class A { #m() {} f() { var __receiver0; return (__receiver0 = g()?.a)?.#m?.call(__receiver0, 1); } }',
    );
    expect(
      split('class A { #a; #m() {} f() { return this.#a.#a?.#m(); } }'),
    ).toBe(
      'class A { #a; #m() {} f() { var __receiver0; return (__receiver0 = (0, this.#a).#a)?.#m?.call(__receiver0); } }',
    );
    // `a?.#a.#m()` asks for the same `?` twice.
    expect(split('class A { #a; #m() {} f(a) { return a?.#a.#m(); } }')).toBe(
      'class A { #a; #m() {} f(a) { var __receiver0; return (__receiver0 = a?.#a)?.#m?.call(__receiver0); } }',
    );
    // A name the module already uses is passed over.
    expect(
      split(
        'const __receiver0 = 1; class A { #m() {} f(x) { return x?.#m(); } }',
      ),
    ).toBe(
      'const __receiver0 = 1; class A { #m() {} f(x) { var ___receiver0; return (___receiver0 = x)?.#m?.call(___receiver0); } }',
    );
  });

  it('declares the variable in the scope each run of the call has', () => {
    const call = (code: string) =>
      split(`class A { #m() {} ${code} }`).slice(
        'class A { #m() {} '.length,
        -2,
      );
    // After a function's directives, with or without their `;`.
    expect(call("f(x) { 'use strict'\n  return x?.#m(); }")).toBe(
      "f(x) { 'use strict'; var __receiver0;\n  return (__receiver0 = x)?.#m?.call(__receiver0); }",
    );
    expect(call("f(x) { 'use strict'\n'b'; return x?.#m(); }")).toBe(
      "f(x) { 'use strict'\n'b'; var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0); }",
    );
    // An arrow function's expression body, on the line it was on.
    expect(call('f() { return (x) =>\n  x?.#m(); }')).toBe(
      'f() { return (x) =>\n  { var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0) }; }',
    );
    // A field's initializer, run for each instance.
    expect(call('a = g()?.#m();')).toBe(
      'a = (() => { var __receiver0; return (__receiver0 = g())?.#m?.call(__receiver0) })();',
    );
    expect(call('static { g()?.#m(); }')).toBe(
      'static { var __receiver0; (__receiver0 = g())?.#m?.call(__receiver0); }',
    );
    // Two calls in one function share the declaration.
    expect(call('f(x, y) { return [x?.#m(), y?.#m()]; }')).toBe(
      'f(x, y) { var __receiver0, __receiver1; return [(__receiver0 = x)?.#m?.call(__receiver0), (__receiver1 = y)?.#m?.call(__receiver1)]; }',
    );
    // A default value can't see the function body's variables, and runs
    // once per call, as does a destructuring's.
    expect(call('f(x, y = x?.#m()) { return y; }')).toBe(
      'f(x, y = (() => { var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0) })()) { return y; }',
    );
    expect(call('f(x, { y = x?.#m() }) { return y; }')).toBe(
      'f(x, { y = (() => { var __receiver0; return (__receiver0 = x)?.#m?.call(__receiver0) })() }) { return y; }',
    );
    // Scopes that end at one place close from the inside out.
    expect(call('f = g()?.#m() ? 1 : () => h()?.#m();')).toBe(
      'f = (() => { var __receiver0; return (__receiver0 = g())?.#m?.call(__receiver0) ? 1 : () => { var __receiver1; return (__receiver1 = h())?.#m?.call(__receiver1) } })();',
    );
    // Outside any function, in a computed key, the module's top level runs
    // once.
    expect(split('class A { static #m() {} [g()?.#m()]() {} }')).toBe(
      'class A { static #m() {} [(__receiver0 = g())?.#m?.call(__receiver0)]() {} };var __receiver0;',
    );
  });

  it('gives the link after a private member in an optional chain its own `?.`', () => {
    expect(
      split('class A { #a; f(x) { return [x?.#a.b.c, x?.#a[0]]; } }'),
    ).toBe('class A { #a; f(x) { return [x?.#a?.b.c, x?.#a?.[0]]; } }');
    expect(
      split(
        'class A { #a?: A; f(x?: A) { return x?.#a!.#a; } }',
        '/app/src/app/a.ts',
      ),
    ).toBe('class A { #a?: A; f(x?: A) { return x?.#a!?.#a; } }');
  });

  it('reads through a non-null assertion in a .ts module', () => {
    expect(
      split(
        'class A { #a?: A; f(): A { return this.#a!.#a!; } }',
        '/app/src/app/a.ts',
      ),
    ).toBe('class A { #a?: A; f(): A { return (0, this.#a!).#a!; } }');
  });

  it('reads through `as` and `satisfies`, though a module has no other chain', () => {
    expect(
      split(
        'class A { #a!: A; f(): A { return (this.#a as A).#a; } }',
        '/app/src/app/a.ts',
      ),
    ).toBe('class A { #a!: A; f(): A { return (0, (this.#a as A)).#a; } }');
    expect(
      split(
        'class A { #a!: A; f(): A { return (this.#a satisfies A).#a; } }',
        '/app/src/app/a.ts',
      ),
    ).toBe(
      'class A { #a!: A; f(): A { return (0, (this.#a satisfies A)).#a; } }',
    );
  });

  it('finds a chain with comments between a `.` and its private name', () => {
    expect(
      split(
        'class A { #a = this; #b = 1; f() { return this./* c */#a.// d\n#b; } }',
      ),
    ).toBe(
      'class A { #a = this; #b = 1; f() { return (0, this./* c */#a).// d\n#b; } }',
    );
  });

  it('checks a run of slashes or comments after a private access in linear time', () => {
    // A hint that followed the chain's syntax took about a second for 36
    // slashes, and seven times longer for each four more.
    const slashes = `class A { #a; f() { return this.#a ${'/'.repeat(10_000)}\n.x; } }`;
    const comments = `class A { #a; f() { return this.#a ${'/* */'.repeat(10_000)}.x; } }`;
    // The same after the `.`, where the hint skips comments.
    const afterDot = `class A { #a; f() { return this.#a.${'/* */'.repeat(10_000)}x; } }`;
    const slashesAfterDot = `class A { #a; f() { return this.#a.${'/'.repeat(10_000)}\nx; } }`;
    const start = performance.now();
    expect(split(slashes)).toBe(slashes);
    expect(split(comments)).toBe(comments);
    expect(split(afterDot)).toBe(afterDot);
    expect(split(slashesAfterDot)).toBe(slashesAfterDot);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it('returns the same string when nothing applies', () => {
    for (const code of [
      'export const a = 1;',
      'class A { #a; #b; f() { return [this.#a?.#b, this.#a.x.#b, f(this.#a).#b, this.#a[0].#b]; } }',
      // A match for the hint that isn't a chain.
      "const s = 'x.#a.#b';",
    ]) {
      expect(split(code)).toBe(code);
    }
  });
});

describe('compilesPrivatesAsProperties', () => {
  it.each([
    ['/app/src/app/app.ts', true],
    ['/app/node_modules/@blotch/angular-lynx/fesm2022/index.mjs', true],
    ['/repo/packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs', true],
    ['/app/node_modules/rxjs/dist/esm/index.js', false],
  ])('%s: %s', (file, expected) => {
    expect(compilesPrivatesAsProperties(file, '/repo/packages')).toBe(expected);
  });
});

describe('transformPrivateMethods', () => {
  const code = 'class A { #m() {} a() { this.#m(); } }';
  const transform = (file: string) =>
    transformPrivateMethods(code, file, { root: ROOT }, '/repo/packages');

  it("renames an AngularLynx package's private methods", () => {
    expect(transform(FILE)).toBe(rename(code));
    expect(transform('/repo/packages/runtime/dist/fesm2022/x.mjs')).toMatch(
      /^class A \{ __m_\w+\(\) \{\}/,
    );
  });

  it("hides the app's own", () => {
    expect(transform('/app/src/app/app.ts')).toBe(
      hide(code, '/app/src/app/app.ts'),
    );
    expect(transform('/repo/examples/counter/src/app/app.ts')).toMatch(
      /^class A \{ static \{ __m_\w+ = \{ m\(\) \{\} \}\.m; \}/,
    );
  });

  it("leaves other packages' as they are", () => {
    expect(transform('/app/node_modules/dep/index.js')).toBe(code);
  });

  it('splits the chains each pass leaves private', () => {
    // `#a in other` keeps the package's class private (renamePrivateMethods),
    // and a call on another object keeps the app's method
    // (hidePrivateMethods).
    const chain =
      'class A { #a; #b() {} f(other) { return #a in other && this.#a.#b(); } }';
    const transformChain = (file: string) =>
      transformPrivateMethods(chain, file, { root: ROOT }, '/repo/packages');
    for (const file of [FILE, '/app/src/app/app.ts']) {
      expect(transformChain(file)).toContain('(0, this.#a).#b()');
    }
    expect(transformChain('/app/node_modules/dep/index.js')).toBe(chain);
  });
});

describe("over the runtime's build", () => {
  const require = createRequire(import.meta.url);

  /**
   * The runtime's FESM as the main thread compiles it: through Angular's
   * transformer (transformModule's JavaScript branch), optionally this pass
   * (otherwise only splitPrivateChains),
   * and SWC with the main thread's options. `LynxElement` isn't exported, so
   * an export is added for the test.
   */
  const compileRuntime = async (withPass: boolean) => {
    let fesm: string;
    try {
      fesm = require.resolve('@blotch/angular-lynx');
    } catch {
      throw new Error(
        "Build @blotch/angular-lynx first (turbo's ^build does, through this package's devDependency).",
      );
    }
    const transformer = new JavaScriptTransformer(
      {
        sourcemap: false,
        jit: false,
        advancedOptimizations: true,
        maxConcurrency: 1,
      },
      undefined as never,
    );
    try {
      const transformed = Buffer.from(
        await transformer.transformData(fesm, fs.readFileSync(fesm, 'utf8'), {
          skipLinker: false,
          sideEffects: () => Promise.resolve(false),
        }),
      ).toString();
      const code = `${transformed}\nexport { LynxElement as ɵLynxElement };\n`;
      return {
        fesm,
        main: compile(
          withPass
            ? transformPrivateMethods(code, fesm, { root: ROOT })
            : // As the background thread compiles it: without the pass, a
              // chained read (`this.#a.#b()`) still needs splitting.
              splitPrivateChains(code, fesm),
          LAYERS.MAIN_THREAD,
        ),
      };
    } finally {
      await transformer.close();
    }
  };

  /**
   * The constructor of `LynxElement` in the compiled code.
   */
  const lynxElementConstructor = (code: string): string => {
    const start = code.indexOf(
      'constructor(element){',
      code.indexOf('var LynxElement = '),
    );
    return code.slice(start, code.indexOf('\n    }\n', start));
  };

  /**
   * Runs the compiled module with fake Lynx globals and the real Angular
   * packages, and creates one `LynxElement`.
   */
  const createLynxElement = (fesm: string, main: string) => {
    const commonJs = experiments.swc.transformSync(main, {
      jsc: { target: 'es2022', parser: { syntax: 'ecmascript' } },
      module: { type: 'commonjs' },
    } as never).code;
    const requireFromRuntime = createRequire(fesm);
    // The runtime's dependencies aren't linked here, so Angular compiles their
    // partial declarations itself.
    requireFromRuntime('@angular/compiler');
    let nextId = 1;
    const globals = {
      __GetElementUniqueID: (ref: { id?: number }) => (ref.id ??= nextId++),
      __DEV__: false,
      __WEB__: false,
      __PROFILE__: false,
      __ENABLE_SSR__: false,
      __MAIN_THREAD__: true,
    };
    const saved = Object.getOwnPropertyDescriptors(globalThis);
    Object.assign(globalThis, globals);
    try {
      const module = {
        exports: {} as Record<string, new (ref: object) => object>,
      };
      new Function('require', 'module', 'exports', commonJs)(
        requireFromRuntime,
        module,
        module.exports,
      );
      return new module.exports['ɵLynxElement']!({});
    } finally {
      for (const name of Object.keys(globals)) {
        if (!(name in saved)) Reflect.deleteProperty(globalThis, name);
      }
    }
  };

  it('defines no private method or field on each LynxElement', async () => {
    const before = await compileRuntime(false);
    const after = await compileRuntime(true);

    const methodSites = (code: string) =>
      lynxElementConstructor(code).match(
        /defineProperty\(this, [\w$]+, \{\s*value:/g,
      )?.length ?? 0;
    const fieldSites = (code: string) =>
      lynxElementConstructor(code).match(
        /defineProperty\(this, [\w$]+, \{\s*writable:/g,
      )?.length ?? 0;
    // 41 private methods, each defined on every instance until now.
    expect(methodSites(before.main)).toBeGreaterThan(30);
    expect(methodSites(after.main)).toBe(0);
    // Its private fields are keyed by symbols, not each defined with a
    // descriptor.
    expect(fieldSites(before.main)).toBeGreaterThan(30);
    expect(fieldSites(after.main)).toBe(0);
    expect(after.main).not.toMatch(PER_INSTANCE_METHOD);

    const element = createLynxElement(before.fesm, before.main);
    const renamedElement = createLynxElement(after.fesm, after.main);
    expect(
      Object.getOwnPropertyNames(element).length -
        Object.getOwnPropertyNames(renamedElement).length,
    ).toBe(methodSites(before.main) + fieldSites(before.main));
    expect(Object.getOwnPropertySymbols(renamedElement)).toHaveLength(
      fieldSites(before.main),
    );
    expect(Object.keys(renamedElement)).toEqual(Object.keys(element));
  }, 60_000);

  it('reads no private member of the runtime through the brand check', async () => {
    // LynxElement's static ones (its registry of wrappers, the sets the end
    // of a cycle commits) are read for every element it makes and inserts.
    const before = await compileRuntime(false);
    const after = await compileRuntime(true);
    const brandChecks = (code: string) =>
      code.match(/_class_private_field_loose_base\(/g)?.length ?? 0;

    expect(brandChecks(before.main)).toBeGreaterThan(50);
    expect(brandChecks(after.main)).toBe(0);
  }, 60_000);
});
