import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Node has the built-ins Lynx's engines lack, and Vitest itself calls them, so
 * the natives can't be deleted from the test's own realm. Instead the tests
 * run the preEntry file, as the plain script it is, in a fresh `node:vm` realm
 * (its own Array, String and typed array prototypes) with the methods deleted
 * to look like PrimJS. Most tests then evaluate the same expression in that
 * realm and in one that keeps Node's natives, and expect the same result.
 * Node 24 lacks a few ES2026 methods; those are checked against known answers
 * and independent implementations instead.
 */
const source = readFileSync(
  new URL('./es-builtins.js', import.meta.url),
  'utf8',
);

/**
 * Every method the script defines, with the length the spec gives it. The
 * owner is an expression evaluated in the realm.
 */
const METHODS: [owner: string, name: string, length: number][] = [
  ['Array.prototype', 'at', 1],
  ['Array.prototype', 'findLast', 1],
  ['Array.prototype', 'findLastIndex', 1],
  ['Array.prototype', 'toReversed', 0],
  ['Array.prototype', 'toSorted', 1],
  ['Array.prototype', 'toSpliced', 2],
  ['Array.prototype', 'with', 2],
  ['Array', 'fromAsync', 1],
  ['Object.getPrototypeOf(Int8Array.prototype)', 'at', 1],
  ['Object.getPrototypeOf(Int8Array.prototype)', 'toReversed', 0],
  ['Object.getPrototypeOf(Int8Array.prototype)', 'toSorted', 1],
  ['Object.getPrototypeOf(Int8Array.prototype)', 'with', 2],
  ['String.prototype', 'at', 1],
  ['String.prototype', 'isWellFormed', 0],
  ['String.prototype', 'toWellFormed', 0],
  ['String.prototype', 'replaceAll', 2],
  ['Object', 'groupBy', 2],
  ['Object', 'hasOwn', 2],
  ['Map', 'groupBy', 2],
  ['Promise', 'allSettled', 1],
  ['Promise', 'any', 1],
  ['Promise', 'withResolvers', 0],
  ['Promise', 'try', 1],
  ['Set.prototype', 'union', 1],
  ['Set.prototype', 'intersection', 1],
  ['Set.prototype', 'difference', 1],
  ['Set.prototype', 'symmetricDifference', 1],
  ['Set.prototype', 'isSubsetOf', 1],
  ['Set.prototype', 'isSupersetOf', 1],
  ['Set.prototype', 'isDisjointFrom', 1],
  ['Iterator.prototype', 'map', 1],
  ['Iterator.prototype', 'filter', 1],
  ['Iterator.prototype', 'take', 1],
  ['Iterator.prototype', 'drop', 1],
  ['Iterator.prototype', 'flatMap', 1],
  ['Iterator.prototype', 'reduce', 1],
  ['Iterator.prototype', 'toArray', 0],
  ['Iterator.prototype', 'forEach', 1],
  ['Iterator.prototype', 'some', 1],
  ['Iterator.prototype', 'every', 1],
  ['Iterator.prototype', 'find', 1],
  ['Iterator', 'from', 1],
  ['Iterator', 'concat', 0],
  ['RegExp', 'escape', 1],
  ['Math', 'f16round', 1],
  ['Math', 'sumPrecise', 1],
  ['Error', 'isError', 1],
  ['Uint8Array', 'fromBase64', 1],
  ['Uint8Array', 'fromHex', 1],
  ['Uint8Array.prototype', 'toBase64', 0],
  ['Uint8Array.prototype', 'toHex', 0],
  ['Uint8Array.prototype', 'setFromBase64', 1],
  ['Uint8Array.prototype', 'setFromHex', 1],
  ['Map.prototype', 'getOrInsert', 2],
  ['Map.prototype', 'getOrInsertComputed', 2],
  ['WeakMap.prototype', 'getOrInsert', 2],
  ['WeakMap.prototype', 'getOrInsertComputed', 2],
];

/**
 * Deletes every method above, then the Iterator global and what it puts on
 * %IteratorPrototype%, as PrimJS lacks them.
 */
const REMOVE_NATIVES = `
  ${METHODS.map(([owner, name]) => `delete ${owner}.${name};`).join('\n')}
  {
    const IteratorPrototype = Object.getPrototypeOf(
      Object.getPrototypeOf([][Symbol.iterator]()),
    );
    delete IteratorPrototype.constructor;
    delete IteratorPrototype[Symbol.toStringTag];
    delete globalThis.Iterator;
  }
`;

/**
 * Describes a value as a string inside its own realm, so two realms' results
 * compare without crossing realms: -0, holes, Maps, Sets, typed arrays,
 * symbol keys and null prototypes all show, and an error is its name.
 */
const DESCRIBE = `
  const describeValue = (value) => {
    if (value === undefined) return 'undefined';
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
    if (typeof value === 'bigint') return value + 'n';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return 'function ' + value.name;
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (value instanceof Error) return 'error ' + value.name;
    if (Array.isArray(value)) {
      const items = [];
      for (let index = 0; index < value.length; index++) {
        items.push(index in value ? describeValue(value[index]) : 'hole');
      }
      return '[' + items.join(',') + ']';
    }
    if (value instanceof Map) {
      return 'Map{' + [...value].map(([k, v]) => describeValue(k) + '=>' + describeValue(v)).join(',') + '}';
    }
    if (value instanceof Set) return 'Set{' + [...value].map(describeValue).join(',') + '}';
    if (ArrayBuffer.isView(value)) {
      return value.constructor.name + '[' + Array.from(value, describeValue).join(',') + ']';
    }
    const prefix = Object.getPrototypeOf(value) === null ? 'null-proto' : '';
    return prefix + '{' + Reflect.ownKeys(value)
      .map((key) => String(key) + ':' + describeValue(value[key]))
      .join(',') + '}';
  };
  globalThis.describeResult = (run) => {
    try {
      return describeValue(run());
    } catch (error) {
      return 'throws ' + error.name;
    }
  };
  globalThis.describeAsyncResult = async (run) => {
    try {
      return describeValue(await run());
    } catch (error) {
      return 'throws ' + error.name;
    }
  };
`;

let realm: Context;
const run = (code: string): unknown => runInContext(code, realm);

/**
 * A realm without the methods, then with the script's versions.
 */
const polyfilledRealm = (): Context => {
  const context = createContext({});
  runInContext(REMOVE_NATIVES, context);
  runInContext(source, context);
  runInContext(DESCRIBE, context);
  return context;
};
const nativeRealm = (): Context => {
  const context = createContext({});
  runInContext(DESCRIBE, context);
  return context;
};

