import { describe, expect, it } from 'vitest';
import { normalizeCssLoaderOptions } from './css';

describe('normalizeCssLoaderOptions', () => {
  it('modules true + exportOnlyLocals true returns { exportOnlyLocals: true }', () => {
    const options = { modules: true } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({ exportOnlyLocals: true });
  });

  it('modules string + exportOnlyLocals true returns { mode, exportOnlyLocals }', () => {
    const options = { modules: 'local' } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({ mode: 'local', exportOnlyLocals: true });
  });

  it('modules object + exportOnlyLocals true merges exportOnlyLocals', () => {
    const options = { modules: { namedExport: true } } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({
      namedExport: true,
      exportOnlyLocals: true,
    });
  });

  it('modules false + exportOnlyLocals true returns options unchanged', () => {
    const options = { modules: false } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result).toBe(options);
  });

  it('modules true + exportOnlyLocals false returns options unchanged', () => {
    const options = { modules: true } as any;

    const result = normalizeCssLoaderOptions(options, false);

    expect(result).toBe(options);
  });

  it('does not mutate the original options object', () => {
    const originalModules = { namedExport: true };
    const options = { modules: originalModules } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result).not.toBe(options);
    expect(originalModules).toEqual({ namedExport: true });
    expect(result.modules).not.toBe(originalModules);
  });
});
