// Hears every CSS transition a test's DOM elements are given. jsdom runs no
// transitions, so a spec that checks an element moved (LynxStackOutlet's
// pages, say) checks the `transition` it was given and the value it ends at.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.

/** A transition an element was given, with the element's style. */
export type StartedTransition = {
  readonly style: CSSStyleDeclaration;
  readonly transition: string;
};

/**
 * The prototype jsdom keeps the `transition` style's accessor on: a
 * renderer's `setStyle` sets `style.transition`, which goes through it.
 */
const transitionOwner = (): object => {
  let owner: object | null = Object.getPrototypeOf(document.body.style);
  while (owner && !Object.getOwnPropertyDescriptor(owner, 'transition')) {
    owner = Object.getPrototypeOf(owner);
  }
  return owner!;
};

/**
 * Records each non-empty `transition` set on any element's style from now
 * on, in `started`, until `restore()`.
 */
export const spyOnTransitions = (): {
  readonly started: StartedTransition[];
  restore(): void;
} => {
  const started: StartedTransition[] = [];
  const owner = transitionOwner();
  const accessor = Object.getOwnPropertyDescriptor(owner, 'transition')!;
  Object.defineProperty(owner, 'transition', {
    ...accessor,
    set(this: CSSStyleDeclaration, value: string) {
      if (value) started.push({ style: this, transition: value });
      accessor.set!.call(this, value);
    },
  });
  return {
    started,
    restore: () => Object.defineProperty(owner, 'transition', accessor),
  };
};
