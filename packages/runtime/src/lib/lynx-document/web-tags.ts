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
 * renders as a `<view>` too, and one without a hyphen gets a warning, as a
 * likely typo (see createDefaultElement): these are expected, so they don't.
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
 * The text tags that are inline in HTML, which run on with the text beside
 * them: `<div>Read <a>the docs</a> first</div>` is one line in a browser.
 * The runtime puts a run of them and loose text in one anonymous `<text>`
 * when their parent lays out as a block does (see LynxElement's #regroup).
 * Not `button`, which a browser lays out as a box of its own, nor the block
 * text tags (`p`, `h1`…), which start lines of their own.
 */
export const INLINE_FLOW_TAGS: ReadonlySet<string> = new Set(
  TEXT_TAGS.filter(
    (tag) => !['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button'].includes(tag),
  ),
);

/**
 * The HTML tags that render as a `<text>` (see TEXT_TAGS). They take the
 * text styles their ancestors set, as on the web (see text-flow.ts), where
 * an element written as a Lynx `<text>` doesn't.
 */
export const WEB_TEXT_TAGS: ReadonlySet<string> = new Set(TEXT_TAGS);

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

/**
 * The HTML tags a browser styles only while they have an attribute, by the
 * attribute: an `<a>` is underlined and link-colored only with an `href`
 * (`a:any-link`), and an `<abbr>` has a dotted underline only with a `title`
 * (`abbr[title]`). Lynx matches no attribute selector (see
 * investigations/lynx-vs-web-differences.md), so the runtime gives such an
 * element a class while it has the attribute (attributeClassOf), and the
 * build plugin's html-text-tags.css styles the class.
 */
export const ATTRIBUTE_STYLED_TAGS: ReadonlyMap<string, string> = new Map([
  ['href', 'a'],
  ['title', 'abbr'],
]);

/**
 * The class that stands for `tag[attribute]`: `_ngattr-a-href` for an `<a>`
 * with an `href`. One class rather than the attribute's alongside the tag's,
 * so the build's rule for it is as specific as an app's own class, which
 * comes later and wins, as an app's CSS wins over a browser's styles.
 */
export const attributeClassOf = (tag: string, attribute: string): string =>
  `_ngattr-${tag}-${attribute}`;
