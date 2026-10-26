// cspell:words ɵɵdefine
import { createHash } from 'node:crypto';
import * as ts from 'typescript';

/**
 * The fields of `@Component()` that a hot update applies to running
 * components in place. They're the fields Angular's own dev server updates
 * that way (`SUPPORTED_FIELD_NAMES` in `@angular/build`'s hmr-candidates.ts):
 * the template and the styles. Any other edit to a component changes its
 * class or how it's created, which running instances can't take in.
 */
const IN_PLACE_FIELDS = new Set([
  'template',
  'templateUrl',
  'styles',
  'styleUrl',
  'styleUrls',
]);

/**
 * Whether a build environment takes hot updates, under the same conditions
 * entry.ts adds the hot update clients: a development build of a Lynx
 * environment (the web preview has none) without `dev.hmr: false`.
 *
 * @param environment - The environment, as Rsbuild passes it to a transform.
 * @returns Whether modules should take hot updates.
 */
export const hotUpdatesEnabled = (environment: {
  name: string;
  config: { mode?: string; dev?: { hmr?: boolean } };
}): boolean =>
  environment.name !== 'web' &&
  environment.config.mode === 'development' &&
  environment.config.dev?.hmr !== false;

const hash = (text: string): string =>
  createHash('sha1').update(text).digest('hex').slice(0, 16);

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

/**
 * Hashes a component file's source without its components' templates and
 * styles. Two versions of a file with the same signature differ only in what
 * a hot update can apply in place (see `ɵhmrAccept` in the runtime). An
 * external template or stylesheet isn't in the source at all, so editing one
 * leaves the signature as it was.
 *
 * @param source - The file's TypeScript source.
 * @param fileName - The file's path, for the parser.
 * @returns The signature.
 */
export const hotUpdateSignature = (
  source: string,
  fileName: string,
): string => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const removals: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && isComponentDecorator(node)) {
      const metadata = (node.expression as ts.CallExpression).arguments[0];
      if (metadata && ts.isObjectLiteralExpression(metadata)) {
        for (const property of metadata.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            IN_PLACE_FIELDS.has(property.name.text)
          ) {
            removals.push({
              start: property.initializer.getStart(sourceFile),
              end: property.initializer.end,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  let rest = source;
  for (const { start, end } of removals.reverse()) {
    rest = rest.slice(0, start) + rest.slice(end);
  }
  return hash(rest);
};

/**
 * Finds the components a module's compiled code defines, as the names of
 * their classes. Only classes declared at the top of the module are listed,
 * because the code {@link addHotAccept} appends assigns to them there.
 *
 * @param code - The module's code, as Angular's compiler emitted it.
 * @param fileName - The module's path, for the parser.
 * @returns The class names, in the order the module defines them.
 */
export const componentClassNames = (
  code: string,
  fileName: string,
): string[] => {
  if (!code.includes('ɵɵdefineComponent')) return [];
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const topLevelClasses = new Set(
    sourceFile.statements
      .filter(ts.isClassDeclaration)
      .flatMap((statement) => (statement.name ? [statement.name.text] : [])),
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : undefined) === 'ɵɵdefineComponent'
    ) {
      const definition = node.arguments[0];
      const type =
        definition && ts.isObjectLiteralExpression(definition)
          ? definition.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.name) &&
                property.name.text === 'type',
            )?.initializer
          : undefined;
      if (
        type &&
        ts.isIdentifier(type) &&
        topLevelClasses.has(type.text) &&
        !names.includes(type.text)
      ) {
        names.push(type.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
};

/**
 * The local name the appended code imports the runtime's `ɵhmrAccept` as,
 * chosen not to collide with the module's own names.
 */
const ACCEPT = 'ɵɵangularLynxHmrAccept';

/**
 * Makes a module that defines components take its own hot updates, through
 * the runtime's `ɵhmrAccept`. The call reassigns the module's component
 * classes to what it returns, so after an in-place update the module's
 * exports are the classes the running app already uses.
 *
 * @param code - The module's code.
 * @param options.components - The names of the module's component classes.
 * @param options.signature - The source's {@link hotUpdateSignature}.
 * @param options.compiled - The code Angular's compiler emitted for the
 *   module, before the plugin's other transforms.
 * @returns The code with the call appended.
 */
export const addHotAccept = (
  code: string,
  {
    components,
    signature,
    compiled,
  }: { components: string[]; signature: string; compiled: string },
): string => {
  const list = `[${components.join(', ')}]`;
  return `${code}
import { ɵhmrAccept as ${ACCEPT} } from '@blotch/angular-lynx';
if (import.meta.webpackHot) {
  ${list} = ${ACCEPT}(import.meta.webpackHot, ${list}, ${JSON.stringify(signature)}, ${JSON.stringify(hash(compiled))});
}
`;
};

/**
 * Makes the app's entry module take every hot update its imports pass on.
 * Re-running the entry calls `bootstrapApplication()` again, which replaces
 * the running app with one built from the updated modules (on the main
 * thread; the background thread runs no app).
 *
 * @param code - The entry module's code.
 * @returns The code with the self-accept appended.
 */
export const addEntryHotAccept = (code: string): string =>
  `${code}
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
`;
