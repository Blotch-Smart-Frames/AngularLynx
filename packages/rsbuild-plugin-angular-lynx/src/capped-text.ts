// cspell:words tmpl
import fs from 'node:fs';
import path from 'node:path';
import type * as AngularCompiler from '@angular/compiler';
import * as ts from 'typescript';
import type { LynxDiagnostic } from './lynx-diagnostics.js';

/** Tailwind's classes that set `text-overflow: ellipsis`. */
const ELLIPSIS_CLASSES = new Set(['text-ellipsis', 'truncate']);

/** The declaration in CSS, a `style` attribute or a `[style]` object. */
const ELLIPSIS_DECLARATION =
  /(?:text-overflow|textOverflow)['"]?\s*:\s*['"]?ellipsis/;

/** Any sign the component sets an ellipsis somewhere. */
const ELLIPSIS_MENTION = new RegExp(
  `text-ellipsis|\\btruncate\\b|${ELLIPSIS_DECLARATION.source}`,
);

/**
 * Bindings that set an element's classes or styles from an expression, which
 * a template can't be read for: `[class]="titleClass()"`, `[ngClass]`, an
 * interpolated `class="a {{ b }}"`.
 */
const STYLING_BINDINGS = new Set([
  'class',
  'className',
  'style',
  'ngClass',
  'ngStyle',
]);

type ComponentTemplate = {
  template: string;
  /** The file the template's lines count from: the component, or its templateUrl. */
  file: string;
  /** Where an inline template starts in the component's file (0-based). */
  offset?: { line: number; character: number };
  /** The component's own stylesheets: its `styles` and `styleUrl(s)` files. */
  styles: string[];
};

const readFile = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
};

const isComponentDecorator = (decorator: ts.Decorator): boolean => {
  const call = decorator.expression;
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  return name === 'Component';
};

const stringValue = (node: ts.Expression): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;

/**
 * The strings of a `string | string[]` metadata value.
 */
const stringValues = (node: ts.Expression): string[] => {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => {
      const value = stringValue(element);
      return value === undefined ? [] : [value];
    });
  }
  const value = stringValue(node);
  return value === undefined ? [] : [value];
};

/**
 * Reads each `@Component`'s template and stylesheets out of a source file.
 */
const componentTemplates = (
  filePath: string,
  source: string,
): ComponentTemplate[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const directory = path.dirname(filePath);
  const components: ComponentTemplate[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && isComponentDecorator(node)) {
      const metadata = (node.expression as ts.CallExpression).arguments[0];
      if (metadata && ts.isObjectLiteralExpression(metadata)) {
        let component: Omit<ComponentTemplate, 'styles'> | undefined;
        const styles: string[] = [];
        for (const property of metadata.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            !(
              ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)
            )
          ) {
            continue;
          }
          const value = property.initializer;
          switch (property.name.text) {
            case 'template': {
              const template = stringValue(value);
              if (template !== undefined) {
                component = {
                  template,
                  file: filePath,
                  // After the opening quote or backtick.
                  offset: sourceFile.getLineAndCharacterOfPosition(
                    value.getStart(sourceFile) + 1,
                  ),
                };
              }
              break;
            }
            case 'templateUrl': {
              const url = stringValue(value);
              if (url === undefined) break;
              const file = path.resolve(directory, url);
              const template = readFile(file);
              if (template !== undefined) component = { template, file };
              break;
            }
            case 'styles':
              styles.push(...stringValues(value));
              break;
            case 'styleUrl':
            case 'styleUrls':
              for (const url of stringValues(value)) {
                const css = readFile(path.resolve(directory, url));
                if (css !== undefined) styles.push(css);
              }
              break;
          }
        }
        if (component) components.push({ ...component, styles });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return components;
};

/**
 * The classes a stylesheet ends a text with "…" in: those in the selector of
 * a rule that sets `text-overflow: ellipsis`, such as `.summary` for
 * `.summary { text-overflow: ellipsis; }`. Only innermost rules are read, so a
 * rule inside `@media` or nested in Sass counts by its own selector.
 */
export const ellipsisClasses = (css: string): Set<string> => {
  const classes = new Set<string>();
  for (const [, selector, body] of css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!ELLIPSIS_DECLARATION.test(body!)) continue;
    for (const [, name] of selector!.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      classes.add(name!);
    }
  }
  return classes;
};

