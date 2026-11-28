# Lynx Elements

## Importing

```typescript
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  imports: [LYNX_ELEMENTS],
  // ...
})
```

`LYNX_ELEMENTS` is an array of directives providing type-checking and IDE support for all Lynx elements. Without it, elements work but produce no type errors for invalid attributes.

At runtime, Angular makes no directive for an element whose directive only declares its attributes (every element's but `<input>`'s and `<textarea>`'s): the renderer sets the attributes itself, so a screen of many elements builds faster. So `viewChild(LynxView)`, `inject(LynxText)` and a test's `By.directive(LynxImage)` find nothing. Reach an element through a template reference instead: `viewChild('card', { read: ElementRef })`. A directive of your own that declares one of the element's attributes as an input (`accessibility-label`) takes that binding, and the element doesn't get it, as with a directive's input on the web; bind `[attr.accessibility-label]` in the directive's `host` if the element needs it too.

`ng build` and `ng serve` also build each static part of a template with Lynx's element calls directly, as ReactLynx's snapshots do: under an element, the `<view>`, `<text>` and `<image>` elements and plain text with no binding, listener, template reference or directive, and nothing dynamic inside them, become native elements with no node of Angular's. An element with an `id`, `data-*`, `hidden`, `alt` or `accessibility-traits` attribute, or an inline style with `display`, `env()`, `calc()`, `var()` or a custom property, stays Angular's, and so does every element of a component whose imports the build can't read the selectors of. Nothing in Angular can name a static element, but two things differ: on a device, a `document:` or `window:` listener's `target` for a touch on one is its nearest Angular element (see [events-and-interactions.md](events-and-interactions.md)), and an element `querySelector()` returns for one loses what you change on it when Lynx rebuilds the block, after it was removed and put back. Give an element a template reference to keep it Angular's. `ng test` builds templates as Angular does, so a spec sees every element as before.

## Available Elements

| Element         | Purpose                                      | Key Attributes                                                                           |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<view>`        | Container (like `<div>`)                     | —                                                                                        |
| `<text>`        | Text display (required for all text)         | `text-maxline`                                                                           |
| `<image>`       | Image display                                | `src`, `mode` (`aspectFit`/`aspectFill`/`scaleToFill`/`center`)                          |
| `<scroll-view>` | Scrollable container                         | `scroll-orientation` (`vertical`/`horizontal`)                                           |
| `<list>`        | Virtualized list                             | `list-type` (`single`/`flow`), `span-count`, `scroll-orientation`                        |
| `<list-item>`   | List item (must be direct child of `<list>`) | `item-key` (required, unique)                                                            |
| `<input>`       | Text input field                             | `type` (`text`/`number`/`password`/`tel`/`email`/`digit`), `placeholder`, `confirm-type` |
| `<textarea>`    | Multi-line text input                        | `placeholder`                                                                            |
| `<overlay>`     | Modal overlay (outside document flow)        | `visible` (boolean attribute)                                                            |
| `<blur-view>`   | Blurs what's behind it; Liquid Glass on iOS  | `blur-effect`, `blur-radius`, `blur-material`, `glass-style`, `glass-tint-color`         |
| `<frame>`       | Embedded Lynx page                           | `src` (URL to `.lynx.bundle`)                                                            |
| `<svg>`         | Inline SVG rendering                         | `content` (SVG string)                                                                   |
| `<canvas>`      | 2D and WebGL2 drawing surface                | `width`, `height` (drawing buffer, in pixels)                                            |
| `<block>`       | Grouping container                           | —                                                                                        |
| `<raw-text>`    | Unprocessed text                             | —                                                                                        |

## Element Rules

- **Put visible text in `<text>`** — raw text straight in a `<view>` is drawn in an anonymous `<text>`, which inherits text styles (see "Raw text in `<view>` gets an anonymous `<text>`" in [lynx-gotchas.md](lynx-gotchas.md))
- **Common HTML tags render as Lynx elements** (see [HTML tags](#html-tags)). Other unknown tags become `<view>`, with a console warning (invisible on device) when the tag has no hyphen, since that's likely a misspelled element. A component's host becomes a `<view>` too, without a warning (as does `<router-outlet>`), unless the component calls `registerHostElement()` (see "A component's host is a real `<view>`" in [lynx-gotchas.md](lynx-gotchas.md))
- **The desktop-only elements are `<view>`s on iOS, Android and the web.** `<title-bar-view>` (drags the window) and `<cover-view>` (draws above a `<webview>`) exist only in Lynx's Windows and macOS apps. Elsewhere the runtime creates a `<view>`, which keeps their content and layout, but a CSS rule naming the tag (`title-bar-view { … }`) doesn't match it: style them with classes
- **`<page>` is implicit** — one per app, created by the runtime as the root element
- **Images default to `scaleToFill`** (stretched, like the web's `object-fit: fill`). Set `mode` for `aspectFit` or `aspectFill`: CSS `object-fit` doesn't work
- **`<input>` and `<textarea>` have no border and are one line of text tall.** Size and outline them with classes (`h-10 border border-zinc-200`)
- **`accessibility-traits` is a single trait on Android.** `button,selected` works on iOS only: Android reads the list as no trait, so the element stops being a button. For state that changes, bind `[lynxAccessibilityTraits]="{ selected: chosen() }"` (part of `LYNX_ELEMENTS`), which adds the trait after the element's own on iOS and leaves Android's alone
- **A heading takes two attributes:** `accessibility-traits="header"` (iOS) and `accessibility-heading` (Android, which reads only the `none`, `image` and `button` traits). Both make `getByRole('heading')` find it. `accessibility-status="Unread"` is read before the label on both (`'Unread, Inbox'`; give a `<text>` with one an `accessibility-label`, as iOS then skips its text), and is part of the name `*ByRole` matches. `accessibility-role-description` (`'switch'`, `'checkbox'`, `'progressbar'`…) names the control for TalkBack, and gives `*ByRole` that role

## HTML tags

A template written for the browser renders: the runtime creates the Lynx element each common HTML tag stands for.

| HTML tags                                                                                                                                                                                                          | Render as           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `div`, `section`, `article`, `aside`, `header`, `footer`, `main`, `nav`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `form`, `fieldset`, `figure`, `figcaption`, `blockquote`, `address`, `hgroup`, `search`, `menu`, `hr` | `<view>`            |
| `span`, `p`, `h1`–`h6`, `a`, `button`, `label`, `strong`, `b`, `em`, `i`, `small`, `code`, `s`, `u`, `mark`, `sub`, `sup`, `abbr`, `cite`, `q`, `time`, `del`, `ins`, `kbd`, `samp`, `var`, `dfn`                  | `<text>`            |
| `img`                                                                                                                                                                                                              | `<image auto-size>` |

- **Text tags are a `<text>`:** text inside one shows, and a tag nested in one runs inline (`<p>Hi <strong>there</strong></p>` is one line). A `<view>` or `<image>` inside one is laid out inline.
- **Text and inline tags share a line.** In a block tag, a `<view>` or a component host, loose text and the inline tags beside it (`span`, `a`, `strong`, `b`, `em`, `code`, `label`…, not `p`, `h1`–`h6` or `button`) run on in one anonymous `<text>`: `<div>Hi <b>there</b></div>` is one line. In a flex or grid container, or a row, each is an item of its own, as on the web. The runtime tells them apart from the `display` the parent's classes, id and inline style can set, which the build lists for it (`globalThis.__angularLynxStyleIndex`), and regroups when they change. An `@if`/`@for` anchor between them stays in the line (as an empty raw-text, see [lynx-gotchas.md](lynx-gotchas.md)), so `{{ n }} @if (n !== 1) {items} @else {item}` is one line.
- **A space alone between two tags is dropped, as in any Angular app:** Angular's compiler (`preserveWhitespaces: false`, the default) deletes whitespace-only text nodes, so `<b>Name:</b> <span>{{ name }}</span>` draws "Name:Ada", in a browser too. The runtime draws whatever space reaches it: write it as `&ngsp;` (`<b>Name:</b>&ngsp;<span>`), inside a tag (`<b>Name: </b>`), or set `preserveWhitespaces: true` on the component.
- **Text styles inherit into HTML text tags and loose text**, through CSS variables: the build copies each inheritable declaration (`color`, `font-*`, `line-height`, `letter-spacing`, `text-align`, `text-decoration`, `text-shadow`, `direction`) to `--angular-lynx-<property>`, on the elements with such text inside (the runtime gives each one, and its ancestors, the class `_nginherit`, which an exact `class` check in a test sees), and those elements read the variable for each property their own rules don't set. A rule whose selector names `text`, such as the theme's `view > text`, isn't an HTML text tag's own, as on the web, so a `<p>` in `<view class="text-red-500">` is red, and one with no colored ancestor takes the page's color, which the theme sets. A Lynx `<text>` with such text inside also gets the class `_nginherit-text`, which the copies of a `text` rule go on instead. An inline `style` or `[style.x]` binding passes styles down too: the runtime copies its text styles to the same variables (`<div style="color: red">` colors the `<p>` inside it). A Lynx `<text>` reads none, as before; it takes only `font-size` from its parent, which the build has Lynx inherit by default (the build plugin's `enableCSSInheritance` and `customCSSInheritanceList` change what it takes: `false` gives an unsized `<text>` the page's size). An HTML inline tag inside a Lynx `<text>` reads only the variables for what that `<text>`'s rules or inline style set (or those of an HTML tag between them), so `<text style="font-size: 18px">Total: <b>12</b></text>` draws both "Total:" and the `<b>` at 18px. A relative size (`2em`, `150%`) is copied as `1em`, the size of the reading tag's parent, so `<p style="font-size: 2em">Total: <b>12</b></p>` draws the `<b>` at the `<p>`'s size, as on the web (it relies on the build's `font-size` inheritance; with it off, `em` is relative to 14px). That holds below a relative size on a `<view>` too: in `<div class="text-[2em]">a <small>b <b>c</b></small></div>` the `<b>` draws at the `<small>`'s size. A property the tag's own rules set stays its own: the build makes `<b>` and `<strong>` bold, so `<text style="font-weight: 300">plain <b>bold</b></text>` still draws the `<b>` bold. A property that none of them sets (the tag, an HTML tag between it and the `<text>`, or the `<text>`) draws as the `<text>` draws it: at the size it inherits (or the page's, with that inheritance off), at the `color` and `font-family` a `<text>` around it passes down, and at Lynx's default for the rest. So `<text>Total: <b>{{ sum }}</b></text>` stays one size. A rule that needs an ancestor (`.card .total`, a component's `:host .total`) counts only where the `<text>` has it. One for `:active` counts nowhere: while a finger is on a `<text>` whose `:active` rule sets its size, the tag in it stays at the default, so the two don't match. The same goes for an HTML text tag's own rules: `.card b { font-size: 24px }` sizes only a `<b>` inside `.card`, and a `<b>` elsewhere takes the size of the text around it. There an `:active` rule does count, so `b:active { color: red }` keeps every `<b>` from inheriting its color.
- **An inline tag in a line draws no box** on iOS and Android: its background shows behind its letters, without padding, borders or rounded corners. A lone inline tag (a badge alone in a `<div>`) is a box of its own and keeps them.
- **An `<img>` sizes to its picture** until CSS gives it a size (`auto-size`), and its `alt` becomes `accessibility-label`.
- **HTML's `hidden`** (`hidden`, `[hidden]="!open()"`) hides any element with `display: none; overflow: hidden`, ahead of the element's own inline style.
- **The element's `tagName` is the Lynx element** (`'text'` for a `<p>`). Type selectors still match the HTML tag (`p { … }`, see [styling-and-css.md](styling-and-css.md)). `RouterLink` treats an `<a>` as a plain element, so `<a routerLink>` navigates on a tap.
- **Inline text tags keep the browser's text styles:** the build plugin adds `b, strong { font-weight: bold }`, `em, i, cite, dfn, var { font-style: italic }`, `u, ins { text-decoration: underline }`, `s, del { text-decoration: line-through }`, `code, kbd, samp { font-family: Menlo, monospace }`, a smaller size for `small`, `sub` and `sup` (and lowered `sub`, raised `sup`) and black on yellow for `mark` to both bundles, ahead of the app's CSS, so the app's own rule or class for them wins. A `<u>` inside an `<s>` (or `<ins>`/`<del>`) gets both lines, from a two-class rule that beats an app's single class on either tag of the pair: `<u class="no-underline"><s>x</s></u>` still draws both lines on the `<s>`.
  - **An `<a href>` is a link, an `<abbr title>` dotted:** Lynx can't match `a[href]`, so the runtime gives an `<a>` with an `href` the class `_ngattr-a-href` (underlined, `#0000ee`, `#9e9eff` when the page is dark), and an `<abbr>` with a `title` `_ngattr-abbr-title` (dotted underline). An `<a routerLink>` writes no `href`, so it isn't styled as a link.
  - **A `<q>` draws quotation marks:** Lynx has no `::before` content, so the runtime puts its language's marks around its text itself (“ ” in English, ‘ ’ inside another `<q>`; « » in French; „ “ in German), the language being the nearest `lang` attribute on or above it, else `LOCALE_ID` (as `<html lang>` is on the web), as raw-texts at the ends of its `<text>` that Angular never sees: they aren't in its children or `nextSibling()`, but a test's `textContent` of the `<text>` includes them (`He said “hello”.`). CSS `quotes` changes them, as in a browser: a rule (`q { quotes: '«' '»' '‹' '›' }`, `none` for no marks), on the `<q>` or an element above it, or an inline style; the build lists the rules for the runtime, as Lynx drops the property. A rule the runtime can't tell applies (an attribute, sibling or structural pseudo-class in its selector, a `@media`, a nested rule) or a `var()` value leaves the language's marks.
  - **Text inside a `<sub>`, a `<sup>` or a tag with a `vertical-align` moves with it:** in `x<sup>n<b>2</b></sup>` the "2" rises with the "n", and a `<sup>` in a `<sup>` rises by both, as in a browser. So does the text inside a tag the app's own rule or inline style moves by a length in `em` or `px` (`.exp { vertical-align: 0.5em }`), and of two rules for a tag, the one Lynx applies wins (`.note sup` over the build's `sup`). Lynx moves only the `<text>` that has the `vertical-align`, so on iOS and Android the runtime gives each HTML text tag inside one the whole distance as an inline `vertical-align`. Where it can't tell the whole distance, it moves the tag by the part it can, the distances of the tags between it and the one it can't follow (so a `<b>` in a `<sup>` still rises with the `<sup>`'s own text), and with none, the tag sits on the line on iOS. It can't follow a tag that moves by a value with no fixed length (`super`, a percentage, a `calc()`, `rem`), by a rule in a `@media`, nested or `!important`, or by a selector it can't fully check (an attribute, `:first-child`, `*`, a sibling); one moved by `em` above a tag with a size of its own, from a rule or an inline style (the tag's own size, or that of a tag in between, isn't measured against it); or one whose distance adds up with the others to both `em` and `px` (a `<sup>` in a tag raised `10px`). That last is a Lynx limitation: its `vertical-align` takes a single length, drops every `calc()`, inline or in a stylesheet, and no unit adds an `em` to pixels, so the `<sup>` rises by its own `0.4em` only. To raise it by both, raise the outer tag by an `em` distance instead, or give the `<sup>` a pixel distance of its own inline (`style="vertical-align: 6px"`). A tag's own inline `vertical-align` (`style` or `[style.vertical-align]`) adds to the tags around it, as in a browser: a `<b style="vertical-align: 2px">` in a tag raised `4px` moves `6px`. Where the two are in different units (an `em` of its own in a tag raised by pixels), it's the same Lynx limitation, and the tag keeps its own value alone.
  - **Limits:** text more than five `<small>`, `<sub>` or `<sup>` tags deep stays at the fifth's size. Android draws no dotted underline, and Lynx Explorer on Android has no monospace for `<code>` (the app's own build does).
