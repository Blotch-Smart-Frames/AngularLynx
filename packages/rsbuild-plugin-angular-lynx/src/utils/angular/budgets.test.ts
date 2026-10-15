import { describe, expect, it } from 'vitest';
import {
  type BudgetAsset,
  calculateBytes,
  calculateThresholds,
  checkBudgets,
  checkThresholds,
  formatSize,
} from './budgets';
import type { Budget } from './options';

describe('calculateBytes', () => {
  it('reads plain bytes and decimal units, like Angular', () => {
    expect(calculateBytes('2048')).toBe(2048);
    expect(calculateBytes('12b')).toBe(12);
    expect(calculateBytes('500kB')).toBe(500_000);
    expect(calculateBytes('1.5mb')).toBe(1_500_000);
    expect(calculateBytes(' 2 GB ')).toBe(2_000_000_000);
  });

  it('gives NaN for input it cannot parse', () => {
    expect(calculateBytes('lots')).toBeNaN();
    expect(calculateBytes('10 tb')).toBeNaN();
  });

  it('measures a percentage of the baseline', () => {
    expect(calculateBytes('10%', '1mb')).toBe(1_100_000);
    expect(calculateBytes('10%', '1mb', -1)).toBe(900_000);
  });

  it('moves the baseline by an absolute value in either direction', () => {
    expect(calculateBytes('100kb', '1mb')).toBe(1_100_000);
    expect(calculateBytes('100kb', '1mb', -1)).toBe(900_000);
  });

  it('treats a percentage without a baseline as zero', () => {
    expect(calculateBytes('10%')).toBe(0);
  });
});

describe('calculateThresholds', () => {
  it('yields each limit the budget sets, in Angular order', () => {
    const budget: Budget = {
      type: 'initial',
      maximumWarning: '1kb',
      maximumError: '2kb',
      minimumWarning: '3kb',
      minimumError: '4kb',
    };
    expect(calculateThresholds(budget)).toEqual([
      { limit: 1000, type: 'maximum', severity: 'warning' },
      { limit: 2000, type: 'maximum', severity: 'error' },
      { limit: 3000, type: 'minimum', severity: 'warning' },
      { limit: 4000, type: 'minimum', severity: 'error' },
    ]);
  });

  it('turns `warning` and `error` into a range around the baseline', () => {
    const budget: Budget = {
      type: 'all',
      baseline: '10kb',
      warning: '1kb',
      error: '2kb',
    };
    expect(calculateThresholds(budget)).toEqual([
      { limit: 9000, type: 'minimum', severity: 'warning' },
      { limit: 11_000, type: 'maximum', severity: 'warning' },
      { limit: 8000, type: 'minimum', severity: 'error' },
      { limit: 12_000, type: 'maximum', severity: 'error' },
    ]);
  });

  it('yields nothing for a budget without limits', () => {
    expect(calculateThresholds({ type: 'all' })).toEqual([]);
  });
});

describe('formatSize', () => {
  it('formats like `ng build`', () => {
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(-5)).toBe('0 bytes');
    expect(formatSize(999)).toBe('999 bytes');
    expect(formatSize(1234)).toBe('1.23 kB');
    expect(formatSize(1_500_000)).toBe('1.50 MB');
    expect(formatSize(2_000_000_000)).toBe('2.00 GB');
  });
});

describe('checkThresholds', () => {
  it('reports a size above a maximum', () => {
    expect([
      ...checkThresholds(
        [{ limit: 1000, type: 'maximum', severity: 'error' }],
        1500,
        'bundle initial',
      ),
    ]).toEqual([
      {
        severity: 'error',
        label: 'bundle initial',
        message:
          'bundle initial exceeded maximum budget. Budget 1.00 kB was not met by 500 bytes with a total of 1.50 kB.',
      },
    ]);
  });

  it('reports a size below a minimum', () => {
    expect([
      ...checkThresholds(
        [{ limit: 1000, type: 'minimum', severity: 'warning' }],
        400,
        'total',
      ),
    ]).toEqual([
      {
        severity: 'warning',
        label: 'total',
        message:
          'total failed to meet minimum budget. Budget 1.00 kB was not met by 600 bytes with a total of 400 bytes.',
      },
    ]);
  });

  it('accepts sizes on the limit', () => {
    expect([
      ...checkThresholds(
        [
          { limit: 1000, type: 'maximum', severity: 'error' },
          { limit: 1000, type: 'minimum', severity: 'error' },
        ],
        1000,
        'total',
      ),
    ]).toEqual([]);
  });
});

