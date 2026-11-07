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
| `<canvas>`      | WebGL2 drawing surface, for three.js         | `width`, `height` (drawing buffer, in pixels)                                            |
| `<block>`       | Grouping container                           | —                                                                                        |
| `<raw-text>`    | Unprocessed text                             | —                                                                                        |

## Element Rules

- **Put visible text in `<text>`** — raw text straight in a `<view>` is drawn in an anonymous `<text>`, which inherits text styles (see "Raw text in `<view>` gets an anonymous `<text>`" in [lynx-gotchas.md](lynx-gotchas.md))
- **Common HTML tags render as Lynx elements** (see [HTML tags](#html-tags)). Other unknown tags become `<view>` with a console warning (invisible on device). So does a component's host, unless the component calls `registerHostElement()` (see "A component's host is a real `<view>`" in [lynx-gotchas.md](lynx-gotchas.md))
- **`<page>` is implicit** — one per app, created by the runtime as the root element
- **Images default to `scaleToFill`** (stretched, like the web's `object-fit: fill`). Set `mode` for `aspectFit` or `aspectFill`: CSS `object-fit` doesn't work
- **`<input>` and `<textarea>` have no border and are one line of text tall.** Size and outline them with classes (`h-10 border border-zinc-200`)
- **`accessibility-traits` is a single trait on Android.** `button,selected` works on iOS only: Android reads the list as no trait, so the element stops being a button. For state that changes, bind `[lynxAccessibilityTraits]="{ selected: chosen() }"` (part of `LYNX_ELEMENTS`), which adds the trait after the element's own on iOS and leaves Android's alone

## HTML tags

A template written for the browser renders: the runtime creates the Lynx element each common HTML tag stands for.

| HTML tags                                                                                                                                                                                                          | Render as           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `div`, `section`, `article`, `aside`, `header`, `footer`, `main`, `nav`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `form`, `fieldset`, `figure`, `figcaption`, `blockquote`, `address`, `hgroup`, `search`, `menu`, `hr` | `<view>`            |
| `span`, `p`, `h1`–`h6`, `a`, `button`, `label`, `strong`, `b`, `em`, `i`, `small`, `code`, `s`, `u`, `mark`, `sub`, `sup`, `abbr`, `cite`, `q`, `time`, `del`, `ins`, `kbd`, `samp`, `var`, `dfn`                  | `<text>`            |
| `img`                                                                                                                                                                                                              | `<image auto-size>` |

- **Text tags are a `<text>`:** text inside one shows, and a tag nested in one runs inline (`<p>Hi <strong>there</strong></p>` is one line). A `<view>` or `<image>` inside one is laid out inline.
- **Text and inline tags share a line.** In a block tag, a `<view>` or a component host, loose text and the inline tags beside it (`span`, `a`, `strong`, `b`, `em`, `code`, `label`…, not `p`, `h1`–`h6` or `button`) run on in one anonymous `<text>`: `<div>Hi <b>there</b></div>` is one line. In a flex or grid container, or a row, each is an item of its own, as on the web. The runtime tells them apart from the `display` the parent's classes, id and inline style can set, which the build lists for it (`globalThis.__angularLynxStyleIndex`), and regroups when they change. An `@if`/`@for` anchor between them stays in the line (as an empty raw-text, see [lynx-gotchas.md](lynx-gotchas.md)), so `{{ n }} @if (n !== 1) {items} @else {item}` is one line.
- **Text styles inherit into HTML text tags and loose text**, through CSS variables: the build copies each inheritable declaration (`color`, `font-*`, `line-height`, `letter-spacing`, `text-align`, `text-decoration`, `text-shadow`, `direction`) to `--angular-lynx-<property>`, and those elements read the variable for each property their own rules don't set. Classes and stylesheet rules pass styles down; an inline `style` doesn't. A Lynx `<text>` reads none, as before.
- **An inline tag in a line draws no box** on iOS and Android: its background shows behind its letters, without padding, borders or rounded corners. A lone inline tag (a badge alone in a `<div>`) is a box of its own and keeps them.
- **An `<img>` sizes to its picture** until CSS gives it a size (`auto-size`), and its `alt` becomes `accessibility-label`.
- **HTML's `hidden`** (`hidden`, `[hidden]="!open()"`) hides any element with `display: none; overflow: hidden`, ahead of the element's own inline style.
- **The element's `tagName` is the Lynx element** (`'text'` for a `<p>`). Type selectors still match the HTML tag (`p { … }`, see [styling-and-css.md](styling-and-css.md)). `RouterLink` treats an `<a>` as a plain element, so `<a routerLink>` navigates on a tap.
- **No browser styles or behavior:** an `<h1>` is the size of any text, a `<button>` has no border, `<a href>` opens nothing (open links with `LynxLinking`, see [http-requests.md](http-requests.md)), a `<form>` doesn't submit, and `disabled` doesn't stop a `<button>`'s taps.
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

- **`blur-effect`** picks iOS's look: `light`, `extra-light` or `dark`, the blur styles from before iOS 13, or `glass`, Liquid Glass. A `blur-effect="glass-container"` view around several glass views merges the ones closer than its `spacing`, as iOS 26 draws a group of controls.
- **Android draws a Gaussian blur of `blur-radius`.** The runtime lays a translucent tint over it to approximate `blur-effect`, `glass-style` and `glass-tint-color`, and a background, background image or shadow the app sets replaces that tint.
- **`blur-material`** (`ultra-thin`, `thin`, `regular`, `thick` or `chrome`) draws one of UIKit's adaptive materials, which follow light and dark mode, in place of `blur-effect` and `blur-radius`. Only the iOS app that `ng build --platform ios` makes has it: Lynx Explorer and Android ignore it, so set a `blur-effect` too.
- **Glass comes and goes smoothly in that iOS app.** Inside a `glass-container` that's already on screen, a glass view materializes when it's added or shown and dissolves when it's removed or hidden. Two glass views with the same `glass-effect-id` are one piece of glass changing shape when one goes and the other comes in the same update: inside a container, the first morphs into the second; elsewhere, such as a button and the menu it opens, the second takes over as the first's content fades out. Lynx Explorer pops glass in and out instead.
- `npx @blotch/dolan add glass` adds `<blur-view ui-glass>`, which picks the effect, material and tint for the platform, its version and the color scheme, so an app rarely sets these attributes itself.

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

- **Like an HTML canvas:** `width` and `height` are the drawing buffer's size (300 by 150 to start); CSS sizes it on screen. `getContext('webgl2')` only: no `'2d'` context, and `'webgl'` is `null`. No `toDataURL()`/`toBlob()`: use `readPixels()`. A `<canvas>` or video can't be a texture.
- **What three.js needs works:** `ResizeObserver`, `getBoundingClientRect()`/`clientWidth` (from the element's last layout), pointer events from touches (on the canvas and on `document`), `performance.now()`, `devicePixelRatio`, `requestAnimationFrame`. `TextureLoader`, `ImageBitmapLoader` and `GLTFLoader` (`.glb` with embedded textures) load from `https://`, `data:` and object URLs and from files the app bundles (by their path in `dist/`, see [http-requests.md](http-requests.md)); the phone decodes images. `DRACOLoader` and `KTX2Loader` need Workers or WebAssembly: they don't work.
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
