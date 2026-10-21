/**
 * Disallows `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component`.
 *
 * Rationale: since Angular 22, OnPush is the default change detection strategy,
 * so spelling it out is noise, and copying it around keeps the habit alive.
 * angular-eslint flags the same thing (`prefer-on-push-component-change-detection`
 * with `allowExplicitOnPush: false`), but this repo lints with oxlint, and that
 * plugin would bring ESLint and Angular's compiler with it for one check.
 *
 * The fix removes the property, and the `ChangeDetectionStrategy` import once
 * nothing else in the file uses it (so the fix doesn't leave an unused import).
 */

const STRATEGY = 'ChangeDetectionStrategy';

/**
 * Whether an object literal property's key is `changeDetection`.
 */
const isChangeDetectionKey = (property) =>
  !property.computed &&
  ((property.key.type === 'Identifier' &&
    property.key.name === 'changeDetection') ||
    (property.key.type === 'Literal' &&
      property.key.value === 'changeDetection'));

/**
 * Whether `value` reads `OnPush` off one of the local names `ChangeDetectionStrategy`
 * was imported as.
 */
const isOnPush = (value, strategyNames) =>
  value.type === 'MemberExpression' &&
  !value.computed &&
  value.object.type === 'Identifier' &&
  strategyNames.has(value.object.name) &&
  value.property.name === 'OnPush';

/**
 * Removes `items[index]` from a comma-separated list (object properties or
 * import specifiers) without leaving a stray comma or an empty line behind.
 */
const removeListItem = (fixer, text, items, index) => {
  const item = items[index];
  const start = item.range[0];
  let end = item.range[1];
  const comma = /^\s*,/.exec(text.slice(end));
  if (comma) end += comma[0].length;

  // The item has its line to itself: drop the whole line.
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = /^[ \t]*(?:\r?\n|$)/.exec(text.slice(end));
  if (/^[ \t]*$/.test(text.slice(lineStart, start)) && lineEnd) {
    return fixer.removeRange([lineStart, end + lineEnd[0].length]);
  }

  // Inline with a comma after it: take the spaces before the next item too.
  if (comma) {
    end += /^[ \t]*/.exec(text.slice(end))[0].length;
    return fixer.removeRange([start, end]);
  }

  // Inline and last: take the comma before it instead.
  const previous = items[index - 1];
  return fixer.removeRange([previous ? previous.range[1] : start, end]);
};

export default {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        'Disallow `changeDetection: ChangeDetectionStrategy.OnPush`, the default since Angular 22',
    },
    messages: {
      redundantOnPush:
        'Remove `changeDetection: ChangeDetectionStrategy.OnPush`. OnPush is the default change detection strategy since Angular 22.',
    },
  },
  create(context) {
    /** `ChangeDetectionStrategy` imports from `@angular/core`, by local name. */
    const imports = new Map();
    /** Redundant `changeDetection` properties, in source order. */
    const found = [];

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@angular/core') return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.name === STRATEGY
          ) {
            imports.set(specifier.local.name, { declaration: node, specifier });
          }
        }
      },

      Decorator(node) {
        const call = node.expression;
        if (
          call.type !== 'CallExpression' ||
          call.callee.type !== 'Identifier' ||
          call.callee.name !== 'Component'
        ) {
          return;
        }
        const metadata = call.arguments[0];
        if (metadata?.type !== 'ObjectExpression') return;
        const strategyNames = new Set(imports.keys());
        metadata.properties.forEach((property, index) => {
          if (
            property.type === 'Property' &&
            isChangeDetectionKey(property) &&
            isOnPush(property.value, strategyNames)
          ) {
            found.push({ metadata, index, property });
          }
        });
      },

      'Program:exit'() {
        const text = context.sourceCode.text;
        const inFound = (node) =>
          found.some(
            ({ property }) =>
              node.range[0] >= property.range[0] &&
              node.range[1] <= property.range[1],
          );

        found.forEach(({ metadata, index, property }, n) => {
          context.report({
            node: property,
            messageId: 'redundantOnPush',
            fix(fixer) {
              const fixes = [
                removeListItem(fixer, text, metadata.properties, index),
              ];
              // Only the first report removes the import, so the fixes for
              // the other properties in the file don't overlap with it.
              if (n === 0) {
                const name = property.value.object.name;
                const { declaration, specifier } = imports.get(name);
                const [variable] =
                  context.sourceCode.getDeclaredVariables(specifier);
                if (
                  variable.references.every((ref) => inFound(ref.identifier))
                ) {
                  const { specifiers } = declaration;
                  fixes.push(
                    specifiers.length === 1
                      ? removeListItem(fixer, text, [declaration], 0)
                      : removeListItem(
                          fixer,
                          text,
                          specifiers,
                          specifiers.indexOf(specifier),
                        ),
                  );
                }
              }
              return fixes;
            },
          });
        });
      },
    };
  },
};