const TEMPLATE_URL = /templateUrl\s*:\s*['"`]([^'"`]+)['"`]/g;

/**
 * Whether a source file's components might cap a text, checked on the text
 * alone, so a rebuild parses only the few files that do.
 */
const mayCapText = (filePath: string, source: string): boolean =>
  source.includes('text-maxline') ||
  [...source.matchAll(TEMPLATE_URL)].some(([, url]) =>
    readFile(path.resolve(path.dirname(filePath), url!))?.includes(
      'text-maxline',
    ),
  );

let compiler: Promise<typeof AngularCompiler> | undefined;

/**
 * Loads Angular's template parser the first time a template caps a text: most
 * builds never need it.
 */
const loadCompiler = (): Promise<typeof AngularCompiler> =>
  (compiler ??= import('@angular/compiler'));

type TemplateElement = AngularCompiler.TmplAstElement;

/**
 * The element's static classes: `class="a b"`.
 */
const staticClasses = (element: TemplateElement): string[] =>
  element.attributes
    .filter(({ name }) => name === 'class')
    .flatMap(({ value }) => value.split(/\s+/).filter(Boolean));

/**
 * The elements of a component's template that cap their text without an
 * ellipsis.
 *
 * An element is fine when its own classes or styles set the ellipsis, or when
 * the component's stylesheets set it for one of its classes. When its classes
 * come from an expression, the template alone can't tell, so it's taken as
 * fine if the component mentions an ellipsis anywhere. A warning the build
 * can't back up is worse than one it misses: the app has no way to silence
 * it. The app's global stylesheets are checked once the bundle is known (see
 * `excusedByStylesheet`).
 */
const cappedTextsWithoutEllipsis = (
  {
    BindingType,
    TmplAstRecursiveVisitor,
    parseTemplate,
    tmplAstVisitAll,
  }: typeof AngularCompiler,
  component: ComponentTemplate,
  source: string,
): TemplateElement[] => {
  /**
   * Whether the element caps its lines: `text-maxline` as an attribute,
   * `[text-maxline]` or `[attr.text-maxline]`.
   */
  const isCapped = (element: TemplateElement): boolean =>
    element.attributes.some(({ name }) => name === 'text-maxline') ||
    element.inputs.some(
      ({ name, type }) =>
        name === 'text-maxline' &&
        (type === BindingType.Property || type === BindingType.Attribute),
    );

  const setsEllipsis = (element: TemplateElement): boolean =>
    staticClasses(element).some((name) => ELLIPSIS_CLASSES.has(name)) ||
    element.attributes.some(
      ({ name, value }) => name === 'style' && ELLIPSIS_DECLARATION.test(value),
    ) ||
    element.inputs.some(
      ({ name, type }) =>
        // [class.text-ellipsis]="…"
        (type === BindingType.Class && ELLIPSIS_CLASSES.has(name)) ||
        // [style.text-overflow]="…"
        (type === BindingType.Style &&
          (name === 'text-overflow' || name === 'textOverflow')),
    );

  const componentEllipsisClasses = new Set(
    component.styles.flatMap((css) => [...ellipsisClasses(css)]),
  );

  const mightSetEllipsis = (element: TemplateElement): boolean => {
    const bindsStyling = element.inputs.some(
      ({ name, type }) =>
        (type === BindingType.Property || type === BindingType.Attribute) &&
        STYLING_BINDINGS.has(name),
    );
    return (
      (bindsStyling &&
        [source, component.template, ...component.styles].some((text) =>
          ELLIPSIS_MENTION.test(text),
        )) ||
      staticClasses(element).some((name) => componentEllipsisClasses.has(name))
    );
  };

  const found: TemplateElement[] = [];
  class Visitor extends TmplAstRecursiveVisitor {
    override visitElement(element: TemplateElement): void {
      if (
        isCapped(element) &&
        !setsEllipsis(element) &&
        !mightSetEllipsis(element)
      ) {
        found.push(element);
      }
      super.visitElement(element);
    }
  }
  const { nodes } = parseTemplate(component.template, component.file, {
    preserveWhitespaces: false,
  });
  tmplAstVisitAll(new Visitor(), nodes);
  return found;
};

/**
 * Scans the components' templates for texts capped with `text-maxline` that
 * don't also set `text-overflow: ellipsis`.
 *
 * Lynx's `text-maxline` only sizes the `<text>` box. The lines past the cap
 * still draw on Android, below the box and over whatever follows it, and iOS
 * cuts them off with no "…". Only `text-overflow: ellipsis` makes both stop at
 * the last line, so every capped text needs it, and nothing else enforced the
 * pairing (issue #437). Apps have no AngularLynx lint config, so the build,
 * which reads every template anyway, is where the warning reaches them.
 */
export const scanTemplatesForCappedTextWithoutEllipsis = async (
  fileNames: readonly string[],
): Promise<LynxDiagnostic[]> => {
  const diagnostics: LynxDiagnostic[] = [];

  for (const filePath of fileNames) {
    if (filePath.includes('node_modules')) continue;

    const source = readFile(filePath);
    if (source === undefined || !mayCapText(filePath, source)) continue;

    for (const component of componentTemplates(filePath, source)) {
      // Most templates never cap a text: skip parsing them.
      if (!component.template.includes('text-maxline')) continue;

      const elements = cappedTextsWithoutEllipsis(
        await loadCompiler(),
        component,
        source,
      );
      for (const element of elements) {
        const { line, col } = element.startSourceSpan.start;
        const { offset } = component;
        // An inline template's first line continues the component's line.
        const location = offset
          ? `${offset.line + line + 1}:${(line === 0 ? offset.character + col : col) + 1}`
          : `${line + 1}:${col + 1}`;
        const fileName = path.relative(process.cwd(), component.file);
        const fix =
          element.name === 'ui-text'
            ? 'Use [maxLines] instead, which sets both'
            : 'Add the text-ellipsis class';
        const classes = staticClasses(element);
        diagnostics.push({
          // The component, even for a templateUrl: the report keeps the
          // diagnostics of the files the bundle contains, and the bundle
          // contains the component, not its HTML.
          file: filePath,
          message: `${fileName}:${location}: <${element.name}> sets text-maxline without text-overflow: ellipsis. ${fix}.`,
          category: 'text',
          // A global stylesheet, such as the app's styles.css, may end one of
          // the element's classes with "…" (`.summary { text-overflow:
          // ellipsis }`, as the styling guide does).
          excusedByStylesheet: (css) => {
            const excusing = ellipsisClasses(css);
            return classes.some((name) => excusing.has(name));
          },
        });
      }
    }
  }

  return diagnostics;
};