- **No other browser styles or behavior:** an `<h1>` is the size of any text, a `<button>` has no border, `<a href>` opens nothing (open links with `LynxLinking`, see [http-requests.md](http-requests.md)), a `<form>` doesn't submit, and `disabled` doesn't stop a `<button>`'s taps.
- **Other HTML tags** (`table`, `tr`, `td`, `select`, `option`, `br`, `pre`, `details`, `iframe`, `audio`…) render as a plain `<view>`, and the build warns about each.
- **Lynx elements are still the better choice** in new code: `LYNX_ELEMENTS` types their attributes (`<image mode>`) and their events' `$event`, while an HTML tag's `$event` is typed as the DOM's.

## Usage Examples

### Basic Layout

```html
<view class="card">
  <image [src]="avatarUrl" mode="aspectFill" class="avatar" />
  <view class="card-body">
    <text class="title">{{ user.name }}</text>
    <text class="subtitle">{{ user.email }}</text>
  </view>
</view>
```

### Scrollable Page

```html
<scroll-view class="page" scroll-orientation="vertical">
  <view class="content">
    <text class="heading">Welcome</text>
    <!-- Content here -->
  </view>
</scroll-view>
```

```css
.page {
  height: 100vh; /* Required — scroll-view won't scroll without explicit height */
  width: 100vw;
}
```

