# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The app is a Lynx app: it renders natively on iOS and Android and, in the docs' live preview, through Lynx for Web. Its design language is its own (CSS, Tailwind, `@blotch/ui`), not UIKit's or Material's, which is why the platform is recorded as web, as for its sibling, Facet (`examples/showcase`).

## Users

Web developers who know TypeScript, CSS and some Angular, but not Lynx or native mobile development. They land on angularlynx.js.org deciding whether AngularLynx is real: whether Angular can produce a native app that looks, moves and performs like one. They meet this app on the landing page, in a phone-sized preview next to its source, and may open it on their phone through Lynx Explorer's QR code or build it as an iOS/Android app.

## Product Purpose

Darkroom, a film photo editor, is the second showcase app for AngularLynx (after Facet). It exists to prove that Angular on Lynx can run real image processing on the phone's GPU: a photo developed live by WebGL2 fragment shaders in a `<canvas>` (ANGLE on Metal on iOS, GL ES on Android, WebGL2 in the preview), with gestures that never drop a frame, then exported as a full-resolution JPEG and handed to the system share sheet. Success: a visitor drags a slider, watches the photo change at 60 fps, compares before and after with their finger, and then opens the source and sees ordinary Angular.

## Positioning

The only Angular renderer for Lynx. Facet proves 3D; Darkroom proves 2D image processing with a real photo, the kind of app people assume needs Swift and Metal.

## Operating Context

- Lives at `examples/darkroom/`, built like every example (`ng build` with `@blotch/angular-lynx-build`), copied by `packages/website/scripts/prepare-examples.mjs` into the docs site and shown with `<Go example="darkroom">`.
- Second tab of the landing page's "Try it right here" (after Facet, before the furniture shop, todo list and kitchen sink) (confirmed), and listed in the docs' Showcase section (confirmed).
- The landing page lays it out in an iPhone-framed preview (402 wide, real safe-area insets); in the docs it's a fitted `<Go>` preview.
- Also runs on a phone through Lynx Explorer (no `<canvas>` there: the app must still show the photo and say why it can't develop it) and as iOS/Android apps built with `ng build --platform`.

## Capabilities and Constraints

- Develop a photo with GPU shaders: exposure, contrast, highlights/shadows, temperature/tint, saturation, film looks (stocks), grain, vignette, halation, fade.
- Compare before and after with a drag handle driven by a main-thread gesture.
- Photos: bundled samples under a free license (CC0, from Wikimedia Commons), credited in the app (confirmed); the visitor can pick their own with `LynxImagePicker`.
- Export (confirmed): a full-resolution JPEG from the canvas (`canvas.toBlob()`), passed to the system share sheet (`LynxShare`), from which the person can save it to Photos. Both APIs are being added to AngularLynx alongside this app (branch `feat/canvas-to-blob-share`).
- Saved looks and per-photo edits persist with `LynxLocalStorage`.
- Film stock names are the app's own inventions: no real film manufacturer's trademarks.
- The `<canvas>` has WebGL2 only (no 2D context). Lynx CSS: no `@media`, no `:hover`, no pseudo-elements, no inheritance except `<text>` nesting; `scroll-view` needs an explicit height; semantic Tailwind colors only; never raw HSL.
- Must build with `ng build`, lint and format with the repo's oxlint/oxfmt, and keep its `@blotch/ui` copies in sync through dolan (never hand-edit `src/components/ui`).

## Brand Commitments

- Product name "AngularLynx"; app name "Darkroom".
- No AI attribution anywhere in code, comments or commits (repo rule).

## Evidence on Hand

- Real: AngularLynx's feature set (`skills/angular-lynx/`, `packages/website/docs/`); `examples/element-canvas`, `examples/showcase` (three.js on the canvas, gestures, main-thread scripts, storage), `examples/gestures`, `examples/main-thread`, `examples/persistent-storage`.
- Photos: seven CC0 photos from Wikimedia Commons, with photographer and source recorded in `src/assets/photos/CREDITS.md` and `src/app/develop/photos.ts`. No photo without a recorded license.
- Absent, must not be fabricated: real film stocks' names or claims to match their response; user counts, ratings or reviews.

## Product Principles

1. Prove by doing: every AngularLynx feature appears because the editor needs it, not as a demo tile.
2. The photo is the interface: controls stay out of its way, and nothing covers it while it's being judged.
3. Instant, or it isn't real: every adjustment lands on the next frame; slow work (export) says what it's doing.
4. The source is part of the product: readable, idiomatic Angular, commented for why; the shaders are short and explained.
5. Degrade, never break: Lynx Explorer without a canvas, reduced motion and narrow panes all look intended.

## Accessibility & Inclusion

- Honor `LynxAccessibilitySettings.reduceMotion()`.
- Every control gets an `accessibility-label`; sliders announce their values.
