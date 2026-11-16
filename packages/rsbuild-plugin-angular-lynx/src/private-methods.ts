import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

export type PrivateMethodsOptions = {
  /** The directory the file keys are relative to, as in cross-thread-transform.ts. */
  root: string;
};

type Edit = { start: number; end: number; text: string };

/**
 * A class's private names, each with its new name: `undefined` for one that
 * stays private (a field, or a static member).
 */
type ClassScope = {
  names: Map<string, string | undefined>;
  /** The class uses `#name in object`, so it keeps all its names. */
  kept: boolean;
};

/**
 * A module of one of AngularLynx's packages installed in `node_modules`: the
 * last `node_modules` in its path is followed by `@blotch/` (THIRD_PARTY in
 * layers.ts, the other way round).
 */
const INSTALLED_PACKAGE =
  /[\\/]node_modules[\\/]@blotch[\\/](?:(?![\\/]node_modules[\\/]).)*$/;

/**
 * The folder that holds this plugin's package: `packages/` in this
 * repository, whose examples resolve the runtime to `packages/runtime/dist`
 * (their tsconfig `paths`) rather than through `node_modules`.
 */
const PACKAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/**
 * Whether `file` is AngularLynx's own published code: in a `@blotch/` package
 * in `node_modules`, or in the build output (`<package>/dist/`) of a package
 * next to this one, as this repository's examples resolve the runtime.
 *
 * @param file - The module's path.
 * @param packagesDir - The folder this plugin's package is in.
 */
export const isAngularLynxPackageModule = (
  file: string,
  packagesDir: string = PACKAGES_DIR,
): boolean => {
  if (INSTALLED_PACKAGE.test(file)) {
    return true;
  }
  const relative = path.relative(packagesDir, file);
  return (
    !path.isAbsolute(relative) &&
    /^(?!\.\.[\\/])[^\\/]+[\\/]dist[\\/]/.test(relative) &&
    !/[\\/]node_modules[\\/]/.test(relative)
  );
};

/**
 * {@link renamePrivateMethods} for AngularLynx's own packages only (see
 * {@link isAngularLynxPackageModule}); other modules come back unchanged.
 *
 * Only the packages for now: the runtime holds the classes that are built
 * the most (an element wrapper for every element, text node and anchor
 * Angular creates), and its code is written to keep clear of the differences
 * listed on {@link renamePrivateMethods}. The app's own code, and the UI
 * components dolan copies into it, keep the standard compile until this has
 * run in apps for a while.
 */
export const renamePackagePrivateMethods = (
  code: string,
  filename: string,
  options: PrivateMethodsOptions,
): string =>
  isAngularLynxPackageModule(filename)
    ? renamePrivateMethods(code, filename, options)
    : code;

