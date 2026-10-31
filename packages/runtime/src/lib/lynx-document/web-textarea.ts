import type { ElementRef } from '../types/lynx';

/**
 * Lets a `<textarea>` on Lynx for Web take a `z-index`, as an `<input>` does.
 *
 * web-elements draws both as a host with `display: contents` (`<x-input>`,
 * `<x-textarea>`) around the browser's own field, inside a `<form>` that's
 * `display: contents` too. A host without a box ignores `z-index`, so
 * web-elements passes it down: its `x-input` rule makes both the form and the
 * field inherit `z-index`, and the field, a flex item of the element's
 * parent, stacks by it. Its `x-textarea` rules leave `z-index` out (still in
 * web-elements 0.12.16). So a textarea's `z-index`
 * did nothing on the web, and a positioned sibling drawn after it covered it:
 * ui-textarea's transparent focus ring took every click, and no textarea in
 * the Dolan docs could be typed in.
 *
 * Like the blur view's layout fix (web-glass/blur-view-layout.ts), the rule
 * goes in a `<style>` in the element's own shadow root: Lynx owns its `class`
 * and `style` attributes. It only inherits, so a textarea without a
 * `z-index` stacks as before.
 */
export const TEXTAREA_STACKING_CSS = 'form,textarea{z-index:inherit}';

/**
 * Applies {@link TEXTAREA_STACKING_CSS} to a `<textarea>` web-core just
 * created. web-elements attaches the shadow root in the constructor, so it's
 * already there.
 */
export const stackWebTextarea = (element: ElementRef): void => {
  const node = element as Partial<HTMLElement>;
  const root = node.shadowRoot;
  if (!root) return;
  const style = root.ownerDocument.createElement('style');
  style.textContent = TEXTAREA_STACKING_CSS;
  root.appendChild(style);
};
