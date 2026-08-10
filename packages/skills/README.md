# AngularLynx Skills

[skills.sh](https://skills.sh) skill pack for building Angular applications on the [Lynx](https://lynxjs.org/) native runtime.

## Install

```bash
npx skills add blotch/angular-lynx-skills
```

## What's included

The `angular-lynx` skill teaches AI agents how to:

- **Bootstrap** a AngularLynx app (`bootstrapApplication`, `provideRenderer`, `provideRouter`)
- **Use Lynx elements** (`view`, `text`, `image`, `scroll-view`, `list`, `input`, `overlay`, etc.)
- **Handle events** with `bind`/`catch` prefixes (`bindtap`, `bindinput`, `catchtap`)
- **Style components** with Lynx CSS (linear layout, `rpx` units, no CSS inheritance)
- **Route** with in-memory navigation and element-pool-aware route reuse
- **Animate** with CSS transitions, `@keyframes`, and `element.animate()`
- **Debug** on-device with `LynxLogger` and on-screen error rendering
- **Avoid gotchas** — curated list of 50+ Lynx-vs-web platform differences

## About AngularLynx

AngularLynx is an Angular renderer for [Lynx](https://lynxjs.org/), a cross-platform native UI framework by ByteDance. Write Angular components using Lynx elements (`<view>`, `<text>`, `<image>`) instead of HTML, and render natively on mobile devices.

- Repository: https://github.com/nicobuzeta/lynx-angular
- Lynx documentation: https://lynxjs.org/
