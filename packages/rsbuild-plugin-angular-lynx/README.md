# @blotch/rsbuild-plugin-angular-lynx

Rsbuild plugin that compiles Angular apps for the [Lynx](https://lynxjs.org/) native runtime. Produces dual-thread bundles (main + background) for iOS, Android, and Web.

## Installation

```bash
npm install @blotch/rsbuild-plugin-angular-lynx
```

> Starting a new project? `ng add @blotch/angular-lynx` sets this up automatically.

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
- Registers `CUSTOM_ELEMENTS_SCHEMA` so Angular accepts Lynx elements (`<view>`, `<text>`, etc.)

## Documentation

Full docs at [angularlynx.dev](https://angularlynx.dev).
