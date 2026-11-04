// cspell:words ɵɵdefine ɵcmp
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {
  importStylesheets,
  type ModuleStylesheets,
} from './transform-module.js';
import { generateComponentScopeId } from './utils/angular/component-scope-id.js';

/**
 * One component's styles, lifted out of its compiled definition.
 */
export type ExtractedComponentStyles = {
  className: string;
  /**
   * The ID the runtime builds the scope classes from. Only Emulated components
   * need one, so it's `undefined` for the others.
   */
  scopeId: string | undefined;
  /** The stylesheets, ready to be written as CSS files. */
  stylesheets: string[];
};

export type ExtractComponentStylesOptions = {
  /**
   * Sets each Emulated component's `ɵcmp.id` inside its definition, rather
   * than leaving it to the loader (buildTransformedCode in
   * transform-module.ts), which assigns it after the class.
   *
   * For a library's modules. The loader's assignment is a module-level
   * statement that uses the class, so the bundler could no longer drop the
   * library's components the app doesn't use, along with everything they
   * import. Inside the definition, the ID is set in the class's own
   * initializer: Angular's build wraps a library's classes in pure IIFEs,
   * and the call that sets it is marked pure too.
   */
  inlineScopeIds?: boolean;
};

export type ExtractComponentStylesResult = {
  /** The module's code, without the `styles` the stylesheets came from. */
  code: string;
  components: ExtractedComponentStyles[];
};

/** `ViewEncapsulation.Emulated`, which the compiler leaves out of the definition. */
const EMULATED = 0;

/**
 * Turns Angular's emulated-encapsulation CSS into CSS that Lynx can match.
 *
 * Angular's compiler scopes an Emulated component's styles with attribute
 * selectors: `.title` becomes `.title[_ngcontent-%COMP%]`, `:host` becomes
 * `[_nghost-%COMP%]`, and keyframe names gain a `_ngcontent-%COMP%_` prefix. On
 * the web, the renderer puts those attributes on the elements. Lynx's selector
 * matcher has no attribute selectors (`SelectorMatcher::MatchSimple` in Lynx
 * core's css/ng/matcher only handles tag, class, id and pseudo-classes), so the
 * attributes become classes here, and EmulatedLynxRenderer adds the same
 * classes to the elements.
 */
export const toLynxScopedCss = (css: string, scopeId: string): string =>
  css
    .replaceAll('[_ngcontent-%COMP%]', `._ngcontent-${scopeId}`)
    .replaceAll('[_nghost-%COMP%]', `._nghost-${scopeId}`)
    .replaceAll('%COMP%', scopeId);

/**
 * Fills the CSS variable namespace placeholder Angular's compiler puts in every
 * component's styles: `var(--muted)` compiles to `var(--%NS%muted)`. Angular's
 * renderer fills it with `CSS_VAR_NAMESPACE`, which is empty unless an app
 * opts in with `provideCssVarNamespacing()`. Lynx CSS is compiled ahead of
 * time, so it gets the default here, and the variables keep their own names,
 * which global stylesheets such as the theme define.
 */
export const fillCssVarNamespace = (css: string): string =>
  css.replaceAll('%NS%', '');

const propertyName = (property: ts.ObjectLiteralElementLike): string | null =>
  ts.isPropertyAssignment(property) &&
  (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : null;

const isDefineComponentCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null;
  return name === 'ɵɵdefineComponent';
};

/**
 * Lifts each component's `styles` out of Angular's compiled output, so they
 * can ship as Lynx CSS.
 *
 * Lynx can't add styles at runtime: CSS has to be compiled into the bundle.
 * So the plugin lets Angular's compiler embed every component's styles in its
 * definition, exactly as on the web (scoped for `ViewEncapsulation.Emulated`,
 * left global for `None` and `ShadowDom`), then takes them back out here. That
 * keeps each component's styles with its own encapsulation, even when two
 * components share a stylesheet file, and removes the CSS strings from the
 * JavaScript.
 *
 * Only `styles` arrays made of string literals are taken, which is what the
 * compiler emits. Anything else is left in place.
 *
 * The app's components come here from its own Angular compilation. A
 * library's come already compiled, and reach it after Angular's linker has
 * turned their `ɵɵngDeclareComponent` (partial compilation, which ng-packagr
 * uses) into the same `ɵɵdefineComponent` the app's compile emits; a library
 * compiled in full has that already.
 */
