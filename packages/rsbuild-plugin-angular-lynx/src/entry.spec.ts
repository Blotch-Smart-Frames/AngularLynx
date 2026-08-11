import { describe, expect, it } from 'vitest';
import { getChunks } from './entry';

describe('getChunks', () => {
  it('string entry extracts import and uses entryName as chunk', () => {
    const result = getChunks('main', ['./src/index.ts']);

    expect(result.imports).toEqual(['./src/index.ts']);
    expect(result.chunks).toEqual(['main']);
  });

  it('EntryDescription with import string extracts import', () => {
    const result = getChunks('app', [{ import: './src/index.ts' }]);

    expect(result.imports).toEqual(['./src/index.ts']);
    expect(result.chunks).toEqual(['app']);
  });

  it('EntryDescription with import array extracts all imports', () => {
    const result = getChunks('app', [{ import: ['./a.ts', './b.ts'] }]);

    expect(result.imports).toEqual(['./a.ts', './b.ts']);
  });

  it('EntryDescription with dependOn string adds to front of chunks', () => {
    const result = getChunks('app', [
      { import: './src/index.ts', dependOn: 'vendor' },
    ]);

    expect(result.chunks).toEqual(['vendor', 'app']);
  });

  it('EntryDescription with dependOn array adds all to front of chunks', () => {
    const result = getChunks('app', [
      { import: './src/index.ts', dependOn: ['vendor', 'shared'] },
    ]);

    expect(result.chunks).toEqual(['vendor', 'shared', 'app']);
  });

  it('multiple string entries accumulate imports', () => {
    const result = getChunks('app', ['./a.ts', './b.ts']);

    expect(result.imports).toEqual(['./a.ts', './b.ts']);
    expect(result.chunks).toEqual(['app']);
  });

  it('array entry duplicates existing imports (documents current behavior)', () => {
    // Line 194 has `imports.push(...imports)` instead of `imports.push(...item)`
    // This means an array entry duplicates whatever imports were already collected
    const result = getChunks('app', ['./a.ts', ['./b.ts', './c.ts']]);

    // After processing './a.ts': imports = ['./a.ts']
    // After processing ['./b.ts', './c.ts']: imports.push(...imports) duplicates → ['./a.ts', './a.ts']
    expect(result.imports).toEqual(['./a.ts', './a.ts']);
  });
});