/**
 * Turns each class's instance `#private` methods, getters and setters into
 * ordinary methods with unique public names, so they're defined once on the
 * prototype instead of on every instance.
 *
 * The main thread compiles to ES2019 with SWC's `privateFieldsAsProperties`
 * (layers.ts). It lowers an instance private method to an
 * `Object.defineProperty(this, _m, { value: m })` in the constructor, so each
 * `new` makes one descriptor and one defineProperty call per method, and the
 * instance gets one more property for each. `LynxElement` has 41 of them, all
 * for methods that never change, and the runtime makes one for every element,
 * text node and anchor Angular creates. They were about half the time it took
 * to create one under V8 without its JIT (`node --jitless`), the nearest
 * stand-in for PrimJS, which has no JIT to take that cost away.
 *
 * `#m(…) {…}` becomes `__m_<key><n>(…) {…}`, where `<key>` comes from the
 * file and `<n>` counts the module's classes, so a subclass's `#m` doesn't
 * override its base's, even in another module. Every `x.#m` and `x?.#m`
 * that names it becomes `x.__m_<key><n>` (or `x?.…`). A private name belongs
 * to the innermost class that declares it, so a nested class's own `#m` is
 * renamed apart from the outer one's.
 *
 * The names are per class in the source, not per class made, which is the
 * same thing for a class the module makes once: one at the top level, or in
 * a function called at once, such as the pure `(() => {…})()` Angular
 * wraps a decorated class in. A class expression that can run more
 * than once (a mixin or a class factory) makes a class each time, all with
 * the same names on their prototypes, so one of them made from another, as
 * `Mixin(Mixin(Base))` is, would override its base's `#m` with its own.
 *
 * Left as they are:
 *
 * - Private fields, which SWC compiles to properties for PrimJS's sake
 *   (issue #237, layers.ts), and static private methods, which are defined
 *   once anyway.
 * - Any class that uses `#name in object`: a public name can't answer it.
 * - A class with `extends` that can be made more than once: one inside a
 *   function that isn't called at once, inside a loop, or in an instance
 *   field's initializer. One without `extends` can't be made from another,
 *   and is renamed.
 *
 * As class methods, the renamed ones are non-enumerable and live on the
 * prototype: `Object.keys()` of an instance doesn't change, and
 * `Object.getOwnPropertyNames()` of one no longer lists them. Otherwise only
 * code that misuses a private member sees a difference: calling a method on
 * an object that isn't an instance (which TypeScript allows only through
 * `any` or a cast) still throws a TypeError, but "is not a function" rather
 * than the brand check's; reading one without calling it gives `undefined`;
 * and assigning to a method, or reading an accessor that has no getter,
 * which TypeScript rejects, no longer throws.
 *
 * Edits never add or remove a line. When Angular's transformer left an
 * inline source map at the end, its columns are moved to match, so the
 * chain from the original source stays exact.
 *
 * @param code - The module's code, after the cross-thread and worklet
 *   transforms (their IDs come from the code as written) and before SWC.
 * @param filename - The module's path, for the parser and the key.
 * @param options - See {@link PrivateMethodsOptions}.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const renamePrivateMethods = (
  code: string,
  filename: string,
  options: PrivateMethodsOptions,
): string => {
  if (!code.includes('#')) {
    return code;
  }
  // The script kind comes from the file name, as a `.ts` module can still
  // hold types here (see pure-classes.ts).
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const key = keyForFile(filename, options.root);
  let classCount = 0;

  /**
   * A class's private names, before its body is visited. `repeated` is
   * whether the class can be made more than once (see visit).
   */
  const declareClass = (
    node: ts.ClassLikeDeclaration,
    repeated: boolean,
  ): ClassScope => {
    const index = classCount++;
    const names = new Map<string, string | undefined>();
    for (const member of node.members) {
      if (!member.name || !ts.isPrivateIdentifier(member.name)) continue;
      const isMethod = ts.isMethodDeclaration(member) || ts.isAccessor(member);
      const name = member.name.text;
      // A getter and setter share one name, and so one new name.
      names.set(
        name,
        isMethod && !isStatic(member)
          ? `__${name.slice(1)}_${key}${index}`
          : undefined,
      );
    }
    // Every class it makes would share these names, and one made from
    // another would override its base's methods (see renamePrivateMethods).
    const extendsAnother =
      node.heritageClauses?.some(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      ) ?? false;
    return { names, kept: repeated && extendsAnother };
  };

  const references: Array<{ node: ts.PrivateIdentifier; scope: ClassScope }> =
    [];
  /**
   * The innermost class around the reference that declares the name.
   */
  const resolve = (name: string, scopes: ClassScope[]) => {
    for (let index = scopes.length - 1; index >= 0; index--) {
      if (scopes[index].names.has(name)) return scopes[index];
    }
    return undefined;
  };

  /**
   * Visits `node`. `repeated` is whether the code it's in can run more than
   * once while the module is evaluated once: in a function that isn't
   * called at once, a loop, or an instance field's initializer.
   */
  const visit = (
    node: ts.Node,
    scopes: ClassScope[],
    repeated: boolean,
  ): void => {
    if (ts.isClassLike(node)) {
      const inner = [...scopes, declareClass(node, repeated)];
      // `extends` and the class's decorators are evaluated outside its body,
      // where its private names don't exist yet.
      ts.forEachChild(node, (child) =>
        visit(
          child,
          ts.isHeritageClause(child) || ts.isDecorator(child) ? scopes : inner,
          repeated ||
            // An instance field's initializer runs for each instance.
            (ts.isPropertyDeclaration(child) && !isStatic(child)),
        ),
      );
      return;
    }
    if (ts.isPrivateIdentifier(node)) {
      const scope = resolve(node.text, scopes);
      if (scope?.names.get(node.text) !== undefined) {
        references.push({ node, scope });
      }
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isPrivateIdentifier(node.left)
    ) {
      // `#m in object` asks whether the object has the class's brand, which
      // only a private member carries. The class that declares the name, and
      // every class around the check, keep their private methods.
      for (const scope of scopes) {
        scope.kept = true;
      }
    }
    const repeats =
      repeated ||
      (ts.isFunctionLike(node) && !isCalledAtOnce(node)) ||
      ts.isIterationStatement(node, false);
    ts.forEachChild(node, (child) => visit(child, scopes, repeats));
  };
  visit(sourceFile, [], false);

  const edits: Edit[] = references
    .filter(({ scope }) => !scope.kept)
    .map(({ node, scope }) => ({
      start: node.getStart(sourceFile),
      end: node.end,
      text: scope.names.get(node.text)!,
    }))
    // In source order, as the edits below and the map's lines expect. Names
    // never overlap.
    .sort((a, b) => a.start - b.start);
  if (edits.length === 0) {
    return code;
  }
  let result = '';
  let last = 0;
  for (const { start, end, text } of edits) {
    result += code.slice(last, start) + text;
    last = end;
  }
  result += code.slice(last);
  return shiftInlineSourceMap(result, edits, sourceFile);
};

