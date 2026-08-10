<p align="center">
  <img src="assets/logo.png" alt="AngularLynx" width="200" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@blotch/angular-lynx"><img src="https://img.shields.io/npm/v/@blotch/angular-lynx.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@blotch/angular-lynx"><img src="https://img.shields.io/npm/dm/@blotch/angular-lynx.svg" alt="npm downloads" /></a>
  <a href="https://github.com/Blotch-Smart-Frames/angular-lynx/blob/master/LICENSE"><img src="https://img.shields.io/github/license/Blotch-Smart-Frames/angular-lynx.svg" alt="license" /></a>
  <a href="https://github.com/Blotch-Smart-Frames/angular-lynx/actions"><img src="https://img.shields.io/github/actions/workflow/status/Blotch-Smart-Frames/angular-lynx/ci.yml?branch=master" alt="build status" /></a>
</p>

# AngularLynx

Build native mobile apps with Angular. AngularLynx renders Angular components to native iOS, Android, and Web UI via the [Lynx](https://lynxjs.org/) runtime by ByteDance.

## Quick Start

```bash
npm create angular-lynx my-app
```

Or add to an existing Angular project:

```bash
ng add @blotch/angular-lynx
```

Full documentation at [angularlynx.dev](https://angularlynx.dev).

## Packages

| Package | Description |
| --- | --- |
| [`@blotch/angular-lynx`](./packages/runtime) | Angular `Renderer2` bridging to Lynx's native element APIs |
| [`@blotch/rsbuild-plugin-angular-lynx`](./packages/rsbuild-plugin-angular-lynx) | Rsbuild plugin — Angular AOT compiler + Lynx dual-thread bundling |
| [`examples/kitchen-sink-app`](./examples/kitchen-sink-app) | Flagship demo app (`npm run demo`) — routing, signals, and `@blotch/dolan` UI components on Lynx |

## Architecture

Monorepo split into build-time and runtime stages:

```mermaid
graph TB
    subgraph build ["Build Time"]
        direction TB
        src["kitchen-sink-app<br/><i>Angular components using<br/>Lynx elements (x-view, x-text, ...)</i>"]
        plugin["@blotch/rsbuild-plugin-angular-lynx<br/><i>RSpeedy/Rsbuild plugin +<br/>Angular compiler (webpack)</i>"]
        bundle[".lynx.bundle<br/><i>main-thread JS + background-thread JS<br/>+ CSS + template</i>"]

        src --> plugin --> bundle
    end

    subgraph device ["Runtime (on device)"]
        direction TB
        engine["Lynx Engine<br/><i>C++ core + PrimJS</i>"]

        subgraph main ["Main Thread"]
            renderer["runtime<br/><i>LynxRenderer → Renderer2</i>"]
            globals["Global __* functions<br/><i>__CreateElement, __AppendElement,<br/>__SetAttribute, __AddEvent, ...</i>"]
            native["Native UI Elements"]

            renderer --> globals --> native
        end

        subgraph bg ["Background Thread"]
            bg_runtime["runtime<br/><i>LynxBackgroundDocument +<br/>LynxBackgroundElement</i>"]
            app_logic["App Logic<br/><i>change detection, signals,<br/>routing, event handling</i>"]

            app_logic --> bg_runtime
        end

        engine --> main
        engine --> bg
    end

    bundle --> engine

    subgraph dev ["Dev Flow"]
        direction LR
        dev_server["Dev Server<br/><i>rspeedy dev</i>"]
        explorer["Lynx Explorer App<br/><i>scan QR code</i>"]

        dev_server -- "serves bundle" --> explorer
    end

    explorer -- "embeds" --> engine
```

## Development

```bash
npm install && npm run build   # Build all packages
npm run demo                   # Start dev server (rspeedy)
```

Scan the QR code with [Lynx Explorer](https://lynxjs.org/guide/start/quick-start.html) to run on your phone.

## Credits

- [Angular](https://github.com/angular/angular)
- [Angular Rspack](https://github.com/nrwl/angular-rspack.git)
- [Lynx](https://github.com/lynx-family)
