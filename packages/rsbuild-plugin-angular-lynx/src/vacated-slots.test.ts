import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Vitest itself calls pop(), shift() and splice(), so the tests run the
 * preEntry file, as the plain script it is, in a fresh `node:vm` realm, and
 * compare it with a realm that keeps Node's own methods.
 *
 * Node's engine collects what an array gave up, so no test here can see the
 * leak itself: that takes PrimJS, and the E2E tests' storage page checks it on
 * a device. What these can see is every write the methods make, through a
 * `Proxy`, and that the results are the engine's own.
 */
const source = readFileSync(
  new URL('./vacated-slots.js', import.meta.url),
  'utf8',
);

/**
 * Describes a value as a string inside its own realm, so two realms' results
 * compare without crossing realms: holes show, and an error is its name.
 */
const DESCRIBE = `
  const describeValue = (value) => {
    if (value === undefined) return 'undefined';
    if (value instanceof Error) return 'error ' + value.name;
    if (Array.isArray(value)) {
      const items = [];
      for (let index = 0; index < value.length; index++) {
        items.push(index in value ? describeValue(value[index]) : 'hole');
      }
      return '[' + items.join(',') + ']';
    }
    return JSON.stringify(value);
  };
  const attempt = (run) => {
    try {
      return describeValue(run());
    } catch (error) {
      return describeValue(error);
    }
  };
`;

/**
 * A realm with the script run in it, or with Node's own methods.
 */
const realm = (patched: boolean, globals: object = {}): Context => {
  const context = createContext({ ...globals });
  runInContext(DESCRIBE, context);
  if (patched) runInContext(source, context);
  return context;
};

/**
 * Evaluates `expression`, a function body that works on `array` and returns
 * what the method returned, and describes that and `array` afterwards.
 */
const outcome = (context: Context, array: string, expression: string) =>
  runInContext(
    `(() => {
      const array = ${array};
      const returned = attempt(() => { ${expression} });
      return returned + ' -> ' + describeValue(array);
    })()`,
    context,
  ) as string;

/**
 * The writes, as `key=value`, that `expression` makes to `array` through a
 * `Proxy` around it.
 */
const writes = (context: Context, array: string, expression: string) =>
  runInContext(
    `(() => {
      const writes = [];
      const array = new Proxy(${array}, {
        set(target, key, value, receiver) {
          writes.push(String(key) + '=' + String(value));
          return Reflect.set(target, key, value, receiver);
        },
      });
      ${expression};
      return writes.join(' ');
    })()`,
    context,
  ) as string;