describe('ES2021–ES2026 built-in polyfills', () => {
  let polyfilled: Context;
  let native: Context;
  beforeAll(() => {
    polyfilled = polyfilledRealm();
    native = nativeRealm();
  });
  /**
   * The expression's result in the polyfilled realm and in Node's.
   */
  const compare = (expression: string) => ({
    polyfilled: runInContext(
      `describeResult(() => (${expression}))`,
      polyfilled,
    ),
    native: runInContext(`describeResult(() => (${expression}))`, native),
  });
  const expectSameAsNative = (expressions: string[]) => {
    for (const expression of expressions) {
      const { polyfilled: actual, native: expected } = compare(expression);
      expect(actual, expression).toBe(expected);
    }
  };
  const expectSameAsNativeAsync = async (expressions: string[]) => {
    for (const expression of expressions) {
      const code = `describeAsyncResult(async () => (${expression}))`;
      const actual = await runInContext(code, polyfilled);
      const expected = await runInContext(code, native);
      expect(actual, expression).toBe(expected);
    }
  };

  it('tests in a realm that lacks every method, as PrimJS does', () => {
    realm = createContext({});
    run(REMOVE_NATIVES);
    const IteratorPrototype = `Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))`;
    expect(
      run(`[
        ${METHODS.map(([owner, name]) => `${owner.replace('Iterator.prototype', IteratorPrototype).replace(/^Iterator$/, 'globalThis.Iterator')}?.${name}`).join()},
        globalThis.Iterator,
      ].filter((method) => method !== undefined).length`),
    ).toBe(0);
  });

  it('defines every method non-enumerable, with the spec name and length, and not as a constructor', () => {
    for (const [owner, name, length] of METHODS) {
      const description = runInContext(
        `(() => {
          const descriptor = Object.getOwnPropertyDescriptor(${owner}, '${name}');
          const fn = descriptor.value;
          let constructor = true;
          try {
            Reflect.construct(String, [], fn);
          } catch {
            constructor = false;
          }
          return [typeof fn, descriptor.enumerable, descriptor.writable, descriptor.configurable, fn.name, fn.length, constructor].join();
        })()`,
        polyfilled,
      );
      expect(description, `${owner}.${name}`).toBe(
        ['function', false, true, true, name, length, false].join(),
      );
    }
  });

  it('agrees with Node on the lengths of the methods Node has', () => {
    for (const [owner, name, length] of METHODS) {
      const nativeLength = runInContext(
        `(() => { try { return ${owner}.${name}.length; } catch { return undefined; } })()`,
        native,
      );
      if (nativeLength !== undefined) {
        expect(nativeLength, `${owner}.${name}`).toBe(length);
      }
    }
  });

  it("keeps every method the engine already has, so a browser's stay", () => {
    realm = createContext({});
    const before = run(
      `[${METHODS.map(([owner, name]) => `${owner}?.${name}`).join()}]`,
    ) as unknown[];
    run(source);
    const after = run(
      `[${METHODS.map(([owner, name]) => `${owner}?.${name}`).join()}]`,
    ) as unknown[];
    before.forEach((method, index) => {
      if (method !== undefined) expect(after[index]).toBe(method);
    });
  });

  it('leaves an existing method alone', () => {
    realm = createContext({});
    run(`const own = () => 'own'; Array.prototype.at = own;`);
    run(source);
    expect(run(`Array.prototype.at === own`)).toBe(true);
  });

  describe('array methods', () => {
    it('finds from the end', () => {
      expectSameAsNative([
        `[1, 2, 3, 4, 5].findLast((v) => v % 2 === 0)`,
        `[1, 2, 3, 4, 5].findLastIndex((v) => v % 2 === 0)`,
        `[1, 3].findLast((v) => v % 2 === 0)`,
        `[1, 3].findLastIndex((v) => v % 2 === 0)`,
        `(() => {
          const values = [7];
          const context = {};
          const seen = [];
          function record(value, index, array) {
            seen.push(this === context, value, index, array === values);
            return false;
          }
          values.findLast(record, context);
          values.findLastIndex(record, context);
          return seen;
        })()`,
        `[].findLast(1)`,
        `[].findLastIndex()`,
        `Array.prototype.findLast.call({ length: 2, 0: 'a', 1: 'b' }, () => true)`,
      ]);
    });

    it('reads from either end with at()', () => {
      expectSameAsNative([
        `[10, 20, 30].at(0)`,
        `[10, 20, 30].at(-1)`,
        `[10, 20, 30].at(3)`,
        `[10, 20, 30].at(-4)`,
        `[10, 20, 30].at(1.9)`,
        `[10, 20, 30].at(-1.9)`,
        `[10, 20, 30].at(NaN)`,
        `[10, 20, 30].at()`,
        `[10, 20, 30].at(1n)`,
        `Array.prototype.at.call({ length: 2, 1: 'b' }, -1)`,
        `Array.prototype.at.call(null, 0)`,
      ]);
    });

    it('sorts, reverses, splices and replaces into a new array', () => {
      expectSameAsNative([
        `[3, 1, 2].toSorted()`,
        `[3, 1, 2].toSorted((a, b) => b - a)`,
        `[10, 9, 1].toSorted()`,
        `[, 1, undefined, 0].toSorted()`,
        `(() => { const a = [3, 1, 2]; a.toSorted(); a.toReversed(); a.toSpliced(0, 1); a.with(0, 9); return a; })()`,
        `[1, 2].toSorted('x')`,
        `[].toSorted(null)`,
        `Array.prototype.toSorted.call({ length: 2, 0: 'b', 1: 'a' })`,
        `Array.prototype.toSorted.call(null)`,
        `[1, , 3].toReversed()`,
        `Array.prototype.toReversed.call({ length: 3, 0: 'a', 2: 'c' })`,
        `Array.prototype.toReversed.call('ab')`,
        `[1, 2, 3, 4].toSpliced(1, 2, 'x', 'y', 'z')`,
        `[1, 2, 3].toSpliced()`,
        `[1, 2, 3].toSpliced(1)`,
        `[1, 2, 3].toSpliced(-1, 1)`,
        `[1, 2, 3].toSpliced(-10, 1)`,
        `[1, 2, 3].toSpliced(-Infinity, 1)`,
        `[1, 2, 3].toSpliced(1, -5, 'x')`,
        `[1, 2, 3].toSpliced(Infinity, 1, 'end')`,
        `[1, 2, 3].toSpliced(1.7, 1.9)`,
        `[1, 2, 3].toSpliced(undefined, undefined)`,
        `[1, , 3].toSpliced(0, 0)`,
        `Array.prototype.toSpliced.call({ length: 2 ** 53 - 1 }, 0, 0, 1)`,
        `[1, 2, 3].with(1, 'x')`,
        `[1, 2, 3].with(-1, 'x')`,
        `[1, 2, 3].with(3, 'x')`,
        `[1, 2, 3].with(-4, 'x')`,
        `[1, , 3].with(0, 0)`,
        `Array.prototype.with.call({ length: 2, 0: 'a' }, 1, 'b')`,
        `Array.prototype.toReversed.call({ length: 2 ** 32 })`,
      ]);
    });
  });

  describe('typed array methods', () => {
    it('copies into the same kind of typed array', () => {
      expectSameAsNative([
        `new Int8Array([3, 1, 2]).toSorted()`,
        `new Float64Array([1, 10, 2]).toSorted((a, b) => b - a)`,
        `new Uint8Array([1, 2, 3]).toReversed()`,
        `new Uint8Array([1, 2, 3]).with(0, 300)`,
        `new Uint8Array([1, 2, 3]).with(-1, 9)`,
        `new BigInt64Array([1n, 2n]).with(1, 5n)`,
        `new BigInt64Array([1n]).with(0, 1)`,
        `new Uint8Array(2).with(2, 0)`,
        `new Uint8Array(2).with(-3, 0)`,
        `new Float32Array([1.5, 2.5]).at(-1)`,
        `new Uint8Array([1]).toSorted('x')`,
        `(() => { class Bytes extends Uint8Array {} return new Bytes([2, 1]).toSorted().constructor.name; })()`,
        `(() => { class Bytes extends Uint8Array {} return new Bytes([2, 1]).toReversed().constructor.name; })()`,
        `Object.getPrototypeOf(Int8Array.prototype).toReversed.call([1, 2])`,
        `Object.getPrototypeOf(Int8Array.prototype).at.call([1, 2], 0)`,
        `(() => {
          const log = [];
          try {
            new Uint8Array(2).with(5, { valueOf() { log.push('converted'); return 1; } });
          } catch (error) {
            log.push(error.name);
          }
          return log;
        })()`,
      ]);
    });
  });

  describe('string methods', () => {
    it('reads characters from either end', () => {
      expectSameAsNative([
        `'abc'.at(-1)`,
        `'abc'.at(3)`,
        `'abc'.at(0.5)`,
        `String.prototype.at.call(123, -1)`,
        `String.prototype.at.call(undefined, 0)`,
      ]);
    });

    it('finds and replaces lone surrogates', () => {
      expectSameAsNative(
        String.raw`'ab\uD800'.isWellFormed()
          'ab\uD800c'.toWellFormed()
          '\uDC00\uD800'.toWellFormed()
          '\uD800𐀀'.toWellFormed()
          '😀'.isWellFormed()
          '😀'.toWellFormed()
          'plain'.isWellFormed()
          'plain'.toWellFormed()
          '\uDFFF'.isWellFormed()
          String.prototype.toWellFormed.call(12)
          String.prototype.isWellFormed.call(null)
          String.prototype.toWellFormed.call(Symbol())`.split('\n'),
      );
    });

    it('replaces every occurrence', () => {
      expectSameAsNative(
        String.raw`'a.b.a'.replaceAll('a', 'x')
          '1.2.3'.replaceAll('.', '-')
          'a(b)a(b)'.replaceAll('(b)', '')
          'a1b22c'.replaceAll(/\d+/g, '#')
          'aa'.replaceAll(/a/, 'b')
          'ab'.replaceAll('b', (m) => m.toUpperCase())
          'ab'.replaceAll('b', '[$&]')
          'ab'.replaceAll('', '-')
          String.prototype.replaceAll.call(null, 'a', 'b')`.split('\n'),
      );
    });
  });

  describe('grouping', () => {
    it('groups into a null-prototype object', () => {
      expectSameAsNative([
        `Object.groupBy([1, 2, 3, 4], (n) => (n % 2 ? 'odd' : 'even'))`,
        `Object.getPrototypeOf(Object.groupBy([], () => 'x'))`,
        `Object.groupBy('abc', (char, index) => index)`,
        `Object.groupBy([1], () => ({ toString: () => 'k' }))`,
        `Object.groupBy([1, 2], () => Symbol.iterator)`,
        `Object.groupBy([1], () => '__proto__')`,
        `Object.groupBy(null, () => 1)`,
        `Object.groupBy([1], 1)`,
        `Object.groupBy(new Set([1, 2]), (n) => n)`,
      ]);
    });

    it('groups into a Map, keyed by SameValueZero', () => {
      expectSameAsNative([
        `Map.groupBy([1, 2, 3], (n) => n > 1)`,
        `Map.groupBy([1, 2], () => -0)`,
        `Map.groupBy([1, 2], () => NaN)`,
        `(() => { const key = {}; return Map.groupBy([1, 2], () => key).get(key); })()`,
        `Map.groupBy(undefined, () => 1)`,
      ]);
    });

    it('closes the iterator when the callback throws', () => {
      expectSameAsNative(
        ['Object', 'Map'].map(
          (owner) => `(() => {
            const log = [];
            const items = {
              [Symbol.iterator]() {
                return {
                  next: () => ({ value: 1, done: false }),
                  return() { log.push('closed'); return {}; },
                };
              },
            };
            try {
              ${owner}.groupBy(items, () => { throw new RangeError('x'); });
            } catch (error) {
              log.push(error.name);
            }
            return log;
          })()`,
        ),
      );
    });
  });

  describe('Object.hasOwn', () => {
    it("checks the object's own properties", () => {
      expectSameAsNative([
        `Object.hasOwn({ a: 1 }, 'a')`,
        `Object.hasOwn(Object.create({ a: 1 }), 'a')`,
        `Object.hasOwn('abc', 'length')`,
        `Object.hasOwn([1], 0)`,
        `Object.hasOwn(null, 'a')`,
      ]);
    });
  });

  describe('promise statics', () => {
    it('settles like the natives', async () => {
      await expectSameAsNativeAsync([
        `Promise.allSettled([1, Promise.reject(2), Promise.resolve(3)])`,
        `Promise.any([Promise.reject(1), Promise.resolve(2), 3])`,
        `Promise.any([Promise.reject(1), Promise.reject(2)]).catch((error) => [error.constructor.name, error.errors, error.message])`,
        `Promise.any([]).catch((error) => [error.constructor.name, error.errors])`,
        `Promise.any(5)`,
        `Promise.any([new Promise(() => {}), Promise.resolve('fast')])`,
        `(async () => { const { promise, resolve } = Promise.withResolvers(); resolve(5); return [Object.keys(Promise.withResolvers()), await promise]; })()`,
        `(async () => { const { promise, reject } = Promise.withResolvers(); reject(new TypeError()); return promise; })()`,
        `Promise.withResolvers.call(5)`,
        `(async () => { class Sub extends Promise {} return Sub.withResolvers().promise instanceof Sub; })()`,
        `Promise.try(() => 1)`,
        `Promise.try(() => { throw new RangeError('x'); })`,
        `Promise.try((a, b) => a + b, 1, 2)`,
        `Promise.try(async () => 3)`,
        `Promise.try(1)`,
        `(() => { const log = []; Promise.try(() => log.push('called')); log.push('after'); return log; })()`,
      ]);
    });
  });

  describe('Array.fromAsync', () => {
    it('collects async and sync iterables and array-likes', async () => {
      await expectSameAsNativeAsync([
        `Array.fromAsync([1, Promise.resolve(2), 3])`,
        `Array.fromAsync({ length: 2, 0: 'a', 1: Promise.resolve('b') })`,
        `Array.fromAsync((async function* () { yield 1; yield 2; })())`,
        `Array.fromAsync('ab')`,
        `Array.fromAsync(new Set([1, 2]), async (value, index) => value * 10 + index)`,
        `Array.fromAsync([1], function (value) { return this.offset + value; }, { offset: 5 })`,
        `Array.fromAsync([1], 5)`,
        `Array.fromAsync(null)`,
        `Array.fromAsync(5)`,
        `Array.fromAsync([Promise.reject(new RangeError())])`,
        `(async () => {
          class Collection {
            constructor(...args) { this.args = args; }
          }
          const fromIterable = await Array.fromAsync.call(Collection, [1, 2]);
          const fromArrayLike = await Array.fromAsync.call(Collection, { length: 1, 0: 'x' });
          return [fromIterable.constructor.name, fromIterable.args, fromIterable.length, fromIterable[1],
            fromArrayLike.args, fromArrayLike.length, fromArrayLike[0]];
        })()`,
        `Array.fromAsync.call({}, [1])`,
        `Array.fromAsync.call(() => {}, { length: 1, 0: 'x' })`,
        `(async () => {
          const log = [];
          const items = {
            [Symbol.iterator]() {
              return {
                next: () => ({ value: 1, done: false }),
                return() { log.push('closed'); return {}; },
              };
            },
          };
          try {
            await Array.fromAsync(items, () => { throw new RangeError(); });
          } catch (error) {
            log.push(error.name);
          }
          return log;
        })()`,
        `(async () => {
          const log = [];
          const items = {
            [Symbol.asyncIterator]() {
              return {
                next: async () => ({ value: Promise.resolve('not awaited'), done: false }),
                return: async () => { log.push('closed'); return {}; },
              };
            },
          };
          try {
            await Array.fromAsync(items, (value) => { log.push(value instanceof Promise); throw new RangeError(); });
          } catch (error) {
            log.push(error.name);
          }
          return log;
        })()`,
        `(() => { const result = Array.fromAsync(null); result.catch(() => {}); return result instanceof Promise; })()`,
      ]);
    });

    it('closes a sync iterable once when one of its values rejects', async () => {
      // As the spec's async-from-sync iterator does since ES2025. Node 24
      // closes it twice, so this is checked on its own.
      realm = polyfilled;
      expect(
        await run(`describeAsyncResult(async () => {
          const log = [];
          const items = {
            [Symbol.iterator]() {
              return {
                next: () => ({ value: Promise.reject(new RangeError()), done: false }),
                return() { log.push('closed'); return {}; },
              };
            },
          };
          try {
            await Array.fromAsync(items);
          } catch (error) {
            log.push(error.name);
          }
          return log;
        })`),
      ).toBe('["closed","RangeError"]');
    });
  });

  describe('Set methods', () => {
    it('combines sets, reading the smaller one', () => {
      expectSameAsNative([
        `new Set([1, 2, 3]).union(new Set([3, 4]))`,
        `new Set([1, 2, 3]).intersection(new Set([2, 3, 4, 5]))`,
        `new Set([1, 2, 3, 4, 5]).intersection(new Set([5, 2]))`,
        `new Set([1, 2, 3]).difference(new Set([2, 3, 4, 5]))`,
        `new Set([1, 2, 3, 4, 5]).difference(new Set([5, 2]))`,
        `new Set([1, 2, 3]).symmetricDifference(new Set([3, 4]))`,
        `new Set([1, 2]).isSubsetOf(new Set([1, 2, 3]))`,
        `new Set([1, 4]).isSubsetOf(new Set([1, 2, 3]))`,
        `new Set([1, 2, 3]).isSubsetOf(new Set([1]))`,
        `new Set([1, 2, 3]).isSupersetOf(new Set([1, 2]))`,
        `new Set([1, 2, 3]).isSupersetOf(new Set([1, 4]))`,
        `new Set([1]).isSupersetOf(new Set([1, 2]))`,
        `new Set([1, 2]).isDisjointFrom(new Set([3, 4, 5]))`,
        `new Set([1, 2]).isDisjointFrom(new Set([2, 4, 5]))`,
        `new Set([1, 2, 3, 4]).isDisjointFrom(new Set([5]))`,
        `new Set([1, 2, 3, 4]).isDisjointFrom(new Set([4]))`,
        `(() => { const set = new Set([1]); return set.union(new Set()) !== set; })()`,
      ]);
    });

    it('accepts any set-like', () => {
      expectSameAsNative([
        `new Set([1, 2]).union(new Map([[3, 'x']]))`,
        `new Set([1, 2]).intersection({ size: 1, has: (v) => v === 2, keys: () => [2][Symbol.iterator]() })`,
        `new Set([1, 2, 3]).intersection({ size: 1, has: () => true, keys: () => [9, 2][Symbol.iterator]() })`,
        `[...new Set([1]).union({ size: 1, has: () => false, keys: () => [-0][Symbol.iterator]() })].map((v) => Object.is(v, -0))`,
        `new Set([1]).union({ size: '1', has() {}, keys: () => [][Symbol.iterator]() })`,
        `new Set([1]).union({ size: Infinity, has() {}, keys: () => [][Symbol.iterator]() })`,
      ]);
    });

    it("rejects what isn't set-like", () => {
      expectSameAsNative([
        `new Set().union([1])`,
        `new Set().union(null)`,
        `new Set().union({ size: -1, has() {}, keys() {} })`,
        `new Set().union({ size: NaN, has() {}, keys() {} })`,
        `new Set().union({ size: 1n, has() {}, keys() {} })`,
        `new Set().union({ size: 1, has: 1, keys() {} })`,
        `new Set().union({ size: 1, has() {}, keys: 1 })`,
        `new Set().union({ size: 1, has() {}, keys: () => 1 })`,
        `new Set().union({ size: 1, has() {}, keys: () => ({ next: () => 1 }) })`,
        `Set.prototype.union.call([], new Set())`,
        `Set.prototype.isSubsetOf.call(new Map(), new Set())`,
      ]);
    });

    it('reads the set-like in the spec order and closes its keys when done early', () => {
      expectSameAsNative([
        `(() => {
          const log = [];
          const other = {
            get size() { log.push('size'); return 1; },
            get has() { log.push('has'); return () => true; },
            get keys() { log.push('keys'); return () => [][Symbol.iterator](); },
          };
          new Set([1]).isSubsetOf(other);
          return log;
        })()`,
        `(() => {
          const log = [];
          const other = {
            size: 0,
            has() {},
            keys() {
              return {
                next: () => ({ value: 9, done: false }),
                return() { log.push('closed'); return {}; },
              };
            },
          };
          return [new Set([1]).isSupersetOf(other), log];
        })()`,
        `(() => {
          const log = [];
          const other = {
            size: 0,
            has() {},
            keys() {
              return {
                next: () => ({ value: 1, done: false }),
                return() { log.push('closed'); return {}; },
              };
            },
          };
          return [new Set([1, 2]).isDisjointFrom(other), log];
        })()`,
      ]);
    });
  });

  describe('iterator helpers', () => {
    it('maps, filters, takes, drops and flattens lazily', () => {
      expectSameAsNative([
        `[1, 2, 3].values().map((x, i) => x * 10 + i).toArray()`,
        `[1, 2, 3, 4].values().filter((x, i) => x % 2 || i === 3).toArray()`,
        `[1, 2, 3].values().take(2).toArray()`,
        `[1, 2, 3].values().take(0).toArray()`,
        `[1, 2, 3].values().take(Infinity).toArray()`,
        `[1, 2, 3].values().take(1.9).toArray()`,
        `[1, 2, 3].values().take(-0.5).toArray()`,
        `[1, 2, 3].values().take('2').toArray()`,
        `[1, 2, 3].values().take(-1)`,
        `[1, 2, 3].values().take(NaN)`,
        `[1, 2, 3].values().take(1n)`,
        `[1, 2, 3].values().drop(1).toArray()`,
        `[1, 2, 3].values().drop(5).toArray()`,
        `[1, 2, 3].values().drop(Infinity).toArray()`,
        `[1, 2, 3].values().drop(-1)`,
        `[1, 2].values().flatMap((x) => [x, x * 10]).toArray()`,
        `[1, 2].values().flatMap((x) => new Set([x]).values()).toArray()`,
        `[1, 2].values().flatMap((x) => ({ next: () => ({ done: true }) })).toArray()`,
        `[1].values().flatMap(() => 'ab').toArray()`,
        `[1].values().flatMap(() => 1).toArray()`,
        `(function* () { yield 1; yield 2; })().map((x) => x * 2).toArray()`,
        `new Map([['a', 1]]).entries().map(([key, value]) => key + value).toArray()`,
        `(() => { const log = []; const helper = [1, 2].values().map((x) => { log.push(x); return x; }); log.push('created'); helper.next(); return log; })()`,
        `[1].values().map((x) => x).next()`,
        `(() => { const helper = [1].values().map((x) => x); helper.next(); return [helper.next(), helper.next()]; })()`,
      ]);
    });

    it('reduces, collects and searches', () => {
      expectSameAsNative([
        `[1, 2, 3].values().reduce((a, b) => a + b)`,
        `[1, 2, 3].values().reduce((a, b) => a + b, 10)`,
        `['a', 'b', 'c'].values().reduce((acc, v, i) => acc + v + i)`,
        `['a', 'b'].values().reduce((acc, v, i) => acc + v + i, '')`,
        `[].values().reduce((a) => a)`,
        `[].values().reduce((a) => a, 'start')`,
        `[1].values().reduce(1)`,
        `(() => { const seen = []; ['a', 'b'].values().forEach((v, i) => seen.push(v + i)); return seen; })()`,
        `[1, 2].values().forEach(() => {})`,
        `[1, 2, 3].values().some((x) => x > 2)`,
        `[1, 2, 3].values().some((x) => x > 3)`,
        `[1, 2, 3].values().every((x, i) => x > i)`,
        `[1, 2, 3].values().every((x) => x < 3)`,
        `[1, 2, 3].values().find((x) => x > 1)`,
        `[1, 2, 3].values().find((x) => x > 3)`,
        `[1, 2, 3].values().find(1)`,
      ]);
    });

    it('closes the iterator it reads when stopped early', () => {
      const tracked = `const log = [];
        const source = {
          __proto__: Iterator.prototype,
          count: 0,
          next() { this.count++; return { value: this.count, done: false }; },
          return() { log.push('closed'); return {}; },
        };`;
      expectSameAsNative([
        `(() => { ${tracked} const helper = source.map((x) => x); helper.next(); helper.return(); helper.return(); return [log, helper.next()]; })()`,
        `(() => { ${tracked} const helper = source.filter(() => true); helper.return(); return [log, source.count]; })()`,
        `(() => { ${tracked} return [source.take(2).toArray(), log]; })()`,
        `(() => { ${tracked} try { source.map(() => { throw new RangeError(); }).next(); } catch (error) { log.push(error.name); } return log; })()`,
        `(() => { ${tracked} try { source.filter(() => { throw new RangeError(); }).next(); } catch (error) { log.push(error.name); } return log; })()`,
        `(() => { ${tracked} try { source.reduce(() => { throw new RangeError(); }, 0); } catch (error) { log.push(error.name); } return log; })()`,
        `(() => { ${tracked} try { source.forEach(() => { throw new RangeError(); }); } catch (error) { log.push(error.name); } return log; })()`,
        `(() => { ${tracked} return [source.some((x) => x === 2), source.every((x) => x < 4), source.find((x) => x > 4), log]; })()`,
        `(() => { ${tracked} try { source.some(() => { throw new RangeError(); }); } catch (error) { log.push(error.name); } return log; })()`,
        `(() => { ${tracked} for (const call of [() => source.map(1), () => source.take(-1), () => source.drop(NaN), () => source.some(), () => source.reduce(null)]) { try { call(); } catch (error) { log.push(error.name); } } return log; })()`,
        `(() => { ${tracked} source.drop(1).return(); return log; })()`,
      ]);
    });

    it('closes the inner iterator before the outer one in flatMap', () => {
      expectSameAsNative([
        `(() => {
          const log = [];
          const outer = {
            __proto__: Iterator.prototype,
            next: () => ({ value: 1, done: false }),
            return() { log.push('outer'); return {}; },
          };
          const helper = outer.flatMap(() => ({
            next: () => ({ value: 'inner value', done: false }),
            return() { log.push('inner'); return {}; },
          }));
          helper.next();
          helper.return();
          return log;
        })()`,
        `(() => {
          const log = [];
          const outer = {
            __proto__: Iterator.prototype,
            next: () => ({ value: 1, done: false }),
            return() { log.push('outer'); return {}; },
          };
          const helper = outer.flatMap(() => ({
            next: () => ({ value: 'inner value', done: false }),
            return() { throw new RangeError(); },
          }));
          helper.next();
          try { helper.return(); } catch (error) { log.push(error.name); }
          return log;
        })()`,
        `(() => {
          const log = [];
          const outer = {
            __proto__: Iterator.prototype,
            next: () => ({ value: 1, done: false }),
            return() { log.push('outer'); return {}; },
          };
          try { outer.flatMap(() => ({ next() { throw new RangeError(); } })).next(); } catch (error) { log.push(error.name); }
          try { outer.flatMap(() => 5).next(); } catch (error) { log.push(error.name); }
          return log;
        })()`,
      ]);
    });

    it('rejects bad receivers and results, and running twice at once', () => {
      expectSameAsNative([
        `Iterator.prototype.map.call(1, (x) => x)`,
        `Iterator.prototype.toArray.call(null)`,
        `Iterator.prototype.toArray.call({ next: () => 1 })`,
        `(() => { let helper; helper = [1].values().map(() => helper.next()); try { helper.next(); } catch (error) { return error.name; } })()`,
        `(() => { const helper = [1].values().map((x) => x); return Object.getPrototypeOf(helper).next.call({}); })()`,
        `(() => { const helper = [1].values().map((x) => x); return Object.getPrototypeOf(helper).return.call({}); })()`,
        `(() => {
          const source = { __proto__: Iterator.prototype, next: () => ({ done: false }), return: () => 1 };
          return source.take(0).next();
        })()`,
        `(() => {
          const source = { __proto__: Iterator.prototype, next: () => ({ done: false }), return: 5 };
          return source.take(0).next();
        })()`,
      ]);
    });

    it('defines the Iterator class and Iterator.from', () => {
      expectSameAsNative([
        `typeof Iterator`,
        `[Iterator.name, Iterator.length]`,
        `Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([].values()))`,
        `[].values() instanceof Iterator`,
        `(function* () {})() instanceof Iterator`,
        `Iterator.prototype.constructor === Iterator`,
        `Object.prototype.toString.call(Iterator.prototype)`,
        `Object.prototype.toString.call([].values().map((x) => x))`,
        `Object.prototype.toString.call(Iterator.from({ next() {} }))`,
        `new Iterator()`,
        `Iterator()`,
        `(() => {
          class Counter extends Iterator {
            constructor() { super(); this.n = 0; }
            next() { this.n++; return { value: this.n, done: this.n > 3 }; }
          }
          return new Counter().map((x) => x * 2).toArray();
        })()`,
        `Iterator.from({ next() { return { done: true }; } }).toArray()`,
        `Iterator.from({ i: 0, next() { this.i++; return { value: this.i, done: this.i > 2 }; } }).map((x) => x * 2).toArray()`,
        `Iterator.from('ab').toArray()`,
        `Iterator.from(new Set([1, 2])).toArray()`,
        `(() => { const it = [1].values(); return Iterator.from(it) === it; })()`,
        `Iterator.from(5)`,
        `Iterator.from(null)`,
        `Iterator.from({ [Symbol.iterator]: () => 5 })`,
        `Iterator.from({ next() {}, return() { return { value: 'r', done: true }; } }).return()`,
        `Iterator.from({ next() {} }).return()`,
        `(() => { const wrapper = Iterator.from({ next() {} }); return Object.getPrototypeOf(wrapper).next.call({}); })()`,
      ]);
    });
  });

  describe('RegExp.escape', () => {
    it('escapes everything that means something in a pattern', () => {
      expectSameAsNative(
        String.raw`RegExp.escape('foo')
          RegExp.escape('1.5')
          RegExp.escape('_a')
          RegExp.escape('a.b*c')
          RegExp.escape('(x)[y]{z}|^$\\/?+')
          RegExp.escape(',-=<>#&!%:;@~\'${'`'}"')
          RegExp.escape(' \t\n\v\f\r       　﻿')
          RegExp.escape('\ud800x\udfff')
          RegExp.escape('😀_éĀ')
          RegExp.escape('')
          RegExp.escape(5)
          new RegExp(RegExp.escape('a.b(c)')).test('a.b(c)')
          new RegExp(RegExp.escape('a.b')).test('axb')`.split('\n'),
      );
    });
  });

  describe('Math.f16round', () => {
    it('rounds to the nearest half-precision float, ties to even', () => {
      // Random doubles across the float16 range and past it, both signs,
      // from subnormal to overflow, plus the boundaries.
      let seed = 1;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const values = [
        0,
        -0,
        NaN,
        Infinity,
        -Infinity,
        1,
        1.5,
        65504,
        65519,
        65520,
        65536,
        -65520,
        2 ** -24,
        2 ** -25,
        2 ** -25 + 2 ** -40,
        3 * 2 ** -25,
        2 ** -14,
        2 ** -14 - 2 ** -25,
        1 + 2 ** -11,
        1 + 3 * 2 ** -11,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        0.1,
        1 / 3,
      ];
      for (let index = 0; index < 20000; index++) {
        const exponent = Math.floor(random() * 50) - 30;
        const value = (1 + random()) * 2 ** exponent;
        values.push(random() < 0.5 ? -value : value);
      }
      realm = polyfilled;
      realm.values = values;
      const actual = run(
        `values.map((value) => Math.f16round(value))`,
      ) as number[];
      const mismatches = values.filter(
        (value, index) => !Object.is(actual[index], Math.f16round(value)),
      );
      expect(mismatches).toEqual([]);
      expectSameAsNative([
        `Math.f16round('1.5')`,
        `Math.f16round()`,
        `Math.f16round(1n)`,
      ]);
    });
  });

  describe('Error.isError', () => {
    it('recognizes errors', () => {
      expectSameAsNative([
        `[new Error(), new TypeError(), new (class extends Error {})(), new AggregateError([])].map(Error.isError)`,
        `[{}, null, 'Error', Object.create(Error.prototype), { name: 'Error', message: '' }].map(Error.isError)`,
        `Error.isError()`,
      ]);
    });
  });
});

describe('ES2026 built-ins Node 24 lacks', () => {
  beforeEach(() => {
    realm = polyfilledRealm();
  });

  describe('Math.sumPrecise', () => {
    /**
     * A finite double as an exact integer count of 2^-1074, the smallest
     * subnormal.
     */
    const exact = (value: number): bigint => {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value);
      const bits = view.getBigUint64(0);
      const exponent = Number((bits >> 52n) & 0x7ffn);
      const mantissa = bits & 0xfffffffffffffn;
      const scaled =
        exponent === 0
          ? mantissa
          : (mantissa | (1n << 52n)) << BigInt(exponent - 1);
      return bits >> 63n === 1n ? -scaled : scaled;
    };
    /**
     * The double nearest a count of 2^-1074, ties to even: rounding to 53
     * significant bits first makes the final multiplication exact.
     */
    const nearest = (sum: bigint): number => {
      if (sum === 0n) return 0;
      let magnitude = sum < 0n ? -sum : sum;
      const shift = Math.max(magnitude.toString(2).length - 53, 0);
      if (shift > 0) {
        const kept = magnitude >> BigInt(shift);
        const remainder = magnitude - (kept << BigInt(shift));
        const half = 1n << BigInt(shift - 1);
        magnitude =
          remainder > half || (remainder === half && (kept & 1n) === 1n)
            ? kept + 1n
            : kept;
      }
      const value = Number(magnitude) * 2 ** (shift - 1074);
      return sum < 0n ? -value : value;
    };
    /**
     * The spec's result, computed exactly with BigInts.
     */
    const expected = (values: number[]): number => {
      let special = 0;
      for (const value of values) {
        if (Number.isNaN(value)) special = NaN;
        else if (!Number.isFinite(value)) {
          special = special === -value ? NaN : special || value;
        }
      }
      if (special !== 0) return special;
      if (values.every((value) => Object.is(value, -0))) return -0;
      return nearest(values.reduce((sum, value) => sum + exact(value), 0n));
    };
    const sumPrecise = (values: number[]): number => {
      realm.values = values;
      return run(`Math.sumPrecise(values)`) as number;
    };

    it('sums exactly and rounds once', () => {
      const MAX = Number.MAX_VALUE;
      const cases = [
        [],
        [-0],
        [-0, -0],
        [-0, 0],
        [0],
        [1, -1],
        [0.1, 0.2],
        [1e20, 0.1, -1e20],
        [1, 1e100, 1, -1e100],
        [2 ** 53, 1, 1],
        [2 ** 53, -0.5, 1.5],
        [MAX, MAX, -MAX],
        [MAX, MAX],
        [-MAX, -MAX],
        [MAX, MAX, -MAX, -MAX],
        [MAX, 2 ** 970],
        [MAX, 2 ** 970, -Number.MIN_VALUE],
        [-MAX, -(2 ** 970)],
        [-MAX, -(2 ** 970), Number.MIN_VALUE],
        [MAX, 2 ** 970, 2 ** 970, -(2 ** 971)],
        [2 ** 1023, 2 ** 1023, -(2 ** 1023), -(2 ** 1023), 1],
        [MAX, MAX, MAX, -MAX, -MAX],
        [Number.MIN_VALUE, Number.MIN_VALUE],
        [Number.MIN_VALUE, -0],
        [1, Infinity],
        [-Infinity, 1],
        [Infinity, -Infinity],
        [Infinity, Infinity],
        [NaN, 1],
        [Infinity, NaN],
      ];
      for (const values of cases) {
        expect(
          Object.is(sumPrecise(values), expected(values)),
          `${values.join(', ')} → ${sumPrecise(values)}, not ${expected(values)}`,
        ).toBe(true);
      }
    });

    it('matches an exact BigInt sum on random input', () => {
      let seed = 7;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const bases = [-1074, -1000, -30, 0, 50, 500, 1000, 1023];
      for (let test = 0; test < 3000; test++) {
        const base = bases[Math.floor(random() * bases.length)];
        const values: number[] = [];
        const count = 1 + Math.floor(random() * 12);
        for (let index = 0; index < count; index++) {
          const exponent = Math.min(
            1023,
            Math.max(-1074, base - Math.floor(random() * 60)),
          );
          let value = (1 + random()) * 2 ** exponent;
          if (random() < 0.5) value = -value;
          values.push(value);
          // Exact cancellation, which naive summation gets wrong.
          if (random() < 0.3) values.push(-value);
        }
        const actual = sumPrecise(values);
        expect(
          Object.is(actual, expected(values)),
          `${values.join(', ')} → ${actual}, not ${expected(values)}`,
        ).toBe(true);
      }
    });

    it('accepts only an iterable of numbers, closing it otherwise', () => {
      expect(run(`Math.sumPrecise(new Set([1, 2]))`)).toBe(3);
      for (const call of [
        `Math.sumPrecise()`,
        `Math.sumPrecise(null)`,
        `Math.sumPrecise(5)`,
        `Math.sumPrecise([1, '2'])`,
        `Math.sumPrecise([NaN, '2'])`,
        `Math.sumPrecise([1n])`,
        `Math.sumPrecise([new Number(1)])`,
      ]) {
        expect(run(`describeResult(() => ${call})`), call).toBe(
          'throws TypeError',
        );
      }
      expect(
        run(`(() => {
          const log = [];
          const items = {
            [Symbol.iterator]() {
              return {
                next: () => ({ value: 'x', done: false }),
                return() { log.push('closed'); return {}; },
              };
            },
          };
          try { Math.sumPrecise(items); } catch (error) { log.push(error.name); }
          return log.join();
        })()`),
      ).toBe('closed,TypeError');
    });
  });

  describe('Uint8Array base64 and hex', () => {
    const bytesOf = (value: unknown) => Array.from(value as Uint8Array);

    it('encodes the RFC 4648 test vectors', () => {
      // The base64 of each prefix of "foobar", from the empty string up.
      const vectors = [
        '',
        'Zg==',
        'Zm8=',
        'Zm9v',
        'Zm9vYg==',
        'Zm9vYmE=',
        'Zm9vYmFy',
      ];
      for (const [length, base64] of vectors.entries()) {
        const text = 'foobar'.slice(0, length);
        realm.bytes = [...Buffer.from(text)];
        expect(run(`new Uint8Array(bytes).toBase64()`)).toBe(base64);
        expect(bytesOf(run(`Uint8Array.fromBase64('${base64}')`))).toEqual([
          ...Buffer.from(text),
        ]);
      }
      expect(run(`new Uint8Array([102]).toBase64({ omitPadding: true })`)).toBe(
        'Zg',
      );
      expect(run(`new Uint8Array([251, 255]).toBase64()`)).toBe('+/8=');
      expect(
        run(`new Uint8Array([251, 255]).toBase64({ alphabet: 'base64url' })`),
      ).toBe('-_8=');
    });

    it('matches Buffer on random bytes', () => {
      let seed = 3;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let test = 0; test < 300; test++) {
        const bytes = Array.from({ length: Math.floor(random() * 40) }, () =>
          Math.floor(random() * 256),
        );
        const buffer = Buffer.from(bytes);
        realm.bytes = bytes;
        expect(run(`new Uint8Array(bytes).toBase64()`)).toBe(
          buffer.toString('base64'),
        );
        expect(
          run(
            `new Uint8Array(bytes).toBase64({ alphabet: 'base64url', omitPadding: true })`,
          ),
        ).toBe(buffer.toString('base64url'));
        expect(run(`new Uint8Array(bytes).toHex()`)).toBe(
          buffer.toString('hex'),
        );
        realm.encoded = buffer.toString('base64');
        expect(bytesOf(run(`Uint8Array.fromBase64(encoded)`))).toEqual(bytes);
        realm.encoded = buffer.toString('base64url');
        expect(
          bytesOf(
            run(`Uint8Array.fromBase64(encoded, { alphabet: 'base64url' })`),
          ),
        ).toEqual(bytes);
        realm.encoded = buffer.toString('hex').toUpperCase();
        expect(bytesOf(run(`Uint8Array.fromHex(encoded)`))).toEqual(bytes);
      }
    });

    it('decodes by the last chunk handling', () => {
      const decode = (expression: string) =>
        run(
          `describeResult(() => Array.from(Uint8Array.fromBase64(${expression})))`,
        );
      expect(decode(`'Zm9v YmE=\\n'`)).toBe('[102,111,111,98,97]');
      expect(decode(`' Z g = = '`)).toBe('[102]');
      expect(decode(`'Zg'`)).toBe('[102]');
      expect(decode(`'Zm8'`)).toBe('[102,111]');
      expect(decode(`'Zh=='`)).toBe('[102]');
      expect(decode(`'Zg', { lastChunkHandling: 'strict' }`)).toBe(
        'throws SyntaxError',
      );
      expect(decode(`'Zh==', { lastChunkHandling: 'strict' }`)).toBe(
        'throws SyntaxError',
      );
      expect(decode(`'Zm9=', { lastChunkHandling: 'strict' }`)).toBe(
        'throws SyntaxError',
      );
      expect(decode(`'Zg==', { lastChunkHandling: 'strict' }`)).toBe('[102]');
      expect(
        decode(`'Zm9vYg', { lastChunkHandling: 'stop-before-partial' }`),
      ).toBe('[102,111,111]');
      expect(
        decode(`'Zm9vYg=', { lastChunkHandling: 'stop-before-partial' }`),
      ).toBe('[102,111,111]');
      expect(
        decode(`'Zm9vYg==', { lastChunkHandling: 'stop-before-partial' }`),
      ).toBe('[102,111,111,98]');
      for (const invalid of [
        `'Z'`,
        `'Zg='`,
        `'Zm9v='`,
        `'Zg==x'`,
        `'Zg===' `,
        `'Zm9vY='`,
        `'Zm!v'`,
        `'Zm9v\\u00a0'`,
        `'-_8=', { alphabet: 'base64' }`,
        `'+/8=', { alphabet: 'base64url' }`,
      ]) {
        expect(decode(invalid), invalid).toBe('throws SyntaxError');
      }
      for (const invalid of [
        `5`,
        `'Zg==', 5`,
        `'Zg==', { alphabet: 'hex' }`,
        `'Zg==', { alphabet: new String('base64') }`,
        `'Zg==', { lastChunkHandling: 'lenient' }`,
      ]) {
        expect(decode(invalid), invalid).toBe('throws TypeError');
      }
      expect(decode(`'-_8=', { alphabet: 'base64url' }`)).toBe('[251,255]');
      expect(decode(`'Zg==', null`)).toBe('throws TypeError');
      expect(decode(`'Zg==', {}`)).toBe('[102]');
    });

    it('decodes into an existing array, as much as fits', () => {
      const into = (length: number, call: string) =>
        run(`(() => {
          const target = new Uint8Array(${length});
          let result;
          try {
            result = target.${call};
          } catch (error) {
            result = error.name;
          }
          return JSON.stringify([result, Array.from(target)]);
        })()`);
      expect(into(8, `setFromBase64('Zm9vYmFy')`)).toBe(
        '[{"read":8,"written":6},[102,111,111,98,97,114,0,0]]',
      );
      expect(into(4, `setFromBase64('Zm9vYmFy')`)).toBe(
        '[{"read":4,"written":3},[102,111,111,0]]',
      );
      expect(into(5, `setFromBase64('Zm9vYmFy')`)).toBe(
        '[{"read":4,"written":3},[102,111,111,0,0]]',
      );
      expect(into(3, `setFromBase64('Zm9v YmFy')`)).toBe(
        '[{"read":4,"written":3},[102,111,111]]',
      );
      expect(into(0, `setFromBase64('Zm9v')`)).toBe(
        '[{"read":0,"written":0},[]]',
      );
      expect(into(8, `setFromBase64('Zm9v!!!!')`)).toBe(
        '["SyntaxError",[102,111,111,0,0,0,0,0]]',
      );
      expect(into(2, `setFromBase64('-_8', { alphabet: 'base64url' })`)).toBe(
        '[{"read":3,"written":2},[251,255]]',
      );
      expect(into(1, `setFromHex('cafe')`)).toBe(
        '[{"read":2,"written":1},[202]]',
      );
      expect(into(4, `setFromHex('CAFE')`)).toBe(
        '[{"read":4,"written":2},[202,254,0,0]]',
      );
      expect(into(2, `setFromHex('caXX')`)).toBe('["SyntaxError",[202,0]]');
      expect(into(2, `setFromHex('caf')`)).toBe('["SyntaxError",[0,0]]');
      expect(into(2, `setFromHex(5)`)).toBe('["TypeError",[0,0]]');
      expect(into(2, `setFromBase64(5)`)).toBe('["TypeError",[0,0]]');
    });

    it('reads and writes hex', () => {
      expect(run(`new Uint8Array([0, 15, 255]).toHex()`)).toBe('000fff');
      expect(bytesOf(run(`Uint8Array.fromHex('cafeBABE')`))).toEqual([
        202, 254, 186, 190,
      ]);
      for (const invalid of [`'abc'`, `'zz'`, `'0x'`, `' 00'`]) {
        expect(
          run(`describeResult(() => Uint8Array.fromHex(${invalid}))`),
          invalid,
        ).toBe('throws SyntaxError');
      }
      expect(run(`describeResult(() => Uint8Array.fromHex(5))`)).toBe(
        'throws TypeError',
      );
    });

    it('works only on a Uint8Array', () => {
      for (const call of [
        `Uint8Array.prototype.toHex.call(new Int8Array(1))`,
        `Uint8Array.prototype.toBase64.call([1])`,
        `Uint8Array.prototype.setFromHex.call(new Uint16Array(1), '00')`,
        `Uint8Array.prototype.setFromBase64.call({}, 'AA==')`,
        `new Uint8Array(1).toBase64(5)`,
        `new Uint8Array(1).toBase64({ alphabet: 'other' })`,
      ]) {
        expect(run(`describeResult(() => ${call})`), call).toBe(
          'throws TypeError',
        );
      }
      expect(
        run(
          `(() => { class Bytes extends Uint8Array {} return new Bytes([1]).toHex(); })()`,
        ),
      ).toBe('01');
    });
  });

  describe('Iterator.concat', () => {
    it('reads each iterable in turn, opening each only when it gets there', () => {
      expect(
        run(
          `describeResult(() => Iterator.concat([1, 2], new Set([3]), new Map([['k', 4]])).toArray())`,
        ),
      ).toBe('[1,2,3,["k",4]]');
      expect(run(`describeResult(() => Iterator.concat().toArray())`)).toBe(
        '[]',
      );
      expect(
        run(`(() => {
          const log = [];
          const iterable = (name, values) => ({
            [Symbol.iterator]() {
              log.push('open ' + name);
              return values[Symbol.iterator]();
            },
          });
          const concatenated = Iterator.concat(iterable('a', [1]), iterable('b', [2]));
          log.push('created');
          for (const value of concatenated) log.push(value);
          return log.join();
        })()`),
      ).toBe('created,open a,1,open b,2');
      expect(
        run(
          `Object.prototype.toString.call(Iterator.concat()) + (Iterator.concat() instanceof Iterator)`,
        ),
      ).toBe('[object Iterator Helper]true');
    });

    it('closes only the iterator it is reading', () => {
      expect(
        run(`(() => {
          const log = [];
          const iterable = (name) => ({
            [Symbol.iterator]: () => ({
              next: () => ({ value: name, done: false }),
              return() { log.push('close ' + name); return {}; },
            }),
          });
          const concatenated = Iterator.concat(iterable('a'), iterable('b'));
          concatenated.return();
          log.push('before start');
          const started = Iterator.concat(iterable('a'), iterable('b'));
          started.next();
          started.return();
          started.return();
          return log.join();
        })()`),
      ).toBe('before start,close a');
    });

    it('takes only iterable objects', () => {
      for (const call of [
        `Iterator.concat(1)`,
        `Iterator.concat('ab')`,
        `Iterator.concat({})`,
        `Iterator.concat([1], { [Symbol.iterator]: 5 })`,
        `Iterator.concat({ [Symbol.iterator]: () => 5 }).next()`,
      ]) {
        expect(run(`describeResult(() => ${call})`), call).toBe(
          'throws TypeError',
        );
      }
    });
  });

  describe('Map and WeakMap upsert', () => {
    it('gets or inserts a value', () => {
      expect(
        run(`describeResult(() => {
          const map = new Map([['a', 1]]);
          return [map.getOrInsert('a', 2), map.getOrInsert('b', 3), map];
        })`),
      ).toBe('[1,3,Map{"a"=>1,"b"=>3}]');
      expect(
        run(`describeResult(() => {
          const map = new Map();
          const calls = [];
          const compute = (key) => { calls.push(Object.is(key, -0)); return 'v'; };
          return [map.getOrInsertComputed(-0, compute), map.getOrInsertComputed(0, compute), calls, [...map.keys()].map((key) => Object.is(key, -0))];
        })`),
      ).toBe('["v","v",[false],[false]]');
      expect(
        run(`describeResult(() => {
          const map = new Map();
          return [map.getOrInsertComputed('k', () => { map.set('k', 'inner'); return 'outer'; }), map.get('k')];
        })`),
      ).toBe('["outer","outer"]');
    });

    it('requires a callback and a Map or WeakMap', () => {
      for (const call of [
        `new Map([['a', 1]]).getOrInsertComputed('a', 1)`,
        `Map.prototype.getOrInsert.call({}, 1, 1)`,
        `Map.prototype.getOrInsertComputed.call(new WeakMap(), {}, () => 1)`,
        `WeakMap.prototype.getOrInsert.call(new Map(), {}, 1)`,
        `new WeakMap().getOrInsert(1, 1)`,
        `new WeakMap().getOrInsert(Symbol.for('registered'), 1)`,
      ]) {
        expect(run(`describeResult(() => ${call})`), call).toBe(
          'throws TypeError',
        );
      }
    });

    it('accepts only keys a WeakMap can hold, before computing a value', () => {
      expect(
        run(`describeResult(() => {
          const map = new WeakMap();
          const key = {};
          return [map.getOrInsert(key, 1), map.getOrInsertComputed(key, () => 2), map.getOrInsertComputed({}, () => 3)];
        })`),
      ).toBe('[1,1,3]');
      expect(
        run(`(() => {
          let called = false;
          try {
            new WeakMap().getOrInsertComputed(1, () => { called = true; });
          } catch (error) {
            return error.name + ' ' + called;
          }
        })()`),
      ).toBe('TypeError false');
    });
  });
});

describe('Number.prototype.toLocaleString without Intl', () => {
  /**
   * PrimJS: no Intl, and toLocaleString is plain String(n).
   */
  const realmWithoutIntl = () => {
    realm = createContext({});
    run(
      `delete globalThis.Intl; Number.prototype.toLocaleString = function () { return String(this); };`,
    );
    run(source);
  };

  it('formats like en-US by default', () => {
    realmWithoutIntl();
    expect(run(`(1234567.891).toLocaleString()`)).toBe('1,234,567.891');
    expect(run(`(21.232271760105846).toLocaleString()`)).toBe('21.232');
    expect(run(`(-0.5).toLocaleString()`)).toBe('-0.5');
    expect(run(`(42).toLocaleString()`)).toBe('42');
  });

  it('shows a value that rounds to zero without a sign', () => {
    realmWithoutIntl();
    expect(run(`(-0.0001).toLocaleString()`)).toBe('0');
  });

  it('honors fraction digit and grouping options', () => {
    realmWithoutIntl();
    expect(
      run(`(1234.5).toLocaleString('en-US', { minimumFractionDigits: 2 })`),
    ).toBe('1,234.50');
    expect(
      run(`(1.23456).toLocaleString(undefined, { maximumFractionDigits: 1 })`),
    ).toBe('1.2');
    expect(
      run(`(1234.5).toLocaleString(undefined, { useGrouping: false })`),
    ).toBe('1234.5');
    // A maximum below the minimum is raised to it rather than throwing.
    expect(
      run(
        `(1.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 0 })`,
      ),
    ).toBe('1.50');
  });

  it('spells out NaN and infinities', () => {
    realmWithoutIntl();
    expect(run(`NaN.toLocaleString()`)).toBe('NaN');
    expect(run(`Infinity.toLocaleString()`)).toBe('∞');
    expect(run(`(-Infinity).toLocaleString()`)).toBe('-∞');
  });

  it("keeps the platform's when Intl exists", () => {
    realm = createContext({});
    run(source);
    // The realm has Node's Intl, so the native method stays.
    expect(run(`(1234.5).toLocaleString('de-DE')`)).toBe('1.234,5');
  });
});
