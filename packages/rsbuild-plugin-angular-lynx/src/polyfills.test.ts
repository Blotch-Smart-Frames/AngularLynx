import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Node has every ES2022 built-in that PrimJS lacks, and Vitest itself calls
 * them, so the natives can't be deleted from the test's own realm. Instead each
 * test gets a fresh `node:vm` realm (its own Array, String and typed array
 * prototypes), deletes the methods there to look like PrimJS, and runs the
 * preEntry file in it as the plain script it is.
 */
const source = readFileSync(new URL('./polyfills.js', import.meta.url), 'utf8');

const REMOVE_NATIVES = `
  delete Array.prototype.at;
  delete String.prototype.at;
  delete Object.getPrototypeOf(Int8Array.prototype).at;
  delete Array.prototype.findLast;
  delete Array.prototype.findLastIndex;
  delete String.prototype.replaceAll;
`;

let realm: Context;
const run = (code: string): unknown => runInContext(code, realm);

describe('ES2022 built-in polyfills', () => {
  beforeEach(() => {
    realm = createContext({});
    run(REMOVE_NATIVES);
    run(source);
  });

  it('installs every method non-enumerable, like the built-ins', () => {
    const descriptors = run(`[
      Object.getOwnPropertyDescriptor(Array.prototype, 'at'),
      Object.getOwnPropertyDescriptor(String.prototype, 'at'),
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Int8Array.prototype), 'at'),
      Object.getOwnPropertyDescriptor(Array.prototype, 'findLast'),
      Object.getOwnPropertyDescriptor(Array.prototype, 'findLastIndex'),
      Object.getOwnPropertyDescriptor(String.prototype, 'replaceAll'),
    ].map((d) => typeof d.value + ':' + d.enumerable)`);
    expect(descriptors).toEqual(Array(6).fill('function:false'));
    expect(
      run(`const keys = []; for (const key in [1]) keys.push(key); keys`),
    ).toEqual(['0']);
  });

  describe('at', () => {
    it('reads arrays from either end', () => {
      expect(run(`[10, 20, 30].at(0)`)).toBe(10);
      expect(run(`[10, 20, 30].at(-1)`)).toBe(30);
      expect(run(`[10, 20, 30].at(3)`)).toBeUndefined();
      expect(run(`[10, 20, 30].at(-4)`)).toBeUndefined();
    });

    it('truncates fractional indexes and treats NaN as 0', () => {
      expect(run(`[10, 20, 30].at(1.9)`)).toBe(20);
      expect(run(`[10, 20, 30].at(-1.9)`)).toBe(30);
      expect(run(`[10, 20, 30].at(NaN)`)).toBe(10);
      expect(run(`[10, 20, 30].at()`)).toBe(10);
    });

    it('returns characters of strings', () => {
      expect(run(`'abc'.at(-1)`)).toBe('c');
      expect(run(`'abc'.at(3)`)).toBeUndefined();
    });

    it('reads typed arrays', () => {
      expect(run(`new Float64Array([1.5, 2.5]).at(-1)`)).toBe(2.5);
    });
  });

  describe('findLast / findLastIndex', () => {
    it('searches from the end', () => {
      expect(run(`[1, 2, 3, 4, 5].findLast((v) => v % 2 === 0)`)).toBe(4);
      expect(run(`[1, 2, 3, 4, 5].findLastIndex((v) => v % 2 === 0)`)).toBe(3);
    });

    it('reports a miss like find/findIndex', () => {
      expect(run(`[1, 3].findLast((v) => v % 2 === 0)`)).toBeUndefined();
      expect(run(`[1, 3].findLastIndex((v) => v % 2 === 0)`)).toBe(-1);
    });

    it('passes value, index and array, bound to thisArg', () => {
      expect(
        run(`
          const values = [7];
          const context = {};
          const seen = [];
          function record(value, index, array) {
            seen.push(this === context, value, index, array === values);
            return false;
          }
          values.findLast(record, context);
          values.findLastIndex(record, context);
          seen
        `),
      ).toEqual([true, 7, 0, true, true, 7, 0, true]);
    });
  });

  describe('replaceAll', () => {
    it('replaces every occurrence of a string', () => {
      expect(run(`'a.b.a'.replaceAll('a', 'x')`)).toBe('x.b.x');
    });

    it('matches regex metacharacters in a string literally', () => {
      expect(run(`'1.2.3'.replaceAll('.', '-')`)).toBe('1-2-3');
      expect(run(`'a(b)a(b)'.replaceAll('(b)', '')`)).toBe('aa');
    });

    it('accepts a global regex', () => {
      expect(run(`'a1b22c'.replaceAll(/\\d+/g, '#')`)).toBe('a#b#c');
    });

    it('rejects a non-global regex', () => {
      expect(
        run(
          `try { 'aa'.replaceAll(/a/, 'b'); 'no error' } catch (e) { e.name }`,
        ),
      ).toBe('TypeError');
    });

    it('supports replacement functions and $& patterns', () => {
      expect(run(`'ab'.replaceAll('b', (m) => m.toUpperCase())`)).toBe('aB');
      expect(run(`'ab'.replaceAll('b', '[$&]')`)).toBe('a[b]');
    });

    it('inserts around every character for an empty search string', () => {
      expect(run(`'ab'.replaceAll('', '-')`)).toBe('-a-b-');
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
        run(
          `(1.23456).toLocaleString(undefined, { maximumFractionDigits: 1 })`,
        ),
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
      // The default realm has Node's Intl, so the native method stays.
      expect(run(`(1234.5).toLocaleString('de-DE')`)).toBe('1.234,5');
    });
  });

  it('leaves an existing method alone', () => {
    realm = createContext({});
    run(`const own = () => 'own'; Array.prototype.at = own;`);
    run(source);
    expect(run(`Array.prototype.at === own`)).toBe(true);
  });
});
