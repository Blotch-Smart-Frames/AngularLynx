---
name: create-example
description: Create a new interactive example in examples/ with a <Go> preview in the website docs. Use when adding a new example, demo, or showcase for an AngularLynx feature or component.
---

# Create an AngularLynx Example

Creates a runnable example in `examples/<name>/` that appears as an interactive `<Go>` preview in the docs website.

## Pipeline Overview

1. Source code lives in `examples/<name>/`
2. `rspeedy build` produces `dist/main.lynx.bundle` and `dist/main.web.bundle`
3. `packages/website/scripts/prepare-examples.mjs` copies source + bundles to `docs/public/examples/<name>/` and generates `example-metadata.json`
4. Docs reference it via `<Go example="<name>" defaultFile="src/app/app.ts" />`

## Steps

### 1. Create the example directory

Create `examples/<name>/` with this file structure:

#### `package.json`

```json
{
  "name": "@angular-lynx-example/<name>",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "rspeedy dev",
    "build": "rspeedy build --environment lynx && rspeedy build --environment web"
  },
  "dependencies": {
    "@angular/common": "^21.0.0",
    "@angular/compiler": "^21.0.0",
    "@angular/core": "^21.0.0",
    "@angular/platform-browser": "^21.0.0",
    "@blotch/angular-lynx": "*"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^21.0.0",
    "@angular/cli": "^21.0.0",
    "@angular/compiler-cli": "^21.0.0",
    "@blotch/rsbuild-plugin-angular-lynx": "*",
    "@lynx-js/rspeedy": "^0.14.3",
    "@lynx-js/types": "^3.8.0",
    "typescript": "~5.9.0"
  }
}
```

If using Tailwind (for UI component examples), also add:

```json
"devDependencies": {
  "@lynx-js/tailwind-preset": "^0.4.0",
  "tailwindcss": "^3.4.19"
}
```

#### `lynx.config.ts`

```typescript
import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {
      output: { cleanDistPath: false },
    },
    lynx: {},
  },
  source: {
    entry: './src/main.ts',
  },
  plugins: [pluginAngularLynx()],
});
```

For multi-page examples, use an entry object:

```typescript
source: {
  entry: {
    main: './src/main.ts',
    settings: './src/pages/settings/main.ts',
  },
},
```

#### `angular.json`

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "projects": {
    "<name>": {
      "projectType": "application",
      "root": ".",
      "sourceRoot": "src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "polyfills": [],
            "tsConfig": "tsconfig.app.json",
            "styles": [],
            "scripts": []
          }
        }
      }
    }
  }
}
```

If using Tailwind, add `"styles": ["src/styles.css"]` instead of `"styles": []`.

#### `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist/out-tsc",
    "paths": {
      "@blotch/angular-lynx": ["../../packages/runtime/dist"]
    }
  }
}
```

#### `tsconfig.app.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.d.ts"]
}
```

#### `src/main.ts`

```typescript
import { bootstrapApplication } from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig);
```

#### `src/app/app.config.ts`

```typescript
import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRenderer()],
};
```

#### `src/app/app.ts`

The main component demonstrating the feature. Must use:
- Lynx elements (`<view>`, `<text>`, `<scroll-view>`, etc.) — NOT HTML
- `LYNX_ELEMENTS` import
- Signal-based state
- `(bindtap)` for tap events (not `(click)`)

#### If using Tailwind: `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
};

export default config;
```

If also using `@blotch/ui` components, add the plugin:

```typescript
import { blotchPlugin } from '@blotch/ui/theme/tailwind-plugin';
// ...
plugins: [blotchPlugin],
```

#### If using Tailwind: `src/styles.css`

```css
@import '@blotch/ui/theme/default.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 2. Add the example docs page

Create `packages/website/docs/examples/<name>.mdx`:

```mdx
# <Title>

One-line description of what this example demonstrates.

\`\`\`typescript
// Paste the key component code (app.ts) here as a static snippet
\`\`\`

## Key concepts

- **`concept1`** — brief explanation
- **`concept2`** — brief explanation
```

### 3. Add a `<Go>` embed in the relevant guide/component page

In the documentation page for the feature this example demonstrates, add:

```mdx
<Go example="<name>" defaultFile="src/app/app.ts" />
```

This renders the interactive preview with source browser, web preview, and QR code tabs.

### 4. Register in the sidebar

Add an entry in `packages/website/rspress.config.ts` in the `/examples/` sidebar section, under the appropriate category:

- **Basics** — foundational patterns (hello-world, counter, forms)
- **Elements** — element-specific demos (`element-*`)
- **Components** — UI component demos (`ui-*`)
- **Patterns** — interaction patterns (scroll, gestures, modals)
- **Animations** — animation/transition demos
- **Styling** — CSS modules, custom fonts
- **Features** — feature-specific (data flow, SSR, i18n, etc.)

### 5. Build and verify

```bash
# From repo root — install deps for the new example
npm install

# Build the example
cd examples/<name> && npm run build && cd ../..

# Run prepare-examples to generate metadata
cd packages/website && node scripts/prepare-examples.mjs

# Start the docs dev server and verify the <Go> preview works
cd packages/website && npm run dev
```

## Checklist

- [ ] `examples/<name>/` directory with all required files
- [ ] Package name follows `@angular-lynx-example/<name>` convention
- [ ] `lynx.config.ts` has both `web` and `lynx` environments
- [ ] Component uses Lynx elements, not HTML
- [ ] `packages/website/docs/examples/<name>.mdx` created
- [ ] `<Go>` component added to relevant guide/component page
- [ ] Sidebar entry added to `rspress.config.ts`
- [ ] Example builds successfully (`npm run build` in example dir)

## Notes

- The `prepare-examples.mjs` script parses `lynx.config.ts` to extract entry names — each entry produces a `dist/<name>.lynx.bundle` and `dist/<name>.web.bundle`
- Preview images: place a `preview-image.png` at the example root for a static preview fallback
- The `<Go>` component props: `example` (folder name), `defaultFile` (initial file to show), `defaultTab` (`'web'`/`'preview'`/`'qrcode'`), `img` (static preview path)
