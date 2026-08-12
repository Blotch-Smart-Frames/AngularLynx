/**
 * Sets an Angular `input()` / `model()` signal's value from a test.
 *
 * The Vitest JIT harness does not wire up signal inputs for template binding or
 * `ComponentRef.setInput()` (that metadata is only emitted by Angular's AOT
 * compiler), so the usual ways of feeding a value into an `input()` are inert
 * here. Angular's own reactive-node API is the supported escape hatch: reach the
 * input's SIGNAL node and call `applyValueToInputSignal`, exactly as a parent
 * template binding would at runtime. This drives a PUBLIC input to a value — it
 * does not touch a component's private (`#`) state — and mirrors the existing
 * pattern in packages/runtime/src/lib/transition/lynx-transition.spec.ts.
 */
export const setInputSignal = (signalFn: unknown, value: unknown): void => {
  const symbols = Object.getOwnPropertySymbols(signalFn as object);
  const signalSymbol = symbols.find((s) => s.toString() === 'Symbol(SIGNAL)')!;
  const node = (signalFn as Record<symbol, unknown>)[signalSymbol];
  const proto = Object.getPrototypeOf(node) as {
    applyValueToInputSignal: (node: unknown, value: unknown) => void;
  };
  proto.applyValueToInputSignal(node, value);
};
