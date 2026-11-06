/**
 * The HTML tags that render as a `<text>`: those whose content is text and
 * inline elements only (HTML's phrasing content). A `<text>` is where Lynx
 * draws text, a nested `<text>` runs inline with it, and a `<view>` or
 * `<image>` inside one is laid out inline too, so `<p>Read <a>the docs</a></p>`
 * reads as one line, as it does in a browser.
 *
 * `a` can hold blocks in HTML, but a link is usually a few words, which only
 * show inside a `<text>`. A block inside one still renders, as an inline view.
 */
const TEXT_TAGS = [
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'button',
  'label',
  'strong',
  'b',
  'em',
  'i',
  'small',
  'code',
  's',
  'u',
  'mark',
  'sub',
  'sup',
  'abbr',
  'cite',
  'q',
  'time',
  'del',
  'ins',
  'kbd',
  'samp',
  'var',
  'dfn',
];

/**
 * The HTML tags that render as a `<view>`: those that hold blocks of other
 * elements (HTML's flow content). Every other tag Lynx has no element for
 * renders as a `<view>` too, but with a warning (see createDefaultElement):
 * these are expected, so they don't get one.
 */
const VIEW_TAGS = [
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'form',
  'fieldset',
  'figure',
  'figcaption',
  'blockquote',
  'address',
  'hgroup',
  'search',
  'menu',
  'hr',
];

/**
 * The Lynx element each common HTML tag renders as, so a template written for
 * the browser shows something on Lynx: a `<div>` is a `<view>`, a `<span>` a
 * `<text>` and an `<img>` an `<image>`. Tags Lynx has an element of the same
 * name for, such as `input`, `textarea`, `video` and `canvas`, aren't here:
 * they're already that element.
 *
 * The element keeps its tag's class (see tagClassOf), so a stylesheet's `p` or
 * `img` selector still matches it.
 */
export const WEB_TAG_ELEMENTS: ReadonlyMap<string, 'view' | 'text' | 'image'> =
  new Map([
    ...TEXT_TAGS.map((tag) => [tag, 'text'] as const),
    ...VIEW_TAGS.map((tag) => [tag, 'view'] as const),
    ['img', 'image'],
  ]);