### List with Virtualization

```html
<list
  class="item-list"
  list-type="single"
  scroll-orientation="vertical"
  span-count="1"
>
  @for (item of items(); track item.id) {
  <list-item item-key="{{ item.id }}" class="item">
    <text>{{ item.name }}</text>
  </list-item>
  }
</list>
```

For hundreds of items or more, put `*lynxListFor="let item of items(); trackBy: byId"` on the `<list-item>` instead of `@for`: it builds an item only when the list asks for it and reuses the views scrolled away (see [list-virtualization.md](list-virtualization.md)).

### Overlay Modal

```html
<overlay
  [attr.visible]="showModal()"
  style="position: fixed; overflow: visible;"
>
  <view class="modal-backdrop" (bindtap)="closeModal()">
    <view class="modal-content" (catchtap)="$event">
      <text class="modal-title">Title</text>
      <text class="modal-body">Content here</text>
    </view>
  </view>
</overlay>
```

In the apps `ng build --platform` makes, an overlay covers the whole screen, under the status bar and the home indicator or navigation bar: pad its content with `env(safe-area-inset-*)` (see the Safe Area section of [styling-and-css.md](styling-and-css.md)).

### Blur and Liquid Glass

`<blur-view>` blurs what's drawn behind it, in place of CSS `backdrop-filter`:

