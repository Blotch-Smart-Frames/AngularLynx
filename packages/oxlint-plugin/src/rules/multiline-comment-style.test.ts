import { describe, expect, it, vi } from 'vitest';
import rule from './multiline-comment-style.mjs';

/**
 * Builds a minimal fake oxlint `context`. The rule only reads `context.sourceCode.text`
 * (for indentation detection and gap-sniffing between comments) and calls
 * `context.sourceCode.getCommentsBefore` (mocked per-test to return the comments we
 * want to simulate sitting above a node).
 */
const createContext = (text: string, commentsBefore: unknown[]) => ({
  report: vi.fn(),
  sourceCode: {
    text,
    getCommentsBefore: vi.fn(() => commentsBefore),
  },
});

/**
 * Derives a [start, end] range tuple for `snippet` as it appears inside `text`. 
 */
const rangeOf = (text: string, snippet: string): [number, number] => {
  const start = text.indexOf(snippet);
  if (start === -1) throw new Error(`snippet not found in fixture text: ${snippet}`);
  return [start, start + snippet.length];
};

/**
 * Builds a fake Line comment node (`// value`) anchored to its position in `text`. 
 */
const lineComment = (text: string, snippet: string, value: string) => ({
  type: 'Line' as const,
  value,
  range: rangeOf(text, snippet),
});

/**
 * Builds a fake Block comment node (`/*value*&#47;`) anchored to its position in `text`. 
 */
const blockComment = (text: string, snippet: string, value: string) => ({
  type: 'Block' as const,
  value,
  range: rangeOf(text, snippet),
});

const createFixer = () => ({
  replaceTextRange: vi.fn((range: [number, number], replacement: string) => ({
    range,
    replacement,
  })),
});

