/**
 * Enforces arrow function expressions instead of function declarations or
 * anonymous function expressions. Arrow functions are lexically scoped (no own
 * `this`/`arguments`), which avoids accidental context bugs and is consistent
 * with the rest of the codebase style. This replicates the Biome GritQL
 * noFunctionDeclaration rule that was previously applied via biome.
 *
 * Exception: functions that reference `this` are allowed, because arrow
 * functions cannot receive a `this` binding (e.g. via Function.call), making
 * a regular function the only viable option in those cases.
 * Walk an AST node looking for a ThisExpression. Stops recursing into nested
 * FunctionDeclaration/FunctionExpression because those create their own `this`
 * scope. ArrowFunctionExpression does NOT create its own `this`, so we
 * continue into those.
 * visited guards against circular references in the AST (e.g. parent back-pointers
 * that some linter runtimes attach to nodes), which would otherwise cause infinite recursion.
 */
const usesThis = (node, visited = new WeakSet()) => {
  if (!node || typeof node !== 'object') return false;
  if (visited.has(node)) return false;
  visited.add(node);
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
    return false;
  return Object.values(node).some((child) =>
    Array.isArray(child)
      ? child.some((item) => usesThis(item, visited))
      : usesThis(child, visited),
  );
};

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce arrow function expressions over function declarations and anonymous function expressions',
    },
    messages: {
      useArrow:
        'Use arrow function expression instead of function declaration or anonymous function expression.',
    },
  },
  create(context) {
    // oxlint's JS plugin API does not set node.parent. To distinguish class
    // methods (FunctionExpression under MethodDefinition) from standalone
    // function expressions (const f = function(){}), we collect the
    // FunctionExpression node references from MethodDefinition/Property
    // visitors — which run before their child FunctionExpression — and skip
    // those in the FunctionExpression visitor.
    const methodFunctionExpressions = new WeakSet();

    return {
      FunctionDeclaration(node) {
        if (usesThis(node.body)) return;
        context.report({ node, messageId: 'useArrow' });
      },
      MethodDefinition(node) {
        if (node.value?.type === 'FunctionExpression') {
          methodFunctionExpressions.add(node.value);
        }
      },
      Property(node) {
        if (node.method && node.value?.type === 'FunctionExpression') {
          methodFunctionExpressions.add(node.value);
        }
      },
      FunctionExpression(node) {
        if (methodFunctionExpressions.has(node)) return;
        if (usesThis(node.body)) return;
        context.report({ node, messageId: 'useArrow' });
      },
    };
  },
};
