import * as ts from 'typescript';
import {
  applyEdits,
  declareVariables,
  type Edit,
  receiverScope,
  yieldingDefault,
} from './private-methods.js';

/**
 * `Function.prototype.apply`, reached through a new arrow function rather
 * than a name (`Reflect`, `Function`), which the module could bind to
 * something else. `<it>.call(f, r, [x])` calls `f` with `r` as `this`, after
 * the list is built, and throws a TypeError then if `f` isn't a function.
 */
const APPLY = '(() => {}).apply';

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
 * natively. A call (`a.b?.()`, `a?.b.c?.()`) is made on its receiver, read
 * into a variable of its own before the member is, through
 * `Function.prototype.apply` (see {@link APPLY}). Object
 * patterns' default values, which SWC compiles correctly, are compiled the
 * same way, so a private member in any of these default values runs as it
 * does natively rather than with SWC's private-member compile (see
 * splitPrivateChains, which runs after this). Chains in a function or a
 * class member inside the default value are left to SWC, which declares
 * their variables in that function.
 *
 * `delete a?.b` becomes `(t = a) == null ? true : delete t.b`, in
 * parentheses too. A chain in parentheses that's called (`(a?.m)(x)`,
 * `(a?.b.c)?.()`) or tags a template keeps its receiver, as natively: the
 * chain reads the object of its last member into a variable, and the call is
 * made on it with `Function.prototype.apply`.
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
  // The `]`s that close an argument list turned into an array, made after
  // every other edit at their place: a chain that ends the last argument
  // closes there first (`[x, ((t = a) == null ? void 0 : t.b)]`).
  const closingBrackets: Edit[] = [];
  const variables = new Map<ts.Node, string[]>();
  let count = 0;
  // A name nothing in the module uses, so it can't take another's place:
  // one its identifiers don't start with, read as they're parsed, so a name
  // written with escapes (`\u005f_chain0`) counts too.
  let prefix: string | undefined;
  const choosePrefix = (): string => {
    const names: string[] = [];
    const collect = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) names.push(node.text);
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    let chosen = '__chain';
    while (names.some((name) => name.startsWith(chosen))) {
      chosen = `_${chosen}`;
    }
    return chosen;
  };
  // The variable each chain in parentheses that's called or tags a template
  // reads its last member's object into, for the call's `this` (see
  // `called` below), by the chain.
  const captures = new Map<ts.Node, string>();
  const declare = (scope: ts.Node): string => {
    prefix ??= choosePrefix();
    const name = `${prefix}${count++}`;
    variables.set(scope, [...(variables.get(scope) ?? []), name]);
    return name;
  };

  /**
   * Compiles one whole chain: `top` is its last link.
   */
  const lower = (top: ts.OptionalChain): void => {
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
    // that link's (`a?.b?.()`); `this`, for `super`'s; the member's object,
    // read into a variable of its own; or, for a chain in parentheses
    // (`(a?.b.c)?.()`), what that chain reads into one (see `captures`).
    type Receiver =
      | null
      | 'previous'
      | 'this'
      | { object: ts.Expression; name?: string }
      | { chain: ts.OptionalChain; name?: string };
    const receivers: Receiver[] = [];
    for (const link of links) {
      if (!ts.isCallExpression(link)) {
        receivers.push(null);
        continue;
      }
      const chain = calledChain(link.expression);
      if (chain) {
        receivers.push({ chain });
        continue;
      }
      // Parentheses keep a member's receiver (`(a.b)?.()`), and can only be
      // around what the chain starts with.
      let callee: ts.Expression = link.expression;
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
        if ('chain' in receiver) captures.set(receiver.chain, receiver.name);
      }
    }
    // This chain's own last member's object, when it's called in
    // parentheses: read where the last link starts, in its part of the
    // chain.
    const capture = captures.get(top);
    const captured =
      capture !== undefined &&
      (ts.isPropertyAccessExpression(top) || ts.isElementAccessExpression(top))
        ? top
        : undefined;
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
        'object' in receiver &&
        receiver.object.getStart(sourceFile) === top.getStart(sourceFile);
      return `((${names[index]} = ${readsReceiver ? `(${receiver.name} = ` : ''}`;
    };

    const start = top.getStart(sourceFile);
    // `delete a?.b` moves its `delete` to the last link (see below), and
    // so does `delete (a?.b)`, whose parentheses stay.
    let outer = top.parent;
    while (ts.isParenthesizedExpression(outer)) outer = outer.parent;
    const deleted = ts.isDeleteExpression(outer);
    if (deleted) {
      const at = outer.getStart(sourceFile);
      edits.push({ start: at, end: at + 'delete'.length, text: '' });
    }
    edits.push({ start, end: start, text: opening(0) });
    for (const [index, link] of links.entries()) {
      const receiver = receivers[index];
      const object =
        typeof receiver === 'object' && receiver && 'object' in receiver
          ? receiver.object
          : undefined;
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
        access = thisArg === undefined ? name : `${APPLY}.call`;
      } else if (ts.isElementAccessExpression(link)) {
        access = name;
      } else {
        access = `${name}.`;
      }
      const last = index === links.length - 1;
      if (last && captured) {
        if (captured.questionDotToken) {
          // The last member's object is what this link read.
          access = `(${capture} = ${name})${ts.isPropertyAccessExpression(captured) ? '.' : ''}`;
        } else {
          // It starts this part of the chain (`(r = t.b).c`).
          access = `(${capture} = ${access}`;
          edits.push({
            start: captured.expression.end,
            end: captured.expression.end,
            text: ')',
          });
        }
      }
      edits.push({
        start: token.getStart(sourceFile),
        end: token.end,
        // A `delete` of the chain deletes from the last link, and gives
        // `true` when the chain short-circuits, as natively.
        text: `) == null ? ${deleted ? 'true' : 'void 0'} : ${next}${
          deleted && last ? 'delete ' : ''
        }${access}`,
      });
      if (ts.isCallExpression(link) && thisArg !== undefined) {
        // `t?.(x)` becomes `<apply>.call(t, r, [x])` (see APPLY), so a
        // getter or a value at the function's own `call` doesn't run before
        // the arguments, or at all, as natively.
        edits.push({
          start: link.arguments.pos,
          end: link.arguments.pos,
          text: `${name}, ${thisArg}, [`,
        });
        closingBrackets.push({
          start: link.end - 1,
          end: link.end - 1,
          text: ']',
        });
      }
    }
    edits.push({
      start: top.end,
      end: top.end,
      text: ')'.repeat(links.length),
    });
  };

  /**
   * Gives a chain in parentheses that's called (`(a?.m)(x)`) or tags a
   * template its receiver: natively the call gets the last member's object
   * as `this`, which a conditional loses.
   *
   * The call is made with `Function.prototype.apply` (see {@link APPLY}), not
   * the function's `call`, as natively: a function's own `call` (or `bind`)
   * property doesn't take part,
   * and the arguments (or the template's substitutions) are evaluated before
   * a callee that isn't a function throws, as when the chain short-circuits.
   */
  const called = (node: ts.CallExpression | ts.TaggedTemplateExpression) => {
    const callee = ts.isCallExpression(node) ? node.expression : node.tag;
    const chain = calledChain(callee);
    if (!chain) return;
    const name = declare(receiverScope(node));
    captures.set(chain, name);
    const start = callee.getStart(sourceFile);
    if (ts.isTaggedTemplateExpression(node)) {
      // A tag gets the template's strings and substitutions as arguments,
      // which a function in its place passes on.
      edits.push(
        {
          start,
          end: start,
          text: `((f, r) => function () { return ${APPLY}.call(f, r, arguments); })(`,
        },
        { start: callee.end, end: callee.end, text: `, ${name})` },
      );
      return;
    }
    // `(callee)(x, y)` becomes `<apply>.call((callee), r, [x, y])`: the
    // arguments' opening parenthesis becomes the list's, and the call's
    // closes `<apply>.call(`.
    edits.push(
      { start, end: start, text: `${APPLY}.call(` },
      {
        start: node.arguments.pos - 1,
        end: node.arguments.pos,
        text: `, ${name}, [`,
      },
    );
    closingBrackets.push({ start: node.end - 1, end: node.end - 1, text: ']' });
  };

  /**
   * Visits `node`. `lowering` is whether it's evaluated as part of a
   * default value whose chains are compiled here.
   */
  const visit = (node: ts.Node, lowering: boolean): void => {
    const inDefault = lowering || yieldingDefault(node);
    if (inDefault) {
      // A call in a chain (`(a?.m)?.()`) is the chain's to compile.
      if (
        (ts.isCallExpression(node) && !ts.isOptionalChain(node)) ||
        ts.isTaggedTemplateExpression(node)
      ) {
        called(node);
      }
      if (isChainTop(node)) lower(node);
    }
    ts.forEachChild(node, (child) =>
      visit(child, inDefault && evaluatedWith(node, child)),
    );
  };
  visit(sourceFile, false);
  return applyEdits(
    code,
    declareVariables(
      variables,
      [...edits, ...closingBrackets],
      code,
      sourceFile,
    ),
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
 * The chain in parentheses a call's callee is, when its last link is a
 * member, whose object the call gets as `this` (`(a?.b.c)(x)`).
 */
const calledChain = (
  callee: ts.Expression,
): (ts.PropertyAccessChain | ts.ElementAccessChain) | undefined => {
  if (!ts.isParenthesizedExpression(skipNonNull(callee))) return undefined;
  let inner = callee;
  while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression;
  }
  return ts.isOptionalChain(inner) &&
    (ts.isPropertyAccessExpression(inner) ||
      ts.isElementAccessExpression(inner))
    ? inner
    : undefined;
};

/**
 * The expression inside any non-null assertions (`a!`).
 */
const skipNonNull = (node: ts.Expression): ts.Expression =>
  ts.isNonNullExpression(node) ? skipNonNull(node.expression) : node;

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