describe('multiline-comment-style', () => {
  describe('MethodDefinition', () => {
    it('rewrites a single-line block comment above a method into multi-line TSDoc', () => {
      const text = ['/** Single line jsdoc. */', 'foo() {}'].join('\n');
      const comment = blockComment(text, '/** Single line jsdoc. */', '* Single line jsdoc. ');
      const node = { range: rangeOf(text, 'foo() {}') };
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.MethodDefinition(node as never);

      expect(context.report).toHaveBeenCalledTimes(1);
      const call = context.report.mock.calls[0][0];
      expect(call.messageId).toBe('multiline');
      expect(call.node).toBe(comment);

      const fixer = createFixer();
      call.fix(fixer);
      // extractLines only strips *leading* whitespace, so the trailing space before
      // the closing `*/` in the original single-line comment is preserved verbatim.
      expect(fixer.replaceTextRange).toHaveBeenCalledWith(
        comment.range,
        '/**\n * Single line jsdoc. \n */',
      );
    });

    it('leaves an already-valid multi-line TSDoc comment alone', () => {
      const text = ['/**', ' * Already documented.', ' */', 'foo() {}'].join('\n');
      const comment = blockComment(
        text,
        '/**\n * Already documented.\n */',
        '*\n * Already documented.\n ',
      );
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.MethodDefinition({} as never);

      expect(context.report).not.toHaveBeenCalled();
    });

    it('does nothing when there are no leading comments at all', () => {
      const context = createContext('foo() {}', []);
      const visitors = rule.create(context as never);

      visitors.MethodDefinition({} as never);

      expect(context.report).not.toHaveBeenCalled();
    });
  });

  describe('ClassDeclaration', () => {
    it('checks comments above the first decorator for a decorated class, not the class keyword', () => {
      const text = ['// needs tsdoc', '@Component()', 'class Foo {}'].join('\n');
      const comment = lineComment(text, '// needs tsdoc', ' needs tsdoc');
      const decorator = { range: rangeOf(text, '@Component()') };
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.ClassDeclaration({ decorators: [decorator] } as never);

      expect(context.sourceCode.getCommentsBefore).toHaveBeenCalledWith(decorator);
      expect(context.report).toHaveBeenCalledTimes(1);
    });

    it('checks comments above the class itself when there are no decorators', () => {
      const text = ['// needs tsdoc', 'class Foo {}'].join('\n');
      const comment = lineComment(text, '// needs tsdoc', ' needs tsdoc');
      const node = { range: rangeOf(text, 'class Foo {}') };
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.ClassDeclaration(node as never);

      expect(context.sourceCode.getCommentsBefore).toHaveBeenCalledWith(node);
      expect(context.report).toHaveBeenCalledTimes(1);
    });

    it('treats an empty decorators array the same as "no decorators"', () => {
      const text = ['// needs tsdoc', 'class Foo {}'].join('\n');
      const comment = lineComment(text, '// needs tsdoc', ' needs tsdoc');
      const node = { decorators: [], range: rangeOf(text, 'class Foo {}') };
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.ClassDeclaration(node as never);

      expect(context.sourceCode.getCommentsBefore).toHaveBeenCalledWith(node);
    });
  });

  describe('VariableDeclaration', () => {
    it('ignores declarations with no function initializer at all', () => {
      const context = createContext('let x;\nconst y = 5;', []);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration({
        declarations: [{ init: null }, { init: { type: 'Literal' } }],
      } as never);

      expect(context.sourceCode.getCommentsBefore).not.toHaveBeenCalled();
    });

    it('checks a declaration whose initializer is an arrow function', () => {
      const text = ['const helper = () => {};'].join('\n');
      const node = { declarations: [{ init: { type: 'ArrowFunctionExpression' } }], range: rangeOf(text, 'const helper = () => {};') };
      const context = createContext(text, []);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      expect(context.sourceCode.getCommentsBefore).toHaveBeenCalledWith(node);
    });

    it('checks a declaration whose initializer is a function expression', () => {
      const text = ['const helper = function () {};'].join('\n');
      const node = {
        declarations: [{ init: { type: 'Literal' } }, { init: { type: 'FunctionExpression' } }],
        range: rangeOf(text, 'const helper = function () {};'),
      };
      const context = createContext(text, []);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      expect(context.sourceCode.getCommentsBefore).toHaveBeenCalledWith(node);
    });

    it('merges a contiguous group of mismatched comments (Line + already-valid Block) into one TSDoc block', () => {
      const text = [
        '// Extra detail.',
        '/**',
        ' * Already documented.',
        ' */',
        'const helper2 = () => {};',
      ].join('\n');
      const extra = lineComment(text, '// Extra detail.', ' Extra detail.');
      const already = blockComment(
        text,
        '/**\n * Already documented.\n */',
        '*\n * Already documented.\n ',
      );
      const node = {
        declarations: [{ init: { type: 'ArrowFunctionExpression' } }],
        range: rangeOf(text, 'const helper2 = () => {};'),
      };
      const context = createContext(text, [extra, already]);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      expect(context.report).toHaveBeenCalledTimes(1);
      const call = context.report.mock.calls[0][0];
      // Reported on the first comment in the (single, contiguous) group.
      expect(call.node).toBe(extra);

      const fixer = createFixer();
      call.fix(fixer);
      expect(fixer.replaceTextRange).toHaveBeenCalledWith(
        [extra.range[0], already.range[1]],
        '/**\n * Extra detail.\n * Already documented.\n */',
      );
    });

    it('splits comments into groups on a blank line and only rewrites the last (contiguous) group', () => {
      const text = [
        '// old unrelated comment',
        '',
        '// First part of doc.',
        '// Second part of doc.',
        'const helper = () => {};',
      ].join('\n');
      const unrelated = lineComment(text, '// old unrelated comment', ' old unrelated comment');
      const first = lineComment(text, '// First part of doc.', ' First part of doc.');
      const second = lineComment(text, '// Second part of doc.', ' Second part of doc.');
      const node = {
        declarations: [{ init: { type: 'ArrowFunctionExpression' } }],
        range: rangeOf(text, 'const helper = () => {};'),
      };
      const context = createContext(text, [unrelated, first, second]);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      expect(context.report).toHaveBeenCalledTimes(1);
      const call = context.report.mock.calls[0][0];
      // The unrelated comment (separated by a blank line) must be excluded from the group.
      expect(call.node).toBe(first);

      const fixer = createFixer();
      call.fix(fixer);
      expect(fixer.replaceTextRange).toHaveBeenCalledWith(
        [first.range[0], second.range[1]],
        '/**\n * First part of doc.\n * Second part of doc.\n */',
      );
    });

    it('extracts text from a plain block comment that does not start with a leading "*"', () => {
      const text = ['/* plain comment */', 'const helper3 = () => {};'].join('\n');
      const plain = blockComment(text, '/* plain comment */', ' plain comment ');
      const node = {
        declarations: [{ init: { type: 'ArrowFunctionExpression' } }],
        range: rangeOf(text, 'const helper3 = () => {};'),
      };
      const context = createContext(text, [plain]);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      const fixer = createFixer();
      const call = context.report.mock.calls[0][0];
      call.fix(fixer);
      // Only the single leading space (right after `/*`) is stripped; the trailing
      // space before `*/` survives, same as the leading-star case above.
      expect(fixer.replaceTextRange).toHaveBeenCalledWith(
        plain.range,
        '/**\n * plain comment \n */',
      );
    });

    it('indents the rewritten TSDoc block to match the original comment column', () => {
      const text = ['function outer() {', '  // needs tsdoc', '  const inner = () => {};', '}'].join(
        '\n',
      );
      const comment = lineComment(text, '// needs tsdoc', ' needs tsdoc');
      const node = {
        declarations: [{ init: { type: 'ArrowFunctionExpression' } }],
        range: rangeOf(text, 'const inner = () => {};'),
      };
      const context = createContext(text, [comment]);
      const visitors = rule.create(context as never);

      visitors.VariableDeclaration(node as never);

      const fixer = createFixer();
      const call = context.report.mock.calls[0][0];
      call.fix(fixer);
      expect(fixer.replaceTextRange).toHaveBeenCalledWith(
        comment.range,
        '/**\n   * needs tsdoc\n   */',
      );
    });
  });
});