```html
<blur-view
  blur-effect="glass"
  blur-radius="12px"
  class="rounded-full px-4 py-2"
>
  <text>Now playing</text>
</blur-view>
```

- **`blur-effect`** picks iOS's look: `light`, `extra-light` or `dark`, the blur styles from before iOS 13, or `glass`, Liquid Glass. A `blur-effect="glass-container"` view around several glass views merges them, as iOS 26 draws a group of controls: the ones closer than its `spacing` reach toward each other, and join once the gap is under half of it.
- **iOS's glass follows the shape's size.** Up to 60px on its shorter side it's the thin glass of a control, which lets some of what's behind it through sharp. From about 105px it's the dense glass of a panel, fully frosted, darker in dark mode, with a wider shadow. `glass-style="clear"` is the same at every size and casts no shadow.
- **The web preview draws the same glass with WebGL,** fitted to iOS's pixels: its edge, shadow, blur, lens, merging and press. Each `glass-container`, and each glass view outside one, takes one of the page's WebGL contexts, and a browser allows about 16: with more than that on screen at once, the oldest fall back to a plain frosted blur.
- **Android draws a Gaussian blur of `blur-radius`.** The runtime lays a translucent tint over it to approximate `blur-effect`, `glass-style` and `glass-tint-color`, and a background, background image or shadow the app sets replaces that tint.
- **`blur-material`** (`ultra-thin`, `thin`, `regular`, `thick` or `chrome`) draws one of UIKit's adaptive materials, which follow light and dark mode, in place of `blur-effect` and `blur-radius`. Only the iOS app that `ng build --platform ios` makes has it: Lynx Explorer and Android ignore it, so set a `blur-effect` too.
- **Glass comes and goes smoothly in that iOS app.** Inside a `glass-container` that's already on screen, a glass view materializes when it's added or shown and dissolves when it's removed or hidden. Two glass views with the same `glass-effect-id` are one piece of glass changing shape when one goes and the other comes in the same update: inside a container, the first morphs into the second; elsewhere, such as a button and the menu it opens, the second takes over as the first's content fades out. Lynx Explorer pops glass in and out instead.
- `npx @blotch/dolan add glass` adds `<blur-view ui-glass>`, which picks the effect, material and tint for the platform, its version and the color scheme, so an app rarely sets these attributes itself.

