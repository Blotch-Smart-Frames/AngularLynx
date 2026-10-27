/**
 * The Lynx element functions a test watches with `vi.spyOn()`, as the testing
 * library's main thread runs them.
 */
export type LynxMainThread = {
  /** Starts, plays, pauses or cancels an element's animation. */
  __ElementAnimate: (element: Element, args: unknown[]) => void;
  /** Sets an attribute, such as a boolean jsdom doesn't keep as Lynx does. */
  __SetAttribute: (element: Element, name: string, value: unknown) => void;
  /** Sets one inline style, including those jsdom drops. */
  __AddInlineStyle: (
    element: Element,
    name: string | number,
    value: unknown,
  ) => void;
};

/**
 * The testing library's Lynx main thread, to watch what reaches Lynx where
 * the rendered element can't show it: an animation, or a value jsdom drops.
 *
 *   const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
 *
 * dolan copies component tests into apps with an import of
 * `@blotch/dolan/testing/lynx-main-thread`, a copy of this file.
 */
export const lynxMainThread = (): LynxMainThread =>
  (
    globalThis as unknown as {
      lynxTestingEnv: { mainThread: { globalThis: LynxMainThread } };
    }
  ).lynxTestingEnv.mainThread.globalThis;
