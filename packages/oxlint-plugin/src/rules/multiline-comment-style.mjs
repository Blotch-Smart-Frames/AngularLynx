/**
 * Enforces that comments documenting functions, methods, and classes use multi-line
 * TSDoc format rather than single-line styles.
 *
 * Rationale: Multi-line TSDoc is more readable, leaves room to grow as docs evolve,
 * and produces proper API documentation when processed by documentation generators.
 *
 * Returns true when the comment is already a valid multi-line TSDoc block:
 * - Must be a Block comment (not a Line comment)
 * - Must start with `*` (JSDoc/TSDoc convention)
 * - Must contain at least one newline (i.e. not a single-line block comment)
 */
const isValidMultilineTSDoc = (comment) =>
  comment.type === 'Block' &&
  comment.value.startsWith('*') &&
  comment.value.includes('\n');

/**
 * Determines whether a VariableDeclaration contains a function-like initializer
 * (arrow function or function expression) that warrants multi-line TSDoc enforcement.
 */
const hasFunctionInit = (node) =>
  node.declarations.some(
    (d) =>
      d.init &&
      (d.init.type === 'ArrowFunctionExpression' ||
        d.init.type === 'FunctionExpression'),
  );

/**
 * Extracts the text content lines from a comment node, stripping comment syntax.
 * Line comments yield their trimmed value.
 * Single-line block comments yield the content without leading/trailing markers.
 */
const extractLines = (comment) => {
  if (comment.type === 'Line') {
    return [comment.value.replace(/^ /, '')];
  }

  // Block comment — strip the leading `*` and parse lines.
  // Value for `/** foo */` is `* foo `, for multi-line it's `*\n * line\n `
  const raw = comment.value.startsWith('*')
    ? comment.value.slice(1)
    : comment.value;

  return raw
    .split('\n')
    .map((line) => line.replace(/^ \* ?/, '').replace(/^ /, ''))
    .filter((line, i, arr) => {
      // Remove empty first/last lines (artifacts of block comment formatting)
      if (i === 0 && line.trim() === '') return false;
      if (i === arr.length - 1 && line.trim() === '') return false;
      return true;
    });
};

/**
 * Detects the indentation (leading whitespace) at a given offset in the source text.
 */
const getIndentAt = (sourceText, offset) => {
  // Walk backwards from offset to find the start of the line
  let lineStart = offset;
  while (lineStart > 0 && sourceText[lineStart - 1] !== '\n') {
    lineStart--;
  }
  // Extract the whitespace between line start and the offset
  const beforeComment = sourceText.slice(lineStart, offset);
  const match = beforeComment.match(/^(\s*)/);
  return match ? match[1] : '';
};

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce multi-line TSDoc format for comments on functions, methods, and classes',
    },
    fixable: 'code',
    messages: {
      multiline:
        'Comments on functions, methods, and classes must use multi-line TSDoc format (/** ... */).',
    },
  },
  create(context) {
    /**
     * Splits an array of comments into contiguous groups separated by blank lines.
     * A "blank line" means the gap between two adjacent comments contains a line
     * with no content (just whitespace or empty). Only the last group (immediately
     * before the node) is considered the documentation comment for that node.
     */
    const getLastContiguousGroup = (comments) => {
      if (comments.length <= 1) return comments;

      const text = context.sourceCode.text;
      let groupStart = 0;

      for (let i = 1; i < comments.length; i++) {
        const gap = text.slice(comments[i - 1].range[1], comments[i].range[0]);
        // If the gap between two comments contains a blank line, start a new group.
        // A blank line means two consecutive newlines (possibly with whitespace between).
        if (/\n\s*\n/.test(gap)) {
          groupStart = i;
        }
      }

      return comments.slice(groupStart);
    };

    /**
     * Checks all comments before `node`. If any in the last contiguous group are
     * not valid multi-line TSDoc, reports once with a fix that replaces that group
     * with a single properly-formatted TSDoc block.
     */
    const checkMultiline = (node) => {
      const allComments = context.sourceCode.getCommentsBefore(node);
      if (allComments.length === 0) return;

      // Only consider the last contiguous group (separated by blank lines from earlier comments).
      const comments = getLastContiguousGroup(allComments);

      // If all comments in the group are already valid multi-line TSDoc, nothing to do.
      const hasInvalid = comments.some((c) => !isValidMultilineTSDoc(c));
      if (!hasInvalid) return;

      // Extract text content from all comments in the group.
      const lines = comments.flatMap(extractLines);

      // Detect indentation from the first comment's position.
      const indent = getIndentAt(context.sourceCode.text, comments[0].range[0]);

      // Build the replacement multi-line TSDoc block.
      const tsdocLines = lines.map((line) => `${indent} * ${line}`);
      const replacement = `/**\n${tsdocLines.join('\n')}\n${indent} */`;

      // The range to replace spans from the first comment's start to the last comment's end.
      const rangeStart = comments[0].range[0];
      const rangeEnd = comments[comments.length - 1].range[1];

      context.report({
        node: comments[0],
        messageId: 'multiline',
        fix(fixer) {
          return fixer.replaceTextRange([rangeStart, rangeEnd], replacement);
        },
      });
    };

    return {
      ClassDeclaration(node) {
        if (node.decorators && node.decorators.length > 0) {
          // For decorated classes, comments should be above the first decorator.
          // We check `getCommentsBefore` on the first decorator since the class node's
          // span includes decorators and oxlint won't return comments "before" its own span.
          const firstDecorator = node.decorators[0];
          checkMultiline(firstDecorator);
        } else {
          checkMultiline(node);
        }
      },

      MethodDefinition(node) {
        checkMultiline(node);
      },

      // Arrow functions / function expressions assigned to variables:
      // `const foo = () => {}` or `export const foo = () => {}`
      VariableDeclaration(node) {
        if (hasFunctionInit(node)) {
          checkMultiline(node);
        }
      },
    };
  },
};
