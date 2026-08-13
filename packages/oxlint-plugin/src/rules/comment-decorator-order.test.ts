import { describe, expect, it, vi } from 'vitest';
import rule from './comment-decorator-order.mjs';

/**
 * Builds a minimal fake oxlint `context`. The rule only reads `context.sourceCode.text`
 * (for the fixer's line-splicing math) and calls `context.sourceCode.getCommentsAfter`
 * (mocked to return whatever comments we want to simulate sitting after the decorator),
 * so those are the only members a fake context needs.
 */
const createContext = (text: string, commentsAfter: unknown[]) => ({
  report: vi.fn(),
  sourceCode: {
    text,
    getCommentsAfter: vi.fn(() => commentsAfter),
  },
});

/**
 * Builds a fake decorator/comment AST node whose range is derived from where `snippet` sits in `text`.
 */
const rangeOf = (text: string, snippet: string): [number, number] => {
  const start = text.indexOf(snippet);
  if (start === -1)
    throw new Error(`snippet not found in fixture text: ${snippet}`);
  return [start, start + snippet.length];
};

const createFixer = () => ({
  removeRange: vi.fn((range: [number, number]) => ({
    type: 'removeRange',
    range,
  })),
  insertTextBefore: vi.fn((node: unknown, text: string) => ({
    type: 'insertTextBefore',
    node,
    text,
  })),
});

describe('comment-decorator-order', () => {
  it('ignores classes with no decorators property', () => {
    const context = createContext('class Foo {}', []);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({} as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('ignores classes with an empty decorators array', () => {
    const context = createContext('class Foo {}', []);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [] } as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('does nothing when there are no comments between the decorator and the class', () => {
    const text = '@Component({})\nclass Foo {}';
    const decorator = { range: rangeOf(text, '@Component({})') };
    const context = createContext(text, []);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [decorator] } as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('reports and fixes a line comment wedged after the decorator, moving it above the first decorator', () => {
    // The decorator is indented two spaces on the first line, so getIndentAt's
    // backward scan must step back character-by-character (exercising the loop
    // body, not just its guard) before terminating at "reached the start of the
    // text" -- while the comment's own line-start scan (below) terminates the
    // other way, by immediately finding a preceding newline.
    const text = ['  @Component({})', '// oops', 'class Foo {}'].join('\n');
    const decorator = { range: rangeOf(text, '@Component({})') };
    const comment = {
      type: 'Line' as const,
      value: ' oops',
      range: rangeOf(text, '// oops'),
    };
    const context = createContext(text, [comment]);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [decorator] } as never);

    expect(context.report).toHaveBeenCalledTimes(1);
    const call = context.report.mock.calls[0][0];
    expect(call.messageId).toBe('aboveDecorator');
    expect(call.node).toBe(comment);

    const fixer = createFixer();
    const edits = call.fix(fixer);

    const [, decoratorEnd] = decorator.range;
    const removedLineEnd = text.indexOf('class Foo');
    // The whole "// oops" line (plus its trailing newline) is removed...
    expect(fixer.removeRange).toHaveBeenCalledWith([
      decoratorEnd + 1,
      removedLineEnd,
    ]);
    // ...and reinserted verbatim, reusing the decorator's own indentation.
    expect(fixer.insertTextBefore).toHaveBeenCalledWith(
      decorator,
      '  // oops\n',
    );
    expect(edits).toHaveLength(2);
  });

  it('reports a block comment using block-comment syntax in the reconstructed text', () => {
    // Trailing code shares the comment's line (`/* oops */ class Foo {}`), so
    // findLineEnd's forward scan for the comment must step past several
    // characters before it reaches the newline, instead of finding it immediately.
    const text = ['@Component({})', '/* oops */ class Foo {}'].join('\n');
    const decorator = { range: rangeOf(text, '@Component({})') };
    const comment = {
      type: 'Block' as const,
      value: ' oops ',
      range: rangeOf(text, '/* oops */'),
    };
    const context = createContext(text, [comment]);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [decorator] } as never);

    const fixer = createFixer();
    const call = context.report.mock.calls[0][0];
    call.fix(fixer);
    expect(fixer.insertTextBefore).toHaveBeenCalledWith(
      decorator,
      '/* oops */\n',
    );
  });

  it('removes a trailing comment with no newline after it (end of file)', () => {
    // No trailing newline after the comment, so findLineEnd's scan stops because it
    // reached text.length rather than because it found a "\n" -- and removeEnd must
    // therefore equal lineEnd instead of lineEnd + 1.
    const text = ['@Component({})', 'class Foo {}', '// trailing'].join('\n');
    const decorator = { range: rangeOf(text, '@Component({})') };
    const comment = {
      type: 'Line' as const,
      value: ' trailing',
      range: rangeOf(text, '// trailing'),
    };
    const context = createContext(text, [comment]);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [decorator] } as never);

    const fixer = createFixer();
    const call = context.report.mock.calls[0][0];
    call.fix(fixer);

    expect(fixer.removeRange).toHaveBeenCalledWith([
      comment.range[0],
      text.length,
    ]);
  });

  it('anchors the fix on the first decorator (not the last) and reports every stray comment', () => {
    const text = [
      '@First()',
      '@Second()',
      '// one',
      '// two',
      'class Foo {}',
    ].join('\n');
    const first = { range: rangeOf(text, '@First()') };
    const second = { range: rangeOf(text, '@Second()') };
    const commentOne = {
      type: 'Line' as const,
      value: ' one',
      range: rangeOf(text, '// one'),
    };
    const commentTwo = {
      type: 'Line' as const,
      value: ' two',
      range: rangeOf(text, '// two'),
    };
    const context = createContext(text, [commentOne, commentTwo]);
    const visitors = rule.create(context as never);

    visitors.ClassDeclaration({ decorators: [first, second] } as never);

    // getCommentsAfter must be queried relative to the LAST decorator...
    expect(context.sourceCode.getCommentsAfter).toHaveBeenCalledWith(second);
    // ...but every stray comment gets reinserted above the FIRST one.
    expect(context.report).toHaveBeenCalledTimes(2);
    const fixer = createFixer();
    for (const call of context.report.mock.calls) {
      call[0].fix(fixer);
    }
    expect(fixer.insertTextBefore).toHaveBeenNthCalledWith(
      1,
      first,
      '// one\n',
    );
    expect(fixer.insertTextBefore).toHaveBeenNthCalledWith(
      2,
      first,
      '// two\n',
    );
  });
});
