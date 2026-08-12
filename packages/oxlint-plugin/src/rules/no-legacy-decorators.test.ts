import { describe, expect, it, vi } from 'vitest';
import rule from './no-legacy-decorators.mjs';

/**
 * Builds a minimal fake oxlint `context`. The rule reads decorated members via
 * `context.report` and, only inside fixers, via `context.getSourceCode().getText(node)`.
 * Rather than modeling a real source string + real AST ranges (as the other rule
 * tests do), fake nodes here carry a `.text` property representing their source text,
 * and `getText` simply echoes it back -- this keeps the fixture focused on the
 * decorator-transform logic itself, which is what this rule is actually about.
 */
const createContext = () => ({
  report: vi.fn(),
  getSourceCode: () => ({ getText: (node: { text: string }) => node.text }),
});

const createFixer = () => ({
  replaceText: vi.fn((node: unknown, replacement: string) => ({ node, replacement })),
});

/**
 * A CallExpression decorator, e.g. `@Input()` or `@Input('alias')` or `@Input({...})`. 
 */
const callDecorator = (name: string, args: unknown[] = []) => ({
  expression: {
    type: 'CallExpression',
    callee: { type: 'Identifier', name },
    arguments: args,
  },
});

/**
 * A bare identifier decorator with no call, e.g. `@Input`. 
 */
const bareDecorator = (name: string) => ({
  expression: { type: 'Identifier', name },
});

/**
 * `text` mirrors what `sourceCode.getText()` would return for this node's source
 * span (quoted, since a string literal's source text includes its quotes).
 */
const stringLiteral = (value: string) => ({ type: 'Literal', value, text: `'${value}'` });
const booleanLiteral = (value: boolean) => ({ type: 'Literal', value, text: String(value) });
const identifier = (name: string, text = name) => ({ type: 'Identifier', name, text });

const objectExpression = (
  properties: Array<{ type: string; key?: unknown; value?: unknown }>,
) => ({ type: 'ObjectExpression', properties });

const property = (name: string, value: unknown) => ({
  type: 'Property',
  key: { type: 'Identifier', name },
  value,
});

/**
 * Runs a fake fix through the rule and returns the replacement text it produced.
 */
const runFix = (context: ReturnType<typeof createContext>, callIndex = 0): string => {
  const call = context.report.mock.calls[callIndex][0];
  const fixer = createFixer();
  call.fix(fixer);
  return fixer.replaceText.mock.calls[0][1];
};

/**
 * Runs a fake fix expected to bail out early (propName couldn't be resolved), and
 * asserts it returns null without ever touching the fixer.
 */
const expectFixBailsOut = (context: ReturnType<typeof createContext>) => {
  const call = context.report.mock.calls[0][0];
  const fixer = createFixer();
  expect(call.fix(fixer)).toBeNull();
  expect(fixer.replaceText).not.toHaveBeenCalled();
};

