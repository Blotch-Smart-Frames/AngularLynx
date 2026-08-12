import fs from 'node:fs';
import path from 'node:path';
import { generateComponentScopeId } from './utils/angular/component-scope-id.js';

/**
 * Per-component stylesheet bookkeeping. `imports` lists the on-disk scoped CSS
 * paths the loader will prepend as `import` statements; `inlineStyles` mirrors
 * Angular's inline-style handling surface; `processedFiles` deduplicates calls
 * that Angular's AOT compiler makes multiple times for the same stylesheet.
 */
export type ComponentStylesEntry = {
  imports: string[];
  inlineStyles: string[];
  scopeId: string;
  processedFiles: Map<string, string>;
};

export type ComponentScopeInfo = { className: string; scopeId: string };

/**
 * Builds the `transformStylesheet` callback that Angular's AOT compiler invokes
 * for every component stylesheet (inline `styles: []` and external `styleUrls`).
 *
 * The callback is a closure over the two shared caches the loader
 * (`api.transform` in angular.ts) later reads from:
 *   - `componentStylesCache` — maps component source file → its scoped CSS imports
 *   - `componentScopeIds` — maps component source file → { className, scopeId }
 *
 * Extracted from angular.ts so the dedup / scoped-path / write-if-changed logic
 * can be unit-tested directly by driving the returned callback, without standing
 * up a full Angular compilation.
 */
export const createTransformStylesheet = (params: {
  basePath: string;
  scopedCssCacheDir: string;
  componentStylesCache: Map<string, ComponentStylesEntry>;
  componentScopeIds: Map<string, ComponentScopeInfo>;
}): ((
  data: string,
  containingFile: string,
  stylesheetFile: string | undefined,
  order: number,
  className: string | undefined,
) => Promise<string>) => {
  const {
    basePath,
    scopedCssCacheDir,
    componentStylesCache,
    componentScopeIds,
  } = params;

  return async (data, containingFile, stylesheetFile, order, className) => {
    const resolvedClassName = className ?? 'Component';
    const scopeId = generateComponentScopeId(resolvedClassName, containingFile);
    let componentStyles = componentStylesCache.get(containingFile);
    if (!componentStyles) {
      componentStyles = {
        imports: [],
        inlineStyles: [],
        scopeId,
        processedFiles: new Map(),
      };
      componentStylesCache.set(containingFile, componentStyles);
    }

    // Angular's AOT compiler may invoke this callback multiple times
    // for the same stylesheet — once with className undefined (fallback
    // to 'Component') and once with the real class name. Deduplicate:
    // skip fallback calls when the stylesheet was already processed,
    // but allow real-className calls to overwrite the fallback.
    const stylesheetKey = stylesheetFile ?? `__inline_${order}`;
    const previousPath = componentStyles.processedFiles.get(stylesheetKey);

    if (previousPath && !className) {
      return '';
    }

    // Prefer the real class name for the scope ID set on ɵcmp.id
    if (className || !componentScopeIds.has(containingFile)) {
      componentScopeIds.set(containingFile, {
        className: resolvedClassName,
        scopeId,
      });
    }

    // Use raw CSS without Angular's encapsulateStyle scoping.
    // Angular's encapsulateStyle generates [_ngcontent-xxx] attribute selectors,
    // and even class-conjunction replacements (.class._ngscope-xxx) don't work
    // because the Lynx template stores the scope ID separately from element class
    // lists — elements only get their component classes (e.g. "nav-title"), not
    // scope classes. Plain class selectors (.nav-title) match correctly since
    // enableCSSSelector handles them, and per-component scoping in the template
    // already associates the CSS with the right component scope.
    const scopedCss = data;

    const writeIfChanged = (filePath: string, content: string): void => {
      try {
        if (fs.readFileSync(filePath, 'utf-8') === content) return;
      } catch {}
      fs.writeFileSync(filePath, content);
    };

    let scopedPath: string;
    if (stylesheetFile) {
      const relName = path.relative(basePath, stylesheetFile);
      scopedPath = path.join(
        scopedCssCacheDir,
        `${relName.replace(/[/\\]/g, '__')}.__scoped_${scopeId}.css`,
      );
    } else {
      const relDir = path.relative(basePath, path.dirname(containingFile));
      scopedPath = path.join(
        scopedCssCacheDir,
        `${relDir.replace(/[/\\]/g, '__')}__inline_${resolvedClassName}_${order}.__scoped_${scopeId}.css`,
      );
    }

    writeIfChanged(scopedPath, scopedCss);

    if (previousPath) {
      const idx = componentStyles.imports.indexOf(previousPath);
      if (idx >= 0) {
        componentStyles.imports[idx] = scopedPath;
      } else {
        componentStyles.imports.push(scopedPath);
      }
      if (previousPath !== scopedPath) {
        try {
          fs.unlinkSync(previousPath);
        } catch {}
      }
    } else {
      componentStyles.imports.push(scopedPath);
    }

    componentStyles.processedFiles.set(stylesheetKey, scopedPath);
    return '';
  };
};