export const extractComponentStyles = (
  code: string,
  fileName: string,
  options: ExtractComponentStylesOptions = {},
): ExtractComponentStylesResult => {
  if (!code.includes('ɵɵdefineComponent')) {
    return { code, components: [] };
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const components: ExtractedComponentStyles[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];

  const visit = (node: ts.Node): void => {
    if (isDefineComponentCall(node)) {
      const definition = node.arguments[0];
      if (definition && ts.isObjectLiteralExpression(definition)) {
        const properties = definition.properties;
        const find = (name: string) =>
          properties.find((property) => propertyName(property) === name) as
            | ts.PropertyAssignment
            | undefined;
        const type = find('type')?.initializer;
        const styles = find('styles');
        const encapsulation = find('encapsulation')?.initializer;
        if (
          type &&
          ts.isIdentifier(type) &&
          styles &&
          ts.isArrayLiteralExpression(styles.initializer) &&
          styles.initializer.elements.length > 0 &&
          styles.initializer.elements.every(ts.isStringLiteralLike)
        ) {
          const emulated =
            encapsulation === undefined ||
            (ts.isNumericLiteral(encapsulation) &&
              Number(encapsulation.text) === EMULATED);
          const scopeId = emulated
            ? generateComponentScopeId(type.text, fileName)
            : undefined;
          const stylesheets = styles.initializer.elements.map((element) => {
            const css = fillCssVarNamespace(
              (element as ts.StringLiteralLike).text,
            );
            return scopeId ? toLynxScopedCss(css, scopeId) : css;
          });
          components.push({ className: type.text, scopeId, stylesheets });

          // Remove the property and the comma that separates it from the
          // next one, so the definition stays valid.
          const index = properties.indexOf(styles);
          const next = properties[index + 1];
          edits.push({
            start: styles.getStart(sourceFile),
            end: next
              ? next.getStart(sourceFile)
              : properties.hasTrailingComma
                ? properties.end
                : styles.end,
            text: '',
          });
          if (scopeId && options.inlineScopeIds) {
            // ɵɵdefineComponent takes no ID: it works one out from the
            // definition. So the definition it returns gets the ID the CSS
            // was scoped with, as the loader's assignment would. The compiler
            // marks the call pure (`/*@__PURE__*/ i0.ɵɵdefineComponent(…)`).
            // Its comment now marks the wrapping call, so the inner call is
            // marked again.
            const start = node.getStart(sourceFile);
            edits.push(
              {
                start,
                end: start,
                text: `/*@__PURE__*/ ((def) => (def.id = ${JSON.stringify(scopeId)}, def))(/*@__PURE__*/ `,
              },
              { start: node.end, end: node.end, text: ')' },
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Applied from the end, so each edit's offsets still hold. No two edits
  // start at the same offset: a wrapper opens before its call's `styles` and
  // closes after them.
  let result = code;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return { code: result, components };
};

/**
 * Writes the stylesheets extracted from one module as CSS files, so the
 * module can import them and css-extract compiles them into the bundle.
 *
 * A file is only rewritten when its content changed, and each rewrite is
 * reported through `onWritten`: on a watch rebuild the files change after
 * rspack's watcher collected the edit, so the plugin reports them to rspack as
 * changed, or the new CSS would only ship on the following rebuild.
 *
 * With `nameByContent`, each file is named after its content instead, and
 * written once. That's for a library's modules, which the loader compiles
 * while rspack is building, so the plugin can't report a rewrite in time:
 * when a workspace library is rebuilt into its `dist` during `ng serve`,
 * changed CSS gets a new file, which rspack has to read, rather than an old
 * one rspack has already compiled. The loader also runs for each thread and
 * environment at once, so the file is written under a temporary name and
 * renamed, and no build reads it half-written.
 */
export const writeModuleStylesheets = (params: {
  basePath: string;
  cacheDir: string;
  fileName: string;
  components: readonly ExtractedComponentStyles[];
  onWritten?: (filePath: string) => void;
  nameByContent?: boolean;
}): ModuleStylesheets | undefined => {
  const { basePath, cacheDir, fileName, components, onWritten, nameByContent } =
    params;
  if (components.length === 0) return undefined;

  const prefix = path
    .relative(basePath, fileName)
    .replace(/[/\\]/g, '__')
    .replace(/\.[cm]?[jt]s$/, '');
  const imports: string[] = [];
  const scopes: ModuleStylesheets['scopes'] = [];
  for (const { className, scopeId, stylesheets } of components) {
    stylesheets.forEach((css, index) => {
      if (nameByContent) {
        const hash = createHash('sha256')
          .update(css)
          .digest('hex')
          .slice(0, 10);
        const filePath = path.join(
          cacheDir,
          `${prefix}.${className}.${index}.${hash}.css`,
        );
        if (!fs.existsSync(filePath)) {
          const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
          fs.writeFileSync(temporary, css);
          fs.renameSync(temporary, filePath);
        }
        imports.push(filePath);
        return;
      }
      const filePath = path.join(
        cacheDir,
        `${prefix}.${className}.${index}.css`,
      );
      let current: string | undefined;
      try {
        current = fs.readFileSync(filePath, 'utf-8');
      } catch {}
      if (current !== css) {
        fs.writeFileSync(filePath, css);
        onWritten?.(filePath);
      }
      imports.push(filePath);
    });
    if (scopeId) scopes.push({ className, scopeId });
  }
  return { imports, scopes };
};

/**
 * Ships the styles of the components a library module defines, which arrive
 * already compiled: the module's code after Angular's linker, with each
 * component's styles out of its definition and an import of their CSS files
 * in their place.
 *
 * The app's components go through compileAngular() in angular.ts, which
 * extracts their styles as Angular emits them. A library doesn't go through
 * that compilation, so before this its styles stayed strings in its
 * JavaScript and never reached Lynx: its `:host`, class and type selector
 * rules all matched nothing. This uses the same extraction and the same cache
 * directory, so the CSS is scoped the same way, and goes through the same
 * PostCSS (type selectors, Tailwind) as the app's.
 */
export const shipLibraryComponentStyles = (
  code: string,
  fileName: string,
  options: { basePath: string; cacheDir: string },
): string => {
  const extracted = extractComponentStyles(code, fileName, {
    inlineScopeIds: true,
  });
  const stylesheets = writeModuleStylesheets({
    ...options,
    fileName,
    components: extracted.components,
    nameByContent: true,
  });
  return stylesheets
    ? importStylesheets(extracted.code, fileName, stylesheets.imports)
    : code;
};
