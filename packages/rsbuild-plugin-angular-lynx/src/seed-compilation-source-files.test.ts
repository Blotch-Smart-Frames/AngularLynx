import { createAngularCompilation } from '@angular/build/src/tools/angular/compilation';
import { describe, expect, it } from 'vitest';
import { seedCompilationSourceFiles } from './seed-compilation-source-files';

describe('seedCompilationSourceFiles', () => {
  it('copies every cached SourceFile into the compilation-owned map', () => {
    const existing = { text: 'existing' };
    const sourceFiles = new Map<string, unknown>([['/a.ts', existing]]);
    const replacement = { text: 'schema-injected' };
    const added = { text: 'added' };

    const seeded = seedCompilationSourceFiles(
      { sourceFiles },
      new Map([
        ['/a.ts', replacement],
        ['/b.ts', added],
      ]),
    );

    expect(seeded).toBe(true);
    // Our transformed view must win over anything already cached, otherwise
    // the compiler would type-check the untransformed template.
    expect(sourceFiles.get('/a.ts')).toBe(replacement);
    expect(sourceFiles.get('/b.ts')).toBe(added);
  });

  it('returns false when the compilation has no source-file map', () => {
    // ParallelCompilation keeps its cache inside the worker thread.
    expect(
      seedCompilationSourceFiles({}, new Map([['/a.ts', { text: '' }]])),
    ).toBe(false);
  });

  it('returns false when sourceFiles is not a Map', () => {
    expect(seedCompilationSourceFiles({ sourceFiles: {} }, new Map())).toBe(
      false,
    );
  });

  // Contract tests against the real @angular/build classes. `sourceFiles` is a
  // protected, internal field, so these fail loudly if a future Angular release
  // renames or relocates it again (as 22.2 did with hostOptions.sourceFileCache)
  // instead of letting schema injection silently stop applying.
  it.each([
    ['AOT', true],
    ['JIT', false],
  ])(
    'seeds the in-process %s compilation from @angular/build',
    async (_label, aot) => {
      const compilation = await createAngularCompilation(!aot, false, false);
      const sourceFile = { text: 'schema-injected' };

      expect(
        seedCompilationSourceFiles(
          compilation,
          new Map([['/src/app.ts', sourceFile]]),
        ),
      ).toBe(true);
      expect(
        (
          compilation as unknown as { sourceFiles: Map<string, unknown> }
        ).sourceFiles.get('/src/app.ts'),
      ).toBe(sourceFile);
    },
  );
});
