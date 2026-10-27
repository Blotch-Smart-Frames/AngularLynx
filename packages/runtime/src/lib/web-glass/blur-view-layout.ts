/**
 * web-elements' container layout rules for `<x-view>` (`linear.css`), as
 * `:host` rules for `<x-blur-view>`.
 *
 * On iOS a blur view lays its children out like any view: `flex-col`,
 * `flex-row` and the default linear layout all apply. web-elements gives
 * `<x-blur-view>` `display: flex` but leaves it out of the rules that turn
 * Lynx's layout variables (the display toggle, the linear orientation,
 * `--flex-direction`) into CSS; those list only `<x-view>` and the other
 * containers. So on web a blur view ignored `flex-col` and set its children
 * out in a row: the element-blur-view example's label sat centered across the
 * top of its panel instead of vertically centered at the left.
 *
 * A `:host` rule loses to every style from outside the shadow root, so a class
 * such as `flex` (which sets `--lynx-display-toggle`) or an inline style still
 * wins, exactly as it does over web-elements' own `x-view` rules.
 *
 * Its children need one more rule to lay out as flex items. web-elements
 * sizes an item (`flex-1`, a linear weight) by container style queries on its
 * parent's `--lynx-display` and `--lynx-linear-orientation`. A blur view's
 * children sit in its shadow root's `<slot>`, which is the parent those
 * queries see, and the variables don't inherit, so `flex-1` did nothing in a
 * blur view: a glass capsule beside a button in a glass group stayed as
 * narrow as its content. The slot takes them from the host.
 */
export const BLUR_VIEW_LAYOUT_CSS =
  ':host{' +
  '--lynx-display-toggle:var(--lynx-display-linear);' +
  '--lynx-display-linear:var(--lynx-display-toggle,);' +
  '--lynx-display-flex:var(--lynx-display-toggle,);' +
  '--lynx-linear-orientation-toggle:var(--lynx-linear-orientation-vertical);' +
  '--lynx-linear-orientation-horizontal:var(--lynx-linear-orientation-toggle,);' +
  '--lynx-linear-orientation-vertical:var(--lynx-linear-orientation-toggle,);' +
  '--lynx-linear-orientation-horizontal-reverse:var(--lynx-linear-orientation-toggle,);' +
  '--lynx-linear-orientation-vertical-reverse:var(--lynx-linear-orientation-toggle,);' +
  '--linear-flex-direction:var(--lynx-linear-orientation-horizontal,row) ' +
  'var(--lynx-linear-orientation-vertical,column) ' +
  'var(--lynx-linear-orientation-horizontal-reverse,row-reverse) ' +
  'var(--lynx-linear-orientation-vertical-reverse,column-reverse);' +
  '--linear-justify-content:var(--lynx-linear-orientation-horizontal,var(--justify-content-row)) ' +
  'var(--lynx-linear-orientation-vertical,var(--justify-content-column)) ' +
  'var(--lynx-linear-orientation-horizontal-reverse,var(--justify-content-row-reverse)) ' +
  'var(--lynx-linear-orientation-vertical-reverse,var(--justify-content-column-reverse));' +
  'flex-wrap:var(--lynx-display-linear,nowrap) var(--lynx-display-flex,var(--flex-wrap));' +
  'flex-direction:var(--lynx-display-linear,var(--linear-flex-direction)) ' +
  'var(--lynx-display-flex,var(--flex-direction));' +
  'justify-content:var(--lynx-display-linear,var(--linear-justify-content))' +
  '}' +
  'slot{--lynx-display:inherit;--lynx-linear-orientation:inherit;' +
  '--lynx-linear-weight-sum:inherit}';

/**
 * Gives a `<blur-view>` on Lynx for Web the layout of a `<view>` (see
 * {@link BLUR_VIEW_LAYOUT_CSS}), through a `<style>` in its own shadow root.
 * Like the glass styles, it stays inside the element: Lynx owns its `class`
 * and `style` attributes.
 */
export const applyBlurViewLayout = (element: HTMLElement): void => {
  const root = element.shadowRoot;
  if (!root) return;
  const style = element.ownerDocument.createElement('style');
  style.textContent = BLUR_VIEW_LAYOUT_CSS;
  root.appendChild(style);
};
