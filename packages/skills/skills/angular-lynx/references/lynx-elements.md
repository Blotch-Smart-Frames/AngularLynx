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
| `<frame>`       | Embedded Lynx page                           | `src` (URL to `.lynx.bundle`)                                                            |
| `<svg>`         | Inline SVG rendering                         | `content` (SVG string)                                                                   |
| `<block>`       | Grouping container                           | —                                                                                        |
| `<raw-text>`    | Unprocessed text                             | —                                                                                        |

## Element Rules

- **All visible text must be in `<text>`** — raw text in `<view>` does not render
- **Unknown tags become `<view>`** with a console warning (invisible on device)
- **`<page>` is implicit** — one per app, created by the runtime as the root element
- **Images default to `aspectFit`** in the Angular renderer (Lynx native default is `scaleToFill`)

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
