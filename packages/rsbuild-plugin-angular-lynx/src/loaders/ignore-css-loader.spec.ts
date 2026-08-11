import { describe, expect, it, vi } from 'vitest';
import ignoreCssLoader from './ignore-css-loader';

const createLoaderContext = () => ({
  cacheable: vi.fn(),
});

describe('ignoreCssLoader', () => {
  it('returns "export {}" when source contains ___CSS_LOADER_EXPORT___', () => {
    const ctx = createLoaderContext();
    const source =
      'var ___CSS_LOADER_EXPORT___ = ___CSS_LOADER_API___(function(i){return i});';

    const result = ignoreCssLoader.call(ctx as any, source);

    expect(result).toBe('export {}');
  });

  it('returns source unchanged when it does NOT contain the marker', () => {
    const ctx = createLoaderContext();
    const source = 'export const foo = "bar";';

    const result = ignoreCssLoader.call(ctx as any, source);

    expect(result).toBe(source);
  });

  it('handles marker appearing mid-string', () => {
    const ctx = createLoaderContext();
    const source =
      'some preamble code;\nvar ___CSS_LOADER_EXPORT___ = something;';

    const result = ignoreCssLoader.call(ctx as any, source);

    expect(result).toBe('export {}');
  });

  it('calls this.cacheable(true)', () => {
    const ctx = createLoaderContext();

    ignoreCssLoader.call(ctx as any, 'anything');

    expect(ctx.cacheable).toHaveBeenCalledWith(true);
  });
});
