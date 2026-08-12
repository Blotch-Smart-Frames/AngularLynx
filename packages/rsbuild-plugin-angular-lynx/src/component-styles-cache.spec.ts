import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ComponentScopeInfo,
  type ComponentStylesEntry,
  createTransformStylesheet,
} from './component-styles-cache';

describe('createTransformStylesheet', () => {
  let basePath: string;
  let scopedCssCacheDir: string;
  let componentStylesCache: Map<string, ComponentStylesEntry>;
  let componentScopeIds: Map<string, ComponentScopeInfo>;
  let transformStylesheet: ReturnType<typeof createTransformStylesheet>;

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-css-'));
    scopedCssCacheDir = path.join(basePath, 'cache');
    fs.mkdirSync(scopedCssCacheDir, { recursive: true });
    componentStylesCache = new Map();
    componentScopeIds = new Map();
    transformStylesheet = createTransformStylesheet({
      basePath,
      scopedCssCacheDir,
      componentStylesCache,
      componentScopeIds,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  const componentFile = () => path.join(basePath, 'src', 'app.component.ts');

  it('always returns an empty string so Angular emits no inline style', async () => {
    const result = await transformStylesheet(
      '.a{color:red}',
      componentFile(),
      path.join(basePath, 'src', 'app.css'),
      0,
      'AppComponent',
    );
    expect(result).toBe('');
  });

  it('writes a scoped CSS file and records its import for an external stylesheet', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    await transformStylesheet('.a{color:red}', containing, stylesheet, 0, 'App');

    const entry = componentStylesCache.get(containing)!;
    expect(entry.imports).toHaveLength(1);
    expect(entry.imports[0]).toContain('__scoped_');
    expect(fs.readFileSync(entry.imports[0], 'utf-8')).toBe('.a{color:red}');
    // The external stylesheet path is folded into the scoped filename.
    expect(entry.imports[0]).toContain('app.css.__scoped_');
    expect(componentScopeIds.get(containing)?.className).toBe('App');
  });

  it('derives the scoped path from the component dir for inline styles (no stylesheetFile)', async () => {
    const containing = componentFile();

    await transformStylesheet(
      '.b{color:blue}',
      containing,
      undefined,
      2,
      'App',
    );

    const entry = componentStylesCache.get(containing)!;
    // Inline styles encode the class name + order into the filename.
    expect(entry.imports[0]).toContain('__inline_App_2.__scoped_');
  });

  it('falls back to the "Component" class name when className is undefined', async () => {
    const containing = componentFile();

    await transformStylesheet('.c{}', containing, undefined, 0, undefined);

    // No className provided, so the scope id + record use the "Component" fallback.
    expect(componentScopeIds.get(containing)?.className).toBe('Component');
  });

  it('lets a real-className call overwrite the fallback scope info and replaces the import in place', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    // First: Angular's fallback call with className undefined.
    await transformStylesheet('.a{}', containing, stylesheet, 0, undefined);
    const fallbackEntry = componentStylesCache.get(containing)!;
    const fallbackPath = fallbackEntry.imports[0];
    expect(componentScopeIds.get(containing)?.className).toBe('Component');

    // Then: the real-className call replaces the fallback in the same slot and
    // deletes the now-stale fallback file (previousPath !== scopedPath).
    await transformStylesheet('.a{}', containing, stylesheet, 0, 'RealName');

    const entry = componentStylesCache.get(containing)!;
    expect(entry.imports).toHaveLength(1);
    expect(entry.imports[0]).not.toBe(fallbackPath);
    expect(componentScopeIds.get(containing)?.className).toBe('RealName');
    expect(fs.existsSync(fallbackPath)).toBe(false);
  });

  it('skips redundant fallback calls once a stylesheet is already processed', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    await transformStylesheet('.a{}', containing, stylesheet, 0, undefined);
    const before = componentStylesCache.get(containing)!.imports.slice();

    // Second fallback call (className undefined) for the same stylesheet is a
    // no-op — it must not push a duplicate import.
    const result = await transformStylesheet(
      '.a{}',
      containing,
      stylesheet,
      0,
      undefined,
    );

    expect(result).toBe('');
    expect(componentStylesCache.get(containing)!.imports).toEqual(before);
  });

  it('does not rewrite the file when the content is unchanged', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    await transformStylesheet('.same{}', containing, stylesheet, 0, 'App');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    // Identical class name + file + content: writeIfChanged reads the existing
    // file, sees it matches, and returns without writing.
    await transformStylesheet('.same{}', containing, stylesheet, 0, 'App');

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('appends (not replaces) when the previous path is absent from the imports list', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    // Pre-seed a processedFiles entry whose path is NOT in the imports array,
    // simulating drift so `imports.indexOf(previousPath)` returns -1 and the
    // stale (nonexistent) file's unlink hits the swallowed-error path.
    componentStylesCache.set(containing, {
      imports: [],
      inlineStyles: [],
      scopeId: 'lseed',
      processedFiles: new Map([[stylesheet, path.join(basePath, 'ghost.css')]]),
    });

    await transformStylesheet('.a{}', containing, stylesheet, 0, 'App');

    const entry = componentStylesCache.get(containing)!;
    expect(entry.imports).toHaveLength(1);
    expect(entry.imports[0]).toContain('__scoped_');
  });

  it('does not overwrite existing scope info on a later fallback call for another stylesheet', async () => {
    const containing = componentFile();

    // First: a real-className call records the scope info for this component.
    await transformStylesheet(
      '.a{}',
      containing,
      path.join(basePath, 'src', 'a.css'),
      0,
      'RealName',
    );
    expect(componentScopeIds.get(containing)?.className).toBe('RealName');

    // Then: a fallback call (className undefined) for a *different* stylesheet.
    // previousPath is unset for this new key so it isn't skipped, but because
    // scope info already exists and no className is given, the record must NOT
    // be overwritten (`className || !componentScopeIds.has(...)` is false).
    await transformStylesheet(
      '.b{}',
      containing,
      path.join(basePath, 'src', 'b.css'),
      1,
      undefined,
    );

    expect(componentScopeIds.get(containing)?.className).toBe('RealName');
  });

  it('keeps a single import and skips unlink when the scoped path is unchanged', async () => {
    const containing = componentFile();
    const stylesheet = path.join(basePath, 'src', 'app.css');

    // Same className twice → identical scoped path → previousPath === scopedPath,
    // so no unlink and the import list stays length 1.
    await transformStylesheet('.a{}', containing, stylesheet, 0, 'App');
    await transformStylesheet('.a-changed{}', containing, stylesheet, 0, 'App');

    expect(componentStylesCache.get(containing)!.imports).toHaveLength(1);
  });
});
