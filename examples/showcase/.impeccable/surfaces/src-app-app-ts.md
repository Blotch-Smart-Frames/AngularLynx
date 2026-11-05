---
version: 1
slug: "src-app-app-ts"
primary_target: "src/app/app.ts"
related_targets: []
---

# Facet: the showcase app (examples/showcase)

## Scope and mode

Experience. A phone-sized (402×778) Lynx app shown live on the landing page beside its source, and run on iOS. The visitor is a web developer judging whether AngularLynx can make a native app that looks and moves like one.

## Audience, job, proof, constraints

- Job: play for a minute, be impressed, open the source, see plain Angular.
- Proof: the 3D stone on the GPU (WebGL2 on ANGLE/Metal), glass, charts, a virtualized list, gestures, a main-thread script, routes, transitions, storage, dark mode.
- Constraints: bundled data only (prices and lots are illustrative and say so); no `Intl` on the main thread; Explorer has no canvas (the SVG facet map is the fallback); no `:hover`, `@media` or pseudo-elements; semantic Tailwind colors only.

## Direction contract

THESIS: Facet is the stone's own cut diagram come alive. The facet geometry that builds the 3D stone also rules every screen, and the chosen stone drenches the whole app in its color. It refuses both the dark velvet showroom and the white product page.

OWN-WORLD: Three values: ink (#16181d), drawing paper (#f6f3ec) and the stone (one variable, Paraíba #16b3c6 first); ink and paper swap in dark mode. Every rule, tick and detent is a 1px hairline. Routed Gothic in three widths: Wide for names and figures, regular for body, Narrow for tracked-caps labels. The sheet is set in fixed tier bands (28/40/56/88px: star, break, main, bezel). Pressed inverts ink and paper, never tints. The facet map, an SVG derived from the cut geometry, is the ground's seamless pattern; its only idle motion is a slow breath. Glass carries only what floats: dock, chips, sheets.

STORY: The visitor sees a gemstone throwing real fire inside a faceting dial, drags it and it spins with momentum, taps another stone and the whole app recolors, scrolls into charts, a lot list and a glass sheet, then opens the source and finds ordinary Angular.

FIRST VIEWPORT: 56px wordmark row (FACET left, renderer chip right: METAL / WEBGL2 / NO CANVAS). Plate, 402×430, flooded with the stone's color: the crown facet map ruled in paper hairlines at 40%, the 96-index dial ring with figures every 8, the 3D stone 300px wide at center, the name in 44px Wide at the plate's bottom-left with species and cut beneath. Sheet: a 72px strip of ten stone discs, then bands: HARDNESS with a Mohs tick scale, REFRACTIVE INDEX, DISPERSION with a fire bar, ORIGIN. Glass dock: Atlas, Market, Collection, and a search action. Primary action: drag the dial.

FORM: The lapidary's cut sheet (GemCad facet diagram and the 96-index faceting gear), #6 of my ordered list of seven. seed:9e51107a43d005de

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Signature interaction and motion grammar

- Signature: dragging anywhere on the plate spins the stone and the dial together, with fling momentum (PanGesture + FlingGesture); the dial's figures turn with the stone.
- Cut-in: panels enter with scaleY from the top edge plus a fade, 320ms, ease-out; leave in 200ms.
- Recolor: the plate's background and every stone-colored rule crossfade over 600ms when the stone changes; the 3D material lerps over the same time.
- Breath: the stone's key light orbits slowly (6s) so the fire moves at rest; off under Reduce Motion.
- Scroll: a main-thread scroll script parallaxes the plate and shrinks the dial as the sheet scrolls up.

## Unresolved

- Whether to add a `.test.ts` (ng test) for the facet generator and data helpers.
- Alexandrite's color change tied to dark mode (green by day, red by night) is planned; drop if it reads as a gimmick.
