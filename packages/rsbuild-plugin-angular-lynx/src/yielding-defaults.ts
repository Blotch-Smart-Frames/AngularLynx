import * as ts from 'typescript';
import {
  applyEdits,
  declareVariables,
  type Edit,
  receiverScope,
  yieldingDefault,
} from './private-methods.js';

/**
 * A `yield` or an `await` anywhere. With no `?.` as well, a module can't have
 * what {@link lowerYieldingDefaultChains} rewrites, so it isn't parsed.
 */
const YIELD_HINT = /\b(?:yield|await)\b/;

/**
 * Compiles the optional chains in a destructuring's default value that has a
 * `yield` or an `await` (see {@link yieldingDefault}) to the conditionals
 * SWC would, with their variables declared in the function around them.
 *
 * Both threads lower optional chaining (ES2019 and ES2015 targets), and SWC
 * (1.16, and rspack 2.2's) compiles an array pattern's default value that has
 * a chain it needs a variable for (`a.b()?.c`, `a?.b?.c`, a private member's
 * `x?.#m?.call(x)`) into an arrow function called at once, which declares the
 * variable:
 *
 * ```js
 * const [v = (() => { var _a_b; return (_a_b = a.b()) === null || … })()] = [];
 * ```
 *
 * A `yield` or an `await` in the default value ends up inside that arrow
 * function, where it's a SyntaxError, so the module fails to load. Here the
 * chain is gone before SWC sees it:
 *
 * ```js
 * var __chain0;
 * const [v = ((__chain0 = a.b()) == null ? void 0 : __chain0.c(yield 1))] = [];
 * ```
 *
 * Each `?.` reads what's before it into a variable once, and the rest of the
 * chain, up to its end, runs only when that isn't `null` or `undefined`, as
 * natively. A call (`a.b?.()`, `a?.b.c?.()`) is made through `call`, on its
 * receiver, read into a variable of its own before the member is. Object
 * patterns' default values, which SWC compiles correctly, are compiled the
 * same way, so a private member in any of these default values runs as it
 * does natively rather than with SWC's private-member compile (see
 * splitPrivateChains, which runs after this). Chains in a function or a
 * class member inside the default value are left to SWC, which declares
 * their variables in that function.
 *
 * `delete a?.b` becomes `(t = a) == null ? true : delete t.b`. Left as they
 * are, to SWC: a `delete` of a chain in parentheses (`delete (a?.b)`), and a
 * call of a member read in parentheses on an optional chain
 * (`(a?.b.c)?.()`), whose receiver is inside the other chain.
 *
 * Edits never add or remove a line, and an inline source map's columns are
 * moved to match, as for the passes after it.
 *
 * @param code - The module's code, before SWC.
 * @param filename - The module's path, for the parser.
 * @returns The rewritten code, or `code` itself when nothing applies.
 */
