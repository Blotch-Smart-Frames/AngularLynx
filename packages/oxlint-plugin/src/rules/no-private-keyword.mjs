// Enforces ECMAScript #private fields/methods instead of TypeScript's `private` keyword.
// The `private` keyword is erased at compile time and provides no runtime protection.
// Native #private fields are truly private at runtime and cannot be accessed externally.

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce native #private syntax instead of the TypeScript private keyword',
    },
    messages: {
      useHash:
        'Use #{{ name }} instead of the private keyword. Native private fields provide runtime encapsulation.',
    },
  },
  create(context) {
    const check = (node) => {
      if (node.accessibility !== 'private') return;
      // Only handle simple identifier keys — computed properties like private [Symbol.iterator]()
      // can't use # syntax.
      if (node.key.type !== 'Identifier') return;

      context.report({
        node,
        messageId: 'useHash',
        data: { name: node.key.name },
      });
    };

    return {
      PropertyDefinition: check,
      MethodDefinition: check,
    };
  },
};
