import { type Type, reflectComponentType } from '@angular/core';

/**
 * The Lynx elements a component's host can be, besides the `<view>` every
 * host is by default.
 */
export type HostElementTag =
  | 'view'
  | 'text'
  | 'image'
  | 'scroll-view'
  | 'svg'
  | 'blur-view';

/**
 * A component host's tag (`ui-card-title`) → the Lynx element it renders as.
 * Keyed by tag, because that's all `createElement()` gets: Angular creates a
 * child component's host from the parent's template, before the component
 * exists.
 */
const hostElements = new Map<string, HostElementTag>();

/** A selector part that is an element name alone, such as `ui-card-title`. */
const ELEMENT_SELECTOR = /^[a-z][\w-]*$/i;

/**
 * Makes a component's host element a Lynx element other than `<view>`, such
 * as a `<text>`. Call it once, next to the component:
 *
 * ```ts
 * @Component({
 *   selector: 'app-title',
 *   host: { class: 'text-2xl font-semibold' },
 *   template: '<ng-content />',
 * })
 * export class AppTitle {}
 *
 * registerHostElement(AppTitle, 'text');
 * ```
 *
 * Every host is a `<view>` otherwise, a real element between the parent and
 * the component's template. A component that shows text then needs a
 * `<text>` inside its host, and a class the app writes on the component
 * (`<app-title class="mb-2">`) lands on the host, which Angular gives every
 * static attribute, as well as on whatever element the component passes it
 * to: a margin there applies twice. With a `<text>` host, the component is
 * one element, the way a component's `<span>` or `<p>` would be on the web.
 *
 * The registration covers each element name in the selector, wherever a
 * template uses the component. Content projected into a `<text>` host follows
 * `<text>`'s rules: raw text, and nested `<text>` that runs inline.
 */
export const registerHostElement = (
  component: Type<unknown>,
  element: HostElementTag,
): void => {
  const selector = reflectComponentType(component)?.selector ?? '';
  const tags = selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => ELEMENT_SELECTOR.test(part));
  if (tags.length === 0) {
    throw new Error(
      `registerHostElement: ${component.name} isn't a component with an element selector, such as 'app-title'.`,
    );
  }
  for (const tag of tags) hostElements.set(tag, element);
};

/**
 * The Lynx element to create for a tag: the registered host element for a
 * component's tag, or the tag itself.
 */
export const hostElementOf = (tag: string): string =>
  hostElements.get(tag) ?? tag;
