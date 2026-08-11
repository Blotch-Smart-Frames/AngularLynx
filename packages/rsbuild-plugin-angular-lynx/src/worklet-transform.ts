import * as ts from 'typescript';

const MAIN_THREAD_DIRECTIVE = 'main thread';
const MAIN_THREAD_DIRECTIVE_ALT = 'main-thread';

/**
 * Detects functions with a `"main thread"` directive and wraps them with
 * `mainThreadFn()` at build time. This matches React Lynx's worklet directive
 * pattern — users write a string directive as the first statement, and the
 * build transform handles registration.
 */
export const transformWorklets = (code: string, filename: string): string => {
  if (
    !code.includes(MAIN_THREAD_DIRECTIVE) &&
    !code.includes(MAIN_THREAD_DIRECTIVE_ALT)
  ) {
    return code;
  }

  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  const workletRanges: { start: number; end: number }[] = [];
  visitNode(sourceFile, sourceFile, workletRanges);

  if (workletRanges.length === 0) {
    return code;
  }

  // Apply replacements from end to start so earlier positions remain valid
  // after text is inserted. Forward iteration would shift all subsequent
  // offsets by the length difference of each replacement.
  let result = code;
  for (let i = workletRanges.length - 1; i >= 0; i--) {
    const { start, end } = workletRanges[i];
    const fnText = result.slice(start, end);
    result =
      result.slice(0, start) + `mainThreadFn(${fnText})` + result.slice(end);
  }

  // Single import at the top covers all wrapped functions in this file.
  result = `import { mainThreadFn } from '@blotch/angular-lynx';\n` + result;

  return result;
};

const visitNode = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  ranges: { start: number; end: number }[],
): void => {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (hasMainThreadDirective(node) && !isAlreadyWrapped(node)) {
      ranges.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
      });
      return;
    }
  }

  ts.forEachChild(node, (child) => visitNode(child, sourceFile, ranges));
};

const hasMainThreadDirective = (
  node: ts.ArrowFunction | ts.FunctionExpression,
): boolean => {
  const body = node.body;
  if (!ts.isBlock(body)) return false;
  if (body.statements.length === 0) return false;

  const first = body.statements[0];
  if (!ts.isExpressionStatement(first)) return false;

  const expr = first.expression;
  if (!ts.isStringLiteral(expr)) return false;

  const text = expr.text;
  return text === MAIN_THREAD_DIRECTIVE || text === MAIN_THREAD_DIRECTIVE_ALT;
};

const isAlreadyWrapped = (node: ts.Node): boolean => {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;

  const callee = parent.expression;
  if (ts.isIdentifier(callee) && callee.text === 'mainThreadFn') {
    return true;
  }
  // Handle qualified access: e.g. something.mainThreadFn(...)
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'mainThreadFn'
  ) {
    return true;
  }
  return false;
};