### 2D with `<canvas>`

`getContext('2d')` is the web's CanvasRenderingContext2D, drawn natively: Core Graphics on iOS, `android.graphics.Canvas` on Android, the browser's canvas in the web preview, `null` in Lynx Explorer. Paths, `Path2D` (with SVG path data), `roundRect`, transforms, clipping, dashes, gradients (linear, radial, conic), patterns, shadows, every `globalCompositeOperation`, text with `measureText()`, `drawImage()` of images, `ImageBitmap`s and other canvases, and `getImageData()`/`putImageData()` all work. Chart, signature-pad and image libraries can draw with it.

```typescript
afterNextRender(() => {
  const canvas = this.canvas().nativeElement as unknown as HTMLCanvasElement;
  const context = canvas.getContext('2d')!;
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    // Setting the size clears the bitmap and resets the state.
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    context.scale(devicePixelRatio, devicePixelRatio);
    context.fillStyle = '#4338ca';
    context.beginPath();
    context.roundRect(16, 16, width - 32, height - 32, 12);
    context.fill();
  }).observe(canvas);
});
```

- **Canvases off the page:** `document.createElement('canvas')` and `new OffscreenCanvas(w, h)` have 2D (and WebGL2) contexts, as three.js text labels and photo resizing need. Draw one with `drawImage()`, make it a pattern, upload it as a texture (three.js `CanvasTexture`, `texImage2D()` with the canvas), encode it (`toBlob()`, `toDataURL()`, `convertToBlob()`), or make an `ImageBitmap` of it (`createImageBitmap(canvas)`, `OffscreenCanvas.transferToImageBitmap()`, which clears it). A WebGL canvas's bitmap must be made in the task that drew it, unless `preserveDrawingBuffer: true`.
- **A `<video>` is an image too:** `drawImage(video, …)`, `createPattern(video, …)`, `texImage2D(…, video)` (three.js `VideoTexture`) and `createImageBitmap(video)` read the frame it shows, natively. `videoWidth`/`videoHeight` are 0 and `readyState` is `HAVE_NOTHING` until the first frame (`bindfirstframe` on the phone, which the web preview never fires: check `readyState >= HAVE_CURRENT_DATA`); until then nothing is drawn, as in a browser. A video its file says to turn (a portrait phone recording) is read turned, as it plays, and `videoWidth`/`videoHeight` are its turned size, as in a browser. The web preview's canvas APIs take a template's `<video>` and `<canvas>` too, and there, as on the phone, they're `instanceof HTMLVideoElement`/`HTMLCanvasElement`, a canvas's 2D context `instanceof CanvasRenderingContext2D`, and its WebGL2 context `instanceof WebGL2RenderingContext` (which has the WebGL constants, `WebGL2RenderingContext.FLOAT` and the rest), and what that context makes is an instance of WebGL's object classes (`WebGLBuffer`, `WebGLTexture`, `WebGLProgram`, `WebGLShader`, `WebGLUniformLocation`, `WebGLVertexArrayObject` and the rest), so twgl.js's `isTexture()` and the like work. On iOS and Android `WebGLRenderingContext` is there but nothing is an instance of it, as `getContext('webgl')` gives null. A video hidden with `display: none` is read too, as on the web. Lynx Explorer can't read one.
- **`createImageBitmap()`** takes a canvas, a Blob, a loaded `Image`, an `ImageBitmap` (a copy, with new options) or an `ImageData`, whole or cropped (`createImageBitmap(source, sx, sy, sw, sh, options)`, as for a sprite sheet; outside the source is transparent). The phone copies pixels it already has, so cropping a bitmap or an `Image` sends nothing again, and an `ImageData`'s bytes cross once.
- **Batched:** calls reach the phone once per task, except those that answer (`measureText()`, `getImageData()`, `isPointInPath()`), which send everything recorded first. Avoid them in a tight loop.
- **`filter`:** the CSS filter functions work (`blur()`, `drop-shadow()`, `sepia()`, …); `url()` is kept but not applied. Each filtered draw filters a canvas-sized layer on the main thread (two, when its shadow is cast from a shape far off the canvas, and a smaller one more for a blur or shadow at least 4 of that layer's pixels wide at a scale set by the filter's reach (on its own, a deviation past about 85 px), whose whole reach it takes in, as on the web; when the filter reaches past 256 px, each `drop-shadow()` moved by an offset casts from a layer of its own, the canvas moved back by the offset, so it reaches a shape however far off, as on the web, and doubles the work of the steps before it; only a filter's last three do, and an earlier one is still cut off at 256 px): filter one `drawImage()` of a canvas, big enough to hold any shape drawn off the canvas for its blur, not many small shapes.
- **Shadows:** a 2D shadow follows the shape's alpha (`globalAlpha`, a see-through color, an image's alpha) and `shadowBlur = 0` is sharp, as on the web. Each shadowed draw goes through a canvas-sized layer, on iOS and Android: for many shadowed shapes, draw them into a canvas and shadow one `drawImage()` of it.
- **`bitmaprenderer`:** `canvas.getContext('bitmaprenderer').transferFromImageBitmap(offscreen.transferToImageBitmap())` shows an OffscreenCanvas's frame, as on the web. The bitmap is detached (width 0 after), and the canvas shows it scaled to its CSS size and reads as it (at the bitmap's size). `transferFromImageBitmap(null)` clears it.
- **Not there:** `wordSpacing`, `fontKerning`, `fontStretch`, `fontVariantCaps`, `textRendering` (kept, no effect). Color emoji show only in a plain-color `fillText()`.
- A canvas has the kind of context it was first asked for: after `getContext('2d')`, `getContext('webgl2')` and `getContext('bitmaprenderer')` are `null`.
- **Write `<canvas>` out in a template:** the build includes the canvas element's code, and `OffscreenCanvas`, `ImageData`, `Image`, `HTMLImageElement`, `ImageBitmap`, `ImageBitmapRenderingContext`, `createImageBitmap()` and `document.createElement('canvas')`/`('img')`, only when a module names `'canvas'` or `'bitmaprenderer'` in quotes (a template's `<canvas>` does), one of those classes, or passes `'img'` to `createElement()`. Elsewhere those classes aren't globals. A `<canvas>` made from a tag built at runtime is a plain element (with a console warning) unless another module named `'canvas'`; call `ɵenableCanvas()` from `@blotch/angular-lynx` first.
- **Write `'2d'` out where you ask for the context:** the build includes the 2D context only when a module of the app or its libraries names `'2d'` in quotes, or one of its classes (`Path2D`, `CanvasRenderingContext2D`, `CanvasGradient`, `CanvasPattern`, `TextMetrics`, which are globals only then), so an app that never draws in 2D doesn't carry it. On iOS and Android, a name built at runtime gets `null` and a console warning unless another module named `'2d'`; write the name out, or call `ɵenableCanvas2D()` from `@blotch/angular-lynx` before `getContext()`.
- **The native canvas code comes the same way:** `ng build --platform ios|android` builds `<canvas>` (2D, WebGL2, `bitmaprenderer`, `Image` decoding, `<video>` frames a canvas reads, and ANGLE on iOS) into the app only when a main-thread module of the app or its libraries names `'webgl2'`, the 2D context as above, `'canvas'` or `'bitmaprenderer'` in quotes (a template's `<canvas>`, `document.createElement('canvas')`), `'img'` as `createElement()`'s tag, or `OffscreenCanvas`, `HTMLCanvasElement`, `Image`, `HTMLImageElement`, `ImageBitmap`, `createImageBitmap` or `ImageBitmapRenderingContext`. An app that never draws is about 7 MB smaller on iOS. Without it, a `<canvas>` shows nothing and `getContext()` is `null`; where every name is built at runtime, call `ɵenableCanvas()`, `ɵenableCanvas2D()` or `ɵenableWebGL2()`, which brings the native code too (and `ɵenableWebGL2()` the WebGL context and ANGLE). `ng serve --platform`'s development app always has it. An app that draws only in 2D leaves out the WebGL context and ANGLE (about 6 MB on iOS): those come only where a module names `'webgl2'` (anywhere, even in a comment), `WebGL2RenderingContext` or `ɵenableWebGL2`.

### 3D with `<canvas>`

`<canvas>` has a WebGL2 context, which three.js and angular-three draw with. Lynx has no canvas: this is AngularLynx's. In apps built with `ng build --platform ios|android` it draws with OpenGL ES 3.0: on iOS, ANGLE's on Metal (as Safari's WebGL does), and on Android, the phone's. In the web preview it's the browser's canvas. Lynx Explorer has none: there `getContext('webgl2')` is `null` and the canvas is an empty view.

```typescript
import {
  afterNextRender,
  Component,
  type ElementRef,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxCanvasElement } from '@blotch/angular-lynx';
import * as THREE from 'three';

@Component({
  selector: 'app-scene',
  imports: [LYNX_ELEMENTS],
  template: `<canvas #canvas class="h-[300px] w-full"></canvas>`,
})
export class Scene {
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');