/**
 * Whether a class member is static.
 */
const isStatic = (member: ts.ClassElement): boolean =>
  ts
    .getModifiers(member as ts.HasModifiers)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ??
  false;

/**
 * Whether a function is called where it's written, and so runs once each
 * time the code around it does: `(() => {…})()`, as Angular wraps a
 * decorated class, or `(function () {…}())`. Parentheses around it don't
 * count.
 */
const isCalledAtOnce = (node: ts.Node): boolean => {
  let callee = node;
  while (ts.isParenthesizedExpression(callee.parent)) {
    callee = callee.parent;
  }
  return (
    ts.isCallExpression(callee.parent) && callee.parent.expression === callee
  );
};

/**
 * A short hash of the file's path from `root`, in POSIX form so a Windows
 * build gives the same names.
 */
const keyForFile = (filename: string, root: string): string => {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  return createHash('sha1').update(relative).digest('hex').slice(0, 6);
};

/** The inline source map Angular's transformer and compiler append. */
const INLINE_SOURCE_MAP =
  /(\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,)([A-Za-z0-9+/]+=*)(\s*)$/;

/**
 * Moves the columns of `code`'s inline source map by `edits`, which were made
 * to the code the map was written for. `code` comes back unchanged when it
 * has no inline map, or one this can't read: the build goes on, with a map
 * that's as wrong as it was.
 */
const shiftInlineSourceMap = (
  code: string,
  edits: Edit[],
  sourceFile: ts.SourceFile,
): string => {
  const match = INLINE_SOURCE_MAP.exec(code);
  if (!match) {
    return code;
  }
  let map: { mappings?: unknown };
  try {
    map = JSON.parse(Buffer.from(match[2], 'base64').toString('utf8'));
  } catch {
    return code;
  }
  const mappings = map.mappings;
  if (typeof mappings !== 'string') {
    return code;
  }
  // The edits on each line, in order, by column.
  const editsByLine = new Map<
    number,
    Array<{ start: number; end: number; delta: number }>
  >();
  for (const { start, end, text } of edits) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    const lineEdits = editsByLine.get(line) ?? [];
    lineEdits.push({
      start: character,
      end: character + end - start,
      delta: text.length - (end - start),
    });
    editsByLine.set(line, lineEdits);
  }
  try {
    map.mappings = mappings
      .split(';')
      .map((segments, line) => {
        const lineEdits = editsByLine.get(line);
        return lineEdits ? shiftColumns(segments, lineEdits) : segments;
      })
      .join(';');
  } catch {
    return code;
  }
  return (
    code.slice(0, match.index) +
    match[1] +
    Buffer.from(JSON.stringify(map)).toString('base64') +
    match[3]
  );
};

/**
 * One line of a source map's `mappings` with each segment's column moved past
 * the edits before it. A column inside an edit moves to the edit's start.
 */
const shiftColumns = (
  segments: string,
  edits: Array<{ start: number; end: number; delta: number }>,
): string => {
  const shift = (column: number): number => {
    let shifted = column;
    for (const { start, end, delta } of edits) {
      if (column >= end) shifted += delta;
      else if (column > start) shifted -= column - start;
    }
    return shifted;
  };
  // Each segment's first field is its column, relative to the segment
  // before it on the line; the other fields are left as they are.
  let column = 0;
  let previous = 0;
  return segments
    .split(',')
    .map((segment) => {
      if (segment === '') return segment;
      const [delta, next] = decodeVlq(segment);
      column += delta;
      const shifted = shift(column);
      const text = encodeVlq(shifted - previous) + segment.slice(next);
      previous = shifted;
      return text;
    })
    .join(',');
};

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The first base64 VLQ value in `text`, and where the next one starts. Throws
 * on a character that isn't base64, or a value that never ends, which would
 * otherwise read on forever.
 */
const decodeVlq = (text: string): [value: number, next: number] => {
  let value = 0;
  let shift = 0;
  let index = 0;
  let digit: number;
  do {
    digit = index < text.length ? BASE64.indexOf(text[index++]) : -1;
    if (digit < 0) {
      throw new Error(`Invalid source map segment: ${text}`);
    }
    value += (digit & 31) * 2 ** shift;
    shift += 5;
  } while (digit & 32);
  // The lowest bit is the sign.
  return [value % 2 ? -(value - 1) / 2 : value / 2, index];
};

const encodeVlq = (value: number): string => {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let text = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    text += BASE64[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return text;
};
