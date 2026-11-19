/**
 * A template's element, told apart by shape rather than class, so the
 * polyfills, which run before everything else, don't load the element
 * module: a LynxElement holds its native element and can observe its layout.
 * Its text nodes (`raw-text`) and anchors (`comment`) are LynxElements too,
 * but the DOM's text and comment nodes aren't Elements, so they aren't
 * either.
 */
const isTemplateElement = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || !('element' in value)) {
    return false;
  }
  const { observeLayout, tagName } = value as {
    observeLayout?: unknown;
    tagName?: unknown;
  };
  return (
    typeof observeLayout === 'function' &&
    tagName !== 'raw-text' &&
    tagName !== 'comment'
  );
};

/** Marks an `Element` that already takes a template's elements. */
const FOR_LYNX_ELEMENTS = Symbol.for('angular-lynx.element-global');

/**
 * On Lynx's main thread, which has no DOM: the class a template's elements
 * are instances of. It has no instances of its own, and nothing to construct.
 */
class LynxElementGlobal {
  static [Symbol.hasInstance](value: unknown): boolean {
    return isTemplateElement(value);
  }
}

/**
 * Makes a template's elements `instanceof Element`, as a page's are in a
 * browser. Angular checks before it uses one as an element: in development
 * builds, `@defer`'s `on interaction`, `on hover` and `on viewport` triggers
 * assert that their trigger is an `Element` before listening to it (issue
 * #459). A LynxElement isn't one, so the assertion threw inside Angular's
 * after-render hook, the listeners were never added, and the block kept its
 * placeholder.
 *
 * - On iOS and Android, the main thread has no `Element` at all, so the
 *   assertion threw a ReferenceError. There, `Element` is a class whose
 *   instances are a template's elements and nothing else.
 * - In the web preview's main-thread frame and the testing library's jsdom,
 *   `Element` is the DOM's own, and a LynxElement wraps a DOM element rather
 *   than being one. There, the DOM's `Element` takes a template's elements as
 *   well as its own nodes, which stay instances as before.
 */
export const installElementGlobal = (target: Record<string, any>): void => {
  const native = target['Element'] as
    | (((...args: never[]) => unknown) & { [FOR_LYNX_ELEMENTS]?: true })
    | undefined;
  if (typeof native === 'undefined') {
    target['Element'] = LynxElementGlobal;
    return;
  }
  if (native[FOR_LYNX_ELEMENTS]) return;
  // What `instanceof` does without an own Symbol.hasInstance: walk the
  // prototype chain.
  const isOwnInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(native, Symbol.hasInstance, {
    value(this: unknown, value: unknown): boolean {
      // The DOM's subclasses (HTMLElement, HTMLDivElement, SVGElement, …)
      // inherit Element's static methods, this one with them, so `this` says
      // which class is asking. A template's element is an Element, not a
      // `<div>`.
      return (
        (this === native && isTemplateElement(value)) ||
        isOwnInstance.call(this, value)
      );
    },
    configurable: true,
  });
  Object.defineProperty(native, FOR_LYNX_ELEMENTS, {
    value: true,
    configurable: true,
  });
};
