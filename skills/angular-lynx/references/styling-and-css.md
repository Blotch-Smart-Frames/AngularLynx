# Styling & CSS

## Key Differences from Web CSS

Lynx uses a subset of CSS with fundamentally different defaults. Read this before writing any styles.

### Layout Model

- **Default display is `linear`** (not `block`). Lynx's linear layout is inspired by Android's LinearLayout.
- Supported `display` values: `linear`, `flex`, `grid`, `relative`, `none`
- **`display: block` becomes `linear`.** Lynx has no block layout and would lay a `block` element out as a row, so a child with no width would shrink to nothing. The build rewrites it in every stylesheet (component styles, a library's included, and global ones), and the runtime in inline styles (`[style.display]`, `style="..."`), so `:host { display: block }` works as on the web
- The other values Lynx lacks become the value that lays the children out the same way: `inline` and `inline-block` become `linear`, `inline-flex` becomes `flex`, `inline-grid` becomes `grid`. Lynx can't place elements inline, so such an element still stretches across its parent; add `align-self: flex-start` (`self-start`) to make it hug its content
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

CSS properties do **not** inherit from parent to child (except nested `<text>` inherits `color` and `font-family` from the `<text>` directly around it; a `<view>` in between stops it, and the inner text draws in the default black). Every element must declare its own styles. CSS variables (`--x`) are the exception: they inherit, so a variable set on a parent reaches everything inside it.

On the web, Lynx sets no font, so text would take the font of the page around the `<lynx-view>` (the browser's default serif in `ng serve`'s preview). The build adds `page { font-family: <the system font stack> }` to the web bundle only, before the app's styles, so web text matches the phones' system font. An app's own font still wins: a `page` rule of its own, a `font-*` class, or a style on the element. On iOS and Android, text is in the system font already.

HTML text tags (`<p>`, `<span>`, `<h1>`…) and loose text do inherit text styles, through such variables: the build copies each `color`, `font-*`, `line-height`, `letter-spacing`, `text-align`, `text-decoration`, `text-shadow` and `direction` declaration to `--angular-lynx-<property>`, and those elements read the ones their own rules don't set. Only classes and stylesheet rules pass them down, not an inline `style`. A Lynx `<text>` reads none, so the example below still holds for it.

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

Component styles are scoped as in Angular on the web. `ViewEncapsulation.Emulated` (the default) applies a component's rules only to its own template, with `:host`, `:host-context()` and `::ng-deep`. Lynx can't match attribute selectors, so elements carry `_ngcontent-<id>` and `_nghost-<id>` classes instead of attributes. `ViewEncapsulation.None` makes rules global. `ViewEncapsulation.ShadowDom` falls back to `None` with a warning. Component stylesheets must be plain CSS.

Type selectors match the tag the template wrote, as on the web: `app-card { height: 100%; }` styles a component's host, `div { … }` a `<div>` and `p { … }` a `<p>`, though the first two render as a `<view>` and the `<p>` as a `<text>`. The renderer gives such an element a `_ngtag-<tag>` class, and the build rewrites type selectors naming a tag that isn't a Lynx element to that class, in component and global styles. Selectors naming Lynx elements (`view`, `text`, `page`) are left as they are. A class outranks a type selector, so `app-card { color: red }` ties with `.title { color: blue }` on the same element, and the later rule wins. The root component's host is the page, which `app-root { … }` doesn't match: style it with `page`, or with `:host` in its own styles.

Components from prebuilt libraries (a package from npm, or a workspace library consumed from its `dist`, whether ng-packagr compiled it partially or in full) get the same scoping and type selectors: the build takes their styles out of their compiled definitions after Angular's linker. Importing the component is enough, as on the web. Lynx compiles CSS into the bundle ahead of time, so the styles of every component in a library file ship, even for the ones the app doesn't use. Their code is still tree-shaken.

## Responsive Units

- `rpx` — responsive pixels. `750rpx` = full screen width regardless of device
- `px`, `%`, `vw`, `vh` all work as expected
- No `em`, `rem` support on non-text elements

## Safe Area

Pad for the notch, the status bar and the home indicator with `env(safe-area-inset-top|right|bottom|left)`, as on the web. It works inside `calc()`, in stylesheets, inline styles and `[style.x]` bindings:

```angular-html
<scroll-view scroll-orientation="vertical" class="flex-1">
  <view
    style="padding-top: calc(12px + env(safe-area-inset-top)); padding-bottom: calc(96px + env(safe-area-inset-bottom));"
  >
    <!-- the first row starts below the status bar, and scrolls under it -->
  </view>
</scroll-view>
```

- **Apps from `ng build --platform` draw edge to edge**, under the status bar and the home indicator, as Safari does with `viewport-fit=cover`, and `env()` gives the window's insets on iOS and Android, following rotation. Pad the content, not the screen, so it scrolls under the bars. On Android the keyboard pushes the page up, and the bottom inset is 0 while it's open.
- **An `<overlay>` covers the whole screen too**, under the bars, so a bottom sheet or a dialog reaches the screen's edges on iOS and Android. Pad what sits at its edges with `env()`, as dolan's bottom sheet does with `pb-safe`.
- **`"edgeToEdge": false`** in the build target's options keeps the page inside the safe area instead; `env()` is then 0.
- **Lynx Explorer** gives the window's insets, though its page sits below its own nav bar unless the URL has `?fullscreen=true`. The **web preview** gives 0, and so does your own Android host app unless it sends the insets as the generated apps do (`edgeToEdge: true` with `safeAreaTop`, `safeAreaRight`, `safeAreaBottom` and `safeAreaLeft` global props).
- **Don't define a CSS variable from an inset in a stylesheet.** In `--gap: calc(env(safe-area-inset-top) + 8px)` the build leaves `env()` to Lynx, which is 0 in the generated apps. Write `env()` where the value is used, or set the variable inline (`[style.--gap]`).
- `LynxSafeArea.isNotchScreen()` tells TypeScript whether the screen has a notch or cutout, and `SAFE_AREA_INSET_TOP` (and the other three) are the `env()` strings for bindings.
- With the `@blotch/ui` theme, `pt-safe`, `pb-safe-4` and the other `*-safe` utilities pad by an inset, or a spacing value plus one.

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

## Colors

- **`hsl()` only with commas.** `hsl(240, 5.9%, 10%)` works; space-separated `hsl(240 5.9% 10%)` is dropped silently (the element draws transparent). `rgb()`/`rgba()` take both forms, and hex and named colors work.
- **`var()` inside a color function works.** Lynx substitutes the variable's text before it parses the color, so channels kept comma-separated in one variable fill three arguments:

```css
page {
  --primary: rgba(24, 24, 27, 1);
  --primary-rgb: 24, 24, 27;
}
.scrim {
  background-color: rgba(var(--primary-rgb), 0.5);
}
```

- **`[style.--x]` bindings set CSS variables.** `<view [style.--accent]="accent()">` gives the element `--accent`, which its descendants read with `var(--accent)`: CSS variables inherit, unlike other properties. A binding wins over the same variable in `style="..."`, as on the web. **Not in the web preview:** Lynx for Web's inline-style parser drops the `--`, so there the binding changes nothing a `var()` reads. Where the preview must follow a runtime color, bind it where it's used (`[style.background-color]="accent()"`, a chart's `[color]`, glass's `[tint]`); a class that switches (`[class.dark]`) re-resolves everywhere, since its variables live in a stylesheet rule.
- **Don't wrap raw HSL channels** (`--x: 240 5.9% 10%` in `hsl(var(--x))`, the shadcn/ui pattern): that expands to the space-separated form Lynx drops.
- **The dolan UI theme** stores each color whole (`--primary`) and as channels (`--primary-rgb`). Its Tailwind plugin maps `bg-primary` to `var(--primary)` and `bg-primary/50` to `rgba(var(--primary-rgb), 0.5)`, so opacity modifiers work on every theme color. Keep each pair the same color when editing a theme; `npx @blotch/dolan doctor` reports a mismatch or a missing `-rgb` variable.

## Dark Mode and Wallpaper Colors

There's no `@media (prefers-color-scheme)`. `LynxTheme` follows the phone's appearance instead, from the host's `theme` global prop:

```typescript
import { LynxTheme } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS],
  template: `<view class="app-shell" [class.dark]="theme.isDarkMode()"
    >…</view
  >`,
})
export class App {
  readonly theme = inject(LynxTheme);
}
```

- **Define the colors as variables twice:** light values on `page`, dark ones under `.dark`. Because variables inherit, everything inside the root view switches with the class.
- **Put the class on one element near the root.** Lynx matches descendant selectors such as `.dark .card` only when classes are first assigned, so a class that changes later doesn't restyle them. A rule on the element itself, such as `.dark`, does update.
- **`theme.dynamicColors()`** gives the colors Android 12 and later take from the user's wallpaper (Material You), as Material 3's color roles (`primary`, `onPrimary`, `surface` and the rest, listed in `DYNAMIC_COLOR_ROLES`) for both `light` and `dark`. Each is a hex color, such as `#6750a4`. It's `null` where the host sends none: iOS, the web preview and Lynx Explorer. The Android app `ng build --platform android` makes sends them, and new ones when the wallpaper changes. Apply them with `[style.--x]` bindings on the root view. `npx @blotch/dolan add dynamic-color` does this for the dolan theme.

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