describe('no-legacy-decorators', () => {
  describe('checkDecorators (decorator discovery)', () => {
    it('ignores nodes with no decorators property', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({} as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('ignores nodes with an empty decorators array', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({ decorators: [] } as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('ignores an unrelated call-expression decorator (e.g. a custom decorator)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('value'),
        decorators: [callDecorator('Custom')],
      } as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('ignores an unrelated bare-identifier decorator', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('value'),
        decorators: [bareDecorator('Custom')],
      } as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('ignores a call-expression decorator whose callee is not a plain identifier', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('value'),
        decorators: [
          {
            expression: {
              type: 'CallExpression',
              callee: { type: 'MemberExpression' },
              arguments: [],
            },
          },
        ],
      } as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('ignores a decorator expression that is neither a call nor a bare identifier', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('value'),
        decorators: [{ expression: { type: 'ConditionalExpression' } }],
      } as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('walks every decorator on a node, skipping unknown ones and reporting known ones', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        decorators: [callDecorator('Custom'), callDecorator('Input')],
      } as never);

      expect(context.report).toHaveBeenCalledTimes(1);
      expect(context.report.mock.calls[0][0].messageId).toBe('noInputDecorator');
    });

    it('reports @Input without parentheses (bare decorator) as fixable', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        decorators: [bareDecorator('Input')],
      } as never);

      const call = context.report.mock.calls[0][0];
      expect(typeof call.fix).toBe('function');
      expect(runFix(context)).toBe('readonly name = input()');
    });

    it('does not attach a fixer for non-fixable decorators (@HostBinding/@HostListener)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('isActive'),
        decorators: [callDecorator('HostBinding', [stringLiteral('class.active')])],
      } as never);
      visitors.MethodDefinition({
        key: identifier('onClick'),
        decorators: [callDecorator('HostListener', [stringLiteral('click')])],
      } as never);

      expect(context.report).toHaveBeenCalledTimes(2);
      expect(context.report.mock.calls[0][0].fix).toBeUndefined();
      expect(context.report.mock.calls[0][0].messageId).toBe('noHostBindingDecorator');
      expect(context.report.mock.calls[1][0].fix).toBeUndefined();
      expect(context.report.mock.calls[1][0].messageId).toBe('noHostListenerDecorator');
    });
  });

  describe('@Input fix', () => {
    it('bails out of the fixer when the property key is not a plain identifier', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: { type: 'Literal', value: 'computed' },
        decorators: [callDecorator('Input')],
      } as never);

      expectFixBailsOut(context);
    });

    it('produces a bare input() call with no args/type/options', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        decorators: [callDecorator('Input')],
      } as never);

      expect(runFix(context)).toBe('readonly name = input()');
    });

    it('produces input(defaultValue) when the property has an initializer', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        value: identifier('unused', "'hello'"),
        decorators: [
          callDecorator('Input', [
            objectExpression([
              { type: 'SpreadElement' },
              property('mystery', stringLiteral('x')),
              property('unrelated', stringLiteral('y')),
            ]),
          ]),
        ],
      } as never);

      expect(runFix(context)).toBe("readonly name = input('hello')");
    });

    it('produces input.required<Type>() for a definite-assignment property with a type annotation', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        definite: true,
        typeAnnotation: { typeAnnotation: identifier('unused', 'string') },
        decorators: [callDecorator('Input')],
      } as never);

      expect(runFix(context)).toBe('readonly name = input.required<string>()');
    });

    it('produces input.required() with no type param when there is no type annotation', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        decorators: [
          callDecorator('Input', [objectExpression([property('required', booleanLiteral(true))])]),
        ],
      } as never);

      expect(runFix(context)).toBe('readonly name = input.required()');
    });

    it('does not treat required:<non-literal> or required:false as required', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('a'),
        decorators: [
          callDecorator('Input', [objectExpression([property('required', identifier('flag'))])]),
        ],
      } as never);
      visitors.PropertyDefinition({
        key: identifier('b'),
        decorators: [
          callDecorator('Input', [objectExpression([property('required', booleanLiteral(false))])]),
        ],
      } as never);

      expect(runFix(context, 0)).toBe('readonly a = input()');
      expect(runFix(context, 1)).toBe('readonly b = input()');
    });

    it('produces input.required<Type>({ alias, transform }) combining required + options', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        typeAnnotation: { typeAnnotation: identifier('unused', 'string') },
        decorators: [
          callDecorator('Input', [
            objectExpression([
              property('required', booleanLiteral(true)),
              property('alias', stringLiteral('x')),
            ]),
          ]),
        ],
      } as never);

      expect(runFix(context)).toBe(
        "readonly name = input.required<string>({ alias: 'x' })",
      );
    });

    it('reads alias from an object option whose value is a Literal, but not from a dynamic value', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        typeAnnotation: { typeAnnotation: identifier('unused', 'number') },
        decorators: [
          callDecorator('Input', [
            objectExpression([
              property('alias', identifier('dynamicAlias')),
              property('transform', { type: 'ArrowFunctionExpression', text: '(v) => Number(v)' }),
            ]),
          ]),
        ],
      } as never);

      // alias stays unset (its value wasn't a Literal) but transform is still picked up.
      expect(runFix(context)).toBe(
        'readonly name = input<number>({ transform: (v) => Number(v) })',
      );
    });

    it('reads an alias shorthand from a positional string literal when there is a value', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        value: identifier('unused', "''"),
        decorators: [callDecorator('Input', [stringLiteral('myAlias')])],
      } as never);

      expect(runFix(context)).toBe("readonly name = input('', { alias: 'myAlias' })");
    });

    it('prefers an alias already found on an options object over a positional string literal', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('name'),
        decorators: [
          callDecorator('Input', [
            stringLiteral('shorthand'),
            objectExpression([property('alias', stringLiteral('fromObject'))]),
          ]),
        ],
      } as never);

      expect(runFix(context)).toBe("readonly name = input({ alias: 'fromObject' })");
    });
  });

  describe('@Output fix', () => {
    it('produces output<Type>() by extracting the type param from a `new EventEmitter<T>()` initializer', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('clicked'),
        value: identifier('unused', 'new EventEmitter<void>()'),
        decorators: [callDecorator('Output')],
      } as never);

      expect(runFix(context)).toBe('readonly clicked = output<void>()');
    });

    it('produces output<Type>() by extracting the type param from a type annotation when there is no initializer', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('clicked'),
        typeAnnotation: { typeAnnotation: identifier('unused', 'EventEmitter<string>') },
        decorators: [callDecorator('Output')],
      } as never);

      expect(runFix(context)).toBe('readonly clicked = output<string>()');
    });

    it('produces a bare output() when neither the initializer nor the type annotation mention EventEmitter<T>', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('clicked'),
        value: identifier('unused', 'somethingElse()'),
        decorators: [callDecorator('Output')],
      } as never);

      expect(runFix(context)).toBe('readonly clicked = output()');
    });

    it('produces a bare output() when the type annotation (and no initializer) does not mention EventEmitter<T>', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('clicked'),
        typeAnnotation: { typeAnnotation: identifier('unused', 'string') },
        decorators: [callDecorator('Output')],
      } as never);

      expect(runFix(context)).toBe('readonly clicked = output()');
    });

    it('produces a bare output() when there is no initializer and no type annotation at all', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('clicked'),
        decorators: [bareDecorator('Output')],
      } as never);

      expect(runFix(context)).toBe('readonly clicked = output()');
    });

    it('adds an alias option from a positional string literal', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('changed'),
        value: identifier('unused', 'new EventEmitter<number>()'),
        decorators: [callDecorator('Output', [stringLiteral('valueChange')])],
      } as never);

      expect(runFix(context)).toBe(
        "readonly changed = output<number>({ alias: 'valueChange' })",
      );
    });

    it('bails out of the fixer when the property key is not a plain identifier', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: { type: 'Literal', value: 'computed' },
        decorators: [callDecorator('Output')],
      } as never);

      expectFixBailsOut(context);
    });
  });

  describe('@ViewChild / @ViewChildren / @ContentChild / @ContentChildren fix', () => {
    it('produces viewChild.required<Type>(selector) for a definite-assignment string ref', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('el'),
        definite: true,
        typeAnnotation: { typeAnnotation: identifier('unused', 'ElementRef') },
        decorators: [callDecorator('ViewChild', [stringLiteral('canvas')])],
      } as never);

      expect(runFix(context)).toBe(
        "readonly el = viewChild.required<ElementRef>('canvas')",
      );
    });

    it('produces viewChild.required<Type>(Component, { read }) with a read option', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('el'),
        definite: true,
        typeAnnotation: { typeAnnotation: identifier('unused', 'ElementRef') },
        decorators: [
          callDecorator('ViewChild', [
            stringLiteral('canvas'),
            objectExpression([property('read', identifier('ElementRef'))]),
          ]),
        ],
      } as never);

      expect(runFix(context)).toBe(
        "readonly el = viewChild.required<ElementRef>('canvas', { read: ElementRef })",
      );
    });

    it('produces viewChildren<Type>(Type) extracting the element type out of QueryList<T>', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('items'),
        typeAnnotation: { typeAnnotation: identifier('unused', 'QueryList<Item>') },
        decorators: [callDecorator('ViewChildren', [identifier('Item')])],
      } as never);

      expect(runFix(context)).toBe('readonly items = viewChildren<Item>(Item)');
    });

    it('produces contentChild.required<Type>(Type) (viewChildren/contentChildren never support .required)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('panel'),
        definite: true,
        typeAnnotation: { typeAnnotation: identifier('unused', 'Panel') },
        decorators: [callDecorator('ContentChild', [identifier('Panel')])],
      } as never);

      expect(runFix(context)).toBe(
        'readonly panel = contentChild.required<Panel>(Panel)',
      );
    });

    it('produces a bare contentChildren<Type>(Type) call (not required, since the decorator has no supportsRequired)', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('tabs'),
        definite: true, // even with `definite`, ContentChildren never supports .required
        typeAnnotation: { typeAnnotation: identifier('unused', 'QueryList<Tab>') },
        decorators: [callDecorator('ContentChildren', [identifier('Tab')])],
      } as never);

      expect(runFix(context)).toBe('readonly tabs = contentChildren<Tab>(Tab)');
    });

    it('produces a bare, argument-less call for an unparenthesized decorator with no selector/type/options', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('el'),
        decorators: [bareDecorator('ViewChild')],
      } as never);

      expect(runFix(context)).toBe('readonly el = viewChild()');
    });

    it('ignores an options object with no `read` property', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: identifier('el'),
        decorators: [
          callDecorator('ViewChild', [
            stringLiteral('ref'),
            objectExpression([property('static', booleanLiteral(true))]),
          ]),
        ],
      } as never);

      expect(runFix(context)).toBe("readonly el = viewChild('ref')");
    });

    it('bails out of the fixer when the property key is not a plain identifier', () => {
      const context = createContext();
      const visitors = rule.create(context as never);

      visitors.PropertyDefinition({
        key: { type: 'Literal', value: 'computed' },
        decorators: [callDecorator('ViewChild', [stringLiteral('ref')])],
      } as never);

      expectFixBailsOut(context);
    });
  });
});