describe('vacated array slots', () => {
  let patched: Context;
  let native: Context;

  beforeEach(() => {
    patched = realm(true);
    native = realm(false);
  });

  it('defines pop, shift and splice non-enumerable, with the built-ins names and lengths, and not as constructors', () => {
    const shape = (context: Context) =>
      runInContext(
        `['pop', 'shift', 'splice'].map((name) => {
          const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name);
          const method = descriptor.value;
          let constructs = true;
          try {
            new method();
          } catch {
            constructs = false;
          }
          return [name, method.name, method.length, descriptor.enumerable, descriptor.writable, descriptor.configurable, constructs].join(' ');
        })`,
        context,
      ) as string[];

    expect([...shape(patched)]).toEqual([...shape(native)]);
  });

  it('replaces the engine own methods', () => {
    const methods = (context: Context) =>
      runInContext(
        `[Array.prototype.pop, Array.prototype.shift, Array.prototype.splice].map(String)`,
        context,
      ) as string[];

    for (const method of methods(patched)) {
      expect(method).not.toContain('[native code]');
    }
  });

  it.each([
    ['[1, 2, 3]', 'return array.pop();'],
    ['[]', 'return array.pop();'],
    ['[1, , 3]', 'return array.pop();'],
    ['[1, 2, ,]', 'return array.pop();'],
    ['[1, 2, 3]', 'return array.shift();'],
    ['[]', 'return array.shift();'],
    ['[, 2, 3]', 'return array.shift();'],
    ['[1, 2, 3, 4]', 'return array.splice(1);'],
    ['[1, 2, 3, 4]', 'return array.splice(1, 2);'],
    ['[1, 2, 3, 4]', 'return array.splice();'],
    ['[1, 2, 3, 4]', 'return array.splice(undefined);'],
    ['[1, 2, 3, 4]', 'return array.splice(-1);'],
    ['[1, 2, 3, 4]', 'return array.splice(0, Infinity);'],
    ['[1, 2, 3, 4]', 'return array.splice(10);'],
    ['[1, 2, 3, 4]', "return array.splice(1, 2, 'a');"],
    ['[1, 2]', "return array.splice(1, 0, 'a', 'b', 'c');"],
    ['[1, 2, 3]', "return array.splice(0, 1, 'a');"],
    ['[1, , 3, 4]', 'return array.splice(0, 2);'],
  ])(
    'returns what the engine does, and leaves %s as it does, for %s',
    (array, expression) => {
      expect(outcome(patched, array, expression)).toBe(
        outcome(native, array, expression),
      );
    },
  );

  it.each([
    ['pop()', 'array.pop()', '1=undefined length=1'],
    ['shift()', 'array.shift()', '1=undefined length=1'],
    ['splice()', 'array.splice(0, 2)', '1=undefined 2=undefined length=1'],
  ])(
    'writes undefined into the slots %s gives up, then puts the length back',
    (_name, expression, cleared) => {
      const array = expression.startsWith('array.splice')
        ? "['a', 'b', 'c']"
        : "['a', 'b']";
      const before = writes(native, array, expression);

      expect(writes(patched, array, expression)).toBe(`${before} ${cleared}`);
    },
  );

  it('writes nothing more when splice() inserts as many as it removes, or more', () => {
    const expression = "array.splice(0, 1, 'x', 'y')";

    expect(writes(patched, "['a', 'b']", expression)).toBe(
      writes(native, "['a', 'b']", expression),
    );
  });

  it('writes nothing more into an array that was empty', () => {
    expect(writes(patched, '[]', 'array.pop(); array.shift()')).toBe(
      writes(native, '[]', 'array.pop(); array.shift()'),
    );
  });

  it.each([
    ['Array.prototype.pop.call(array)'],
    ['Array.prototype.shift.call(array)'],
    ['Array.prototype.splice.call(array, 0, 1)'],
  ])('leaves an array-like to the engine: %s', (expression) => {
    const arrayLike = "({ length: 2, 0: 'a', 1: 'b' })";

    expect(writes(patched, arrayLike, expression)).toBe(
      writes(native, arrayLike, expression),
    );
    expect(outcome(patched, arrayLike, `return ${expression};`)).toBe(
      outcome(native, arrayLike, `return ${expression};`),
    );
  });

  it('leaves a non-extensible array its old slots rather than throw', () => {
    const array = 'Object.preventExtensions([1, 2, 3])';

    expect(outcome(patched, array, 'return array.pop();')).toBe('3 -> [1,2]');
    expect(outcome(patched, array, 'return array.splice(1);')).toBe(
      '[2,3] -> [1]',
    );
  });

  it.each([
    ['Array.prototype.pop.call(null)'],
    ['Array.prototype.shift.call(undefined)'],
    ['Array.prototype.splice.call(null, 0)'],
    ['Object.freeze([1, 2]).pop()'],
    ['Object.freeze([1, 2]).shift()'],
    ['Object.freeze([1, 2]).splice(0, 1)'],
  ])('throws what the engine throws for %s', (expression) => {
    expect(outcome(patched, '[]', `return ${expression};`)).toBe(
      outcome(native, '[]', `return ${expression};`),
    );
  });

  it("keeps the engine's own methods in the web build", () => {
    const web = realm(true, { __WEB__: true });

    expect(
      runInContext(
        `[Array.prototype.pop, Array.prototype.shift, Array.prototype.splice].every((method) => String(method).includes('[native code]'))`,
        web,
      ),
    ).toBe(true);
  });

  it('patches the native build, where the bundler sets __WEB__ to false', () => {
    const lynx = realm(true, { __WEB__: false });

    expect(
      runInContext(
        `String(Array.prototype.pop).includes('[native code]')`,
        lynx,
      ),
    ).toBe(false);
  });
});
