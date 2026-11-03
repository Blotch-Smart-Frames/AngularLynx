import { Compilation, sources } from '@rspack/core';
import { describe, expect, it, vi } from 'vitest';
import {
  findZeroBigIntLiterals,
  ZeroBigIntLiteralsPlugin,
} from './zero-bigint-literals';

/**
 * The literals' source text, which tells the cases apart better than offsets.
 */
const literalsIn = (code: string): string[] =>
  findZeroBigIntLiterals(code).map(({ start, end }) => code.slice(start, end));

describe('findZeroBigIntLiterals', () => {
  it('finds a zero BigInt literal, such as Firestore 12 has', () => {
    const code =
      'if (e >= 0n) t = Number(e / 1000000000n), n = Number(e % 1000000000n);';

    expect(findZeroBigIntLiterals(code)).toEqual([
      { start: code.indexOf('0n'), end: code.indexOf('0n') + 2 },
    ]);
  });

  it('finds zero in every radix, with separators and under a minus', () => {
    expect(
      literalsIn('x = [0n, 0x0n, 0X00n, 0b0_0n, 0O0n, -0n, 0x0_0n];'),
    ).toEqual(['0n', '0x0n', '0X00n', '0b0_0n', '0O0n', '0n', '0x0_0n']);
  });

  it('leaves the BigInt literals the engine loads alone', () => {
    // Small, large, negative, hex and separated values all load on a device.
    expect(
      literalsIn('x = [1n, 10n, 1000000000n, -5n, 0xFFn, 0b10n, 1_000n];'),
    ).toEqual([]);
  });

  it('finds literals anywhere an expression can be', () => {
    expect(
      literalsIn(
        'function f(a = 0n) { switch (a) { case 0n: return `${0n}`; } return a?.[0n] ?? 0n.toString(); }',
      ),
    ).toEqual(['0n', '0n', '0n', '0n', '0n']);
  });

  it('leaves a zero BigInt property name alone, which stores no BigInt', () => {
    expect(
      literalsIn(
        'o = { 0n: 1, 0x0n() {} }; ({ 0n: a } = o); class C { 0n = 1; get 0b0n() {} }',
      ),
    ).toEqual([]);
  });

  it('ignores zero BigInt text in strings, comments and regular expressions', () => {
    expect(
      literalsIn('s = "0n" + \'0n\' + `0n`; // 0n\n/* 0n */ r = /0n/;'),
    ).toEqual([]);
  });

  it("doesn't parse a script with nothing that looks like a zero BigInt", () => {
    // Neither `10n` nor an identifier ending `0n` starts a zero literal.
    expect(findZeroBigIntLiterals('x = 10n + a0n + $0n + 1.0;')).toEqual([]);
  });
});

/**
 * Runs the plugin's processAssets callback over the given assets, with the
 * real webpack-sources classes, and returns the compilation's assets after.
 */
const runPlugin = (
  assets: Record<string, { code: string; info?: Record<string, unknown> }>,
) => {
  const current = new Map<
    string,
    { name: string; source: sources.Source; info: Record<string, unknown> }
  >(
    Object.entries(assets).map(([name, { code, info = {} }]) => [
      name,
      { name, source: new sources.RawSource(code), info },
    ]),
  );
  let processAssets: (() => void) | undefined;
  const processAssetsTap = vi.fn(
    (_options: { name: string; stage: number }, callback: () => void) => {
      processAssets = callback;
    },
  );
  const compilation = {
    hooks: { processAssets: { tap: processAssetsTap } },
    getAssets: () => [...current.values()],
    updateAsset: vi.fn(
      (name: string, update: (old: sources.Source) => sources.Source) => {
        const asset = current.get(name)!;
        current.set(name, { ...asset, source: update(asset.source) });
      },
    ),
  };
  const compiler = {
    webpack: { Compilation, sources },
    hooks: {
      thisCompilation: {
        tap: (_name: string, callback: (c: unknown) => void) =>
          callback(compilation),
      },
    },
  };

  new ZeroBigIntLiteralsPlugin().apply(compiler as never);
  processAssets!();

  return {
    code: (name: string) => current.get(name)!.source.source().toString(),
    compilation,
    processAssetsTap,
  };
};

describe('ZeroBigIntLiteralsPlugin', () => {
  it("rewrites the main thread's zero BigInt literals into BigInt(0)", () => {
    const { code } = runPlugin({
      'main/main-thread.js': {
        code: 'globalThis.r = [0n, -0x0n, 5n, typeof 0n, { 0n: 1 }];',
        info: { 'lynx:main-thread': true },
      },
    });

    const rewritten = code('main/main-thread.js');
    expect(rewritten).toBe(
      'globalThis.r = [BigInt(0), -BigInt(0), 5n, typeof BigInt(0), { 0n: 1 }];',
    );
    // The values are the ones the literals made.
    const scope: { r?: unknown[] } = {};
    new Function('globalThis', rewritten)(scope);
    expect(scope.r).toEqual([0n, 0n, 5n, 'bigint', { 0: 1 }]);
  });

  it("leaves the background thread's scripts alone", () => {
    const { code, compilation } = runPlugin({
      'main/background-thread.js': { code: 'x = 0n;' },
      'main/other.js': { code: 'x = 0n;', info: { 'lynx:main-thread': false } },
    });

    expect(code('main/background-thread.js')).toBe('x = 0n;');
    expect(code('main/other.js')).toBe('x = 0n;');
    expect(compilation.updateAsset).not.toHaveBeenCalled();
  });

  it('leaves a main-thread script without a zero BigInt untouched', () => {
    const { compilation } = runPlugin({
      'main/main-thread.js': {
        code: 'x = 1000000000n;',
        info: { 'lynx:main-thread': true },
      },
    });

    expect(compilation.updateAsset).not.toHaveBeenCalled();
  });

  it('runs before minification, after the main-thread scripts are marked', () => {
    const { processAssetsTap } = runPlugin({});

    // AngularWebpackPlugin marks them at the ADDITIONAL stage; the minifier
    // runs at OPTIMIZE_SIZE.
    const [{ stage }] = processAssetsTap.mock.calls[0]!;
    expect(stage).toBe(Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY);
    expect(stage).toBeGreaterThan(Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL);
    expect(stage).toBeLessThan(Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE);
  });
});
