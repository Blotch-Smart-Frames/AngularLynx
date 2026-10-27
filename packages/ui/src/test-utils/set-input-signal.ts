/**
 * Sets an Angular `input()` / `model()` signal's value from a test.
 *
 * Under `ng test`, which compiles ahead of time, bind the input from a host
 * component's template or call `ComponentRef.setInput()` instead. This is for
 * tests compiled just in time (plain Vitest), where neither reaches a signal
 * input: that metadata is only emitted by Angular's AOT compiler. Angular's own
 * reactive-node API is the supported escape hatch there: reach the
 * input's SIGNAL node and call `applyValueToInputSignal`, exactly as a parent
 * template binding would at runtime. This drives a PUBLIC input to a value — it
 * does not touch a component's private (`#`) state — and mirrors the existing
 * pattern in packages/runtime/src/lib/transition/lynx-transition.test.ts.
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
