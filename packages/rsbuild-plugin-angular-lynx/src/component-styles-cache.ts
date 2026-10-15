import fs from 'node:fs';
import path from 'node:path';
import type { ComponentStyleSize } from './utils/angular/budgets.js';
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
 * The key a stylesheet's size is recorded under in `componentStyleSizes`:
 * per component, since two components sharing a stylesheet each ship it.
 */
const componentStyleSizeKey = (
  containingFile: string,
  stylesheetKey: string,
): string => `${containingFile}#${stylesheetKey}`;

/**
 * Drops the recorded stylesheet sizes of a component whose file was deleted,
 * so `anyComponentStyle` budgets stop reporting styles that no longer ship.
 */
export const forgetComponentStyleSizes = (
  componentStyleSizes: Map<string, ComponentStyleSize>,
  containingFile: string,
): void => {
  const prefix = componentStyleSizeKey(containingFile, '');
  for (const key of componentStyleSizes.keys()) {
    if (key.startsWith(prefix)) {
      componentStyleSizes.delete(key);
    }
  }
};

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
  /**
   * Called with the path of each scoped CSS file whose contents were
   * (re)written. On watch rebuilds the scoped files change after rspack's
   * watcher has already collected the edit, so angular.ts passes them to
   * rspack as modified. Otherwise the CSS change would only ship on the
   * following rebuild.
   */
  onStylesheetWritten?: (filePath: string) => void;
  /**
   * The compiled size of every component stylesheet, for `anyComponentStyle`
   * budgets. Overwritten each time Angular compiles a stylesheet, so watch
   * rebuilds check the current sizes.
   */
  componentStyleSizes?: Map<string, ComponentStyleSize>;
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
    onStylesheetWritten,
    componentStyleSizes,
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

    componentStyleSizes?.set(
      componentStyleSizeKey(containingFile, stylesheetKey),
      {
        // Angular labels a component style budget failure with the stylesheet;
        // inline styles have none, so they're labeled with their component.
        label: path
          .relative(basePath, stylesheetFile ?? containingFile)
          .replace(/\\/g, '/'),
        size: Buffer.byteLength(data),
      },
    );

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
      onStylesheetWritten?.(filePath);
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