  constructor() {
    // Draw once the canvas is laid out.
    afterNextRender(() => {
      const canvas = this.canvas()
        .nativeElement as unknown as HTMLCanvasElement;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.z = 4;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshNormalMaterial(),
      );
      scene.add(cube);
      // The canvas's size comes from its layout, as on the web.
      new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }).observe(canvas);
      renderer.setAnimationLoop((time) => {
        cube.rotation.y = time / 1000;
        renderer.render(scene, camera);
      });
    });
  }
}
```

- **Like an HTML canvas:** `width` and `height` are the drawing buffer's size (300 by 150 to start); CSS sizes it on screen. `'webgl'` is `null`. A canvas (2D or WebGL) or a `<video>` (`VideoTexture`) can be a texture.
- **Write `'webgl2'` out where you ask for the context:** the build includes the WebGL2 context only when a module of the app or its libraries names `'webgl2'` (three.js does), so an app that never draws in 3D doesn't carry it. On iOS and Android, a name built at runtime (`'webgl' + version`) gets `null` and a console warning unless another module named `'webgl2'` (the web preview's canvas is the browser's); write the name out, or call `ɵenableWebGL2()` from `@blotch/angular-lynx` before `getContext()`.
- **`toBlob(callback, type, quality)` and `toDataURL(type, quality)`** encode a PNG, or a JPEG for `'image/jpeg'` (quality 0.92 by default; other types give PNG), natively: a 2048×1365 JPEG takes ~20 ms (iOS Simulator) to ~35 ms (Android emulator), and the callback runs on a later task. A 2D canvas keeps its drawing; WebGL's drawing buffer is cleared once a frame is shown: call them in the task that drew (right after `renderer.render()`), or create the context with `preserveDrawingBuffer: true`; later you get a transparent image. JPEG makes transparent pixels black. A canvas without a context encodes a transparent image; a lost context, a zero size or Lynx Explorer gives `null` / `'data:,'`. Share the `Blob` with `LynxShare` (see [http-requests.md](http-requests.md#share-files-and-links)).
- **What three.js needs works:** `ResizeObserver`, `getBoundingClientRect()`/`clientWidth` (from the element's last layout), pointer events from touches (on the canvas and on `document`), `performance.now()` (in fractions of a millisecond, as on the web: in a native app the runtime builds it on the engine's microsecond clock, which a change to the device's time moves; the web preview has the browser's), `devicePixelRatio`, `requestAnimationFrame`. `TextureLoader`, `ImageBitmapLoader` and `GLTFLoader` (`.glb` with embedded textures) load from `https://`, `data:` and object URLs and from files the app bundles (by their path in `dist/`, see [http-requests.md](http-requests.md)); the phone decodes images. `DRACOLoader` and `KTX2Loader` need Workers or WebAssembly: they don't work.
- **angular-three:** add `provideNgtRenderer()` from `angular-three/dom` after `provideRenderer()`: it wraps AngularLynx's renderer. `<ngt-canvas>` sizes itself, and mesh events come from touches. angular-three 4.2 lists Angular below 22 and three.js below 0.183 as peers: install with `--legacy-peer-deps` (or an npm `overrides` entry) and pin `three@0.182`.
- **The GL context goes with the canvas:** at once when Angular destroys the view the canvas is at the top of, otherwise when the canvas is garbage-collected, as in a browser. To free it as soon as a component goes, dispose of it there (three.js: `renderer.dispose()` and `renderer.forceContextLoss()` in `ngOnDestroy`).
- **Give each canvas its own materials and textures:** three.js keeps every renderer that drew a material or texture for as long as that material or texture lives, with its canvas, the canvas's native view and its GL state, as in a browser. So a module-level material, or a model or texture from angular-three's loader cache drawn as it is, keeps one of each for every time its canvas was shown. Draw copies: `material.clone()`, and `texture.clone()`, which shares the decoded image.
- **Performance:** WebGL calls are batched: a frame that asks the context nothing (`getParameter()`, `readPixels()`, `getError()`…) reaches the shell in one call. The iOS Simulator and the Android emulator draw on the Mac's GPU (a shadowed three.js scene runs at 60 fps in the Simulator), but a phone's GPU is slower: judge speed on a phone. On an app's first launch after it's installed, each material's shaders compile when it's first drawn (up to 2 s for the first in the Simulator); later launches reuse them.
- `crypto.randomUUID()`, which the runtime adds for angular-three, isn't cryptographically secure.

