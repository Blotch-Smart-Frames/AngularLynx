import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { injectLynxSchema } from './utils/inject-lynx-schema.js';
import { stripTemplateWhitespace } from './utils/strip-template-whitespace.js';

/**
 * Reads the tsconfig to enumerate all project TypeScript files, then returns a
 * Map<filePath, SourceFile> where every file containing an @Component decorator
 * has had CUSTOM_ELEMENTS_SCHEMA injected. Angular's compiler host checks this
 * cache before reading from disk, so the template type-checker never sees unknown
 * Lynx element errors without the user having to add the schema manually.
 *
 * Returns Map<string, any> to avoid TypeScript instance mismatch: the plugin's
 * local `typescript` package and `@angular/build`'s TypeScript resolve to different
 * module instances in the monorepo, making their SourceFile types structurally
 * incompatible at the type level even though they're identical at runtime.
 *
 * `shouldInclude` limits which files are read and parsed; `fileNames` still lists
 * every project file. Watch rebuilds pass it so only changed and new files are
 * re-parsed, instead of every component in the project on each save.
 */
export const buildLynxSchemaSourceFileCache = (
  tsconfig: string,
  shouldInclude: (filePath: string) => boolean = () => true,
): { sourceFileCache: Map<string, any>; fileNames: string[] } => {
  const sourceFileCache = new Map<string, any>();

  let fileNames: string[];
  try {
    const configFile = ts.readConfigFile(tsconfig, (p) =>
      fs.readFileSync(p, 'utf-8'),
    );
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsconfig),
    );
    fileNames = parsedConfig.fileNames;
  } catch {
    // If we can't parse the tsconfig, skip cache population — Angular will read
    // files from disk normally and the user's explicit schemas (if any) apply.
    return { sourceFileCache, fileNames: [] };
  }

  for (const filePath of fileNames) {
    // Skip library files — only project source needs the schema injection.
    if (filePath.includes('node_modules')) continue;
    if (!shouldInclude(filePath)) continue;

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Quick bail-out: files without @Component don't need transformation.
    if (!source.includes('@Component')) continue;

    // stripTemplateWhitespace runs here — before Angular's compiler — because this
    // is the only point where we still have the original template structure, with
    // newlines that tell us "this whitespace is indentation" vs "this space is
    // inter-word spacing next to an inline child element". By the time Angular emits
    // ɵɵtext instructions the structural information is gone and trimming blindly
    // would break inline text like <text>Hello <text>world</text> again</text> by
    // eating the spaces between words. Running injectLynxSchema first means the
    // schema import is already prepended, but stripTemplateWhitespace only matches
    // the >\n..content..\n< pattern inside template strings, so the two transforms
    // are order-independent in practice.
    const transformed = stripTemplateWhitespace(injectLynxSchema(source));
    // Even if the transforms returned the source unchanged, we still cache it
    // so Angular uses a consistent file view during the build.
    sourceFileCache.set(
      filePath,
      ts.createSourceFile(filePath, transformed, ts.ScriptTarget.Latest, true),
    );
  }

  return { sourceFileCache, fileNames };
};
