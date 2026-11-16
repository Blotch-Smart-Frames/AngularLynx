import { experiments } from '@rspack/core';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LAYERS, applyLayers } from './layers.js';
import {
  isAngularLynxPackageModule,
  renamePackagePrivateMethods,
  renamePrivateMethods,
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
    [Registry.add(1, 'a'), new Registry().own];
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
};

/**
 * The fixtures whose classes keep native private methods (see
 * renamePrivateMethods), which SWC then defines on each instance.
 */
const KEPT_NATIVE = new Set([
  'a subclass a method makes, which shadows a private name',
  'a class factory made from its own class',
  'a mixin applied twice, whose constructor calls its own private method',
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

  it('leaves private fields and static private methods alone', () => {
    const code =
      'class A { #f = 1; static #s() {} static #t = 2; g() { return this.#f + A.#t; } h() { A.#s(); } }';
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
      "const c = '#fff'; class A { #f = 1; m() { return this.#f; } }";
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

describe('renamePrivateMethods with an inline source map', () => {
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
    code.replace(/__(\w+?)_[0-9a-f]{6}\d+/g, '#$1');

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
        expect(withPrivateNames(outputLines[line]!.slice(shifted))).toBe(
          inputLines[line]!.slice(column),
        );
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

describe('renamePackagePrivateMethods', () => {
  const code = 'class A { #m() {} a() { this.#m(); } }';

  it("renames an AngularLynx package's private methods", () => {
    expect(renamePackagePrivateMethods(code, FILE, { root: ROOT })).not.toBe(
      code,
    );
  });

  it("leaves the app's own code as it is", () => {
    expect(
      renamePackagePrivateMethods(code, '/app/src/app/app.ts', { root: ROOT }),
    ).toBe(code);
  });
});

describe("over the runtime's build", () => {
  const require = createRequire(import.meta.url);

  /**
   * The runtime's FESM as the main thread compiles it: through Angular's
   * transformer (transformModule's JavaScript branch), optionally this pass,
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
            ? renamePackagePrivateMethods(code, fesm, { root: ROOT })
            : code,
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

  it('defines no private method on each LynxElement', async () => {
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
    // The private fields stay properties (issue #237).
    expect(fieldSites(after.main)).toBe(fieldSites(before.main));
    expect(after.main).not.toMatch(PER_INSTANCE_METHOD);

    const element = createLynxElement(before.fesm, before.main);
    const renamedElement = createLynxElement(after.fesm, after.main);
    expect(
      Object.getOwnPropertyNames(element).length -
        Object.getOwnPropertyNames(renamedElement).length,
    ).toBe(methodSites(before.main));
    expect(Object.keys(renamedElement)).toEqual(Object.keys(element));
  }, 60_000);
});
