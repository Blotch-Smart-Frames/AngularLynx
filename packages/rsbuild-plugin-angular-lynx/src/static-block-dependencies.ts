// cspell:words ɵɵDirectiveDeclaration ɵɵComponentDeclaration ɵɵPipeDeclaration
import * as ts from 'typescript';
import {
  type Dependency,
  type ResolveDependency,
  type Selector,
  definitionsOf,
} from './static-blocks.js';

const SELECTOR_NOT = 1;
const SELECTOR_CLASS = 8;

/**
 * A selector as Angular writes it in a library's type declarations (`"view"`,
 * `"[routerLink]"`, `"button[uiButton], a[uiButton]"`) as the runtime keeps
 * it. Errs towards matching what it doesn't follow: a `:not()` becomes a
 * selector that matches anything with its tag, and an attribute's value is
 * left out (an attribute with any value matches).
 */
export const parseSelector = (text: string): Selector[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const tag = /^[a-zA-Z][\w-]*/.exec(part)?.[0] ?? '';
      const selector: Array<string | number> = [tag];
      const classes: string[] = [];
      let rest = part.slice(tag.length);
      if (rest.includes(':')) {
        // `:not(...)` and the rest: a selector the pass treats as matching.
        selector.push(SELECTOR_NOT);
        return selector;
      }
      while (rest.length > 0) {
        const attribute = /^\[([^\]=~|^$*]+)[^\]]*\]/.exec(rest);
        if (attribute) {
          selector.push(attribute[1]!.trim(), '');
          rest = rest.slice(attribute[0].length);
          continue;
        }
        const name = /^\.([\w-]+)/.exec(rest);
        if (name) {
          classes.push(name[1]!);
          rest = rest.slice(name[0].length);
          continue;
        }
        // Something else: treat it as matching.
        return [tag, SELECTOR_NOT];
      }
      if (classes.length > 0) selector.push(SELECTOR_CLASS, ...classes);
      return selector;
    });

/**
 * The element directives of LYNX_ELEMENTS that the runtime stops Angular
 * matching (its lynx-elements/declaration-only.ts, #581): a direct subclass of
 * LynxElementBase that selects one tag. They match nothing at runtime, so a
 * static element they'd select loses nothing. Only the tags a static block
 * can hold matter here.
 */
const declarationOnly = (
  declaration: ts.ClassDeclaration,
  selector: string,
): boolean =>
  ['view', 'text', 'image'].includes(selector) &&
  (declaration.heritageClauses ?? []).some(
    (clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword &&
      clause.types.some(
        (type) =>
          ts.isIdentifier(type.expression) &&
          type.expression.text === 'LynxElementBase',
      ),
  );

/**
 * The directives, components and pipes a type declaration file declares, by
 * class name: `static ɵdir: i0.ɵɵDirectiveDeclaration<X, "selector", …>`.
 */
const declarationsOf = (sourceFile: ts.SourceFile): Map<string, Dependency> => {
  const found = new Map<string, Dependency>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      for (const member of node.members) {
        if (
          !ts.isPropertyDeclaration(member) ||
          !member.type ||
          !ts.isTypeReferenceNode(member.type)
        ) {
          continue;
        }
        const typeName = member.type.typeName;
        const kind = ts.isQualifiedName(typeName)
          ? typeName.right.text
          : typeName.text;
        if (kind === 'ɵɵPipeDeclaration') {
          found.set(node.name.text, 'pipe');
        } else if (
          kind === 'ɵɵDirectiveDeclaration' ||
          kind === 'ɵɵComponentDeclaration'
        ) {
          const selector = member.type.typeArguments?.[1];
          if (
            selector &&
            ts.isLiteralTypeNode(selector) &&
            ts.isStringLiteral(selector.literal)
          ) {
            found.set(
              node.name.text,
              declarationOnly(node, selector.literal.text)
                ? []
                : parseSelector(selector.literal.text),
            );
          } else if (selector && selector.kind === ts.SyntaxKind.NeverKeyword) {
            // No selector: a host directive, which matches no element.
            found.set(node.name.text, []);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

/**
 * Finds what the components and directives a template uses are, for
 * foldStaticBlocks: from the app's compiled modules (Angular's
 * `ɵɵdefineDirective` and the rest) and from libraries' type declarations,
 * following re-exports. Anything it can't find is null, and the component
 * that uses it keeps its whole template.
 *
 * @param compiled - The app's compiled module code by file path, or
 *   undefined for a file Angular didn't compile.
 */
export const createDependencyResolver = (
  compiled: (file: string) => string | undefined,
  compilerOptions: ts.CompilerOptions,
): ((containingFile: string) => ResolveDependency) => {
  const files = new Map<string, ts.SourceFile | null>();
  const sourceOf = (file: string): ts.SourceFile | null => {
    let sourceFile = files.get(file);
    if (sourceFile !== undefined) return sourceFile;
    const text = file.endsWith('.d.ts')
      ? ts.sys.readFile(file)
      : compiled(file);
    sourceFile =
      text === undefined
        ? null
        : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    files.set(file, sourceFile);
    return sourceFile;
  };
  const definitions = new Map<string, Map<string, Dependency>>();
  const definitionsIn = (sourceFile: ts.SourceFile) => {
    let found = definitions.get(sourceFile.fileName);
    if (!found) {
      found = sourceFile.isDeclarationFile
        ? declarationsOf(sourceFile)
        : definitionsOf(sourceFile);
      definitions.set(sourceFile.fileName, found);
    }
    return found;
  };
  const resolveModule = (specifier: string, from: string): string | null =>
    ts.resolveModuleName(specifier, from, compilerOptions, ts.sys)
      .resolvedModule?.resolvedFileName ?? null;

  const find = (file: string, name: string, depth: number): Dependency => {
    if (depth > 8) return null;
    const sourceFile = sourceOf(file);
    if (!sourceFile) return null;
    // The export's local name, and where it's re-exported from.
    let local = name;
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      const from =
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.name.text !== name) continue;
          const original = (element.propertyName ?? element.name).text;
          if (from === null) {
            local = original;
          } else {
            const target = resolveModule(from, file);
            return target ? find(target, original, depth + 1) : null;
          }
        }
      }
    }
    const own = definitionsIn(sourceFile).get(local);
    if (own !== undefined) return own;
    // `export * from '…'`.
    for (const statement of sourceFile.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.exportClause &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = resolveModule(statement.moduleSpecifier.text, file);
        const found = target ? find(target, name, depth + 1) : null;
        if (found !== null) return found;
      }
    }
    return null;
  };

  return (containingFile) => (specifier, name) => {
    const file = resolveModule(specifier, containingFile);
    return file ? find(file, name, 0) : null;
  };
};
