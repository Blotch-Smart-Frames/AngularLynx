# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The app is a Lynx app: it renders natively on iOS and Android and, in the docs' live preview, through Lynx for Web. Its design language is its own (CSS, Tailwind, `@blotch/ui`), not UIKit's or Material's, which is why the platform is recorded as web. Verified in the docs' web preview and in the iOS app `ng build --platform ios` makes (confirmed by the user).

## Users

Web developers who know TypeScript, CSS and some Angular, but not Lynx or native mobile development. They land on angularlynx.js.org deciding whether AngularLynx is real: whether Angular can produce a native app that looks and moves like one. They meet this app embedded on the landing page, in a phone-sized preview next to its source, and may open it on their phone through Lynx Explorer's QR code.

## Product Purpose

Facet, a jeweler's gem atlas, is the showcase app for AngularLynx. It exists to prove, in one real app, the best AngularLynx can do: GPU 3D in a `<canvas>` (WebGL2 on ANGLE/Metal on iOS), Liquid Glass, charts, virtualized lists, gestures, main-thread scripts, routing, transitions, storage, dark mode and dynamic color, all written as a standard Angular app. Success: a visitor spends a minute playing with it, then opens the source and sees ordinary Angular.

The user's brief (confirmed): "very pretty, exaggerated, over the top", "go wild with the design", "using every feature AngularLynx offers, including Metal 3D capabilities", "showcase the best Angular Lynx can offer".

## Positioning

The only Angular renderer for Lynx: the same component, signals and templates a web Angular developer writes, drawn as native views. A competitor can show a demo; this one is a real Angular app whose source sits beside it, and the 3D runs on the phone's GPU.

## Operating Context

- Lives at `examples/showcase/`, built like every example (`ng build` with `@blotch/angular-lynx-build`), copied by `packages/website/scripts/prepare-examples.mjs` into the docs site and shown with `<Go example="showcase">`.
- Shown first in a tab menu on the landing page (`packages/website/src/components/home-comps/showcase/index.tsx`), before the todo list and the kitchen sink (confirmed).
- The preview lays the app out at 402×778 (iPhone 17 Pro's safe-area LynxView) and scales it to fit; on a phone it's full width.
- Also runs on a phone through Lynx Explorer (no canvas there: the 3D must degrade to something still beautiful) and as an iOS/Android app.

## Capabilities and Constraints

- Subject (confirmed): a jeweler's gem catalog. A refractive 3D gemstone with dispersion that the visitor spins and tilts, a market of cut, carat and price with charts, a collection list, and a UI that takes the chosen stone's color.
- Data (confirmed): bundled only. No HTTP, no API keys, nothing loads from the network. Gem facts (names, hardness, refractive index, dispersion, origins) are real mineralogy; prices, lots and any "market" series are illustrative and must be labelled as such in the app.
- The `<canvas>` has WebGL2 only: no 2D context, no DRACO/KTX2 loaders, no canvas-as-texture. Procedural geometry and materials only, unless an asset is bundled.
- Lynx CSS: no `@media`, no `:hover`, no pseudo-elements, no inheritance except `<text>` nesting; `display: linear` default; `scroll-view` needs an explicit height. Semantic Tailwind colors (`bg-background`, `text-primary`…) only; never raw HSL.
- Must build with `ng build`, lint and format with the repo's oxlint/oxfmt, and keep its `@blotch/ui` copies in sync through dolan (never hand-edit `src/components/ui`).
- Must stay runnable in the web preview with the browser's WebGL2 and degrade gracefully (no crash, no blank screen) in Lynx Explorer, where `getContext('webgl2')` is `null`.
- Undecided: whether to add a `.test.ts` with the testing library (nice to have, not required by the brief).

## Brand Commitments

- Product name "AngularLynx"; app name "Facet" (chosen here; the user may rename).
- No AI attribution anywhere in code, comments or commits (repo rule).

## Evidence on Hand

- Real: AngularLynx's feature set, documented in `skills/angular-lynx/` and `packages/website/docs/`; `examples/element-canvas` (three.js on the Lynx canvas), `examples/ui-glass` (Liquid Glass, morphing), `examples/ui-dynamic-color`, `examples/main-thread`, `examples/transitions`, `examples/persistent-storage`, `examples/custom-fonts`.
- Real gemology: hardness (Mohs), refractive index and dispersion values of common gems are public reference data.
- Absent, must not be fabricated as fact: real prices, real lots, real customers, real auction results. Author them as illustrative and label them.

## Product Principles

1. Prove by doing: every feature appears because the app needs it, not as a labelled demo tile.
2. The source is part of the product: readable, idiomatic Angular, commented for why.
3. Exuberance with craft: over the top in material and motion, exact in spacing, type and states.
4. Degrade, never break: Explorer without a canvas, reduced motion, dark mode and narrow panes all look intended.
5. Phone-first: 402×778 is the canvas; touch targets, safe areas and one-thumb reach are real constraints.

## Accessibility & Inclusion

- Honor `LynxAccessibilitySettings.reduceMotion()` and `reduceTransparency()`.
- Every control gets an `accessibility-label`; interactive glass gets `accessibility-traits="button"`.
