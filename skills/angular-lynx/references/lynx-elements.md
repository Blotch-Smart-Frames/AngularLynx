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
| `<block>`       | Grouping container                           | —                                                                                        |
| `<raw-text>`    | Unprocessed text                             | —                                                                                        |

## Element Rules

- **All visible text must be in `<text>`** — raw text in `<view>` does not render
- **Unknown tags become `<view>`** with a console warning (invisible on device). So does a component's host, unless the component calls `registerHostElement()` (see "A component's host is a real `<view>`" in [lynx-gotchas.md](lynx-gotchas.md))
- **`<page>` is implicit** — one per app, created by the runtime as the root element
- **Images default to `scaleToFill`** (stretched, like the web's `object-fit: fill`). Set `mode` for `aspectFit` or `aspectFill`: CSS `object-fit` doesn't work
- **`<input>` and `<textarea>` have no border and are one line of text tall.** Size and outline them with classes (`h-10 border border-zinc-200`)
- **`accessibility-traits` is a single trait on Android.** `button,selected` works on iOS only: Android reads the list as no trait, so the element stops being a button. For state that changes, bind `[lynxAccessibilityTraits]="{ selected: chosen() }"` (part of `LYNX_ELEMENTS`), which adds the trait after the element's own on iOS and leaves Android's alone

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

### Input Handling

```html
<input
  placeholder="Enter your name"
  type="text"
  (bindinput)="onInput($any($event))"
/>

<textarea
  placeholder="Enter description"
  (bindinput)="onInput($any($event))"
></textarea>
```

```typescript
onInput(event: { detail: { value: string } }) {
  this.inputValue.set(event.detail.value);
}
```