### Input Handling

```html
<input
  placeholder="Enter your name"
  type="text"
  (bindinput)="onInput($event)"
/>

<textarea
  placeholder="Enter description"
  (bindinput)="onInput($event)"
></textarea>
```

```typescript
import { type InputDetail, type LynxEvent } from '@blotch/angular-lynx';

onInput({ detail }: LynxEvent<InputDetail>) {
  this.inputValue.set(detail.value);
}
```

Set a field's text from code with `[value]`, a form (`[formField]`, `[formControl]`, `[(ngModel)]`) or `form.reset()`. It shows from the field's first render, as on the web. Don't bind `[attr.value]`: on iOS and Android a Lynx field has no `value` attribute, so the runtime sets the text with the field's `setValue` method (and as `default-value` before the field is on screen). A `[value]` set to the text the field already has, such as a model bound back to it after each keystroke, leaves the field alone, so the caret doesn't move. Read what's typed from `(bindinput)`'s `detail.value`: `nativeElement.value` doesn't exist.

Call an element's UI methods (`focus`, `setSelectionRange`, `scrollTo`…) with `nativeElement.invoke(method, params)` on its `ElementRef`. Native makes an element's UI when the tree is flushed after change detection, and the call waits for that flush (the build turns on Lynx's pending UI method calls), so focusing a field from `ngAfterViewInit()` or the first screen's `afterNextRender()` works. The method runs, and its result comes back, after the flush: never inside the `invoke()` call.
