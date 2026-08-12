import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as TypescriptModule from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLynxSchemaSourceFileCache } from './build-schema-source-file-cache';

// A controllable flag lets a single test force ts.parseJsonConfigFileContent to
// throw so the defensive catch is exercised, while every other test keeps the
// real TypeScript behavior. We can't vi.spyOn a native ESM export (its module
// namespace is frozen), and no malformed tsconfig on disk makes TypeScript throw
// — it always returns diagnostics instead — so replacing the module and
// delegating to the original by default is the only way to reach the catch.
const parseState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<typeof TypescriptModule>();
  return {
    ...actual,
    default: actual,
    parseJsonConfigFileContent: (
      ...args: Parameters<typeof actual.parseJsonConfigFileContent>
    ): ReturnType<typeof actual.parseJsonConfigFileContent> => {
      if (parseState.shouldThrow) {
        throw new Error('boom');
      }
      return actual.parseJsonConfigFileContent(...args);
    },
  };
});

const COMPONENT_SOURCE = `
import { Component } from '@angular/core';
@Component({ template: '<view></view>' })
export class AppComponent {}
`;

describe('buildLynxSchemaSourceFileCache', () => {
  let root: string;

  const write = (rel: string, contents: string): string => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
    return full;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-schema-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    parseState.shouldThrow = false;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('injects the Lynx schema into @Component files and skips the rest', () => {
    const componentPath = write('src/app.component.ts', COMPONENT_SOURCE);
    write('src/plain.ts', 'export const x = 1;');
    const nodeModulePath = write(
      'node_modules/lib/lib.component.ts',
      COMPONENT_SOURCE,
    );
    const tsconfig = write(
      'tsconfig.json',
      JSON.stringify({
        files: [
          'src/app.component.ts',
          'src/plain.ts',
          'node_modules/lib/lib.component.ts',
        ],
      }),
    );

    const { sourceFileCache, fileNames } =
      buildLynxSchemaSourceFileCache(tsconfig);

    // fileNames enumerates everything the tsconfig references, including libs.
    expect(fileNames.some((f) => f.endsWith('app.component.ts'))).toBe(true);

    // The @Component file was transformed and cached with the schema injected.
    const cached = sourceFileCache.get(componentPath);
    expect(cached).toBeDefined();
    expect(cached.text).toContain('CUSTOM_ELEMENTS_SCHEMA as __LynxCES__');

    // Plain (no @Component) and node_modules files are never cached.
    expect(sourceFileCache.has(path.join(root, 'src', 'plain.ts'))).toBe(false);
    expect(sourceFileCache.has(nodeModulePath)).toBe(false);
  });

  it('skips files that cannot be read and continues with the rest', () => {
    const componentPath = write('src/app.component.ts', COMPONENT_SOURCE);
    const unreadablePath = write('src/broken.component.ts', COMPONENT_SOURCE);
    const tsconfig = write(
      'tsconfig.json',
      JSON.stringify({
        files: ['src/app.component.ts', 'src/broken.component.ts'],
      }),
    );

    // Make only the "broken" source throw on read; delegate every other read
    // (including the tsconfig read) to the real implementation.
    const realReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, enc: any) => {
      if (p === unreadablePath) {
        throw new Error('EACCES: simulated unreadable file');
      }
      return realReadFileSync(p, enc);
    }) as typeof fs.readFileSync);

    const { sourceFileCache } = buildLynxSchemaSourceFileCache(tsconfig);

    expect(sourceFileCache.has(componentPath)).toBe(true);
    expect(sourceFileCache.has(unreadablePath)).toBe(false);
  });

  it('returns empty results when the tsconfig cannot be parsed', () => {
    const tsconfig = write('tsconfig.json', '{}');

    // Force the config parse to throw so the defensive catch is exercised. No
    // malformed tsconfig on disk triggers it (TypeScript reports diagnostics
    // rather than throwing), so we flip the mocked parser into a throwing mode.
    parseState.shouldThrow = true;

    const { sourceFileCache, fileNames } =
      buildLynxSchemaSourceFileCache(tsconfig);

    expect(sourceFileCache.size).toBe(0);
    expect(fileNames).toEqual([]);
  });
});
