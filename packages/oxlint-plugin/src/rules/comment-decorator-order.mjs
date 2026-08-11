/**
 * Enforces that comments on decorated classes are placed above the first decorator,
 * not wedged between the decorator and the class keyword.
 *
 * Rationale: Placing documentation above decorators keeps it visually associated with
 * the public API surface rather than buried in implementation metadata. Decorators are
 * part of the class declaration — the comment should introduce the whole thing.
 */

/**
 * Finds the start of the line containing the given offset (position after the
 * preceding newline, or 0 if on the first line).
 */
const findLineStart = (text, offset) => {
  let pos = offset;
  while (pos > 0 && text[pos - 1] !== '\n') {
    pos--;
  }
  return pos;
};

/**
 * Finds the end of the line containing the given offset (position of the
 * newline character, or text length if on the last line).
 */
const findLineEnd = (text, offset) => {
  let pos = offset;
  while (pos < text.length && text[pos] !== '\n') {
    pos++;
  }
  return pos;
};

/**
 * Extracts the leading whitespace (indentation) at a given offset's line.
 */
const getIndentAt = (text, offset) => {
  const lineStart = findLineStart(text, offset);
  const match = text.slice(lineStart, offset).match(/^(\s*)/);
  return match ? match[1] : '';
};

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce comments on decorated classes are placed above the first decorator',
    },
    fixable: 'code',
    messages: {
      aboveDecorator:
        'Comments on decorated classes must be placed above the first decorator, not between the decorator and class.',
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        if (!node.decorators || node.decorators.length === 0) return;

        // Check for any comment between the last decorator and the class keyword.
        // `getCommentsAfter(lastDecorator)` returns comments in the gap between
        // the decorator's end and the next token (`export`/`class` keyword).
        const lastDecorator = node.decorators[node.decorators.length - 1];
        const firstDecorator = node.decorators[0];
        const comments = context.sourceCode.getCommentsAfter(lastDecorator);

        for (const comment of comments) {
          context.report({
            node: comment,
            messageId: 'aboveDecorator',
            fix(fixer) {
              const text = context.sourceCode.text;

              // Reconstruct the comment text as it appears in source.
              const commentText =
                comment.type === 'Line'
                  ? `//${comment.value}`
                  : `/*${comment.value}*/`;

              // Remove the entire line containing the misplaced comment.
              // This includes the leading whitespace and trailing newline.
              const lineStart = findLineStart(text, comment.range[0]);
              const lineEnd = findLineEnd(text, comment.range[1]);
              // Include the trailing newline in the removal (consume it)
              const removeEnd = lineEnd < text.length ? lineEnd + 1 : lineEnd;

              // Insert the comment above the first decorator with matching indentation.
              const indent = getIndentAt(text, firstDecorator.range[0]);
              const insertion = `${indent}${commentText}\n`;

              return [
                fixer.removeRange([lineStart, removeEnd]),
                fixer.insertTextBefore(firstDecorator, insertion),
              ];
            },
          });
        }
      },
    };
  },
};
