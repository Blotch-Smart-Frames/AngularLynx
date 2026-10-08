/**
 * Copies pre-transformed SourceFiles into an Angular compilation's own
 * source-file cache so its compiler host serves them instead of reading the
 * original files from disk.
 *
 * Why this exists: up to Angular 22.1 the cache was handed over through
 * `AngularHostOptions.sourceFileCache` on `compilation.initialize()`. In 22.2,
 * `@angular/build` moved ownership of the cache onto the compilation itself
 * (`TypeScriptCompilation#sourceFiles`, a protected `Map`) and passes it to
 * `createAngularCompilerHost()` directly, so the host option no longer exists.
 * Seeding that map before `initialize()` is the equivalent hook.
 *
 * Only in-process compilations (`AotCompilation` / `JitCompilation`) own such a
 * map. `ParallelCompilation` runs the compiler in a worker thread with a cache
 * that lives in the worker, so there is nothing to seed — the same as before
 * 22.2, where the worker ignored `hostOptions.sourceFileCache` entirely. Callers
 * get `false` back in that case so the miss is observable rather than silent.
 *
 * The compilation is typed structurally because `sourceFiles` is `protected`
 * on `@angular/build`'s class and not part of its public surface.
 */
export const seedCompilationSourceFiles = (
  compilation: object,
  sourceFileCache: ReadonlyMap<string, unknown>,
): boolean => {
  const { sourceFiles } = compilation as { sourceFiles?: unknown };
  if (!(sourceFiles instanceof Map)) return false;

  for (const [fileName, sourceFile] of sourceFileCache) {
    sourceFiles.set(fileName, sourceFile);
  }
  return true;
};
