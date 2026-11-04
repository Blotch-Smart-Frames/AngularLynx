/**
 * The tags `createElement()` creates a Lynx element of the same name for (see
 * `createNativeRefByTag`, and `list` and `page` in `LynxDocument`). Lynx's CSS
 * matches a type selector naming one of them, such as `view` or `text`,
 * against the element itself.
 *
 * Every other tag, a component's host (`app-card`) or a web element Lynx
 * doesn't have (`div`), renders as another element, a `<view>` unless
 * `registerHostElement` names one, so a type selector naming it would match
 * nothing. The renderer gives such an element its tag's class (`tagClassOf`)
 * instead, and the build plugin rewrites the type selector to that class.
 *
 * The build plugin keeps its own copy of this list
 * (`packages/rsbuild-plugin-angular-lynx/src/type-selectors.ts`), and a test
 * there keeps the two the same: a Lynx tag missing from its copy would have its
 * selectors rewritten to a class no element has.
 */
export const LYNX_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  'page',
  'view',
  'text',
  'raw-text',
  'inline-truncation',
  'image',
  'scroll-view',
  'list',
  'list-item',
  'block',
  'if',
  'for',
  'frame',
  'input',
  'textarea',
  'overlay',
  'svg',
  'viewpager',
  'viewpager-item',
  'refresh',
  'refresh-header',
  'title-bar-view',
  'scroll-coordinator',
  'scroll-coordinator-header',
  'scroll-coordinator-toolbar',
  'scroll-coordinator-slot',
  'scroll-coordinator-slot-drag',
  'blur-view',
  'webview',
  'video',
  'cover-view',
  'canvas',
  'comment',
]);

/**
 * The class that stands for a tag Lynx has no element for, so a type
 * selector naming the tag can match the element that renders it. CSS type
 * selectors ignore case, so the tag is lowercased. The underscore keeps it
 * apart from an app's own classes, as with Angular's `_ngcontent-` scope
 * classes: a plain `header` or `label` class is common.
 */
export const tagClassOf = (tag: string): string =>
  `_ngtag-${tag.toLowerCase()}`;

/**
 * The class to mark an element created for `tag` with, so type selectors
 * naming the tag match it, or `null` for a Lynx element, which Lynx's CSS
 * matches by its own tag.
 */
export const tagClassFor = (tag: string): string | null =>
  LYNX_ELEMENT_TAGS.has(tag) ? null : tagClassOf(tag);
