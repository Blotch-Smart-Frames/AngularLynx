# @blotch/rsbuild-plugin-angular-lynx

Rsbuild plugin that compiles Angular apps for the [Lynx](https://lynxjs.org/) native runtime. Produces dual-thread bundles (main + background) for iOS, Android, and Web.

## Installation

> **Using the Angular CLI?** You don't need this package directly. `ng add @blotch/angular-lynx` installs [`@blotch/angular-lynx-build`](../build), whose `ng build` and `ng serve` builders depend on this plugin and add it to rspeedy's config. To pass it options, import it from there: `import { pluginAngularLynx } from '@blotch/angular-lynx-build'`.

To run rspeedy directly:

```bash
npm install @blotch/rsbuild-plugin-angular-lynx
```

## Usage

Add the plugin to your `lynx.config.ts`:

```typescript
import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  source: {
    entry: './src/main.ts',
  },
  plugins: [pluginAngularLynx()],
});
```

## What It Does

- Runs Angular's AOT compiler within Rsbuild/webpack
- Splits each entry into **main-thread** and **background-thread** bundles for Lynx's dual-thread model
- Bundles component stylesheets and processes CSS
- Runs Tailwind CSS 3 from a `tailwind.config.*`, and rewrites the CSS Tailwind CSS 4 writes (layers, `@property`, nesting, `oklch()` and `color-mix()`, logical properties, `translate`/`rotate`/`scale`) into CSS Lynx reads, for the device and the web preview alike. See [Tailwind CSS](https://angularlynx.js.org/guide/tailwindcss)
- Registers `CUSTOM_ELEMENTS_SCHEMA` so Angular accepts Lynx elements (`<view>`, `<text>`, etc.)
- Enforces the build target's `budgets` with `ng build`'s units and messages: a warning is printed, an error fails the build

## Budgets

Budgets in angular.json are checked against the `lynx` environment, the bundles devices load. The `web` preview isn't checked. A Lynx app ships `.bundle` files rather than separate scripts and stylesheets, so each budget type measures:

| Type                | Measures                                                           |
| ------------------- | ------------------------------------------------------------------ |
| `initial`           | Each entry's bundle on its own, since a Lynx page loads one bundle |
| `bundle`            | The bundle of the entry named by `name`                            |
| `all` / `allScript` | All bundles and scripts together (scripts ship inside the bundles) |
| `any` / `anyScript` | Each bundle and script                                             |
| `anyComponentStyle` | Each component stylesheet, compiled                                |

Media and fonts aren't counted. Under plain `rspeedy dev` budgets are skipped: the plugin then reads angular.json's default configuration, usually production, whose budgets don't fit a development build. `ng serve` checks them when the configuration it serves has them, as Angular's dev server does.

## Documentation

Full docs at [angularlynx.js.org](https://angularlynx.js.org).
