// cspell:words ɵɵdefineComponent ɵɵelementStart ɵɵelement ɵɵelementEnd ɵɵdomElementStart ɵɵdomElement ɵɵdomElementEnd ɵɵtext ɵɵadvance
import * as ts from 'typescript';
import { applyEdits, type Edit } from './source-map-edits.js';

/**
 * The attribute a static block's root element gets, whose value is the
 * block: the runtime's renderer builds the block's elements under the root
 * when Angular sets it (see the runtime's static-blocks/). The runtime has
 * its own copy, which a test keeps the same.
 */
export const STATIC_BLOCK_ATTRIBUTE = 'ng-lynx-static';

/**
 * The elements a static block can hold. Each is a plain Lynx element that
 * LynxDocument creates with one `__Create*` call and nothing else, so the
 * runtime can create it the same way without a LynxElement. Other tags have
 * more to them: a `scroll-view` listens for scrolls from the start, a `list`
 * is a LynxListElement, an HTML tag such as `div` takes the `_ngtag-div`
 * class and text styles, and a component's host is a component.
 */
const STATIC_TAGS: ReadonlySet<string> = new Set(['view', 'text', 'image']);

/**
 * The elements a static `<text>` root can sit in. A `<text>` in a `<text>`
 * shares its parent's line, whose spaces the runtime trims across all of its
 * runs at the end of the cycle; a static run isn't one it can see. So a
 * `<text>` root needs a parent that starts a new line. A component's host can
 * be a `<text>` (registerHostElement), so a template's top level doesn't count.
 */
const BLOCK_PARENTS: ReadonlySet<string> = new Set([
  'view',
  'scroll-view',
  'list-item',
]);

/**
 * Attributes LynxElement.setAttribute does more with than `__SetAttribute`:
 * `hidden` and `alt` become other attributes, `id` is `__SetID`, and
 * `accessibility-traits` adds the runtime's own traits. A static element with
 * one stays an element of Angular's.
 */
const SPECIAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'hidden',
  'alt',
  'id',
  'accessibility-traits',
]);

/**
 * Inline styles the runtime rewrites or follows (env(safe-area-inset-*),
 * nested calc(), custom properties, `display: block`), which a static element
 * would get unchanged.
 */
