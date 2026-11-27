import { InjectionToken, type Provider, inject } from '@angular/core';

import type * as iconSet from './icon-set';

/**
 * An icon of the set (icon-set.ts), such as `chevronRightIcon`: the name
 * templates draw it by and the markup inside its `<svg>`.
 */
export type UiIconDefinition<Name extends string = string> = {
  readonly name: Name;
  readonly body: string;
};

/**
 * The name of every icon in the set, such as `'chevron-right'`. A type only,
 * so it costs an app's scripts nothing: an icon draws by name once it's
 * registered (`provideIcons`).
 */
export type IconName = (typeof iconSet)[keyof typeof iconSet]['name'];

/** An icon's whole markup, its body in the set's root `<svg>`. */
export const iconSvg = (icon: UiIconDefinition): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.body}</svg>`;

/**
 * The icons one `provideIcons()` registered, and the registrations above the
 * injector it's in, which it reads on a miss.
 */
type IconRegistry = {
  readonly icons: ReadonlyMap<string, UiIconDefinition>;
  readonly parent: readonly IconRegistry[] | null;
};

/**
 * Multi, so an app can call `provideIcons()` more than once in one place, and
 * each call adds its icons rather than replacing the last call's.
 */
const UI_ICONS = new InjectionToken<readonly IconRegistry[]>('UI_ICONS');

/**
 * Registers icons from the set, so templates can draw them by name
 * (`name="chevron-right"`, `[icon]="item.icon"`). An icon that isn't
 * registered isn't in the app's scripts at all: the set is one export per
 * icon, and a bundler leaves out every one the app doesn't import.
 *
 * Give it in the app's config for the whole app, or in a component's
 * `providers` for that component and what it shows; each registration adds
 * to those above it. The keys don't matter, since each icon carries its own
 * name, so `provideIcons({ checkIcon, chevronRightIcon })` registers `check`
 * and `chevron-right`.
 *
 * ```ts
 * // checkIcon, chevronRightIcon and provideIcons from the icon component.
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideIcons({ checkIcon, chevronRightIcon })],
 * };
 * ```
 */
export const provideIcons = (
  icons: Readonly<Record<string, UiIconDefinition>>,
): Provider => ({
  provide: UI_ICONS,
  multi: true,
  // A registration keeps a link to the ones above it rather than a copy of
  // their icons: a component's providers run for each of its instances, and
  // copying the app's every icon into each menu item would cost more than
  // the walk up on a miss.
  useFactory: (): IconRegistry => ({
    icons: new Map(Object.values(icons).map((icon) => [icon.name, icon])),
    parent: inject(UI_ICONS, { skipSelf: true, optional: true }),
  }),
});

const findIcon = (
  registries: readonly IconRegistry[] | null,
  name: string,
): UiIconDefinition | undefined => {
  if (!registries) return undefined;
  // The last registration wins, as Angular's own providers do.
  for (let i = registries.length - 1; i >= 0; i--) {
    const icon = registries[i].icons.get(name);
    if (icon) return icon;
  }
  for (const registry of registries) {
    const icon = findIcon(registry.parent, name);
    if (icon) return icon;
  }
  return undefined;
};

/**
 * `chevron-right` → `chevronRightIcon`, the export that holds it.
 */
const exportName = (name: string): string =>
  `${name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Icon`;

/**
 * Gives the markup's root `<svg>` the SVG namespace when it has none. The web
 * preview draws `content` as an image of the markup, and a browser draws
 * nothing for an SVG image without the namespace. An app's own SVG often
 * leaves it out, since an `<svg>` written in an HTML page doesn't need it.
 */
const withSvgNamespace = (markup: string): string =>
  markup.replace(/<svg\b([^>]*)>/, (tag, attributes: string) =>
    /\sxmlns\s*=/.test(attributes)
      ? tag
      : `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>`,
  );

/**
 * The markup to draw for an icon given either way: by name from the icons
 * `provideIcons()` registered, or as the app's own SVG, such as its logo or a
 * sign-in provider's mark, which the set can't hold.
 */
export type IconMarkup = (
  name: IconName | undefined,
  svg: string | undefined,
  mistake: string,
) => string;

/**
 * The `IconMarkup` of the injector it's called in, for the components that
 * take an icon either way: `<ui-icon>` and the dock's and tab bar's items
 * (and, through `optionalIconMarkup`, the menu's and toolbar's items and the
 * empty state), so an app's mark draws the same in each.
 *
 * Neither, or both, is a mistake in the template that the compiler can't
 * catch, since neither input can be required, so it throws `mistake` rather
 * than drawing an empty box or picking one. A name nobody registered throws
 * too, naming the export to register: an empty box would look like a layout
 * bug.
 */
export const injectIconMarkup = (): IconMarkup => {
  const registries = inject(UI_ICONS, { optional: true });
  return (name, svg, mistake) => {
    if (svg !== undefined && name === undefined) return withSvgNamespace(svg);
    if (name === undefined || svg !== undefined) throw new Error(mistake);
    const icon = findIcon(registries, name);
    if (!icon) {
      throw new Error(
        `No icon named "${name}" is registered. Register it with provideIcons({ ${exportName(name)} }) in the app's config or a component's providers.`,
      );
    }
    return iconSvg(icon);
  };
};

/**
 * As `IconMarkup`, for a component whose icon is optional, such as a menu
 * item, a toolbar item or an empty state: neither is no icon (`undefined`),
 * and both is still a mistake that throws.
 */
export const optionalIconMarkup = (
  iconMarkup: IconMarkup,
  name: IconName | undefined,
  svg: string | undefined,
  mistake: string,
): string | undefined =>
  name === undefined && svg === undefined
    ? undefined
    : iconMarkup(name, svg, mistake);

/**
 * Markup with each `currentColor` in it drawn in `color`, a concrete color
 * (see icon-theme.ts). The set's icons stroke with `currentColor`, and an
 * app's one-color mark fills with it, so both follow the state and theme of
 * what they're drawn in, while colors written out stay.
 *
 * The SVG engines don't take `color` from the element: Lynx's native ones
 * read a literal color, and the web preview draws the markup as an image,
 * apart from the page's CSS. So the color goes into the markup itself.
 *
 * split/join, not String.prototype.replaceAll(): replaceAll is ES2021, and
 * PrimJS, which runs Angular on Lynx's main thread, implements ES2019. Only
 * the build's polyfill (es-builtins.js) adds it, and without it the call
 * throws "not a function" inside change detection, which aborts the whole
 * tick before Lynx flushes the element tree, so no icon paints at all. An app
 * built with an older build plugin than its copied components has no
 * polyfill. The search term is a plain literal, so it needs no regex either.
 */
export const paintIcon = (markup: string, color: string): string =>
  markup.split('currentColor').join(color);
