# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The app is a Lynx app: it renders natively on iOS and Android and, in the docs' live preview, through Lynx for Web. Its design language is its own (CSS, Tailwind), not UIKit's or Material's, which is why the platform is recorded as web, as for its siblings Facet (`examples/showcase`), Darkroom (`examples/darkroom`) and Par Avion (`examples/chat`).

## Users

Web developers who know TypeScript, CSS and some Angular, but not Lynx or native mobile development. They land on angularlynx.js.org deciding whether AngularLynx is real: whether Angular can produce a native app that looks, moves and performs like one. They meet this app on the landing page, in a phone-sized preview next to its source, and may open it on their phone through Lynx Explorer's QR code or build it as an iOS/Android app.

## Product Purpose

The solar system app is a showcase for AngularLynx: the Sun and its eight planets, drawn on the phone's GPU with three.js and custom GLSL shaders in a `<canvas>`, at their real positions for today's date. It exists to prove that Angular on Lynx can carry a real-time 3D scene with hand-written shaders (atmospheres, a day/night line with city lights, ring shadows, a boiling Sun, swirling gas giants) at frame rate, driven by gestures, alongside native UI. Success: a visitor scrubs time and watches the planets orbit, taps one and flies in to it, spins it with a finger, reads its facts, then opens the source and sees ordinary Angular.

## Positioning

The only Angular renderer for Lynx. Facet proves a 3D object, Darkroom proves 2D image processing, Par Avion proves the everyday native feel; this proves a whole live 3D world with custom shaders, the kind of app people assume needs Unity, Swift and Metal.

## Operating Context

- Lives at `examples/solar-system/`, built like every example (`ng build` with `@blotch/angular-lynx-build`), copied by `packages/website/scripts/prepare-examples.mjs` into the docs site and shown with `<Go example="solar-system">`.
- Second tab of the landing page's "Try it right here" (after Facet, before Darkroom) (confirmed), and listed in the docs' Showcase section.
- The landing page lays it out in an iPhone-framed preview (402 wide, real safe-area insets); in the docs it's a fitted `<Go>` preview.
- Also runs on a phone through Lynx Explorer (no `<canvas>` there: the app must still show something intended and say why) and as iOS/Android apps built with `ng build --platform`.

## Capabilities and Constraints

- Two views (confirmed): the whole system, every planet at its real heliocentric position for the current date (computed from JPL's published Keplerian orbital elements), with time scrubbing to watch them orbit; and a close-up of one planet, reached by tapping it (a camera flight), that a finger spins, with its facts.
- Surfaces (confirmed, "mix"): real public-domain NASA/USGS maps for the rocky worlds (Earth with its night lights, the Moon, Mars, Mercury), and the gas giants, Venus's clouds and the Sun generated live in GLSL so they move. Shader lighting everywhere: atmosphere scattering, terminator, city lights, ring shadows. Every image's source and license recorded in `src/assets/planets/CREDITS.md` and on the docs page.
- Planet facts come from NASA's planetary fact sheets: real figures only.
- The `<canvas>` has WebGL2 only (no 2D context). Lynx CSS: no `@media`, no `:hover`, no pseudo-elements, no inheritance except `<text>` nesting; `scroll-view` needs an explicit height; never raw HSL.
- Must build with `ng build`, lint and format with the repo's oxlint/oxfmt.

## Brand Commitments

- Product name "AngularLynx".
- No AI attribution anywhere in code, comments or commits (repo rule).

## Evidence on Hand

- Real: AngularLynx's feature set (`skills/angular-lynx/`, `packages/website/docs/`); `examples/showcase` (three.js on the canvas, pan and fling gestures, main-thread scripts), `examples/darkroom` (raw WebGL2 shaders), `examples/gestures`, `examples/main-thread`.
- Data: JPL's "Approximate Positions of the Planets" Keplerian elements; NASA planetary fact sheets.
- Absent, must not be fabricated: user counts, ratings, benchmarks, frame-rate claims not measured.

## Product Principles

1. Prove by doing: every AngularLynx feature appears because the app needs it, not as a demo tile.
2. The sky is the interface: controls stay small and out of the way of the planets.
3. True to the sky: positions, sizes' order, colors and facts are real; where scale is cheated for legibility, the app says so.
4. The source is part of the product: readable, idiomatic Angular, commented for why; the shaders are short and explained.
5. Degrade, never break: Lynx Explorer without a canvas, reduced motion and narrow panes all look intended.

## Accessibility & Inclusion

- Honor `LynxAccessibilitySettings.reduceMotion()`.
- Every control gets an `accessibility-label`; planets are reachable without the 3D view (a list or row of names).