const SPECIAL_STYLE = /env\(|calc\(|var\(|--|display/;

/** Angular's AttributeMarker values (`@angular/core`'s `AttributeMarker`). */
const MARKER_CLASSES = 1;
const MARKER_STYLES = 2;

const ELEMENT_START = new Set(['ɵɵelementStart', 'ɵɵdomElementStart']);
const ELEMENT = new Set(['ɵɵelement', 'ɵɵdomElement']);
const ELEMENT_END = new Set(['ɵɵelementEnd', 'ɵɵdomElementEnd']);

/** One instruction call, with a chained call (`ɵɵelementEnd()()`) split out. */
type Call = {
  /** `i0`, the namespace Angular's compiler imports @angular/core as. */
  namespace: string;
  name: string;
  args: readonly ts.Expression[];
};

/** A statement of a creation block other than instruction calls. */
type Opaque = { text: string };

type ElementNode = {
  kind: 'element';
  index: number;
  tag: string;
  constIndex: number | null;
  /** The element's static class names, style and other attributes. */
  attrs: StaticAttrs | null;
  /** Something other than a static element or text happened inside it. */
  dynamic: boolean;
  children: Node[];
  parent: ElementNode | null;
  /** Its start and end in the creation block's item list. */
  start: number;
  end: number;
  /** Whether Angular's DOM-only instructions created it. */
  dom: boolean;
};

type TextNode = {
  kind: 'text';
  index: number;
  /** The text, or null for an interpolation's text. */
  value: string | null;
};

type Node = ElementNode | TextNode;

type StaticAttrs = {
  classes: string[];
  style: string;
  /** Other attributes, name then value. */
  pairs: string[];
  /** The consts entry's elements as written, for the root's new entry. */
  source: string[];
};

/**
 * The static description of a block's elements under its root, as the
 * runtime reads it (its StaticNode): `[tag, classes, style, attributes,
 * children]` for an element and a string for a text.
 */
type StaticNode = string | [string, string, string, string[], StaticNode[]];

/**
 * Folds each static part of a module's component templates into its root
 * element, which builds the rest with Lynx's element calls.
 *
 * Angular creates every element and text of a template with its own
 * instructions: a node in the view's data, a native element through the
 * renderer, and a LynxElement wrapper around it, each with work at creation
 * and in every change detection pass. On PrimJS, which has no JIT, that is
 * what a screen spends most of its time on (#444). ReactLynx's compiler turns
 * the static part of each JSX tree into a "snapshot", one function that
 * creates those elements with Lynx's element calls directly.
 *
 * This does the same for Angular's compiled output. A subtree of `<view>`,
 * `<text>` and `<image>` elements and static text, with no binding, listener,
 * local reference, directive, component, control flow, projection, i18n or
 * animation anywhere in it, keeps only its root as an Angular element. The
 * root's consts entry gets the {@link STATIC_BLOCK_ATTRIBUTE} attribute whose
 * value is the description of the rest, and the instructions for the rest go.
 * Their slots in the view stay, empty: renumbering the nodes after them would
 * mean rewriting every index and `ɵɵadvance()` in the template.
 *
 * Only Lynx elements whose runtime handling the runtime can repeat without a
 * LynxElement qualify (see STATIC_TAGS, SPECIAL_ATTRIBUTES, SPECIAL_STYLE),
 * and text only as the one run of a `<text>` that starts a line. Anything the
 * pass doesn't recognize leaves the element where it is in Angular's hands.
 *
 * @param code - The module's code as Angular compiled it.
 * @param filename - The module's path, for the parser.
 * @param resolveDependency - What a directive, component or pipe another
 *   module exports is, by the module's specifier and the export's name. A
 *   component whose dependencies aren't all known keeps its template: one of
 *   them could match a static element, which would then get no directive.
 * @returns The transformed code, or `code` itself when nothing folds.
 */
export const foldStaticBlocks = (
  code: string,
  filename: string,
  resolveDependency: ResolveDependency,
): string => {
  if (!code.includes('ɵɵdefineComponent')) return code;
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  // The module's template functions for embedded views (`@if`, `@for`,
  // `ng-template`), which share their component's consts.
  const functions = new Map<string, ts.FunctionDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
  }

  const imports = importsOf(sourceFile);
  const edits: Edit[] = [];
  const declarations: string[] = [];
  let blockCount = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'ɵɵdefineComponent' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const definition = node.arguments[0];
      const consts = property(definition, 'consts');
      const template = property(definition, 'template');
      // A function for consts (i18n) or none at all: leave the component.
      if (
        !consts ||
        !ts.isArrayLiteralExpression(consts) ||
        !template ||
        !ts.isFunctionExpression(template)
      ) {
        return;
      }
      const selectors = dependencySelectors(
        property(definition, 'dependencies'),
        sourceFile,
        imports,
        resolveDependency,
      );
      if (!selectors) return;
      const constEntries = consts.elements.map((element) =>
        ts.isArrayLiteralExpression(element) ? element : null,
      );
      const newConsts: string[] = [];
      const templates = templateFunctions(template, functions, sourceFile);
      for (const fn of templates) {
        const result = foldTemplate(fn, sourceFile, constEntries, selectors, {
          addConst: (text) => {
            newConsts.push(text);
            return consts.elements.length + newConsts.length - 1;
          },
          addBlock: (description) => {
            // A name the module doesn't use already.
            let name = `ɵngLynxStatic${blockCount++}`;
            while (code.includes(name)) name = `ɵngLynxStatic${blockCount++}`;
            declarations.push(
              `const ${name} = ${JSON.stringify(description)};`,
            );
            return name;
          },
        });
        if (result) edits.push(result);
      }
      if (newConsts.length > 0) {
        // After the last entry, with a comma unless the array is empty.
        const end = consts.elements.end;
        const comma =
          consts.elements.length > 0
            ? consts.elements.hasTrailingComma
              ? ''
              : ', '
            : '';
        edits.push({
          start: end,
          end,
          text: comma + newConsts.join(', '),
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (edits.length === 0) return code;
  // The declarations go before everything else: a component's definition,
  // which reads them, is made as its class is defined. Imports are hoisted
  // above them. One call, so a source map follows every edit (see
  // source-map-edits.ts).
  return applyEdits(code, [
    { start: 0, end: 0, text: `${declarations.join('\n')}\n` },
    ...edits,
  ]);
};

/**
 * A selector as Angular's runtime keeps it (its `CssSelector`): the tag
 * (`''` for any), then attribute names and values, with numbers that switch
 * to classes (8) or start a `:not()` (1).
 */
export type Selector = ReadonlyArray<string | number>;

/**
 * A dependency of a component as the pass sees it: a pipe, which matches no
 * element, the selectors of a directive or component, or null when it isn't
 * known.
 */
export type Dependency = 'pipe' | readonly Selector[] | null;

/**
 * Finds what the export `name` of the module `specifier` is.
 */
export type ResolveDependency = (specifier: string, name: string) => Dependency;

const SELECTOR_NOT = 1;
const SELECTOR_CLASS = 8;

/**
 * The directives, components and pipes a module defines, by class name.
 */
export const definitionsOf = (
  sourceFile: ts.SourceFile,
): Map<string, Dependency> => {
  const found = new Map<string, Dependency>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const kind = node.expression.name.text;
      const definition = node.arguments[0];
      const type = property(definition, 'type');
      if (type && ts.isIdentifier(type)) {
        if (kind === 'ɵɵdefinePipe') {
          found.set(type.text, 'pipe');
        } else if (
          kind === 'ɵɵdefineComponent' ||
          kind === 'ɵɵdefineDirective'
        ) {
          found.set(
            type.text,
            literalSelectors(property(definition, 'selectors')),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const literalSelectors = (
  expression: ts.Expression | undefined,
): readonly Selector[] | null => {
  // A directive with no selector (a host directive's) matches nothing.
  if (!expression) return [];
  if (!ts.isArrayLiteralExpression(expression)) return null;
  const selectors: Selector[] = [];
  for (const element of expression.elements) {
    if (!ts.isArrayLiteralExpression(element)) return null;
    const selector: Array<string | number> = [];
    for (const part of element.elements) {
      const value = stringOf(part) ?? numberOf(part);
      if (value === null) return null;
      selector.push(value);
    }
    selectors.push(selector);
  }
  return selectors;
};

/** Where each import of a module comes from. */
type Imports = {
  /** `import * as i1 from '…'`: the namespace's name to the specifier. */
  namespaces: Map<string, string>;
  /** `import { A as B } from '…'`: B to the specifier and A. */
  named: Map<string, { specifier: string; name: string }>;
};

const importsOf = (sourceFile: ts.SourceFile): Imports => {
  const imports: Imports = { namespaces: new Map(), named: new Map() };
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      imports.namespaces.set(bindings.name.text, specifier);
    } else {
      for (const element of bindings.elements) {
        imports.named.set(element.name.text, {
          specifier,
          name: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  return imports;
};

/**
 * The selectors of everything a component's template matches, or null when
 * one of its dependencies isn't known. Angular lists only the directives and
 * components the template uses, each with its selectors.
 */
const dependencySelectors = (
  dependencies: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  imports: Imports,
  resolve: ResolveDependency,
): Selector[] | null => {
  if (!dependencies) return [];
  // `dependencies: () => [...]` when one is declared later in the file.
  let list: ts.Expression = dependencies;
  if (ts.isArrowFunction(list) && !ts.isBlock(list.body)) list = list.body;
  if (!ts.isArrayLiteralExpression(list)) return null;
  let local: Map<string, Dependency> | null = null;
  const selectors: Selector[] = [];
  for (const element of list.elements) {
    let dependency: Dependency = null;
    if (
      ts.isPropertyAccessExpression(element) &&
      ts.isIdentifier(element.expression)
    ) {
      const specifier = imports.namespaces.get(element.expression.text);
      if (specifier) dependency = resolve(specifier, element.name.text);
    } else if (ts.isIdentifier(element)) {
      const imported = imports.named.get(element.text);
      if (imported) {
        dependency = resolve(imported.specifier, imported.name);
      } else {
        local ??= definitionsOf(sourceFile);
        dependency = local.get(element.text) ?? null;
      }
    }
    if (dependency === null) return null;
    if (dependency !== 'pipe') selectors.push(...dependency);
  }
  return selectors;
};

/**
 * Whether a selector could match an element with this tag, these classes and
 * these attributes. It errs towards matching: a `:not()` matches, and an
 * attribute matches whatever its value.
 */
const couldMatch = (
  selector: Selector,
  tag: string,
  classes: readonly string[],
  attributes: ReadonlySet<string>,
): boolean => {
  if (selector[0] && selector[0] !== tag) return false;
  let inClasses = false;
  for (let i = 1; i < selector.length; i++) {
    const part = selector[i]!;
    if (typeof part === 'number') {
      if (part & SELECTOR_NOT) return true;
      inClasses = (part & SELECTOR_CLASS) !== 0;
      continue;
    }
    if (inClasses) {
      // Angular matches class names whatever their case (its
      // isCssClassMatching).
      const name = part.toLowerCase();
      if (!classes.some((own) => own.toLowerCase() === name)) return false;
    } else {
      if (!attributes.has(part)) return false;
      i++;
    }
  }
  return true;
};

const matchesAny = (
  selectors: readonly Selector[],
  tag: string,
  attrs: StaticAttrs,
): boolean => {
  if (selectors.length === 0) return false;
  const attributes = new Set<string>();
  for (let i = 0; i < attrs.pairs.length; i += 2)
    attributes.add(attrs.pairs[i]!);
  if (attrs.classes.length > 0) attributes.add('class');
  if (attrs.style) attributes.add('style');
  return selectors.some((selector) =>
    couldMatch(selector, tag, attrs.classes, attributes),
  );
};

const property = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined => {
  for (const element of object.properties) {
    if (
      ts.isPropertyAssignment(element) &&
      ts.isIdentifier(element.name) &&
      element.name.text === name
    ) {
      return element.initializer;
    }
  }
  return undefined;
};

/**
 * A component's template function and the embedded views' template functions
 * it reaches, which all index into the component's consts.
 */
const templateFunctions = (
  template: ts.FunctionExpression,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  sourceFile: ts.SourceFile,
): Array<ts.FunctionExpression | ts.FunctionDeclaration> => {
  const found: Array<ts.FunctionExpression | ts.FunctionDeclaration> = [
    template,
  ];
  const seen = new Set<string>();
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const fn = functions.get(node.text);
      if (fn && fn.name !== node && node.getSourceFile() === sourceFile) {
        seen.add(node.text);
        found.push(fn);
        ts.forEachChild(fn, scan);
      }
    }
    ts.forEachChild(node, scan);
  };
  ts.forEachChild(template, scan);
  return found;
};

/**
 * The creation (`rf & 1`) or update (`rf & 2`) block of a template function.
 */
const block = (
  fn: ts.FunctionExpression | ts.FunctionDeclaration,
  flag: number,
): ts.Block | undefined => {
  for (const statement of fn.body!.statements) {
    if (
      ts.isIfStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind ===
        ts.SyntaxKind.AmpersandToken &&
      ts.isNumericLiteral(statement.expression.right) &&
      Number(statement.expression.right.text) === flag &&
      ts.isBlock(statement.thenStatement)
    ) {
      return statement.thenStatement;
    }
  }
  return undefined;
};

/**
 * The instruction calls of a statement such as `i0.ɵɵelementStart(0, "view",
 * 0)(1, "view", 1);`, first to last, or null for any other statement.
 */
const callsOf = (statement: ts.Statement): Call[] | null => {
  if (!ts.isExpressionStatement(statement)) return null;
  const argLists: Array<readonly ts.Expression[]> = [];
  let expression: ts.Expression = statement.expression;
  while (ts.isCallExpression(expression)) {
    argLists.unshift(expression.arguments);
    expression = expression.expression;
  }
  if (
    argLists.length === 0 ||
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    !expression.name.text.startsWith('ɵɵ')
  ) {
    return null;
  }
  const namespace = expression.expression.text;
  const name = expression.name.text;
  return argLists.map((args) => ({ namespace, name, args }));
};

const numberOf = (expression: ts.Expression | undefined): number | null =>
  expression && ts.isNumericLiteral(expression)
    ? Number(expression.text)
    : null;

const stringOf = (expression: ts.Expression | undefined): string | null =>
  expression &&
  (ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : null;

/**
 * The slots the update block's instructions write to. `ɵɵadvance(n)` moves
 * the selected slot on by n (1 without an argument), and every other
 * instruction reads or writes the selected one. Null when the block has an
 * `ɵɵadvance()` anywhere but as a statement of its own, which this can't
 * follow.
 */
const boundSlots = (update: ts.Block | undefined): Set<number> | null => {
  const bound = new Set<number>();
  if (!update) return bound;
  let selected = 0;
  for (const statement of update.statements) {
    const calls = callsOf(statement);
    if (calls && calls[0]!.name === 'ɵɵadvance') {
      for (const call of calls) {
        if (call.args.length === 0) {
          selected += 1;
        } else {
          const delta = numberOf(call.args[0]);
          if (delta === null) return null;
          selected += delta;
        }
      }
      continue;
    }
    let advances = false;
    const find = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'ɵɵadvance'
      ) {
        advances = true;
      }
      ts.forEachChild(node, find);
    };
    find(statement);
    if (advances) return null;
    // An instruction reads or writes the selected slot; a statement of
    // another kind (`let tmp_0_0;`) doesn't.
    if (calls) bound.add(selected);
  }
  return bound;
};

/**
 * The static attributes of an element's consts entry: name-value pairs,
 * classes and styles, nothing else.
 */
const staticAttrs = (
  entry: ts.ArrayLiteralExpression | null | undefined,
  sourceFile: ts.SourceFile,
): StaticAttrs | null => {
  if (!entry) return null;
  const attrs: StaticAttrs = {
    classes: [],
    style: '',
    pairs: [],
    source: entry.elements.map((element) => element.getText(sourceFile)),
  };
  const styles: string[] = [];
  let marker = 0;
  const elements = entry.elements;
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!;
    const number = numberOf(element);
    if (number !== null) {
      if (number !== MARKER_CLASSES && number !== MARKER_STYLES) return null;
      marker = number;
      continue;
    }
    const text = stringOf(element);
    if (text === null) return null;
    if (marker === MARKER_CLASSES) {
      attrs.classes.push(text);
    } else if (marker === MARKER_STYLES) {
      const value = stringOf(elements[++i]);
      if (value === null) return null;
      // As Angular writes an element's static style (`height: 8px;`).
      styles.push(`${text}: ${value};`);
    } else {
      const value = stringOf(elements[++i]);
      if (
        value === null ||
        SPECIAL_ATTRIBUTES.has(text) ||
        text.startsWith('data-') ||
        text.startsWith('@') ||
        text.includes(':') ||
        text === 'ngSkipHydration' ||
        text === STATIC_BLOCK_ATTRIBUTE
      ) {
        return null;
      }
      attrs.pairs.push(text, value);
    }
  }
  attrs.style = styles.join(' ');
  if (SPECIAL_STYLE.test(attrs.style)) return null;
  return attrs;
};

const EMPTY_ATTRS: StaticAttrs = {
  classes: [],
  style: '',
  pairs: [],
  source: [],
};

/**
 * The creation block's tree of elements and texts, with each element marked
 * dynamic when anything but a static element or text happens inside it.
 */
const parseCreation = (
  items: Array<Call | Opaque>,
  constEntries: ReadonlyArray<ts.ArrayLiteralExpression | null>,
  sourceFile: ts.SourceFile,
  selectors: readonly Selector[],
): Node[] => {
  const roots: Node[] = [];
  const stack: ElementNode[] = [];
  const markOpenDynamic = () => {
    for (const open of stack) open.dynamic = true;
  };
  const add = (node: Node) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
  };
  items.forEach((item, position) => {
    if (!('name' in item)) {
      markOpenDynamic();
      return;
    }
    const { name, args } = item;
    const isStart = ELEMENT_START.has(name);
    if (isStart || ELEMENT.has(name)) {
      const index = numberOf(args[0]);
      const tag = stringOf(args[1]);
      const constIndex = args[2] === undefined ? null : numberOf(args[2]);
      const attrs =
        args[2] === undefined
          ? EMPTY_ATTRS
          : constIndex === null
            ? null
            : staticAttrs(constEntries[constIndex], sourceFile);
      const node: ElementNode = {
        kind: 'element',
        index: index ?? -1,
        tag: tag ?? '',
        constIndex,
        attrs,
        // A local reference (the fourth argument) is something a query or
        // the template reads.
        dynamic:
          index === null ||
          tag === null ||
          !STATIC_TAGS.has(tag) ||
          attrs === null ||
          args.length > 3 ||
          // A directive or component it matches, which needs Angular.
          matchesAny(selectors, tag, attrs),
        children: [],
        parent: stack[stack.length - 1] ?? null,
        start: position,
        end: position,
        dom: name.startsWith('ɵɵdom'),
      };
      if (node.dynamic) markOpenDynamic();
      add(node);
      if (isStart) stack.push(node);
      return;
    }
    if (ELEMENT_END.has(name)) {
      // Angular closes every element it opens.
      stack.pop()!.end = position;
      return;
    }
    if (name === 'ɵɵtext') {
      const index = numberOf(args[0]);
      const value = args.length === 2 ? stringOf(args[1]) : null;
      if (index === null) {
        markOpenDynamic();
        return;
      }
      add({ kind: 'text', index, value });
      return;
    }
    // A listener, a container, a template, a projection, i18n, an
    // animation, @defer, @let...: whatever it is, it belongs to the open
    // element or adds a node to it.
    markOpenDynamic();
  });
  return roots;
};

/**
 * Whether a node and everything under it can be built without Angular, given
 * the slots the update block writes to.
 */
const isStatic = (node: ElementNode, bound: ReadonlySet<number>): boolean => {
  if (bound.has(node.index) || node.dynamic) return false;
  if (node.tag === 'image') return node.children.length === 0;
  if (node.tag === 'text') {
    // One run, which then is the whole line: the runtime trims its edges
    // the same way at creation. A `<text>` in a `<text>`, or two runs,
    // share spaces across runs, which the runtime trims together.
    if (node.children.length === 0) return true;
    const [only] = node.children;
    return (
      node.children.length === 1 &&
      only!.kind === 'text' &&
      only!.value !== null &&
      !bound.has(only!.index) &&
      trimRun(only!.value) !== ''
    );
  }
  // A <view>'s loose text is drawn in an anonymous <text> the runtime makes.
  return node.children.every(
    (child) => child.kind === 'element' && isStatic(child, bound),
  );
};

/**
 * A run's text as the runtime shows it when it's the only run of its line:
 * each run of whitespace collapsed to a space (LynxRenderer.createText), and
 * the edges trimmed (LynxElement's text normalization).
 */
const trimRun = (value: string): string =>
  value
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ /, '')
    .replace(/ $/, '');

const describe = (node: ElementNode): StaticNode => {
  const attrs = node.attrs!;
  const children: StaticNode[] = node.children.map((child) =>
    child.kind === 'text' ? trimRun(child.value!) : describe(child),
  );
  return [
    node.tag,
    attrs.classes.join(' '),
    attrs.style,
    attrs.pairs,
    children,
  ];
};

/**
 * Folds one template function's static blocks: returns the edit that
 * replaces its creation block, or null when nothing in it folds.
 */
const foldTemplate = (
  fn: ts.FunctionExpression | ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  constEntries: ReadonlyArray<ts.ArrayLiteralExpression | null>,
  selectors: readonly Selector[],
  out: {
    addConst: (text: string) => number;
    addBlock: (description: StaticNode[]) => string;
  },
): { start: number; end: number; text: string } | null => {
  const creation = block(fn, 1);
  if (!creation) return null;
  const bound = boundSlots(block(fn, 2));
  if (!bound) return null;

  const items: Array<Call | Opaque> = [];
  for (const statement of creation.statements) {
    const calls = callsOf(statement);
    if (calls) items.push(...calls);
    else items.push({ text: statement.getText(sourceFile) });
  }
  const roots: ElementNode[] = [];
  const findRoots = (nodes: Node[], parent: ElementNode | null): void => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue;
      if (
        isStatic(node, bound) &&
        node.children.length > 0 &&
        (node.tag !== 'text' ||
          (parent !== null && BLOCK_PARENTS.has(parent.tag)))
      ) {
        roots.push(node);
      } else {
        findRoots(node.children, node);
      }
    }
  };
  findRoots(parseCreation(items, constEntries, sourceFile, selectors), null);
  if (roots.length === 0) return null;

  const folded = new Map<number, ElementNode>();
  for (const root of roots) {
    for (let i = root.start; i <= root.end; i++) folded.set(i, root);
  }
  const lines: string[] = [];
  items.forEach((item, position) => {
    const root = folded.get(position);
    if (root) {
      if (position !== root.start) return;
      const description = root.children.map((child) =>
        child.kind === 'text' ? trimRun(child.value!) : describe(child),
      );
      const name = out.addBlock(description);
      const constIndex = out.addConst(
        `[${[
          JSON.stringify(STATIC_BLOCK_ATTRIBUTE),
          name,
          ...root.attrs!.source,
        ].join(', ')}]`,
      );
      const call = root.dom ? 'ɵɵdomElement' : 'ɵɵelement';
      const { namespace } = item as Call;
      lines.push(
        `${namespace}.${call}(${root.index}, ${JSON.stringify(root.tag)}, ${constIndex});`,
      );
      return;
    }
    if ('name' in item) {
      const args = item.args.map((arg) => arg.getText(sourceFile)).join(', ');
      lines.push(`${item.namespace}.${item.name}(${args});`);
    } else {
      lines.push(item.text);
    }
  });
  // The block's statements, without its braces.
  return {
    start: creation.getStart(sourceFile) + 1,
    end: creation.getEnd() - 1,
    text: `\n${lines.join('\n')}\n`,
  };
};
