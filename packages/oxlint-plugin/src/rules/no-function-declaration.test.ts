import { describe, expect, it, vi } from 'vitest';
import rule from './no-function-declaration.mjs';

const createContext = () => ({ report: vi.fn() });

describe('no-function-declaration', () => {
  describe('FunctionDeclaration', () => {
    it('reports a function declaration that never references `this`', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'foo' },
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'bar' },
                arguments: [],
              },
            },
          ],
        },
      };

      visitors.FunctionDeclaration(node as never);

      expect(context.report).toHaveBeenCalledWith({ node, messageId: 'useArrow' });
    });

    it('does not report a function declaration that references `this` through nested plain objects', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionDeclaration',
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'MemberExpression',
                object: { type: 'ThisExpression' },
                property: { type: 'Identifier', name: 'x' },
              },
            },
          ],
        },
      };

      visitors.FunctionDeclaration(node as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('does not descend into a nested function/method to find `this` (it creates its own scope)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      // The ThisExpression lives inside a nested FunctionExpression, which has its
      // own `this` binding -- usesThis must stop recursing there, so the outer
      // FunctionDeclaration should still be reported as `this`-free.
      const node = {
        type: 'FunctionDeclaration',
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'FunctionExpression',
              body: { type: 'ThisExpression' },
            },
          ],
        },
      };

      visitors.FunctionDeclaration(node as never);

      expect(context.report).toHaveBeenCalledWith({ node, messageId: 'useArrow' });
    });

    it('does descend into a nested arrow function to find `this` (arrows do not create their own scope)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionDeclaration',
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'ArrowFunctionExpression',
              body: { type: 'ThisExpression' },
            },
          ],
        },
      };

      visitors.FunctionDeclaration(node as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('does not loop forever on a shared/cyclic node reference (e.g. a parent back-pointer)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      // The same object appears twice in the array so the second visit must be
      // short-circuited by the `visited` guard instead of being walked again.
      const shared = { type: 'Identifier', name: 'x' };
      const node = {
        type: 'FunctionDeclaration',
        body: { type: 'BlockStatement', body: [shared, shared] },
      };

      expect(() => visitors.FunctionDeclaration(node as never)).not.toThrow();
      expect(context.report).toHaveBeenCalledWith({ node, messageId: 'useArrow' });
    });

    it('ignores null/primitive AST fields while walking (e.g. a null `test` on a for-loop)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionDeclaration',
        body: {
          type: 'ForStatement',
          init: null,
          test: null,
          update: null,
          body: { type: 'EmptyStatement' },
        },
      };

      visitors.FunctionDeclaration(node as never);

      expect(context.report).toHaveBeenCalledWith({ node, messageId: 'useArrow' });
    });
  });

  describe('MethodDefinition / Property (tracking method function expressions)', () => {
    it('marks a method body as a method-owned FunctionExpression so it is skipped', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const methodValue = { type: 'FunctionExpression', body: { type: 'BlockStatement', body: [] } };

      visitors.MethodDefinition({ value: methodValue } as never);
      visitors.FunctionExpression(methodValue as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('does not crash on a MethodDefinition with no value, and does not mark non-FunctionExpression values', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      expect(() => visitors.MethodDefinition({} as never)).not.toThrow();
      expect(() =>
        visitors.MethodDefinition({ value: { type: 'ArrowFunctionExpression' } } as never),
      ).not.toThrow();
    });

    it('marks a shorthand method Property value as method-owned so it is skipped', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const methodValue = { type: 'FunctionExpression', body: { type: 'BlockStatement', body: [] } };

      visitors.Property({ method: true, value: methodValue } as never);
      visitors.FunctionExpression(methodValue as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('does not mark a non-method Property, or a method Property with no value/wrong value type', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      // None of these should throw or add anything to the method-tracking Set: a
      // non-method property, a method with no value at all (exercises the `?.`
      // short-circuit), and a method whose value isn't a FunctionExpression.
      expect(() =>
        visitors.Property({ method: false, value: { type: 'FunctionExpression' } } as never),
      ).not.toThrow();
      expect(() => visitors.Property({ method: true } as never)).not.toThrow();
      expect(() =>
        visitors.Property({ method: true, value: { type: 'ArrowFunctionExpression' } } as never),
      ).not.toThrow();

      expect(context.report).not.toHaveBeenCalled();
    });
  });

  describe('FunctionExpression (standalone, not owned by a method)', () => {
    it('reports a standalone function expression that never references `this`', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionExpression',
        body: { type: 'BlockStatement', body: [] },
      };

      visitors.FunctionExpression(node as never);

      expect(context.report).toHaveBeenCalledWith({ node, messageId: 'useArrow' });
    });

    it('does not report a standalone function expression that references `this`', () => {
      const context = createContext();
      const visitors = rule.create(context as never);
      const node = {
        type: 'FunctionExpression',
        body: { type: 'ThisExpression' },
      };

      visitors.FunctionExpression(node as never);

      expect(context.report).not.toHaveBeenCalled();
    });
  });
});
