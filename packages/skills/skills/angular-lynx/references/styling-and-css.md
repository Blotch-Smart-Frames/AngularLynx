# Styling & CSS

## Key Differences from Web CSS

Lynx uses a subset of CSS with fundamentally different defaults. Read this before writing any styles.

### Layout Model

- **Default display is `linear`** (not `block`). Lynx's linear layout is inspired by Android's LinearLayout.
- Supported `display` values: `linear`, `flex`, `grid`, `relative`, `none`
- `block` and `inline` are **not supported**
- `scroll-view` is always forced to `linear`, regardless of CSS

### Linear Layout Properties

```css
.container {
  display: linear; /* default, can be omitted */
  linear-direction: column; /* column (default), row, column-reverse, row-reverse */
}

.child {
  linear-weight: 1; /* distributes remaining space, like flex-grow */
}
```

### Box Model

- **Default `box-sizing` is `border-box`** (not `content-box`)
- **No margin collapsing** — both margins are always applied in full
- Default `border-style` is `solid` (not `none`)
- `border-style: none` does NOT collapse border width — also set `border-width: 0`

### No CSS Inheritance

CSS properties do **not** inherit from parent to child (except nested `<text>` inherits `color` and `font-family`). Every element must declare its own styles.

```css
/* Web: children inherit font-size. Lynx: they don't. */
.container {
  font-size: 16px;
}
.container text {
  font-size: 16px;
} /* Must repeat on every text element */
```

### Position

- Default `position` is `relative` (not `static`)
- `position: fixed` = `position: absolute` relative to root (does NOT stay fixed during scroll)
- `position: sticky` only works inside `<scroll-view>`

## Style Scoping

Angular's `ViewEncapsulation.Emulated` works (adds `_nghost-*` classes). `ViewEncapsulation.ShadowDom` falls back to `None` with a warning. All component styles are effectively global by default.

## Responsive Units

- `rpx` — responsive pixels. `750rpx` = full screen width regardless of device
- `px`, `%`, `vw`, `vh` all work as expected
- No `em`, `rem` support on non-text elements

## Not Supported

| Feature                | Alternative                            |
| ---------------------- | -------------------------------------- |
| `@media` queries       | Runtime logic with conditional classes |
| `::before` / `::after` | Explicit `<view>` elements             |
| `:hover` / `:focus`    | Signal-driven class toggling           |
| `:active`              | Supported (tracks touch state)         |
| `pointer-events`       | DOM ordering (sibling stacking)        |
| `float` / `clear`      | Flex or linear layout                  |
| `outline`              | Use `border`                           |
| `!important`           | Specificity-based overrides            |
| `will-change`          | Lynx manages layer promotion natively  |
| `currentColor`         | Explicit color values                  |

## CSS Property Restrictions

- **`overflow`**: Only `visible` (default) and `hidden`. No `auto` or `scroll` (use `<scroll-view>`).
- **`filter`**: Only one function at a time. Supported: `blur`, `grayscale`, `brightness`, `contrast`, `saturate`.
- **`box-shadow`**: No `inset` keyword.
- **`text-shadow`**: One layer only, all 4 params required (`offset-x offset-y blur-radius color`).
- **`font-weight`**: No `lighter`/`bolder`. Use `normal`, `bold`, or numeric `100`–`1000`.
- **`font-size`**: Default is `14px` (not `16px`). No keyword sizes (`small`, `large`, etc.).
- **`white-space`**: Only `normal` and `nowrap`.
- **`line-height`**: Only works directly on `<text>` elements.
- **`text-align`**: No `justify`.
- **`aspect-ratio`**: No `auto` keyword.
- **`clip-path`**: Only on `<view>`, no `polygon()`.

## Complete Example

```typescript
@Component({
  selector: 'app-card',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="card" [class.card-active]="isActive()" (bindtap)="toggle()">
      <image [src]="imageUrl" mode="aspectFill" class="card-image" />
      <view class="card-body">
        <text class="card-title">{{ title }}</text>
        <text class="card-description">{{ description }}</text>
      </view>
    </view>
  `,
  styles: [`
    .card {
      display: flex;
      flex-direction: row;
      padding: 12px;
      border-radius: 8px;
      background-color: #ffffff;
    }
    .card-active {
      background-color: #e8f0fe;
    }
    .card-image {
      width: 60px;
      height: 60px;
      border-radius: 8px;
    }
    .card-body {
      margin-left: 12px;
      flex: 1;
    }
    .card-title {
      font-size: 16px;
      font-weight: bold;
      color: #1a1a1a;
    }
    .card-description {
      font-size: 14px;
      color: #666666;
      margin-top: 4px;
    }
  `],
})
```