export const lowerYieldingDefaultChains = (
  code: string,
  filename: string,
): string => {
  if (!code.includes('?.') || !YIELD_HINT.test(code)) {
    return code;
  }
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const edits: Edit[] = [];
  const variables = new Map<ts.Node, string[]>();
  let count = 0;
  // A name nothing in the module uses, so it can't take another's place.
  let prefix = '__chain';
  while (code.includes(prefix)) prefix = `_${prefix}`;
  const declare = (scope: ts.Node): string => {
    const name = `${prefix}${count++}`;
    variables.set(scope, [...(variables.get(scope) ?? []), name]);
    return name;
  };

  /**
   * Compiles one whole chain: `top` is its last link. Returns whether it
   * could.
   */
  const lower = (top: ts.OptionalChain): boolean => {
    // Its `?.` links, first to last.
    const links: Array<
      ts.PropertyAccessChain | ts.ElementAccessChain | ts.CallChain
    > = [];
    for (
      let node: ts.Expression = top;
      ts.isOptionalChain(node);
      node = node.expression
    ) {
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isCallExpression(node)) &&
        node.questionDotToken
      ) {
        links.unshift(
          node as ts.PropertyAccessChain | ts.ElementAccessChain | ts.CallChain,
        );
      }
    }
    // What each call's `call` gets as `this`: nothing, for a call that
    // isn't of a member; what the previous link read, when the member is
    // that link's (`a?.b?.()`); `this`, for `super`'s; or the member's object,
    // read into a variable of its own.
    type Receiver =
      | null
      | 'previous'
      | 'this'
      | { object: ts.Expression; name?: string };
    const receivers: Receiver[] = [];
    for (const link of links) {
      if (!ts.isCallExpression(link)) {
        receivers.push(null);
        continue;
      }
      // Parentheses keep a member's receiver (`(a.b)?.()`), and can only be
      // around what the chain starts with.
      let callee: ts.Expression = link.expression;
      while (ts.isNonNullExpression(callee)) callee = callee.expression;
      const parenthesized = ts.isParenthesizedExpression(callee);
      while (
        ts.isParenthesizedExpression(callee) ||
        ts.isNonNullExpression(callee)
      ) {
        callee = callee.expression;
      }
      if (
        !ts.isPropertyAccessExpression(callee) &&
        !ts.isElementAccessExpression(callee)
      ) {
        receivers.push(null);
      } else if (parenthesized && containsChain(callee)) {
        // The receiver is inside another chain (`(a?.b.c)?.()`).
        return false;
      } else if (callee.questionDotToken) {
        receivers.push('previous');
      } else if (callee.expression.kind === ts.SyntaxKind.SuperKeyword) {
        receivers.push('this');
      } else {
        receivers.push({ object: callee.expression });
      }
    }
    const scope = receiverScope(top);
    const names = links.map(() => declare(scope));
    for (const receiver of receivers) {
      if (typeof receiver === 'object' && receiver) {
        receiver.name = declare(scope);
      }
    }
    const receiverName = (index: number): string | undefined => {
      const receiver = receivers[index];
      if (receiver === 'previous') return names[index - 1];
      if (receiver === 'this') return 'this';
      return receiver?.name;
    };
    /**
     * What starts link `index`'s part of the chain: reading what's before
     * it, and a call's receiver before that, when it's read first.
     */
    const opening = (index: number): string => {
      const receiver = receivers[index];
      const readsReceiver =
        typeof receiver === 'object' &&
        receiver !== null &&
        receiver.object.getStart(sourceFile) === top.getStart(sourceFile);
      return `((${names[index]} = ${readsReceiver ? `(${receiver.name} = ` : ''}`;
    };

    const start = top.getStart(sourceFile);
    // `delete a?.b` moves its `delete` to the last link (see below); in
    // parentheses (`delete (a?.b)`) it's left to SWC.
    const deleted = ts.isDeleteExpression(top.parent);
    if (deleted) {
      const at = top.parent.getStart(sourceFile);
      edits.push({ start: at, end: at + 'delete'.length, text: '' });
    }
    edits.push({ start, end: start, text: opening(0) });
    for (const [index, link] of links.entries()) {
      const receiver = receivers[index];
      const object =
        typeof receiver === 'object' && receiver ? receiver.object : undefined;
      // A receiver inside the parentheses the chain starts with is read
      // where it is.
      if (object && object.getStart(sourceFile) !== start) {
        const at = object.getStart(sourceFile);
        edits.push({ start: at, end: at, text: `(${receiverName(index)} = ` });
      }
      if (object) {
        edits.push({ start: object.end, end: object.end, text: ')' });
      }
      const token = link.questionDotToken!;
      const next = index + 1 < links.length ? opening(index + 1) : '';
      const name = names[index]!;
      const thisArg = receiverName(index);
      let access: string;
      if (ts.isCallExpression(link)) {
        access = thisArg === undefined ? name : `${name}.call`;
      } else if (ts.isElementAccessExpression(link)) {
        access = name;
      } else {
        access = `${name}.`;
      }
      edits.push({
        start: token.getStart(sourceFile),
        end: token.end,
        // A `delete` of the chain deletes from the last link, and gives
        // `true` when the chain short-circuits, as natively.
        text: `) == null ? ${deleted ? 'true' : 'void 0'} : ${next}${
          deleted && index === links.length - 1 ? 'delete ' : ''
        }${access}`,
      });
      if (ts.isCallExpression(link) && thisArg !== undefined) {
        const at = link.arguments.pos;
        edits.push({
          start: at,
          end: at,
          text: link.arguments.length > 0 ? `${thisArg}, ` : thisArg,
        });
      }
    }
    edits.push({
      start: top.end,
      end: top.end,
      text: ')'.repeat(links.length),
    });
    return true;
  };

  /**
   * Visits `node`. `lowering` is whether it's evaluated as part of a
   * default value whose chains are compiled here.
   */
  const visit = (node: ts.Node, lowering: boolean): void => {
    let inDefault = lowering || yieldingDefault(node);
    if (
      inDefault &&
      isChainTop(node) &&
      (isDeletedInParentheses(node) || !lower(node))
    ) {
      // Left to SWC as a whole: compiling the chains inside it would change
      // what it reads (a call's receiver, what's deleted).
      inDefault = false;
    }
    ts.forEachChild(node, (child) =>
      visit(child, inDefault && evaluatedWith(node, child)),
    );
  };
  visit(sourceFile, false);
  return applyEdits(
    code,
    declareVariables(variables, edits, code, sourceFile),
    sourceFile,
  );
};

/**
 * Whether `node` is a chain's last link: an optional chain that no link of
 * the same chain is read on.
 */
const isChainTop = (node: ts.Node): node is ts.OptionalChain =>
  ts.isOptionalChain(node) &&
  !(
    ts.isOptionalChain(node.parent) &&
    (node.parent as ts.OptionalChain).expression === node
  );

/**
 * Whether a chain is what a `delete` deletes, in parentheses.
 */
const isDeletedInParentheses = (node: ts.Node): boolean => {
  let parent = node.parent;
  if (!ts.isParenthesizedExpression(parent)) return false;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return ts.isDeleteExpression(parent);
};

/**
 * Whether `node` has an optional chain in it.
 */
const containsChain = (node: ts.Node): boolean =>
  ts.isOptionalChain(node) ||
  (ts.forEachChild(node, (child) => containsChain(child) || undefined) ??
    false);

/**
 * Whether `child` runs when `parent` is evaluated, as {@link yieldingDefault}
 * counts it: a class's `extends` and decorators, and a member's decorators
 * and computed name (a method's in an object literal too, which TypeScript
 * parses as the same node), but not a member's body or initializer, nor any
 * other function's body or parameters.
 */
const evaluatedWith = (parent: ts.Node, child: ts.Node): boolean => {
  if (ts.isClassElement(parent)) {
    return ts.isDecorator(child) || ts.isComputedPropertyName(child);
  }
  return !ts.isFunctionLike(parent);
};
