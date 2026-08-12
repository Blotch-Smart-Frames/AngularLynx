import { describe, expect, it } from 'vitest';
import threadGlobalsLoader from './thread-globals-loader';

const runLoader = (source: string, isMainThread: boolean): string => {
  const ctx = { getOptions: () => ({ isMainThread }) };
  return threadGlobalsLoader.call(ctx as never, source);
};

describe('threadGlobalsLoader', () => {
  it('prepends __MAIN_THREAD__=true for main thread', () => {
    const result = runLoader('const x = 1;', true);
    expect(result).toBe('globalThis["__MAIN_THREAD__"]=true;\nconst x = 1;');
  });

  it('prepends __MAIN_THREAD__=false for background thread', () => {
    const result = runLoader('const x = 1;', false);
    expect(result).toBe('globalThis["__MAIN_THREAD__"]=false;\nconst x = 1;');
  });

  it('preserves the original source unchanged', () => {
    const source = 'import { foo } from "./bar";\nexport const baz = foo();';
    const result = runLoader(source, false);
    expect(result).toContain(source);
  });

  it('prepends exactly one line before source', () => {
    const result = runLoader('line1\nline2', true);
    const lines = result.split('\n');
    expect(lines[0]).toBe('globalThis["__MAIN_THREAD__"]=true;');
    expect(lines.slice(1).join('\n')).toBe('line1\nline2');
  });

  it('handles empty source', () => {
    const result = runLoader('', true);
    expect(result).toBe('globalThis["__MAIN_THREAD__"]=true;\n');
  });
});