describe('checkBudgets', () => {
  const assets: BudgetAsset[] = [
    { name: 'main.lynx.bundle', size: 3000, entryName: 'main' },
    { name: 'lazy-bundle/route.bundle', size: 500 },
    { name: 'chunk.js', size: 200 },
  ];
  const componentStyles = [
    { label: 'src/app/app.css', size: 5000 },
    { label: 'src/app/small.ts', size: 10 },
  ];
  const messages = (budgets: Budget[], bundleAssets = assets) =>
    checkBudgets(budgets, { assets: bundleAssets, componentStyles }).map(
      ({ severity, message }) => `${severity}: ${message}`,
    );

  it("measures `initial` as each entry's bundle", () => {
    expect(messages([{ type: 'initial', maximumError: '2kb' }])).toEqual([
      'error: bundle initial exceeded maximum budget. Budget 2.00 kB was not met by 1.00 kB with a total of 3.00 kB.',
    ]);
  });

  it('names the page of each bundle in a multi-page app', () => {
    expect(
      messages(
        [{ type: 'initial', maximumWarning: '2kb' }],
        [
          ...assets,
          { name: 'home.lynx.bundle', size: 2500, entryName: 'home' },
        ],
      ),
    ).toEqual([
      'warning: bundle initial (main) exceeded maximum budget. Budget 2.00 kB was not met by 1.00 kB with a total of 3.00 kB.',
      'warning: bundle initial (home) exceeded maximum budget. Budget 2.00 kB was not met by 500 bytes with a total of 2.50 kB.',
    ]);
  });

  it("measures `bundle` as the named entry's bundle", () => {
    expect(
      messages([{ type: 'bundle', name: 'main', maximumError: '1kb' }]),
    ).toEqual([
      'error: main exceeded maximum budget. Budget 1.00 kB was not met by 2.00 kB with a total of 3.00 kB.',
    ]);
    // An entry that doesn't exist measures 0 bytes, as in Angular.
    expect(
      messages([{ type: 'bundle', name: 'missing', minimumWarning: '1kb' }]),
    ).toEqual([
      'warning: missing failed to meet minimum budget. Budget 1.00 kB was not met by 1.00 kB with a total of 0 bytes.',
    ]);
    // Without a name there is nothing to measure.
    expect(messages([{ type: 'bundle', maximumError: '1b' }])).toEqual([]);
  });

  it('measures `all` and `allScript` as every counted file together', () => {
    expect(
      messages([
        { type: 'all', maximumError: '3kb' },
        { type: 'allScript', maximumWarning: '3kb' },
      ]),
    ).toEqual([
      'error: total exceeded maximum budget. Budget 3.00 kB was not met by 700 bytes with a total of 3.70 kB.',
      'warning: total scripts exceeded maximum budget. Budget 3.00 kB was not met by 700 bytes with a total of 3.70 kB.',
    ]);
  });

  it('measures `any` and `anyScript` as each counted file', () => {
    expect(
      messages([
        { type: 'any', maximumError: '400b' },
        { type: 'anyScript', minimumWarning: '300b' },
      ]),
    ).toEqual([
      'error: main.lynx.bundle exceeded maximum budget. Budget 400 bytes was not met by 2.60 kB with a total of 3.00 kB.',
      'error: lazy-bundle/route.bundle exceeded maximum budget. Budget 400 bytes was not met by 100 bytes with a total of 500 bytes.',
      'warning: chunk.js failed to meet minimum budget. Budget 300 bytes was not met by 100 bytes with a total of 200 bytes.',
    ]);
  });

  it('measures `anyComponentStyle` as each component stylesheet', () => {
    expect(
      messages([{ type: 'anyComponentStyle', maximumWarning: '4kb' }]),
    ).toEqual([
      'warning: src/app/app.css exceeded maximum budget. Budget 4.00 kB was not met by 1.00 kB with a total of 5.00 kB.',
    ]);
  });

  it('measures nothing for an unknown budget type', () => {
    expect(
      messages([{ type: 'scripts', maximumError: '1b' } as unknown as Budget]),
    ).toEqual([]);
  });
});
