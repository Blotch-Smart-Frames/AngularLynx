---
version: 1
slug: "src-app-app-ts"
primary_target: "src/app/app.ts"
related_targets: []
---

# Orrery: the solar system showcase app (examples/solar-system)

## Scope and mode

Experience. A phone-sized Lynx app shown live on the landing page (second tab, after Facet, before Darkroom) beside its source, in the docs' Showcase section, and run on iOS and Android. The visitor is a web developer judging whether Angular on Lynx can carry a whole live 3D world with hand-written shaders.

## Audience, job, proof, constraints

- Job: watch the planets sit where they really are today, turn the date dial and watch them orbit, tap one and fly in, spin it with a finger, read its figures, open the source and see plain Angular.
- Proof: three.js + custom GLSL in a `<canvas>` (the Sun's boiling surface and corona, Jupiter's and Saturn's moving bands, Saturn's ring shadows, Earth's day/night line with city lights, clouds and atmosphere, Venus's clouds, brass with real reflections), pan and fling gestures, a main-thread script for the dial, signals driving the scene, routes or view state, reduced motion.
- Constraints: positions from JPL Keplerian elements; facts from NASA fact sheets; distances and sizes are not to scale and the app says so; Lynx Explorer has no canvas (show the engraved plan of the orrery in SVG instead and say why); no `:hover`, `@media`, pseudo-elements; explicit rgba colors.

## Direction contract

THESIS: The app is the machine itself: an 18th-century brass orrery, its arms carrying each planet to where it really is today, its date turned on an engraved silvered dial. Flying in, the brass falls away and the model becomes the real world. It refuses the dark space explorer with glowing cyan HUD and frosted glass cards.

OWN-WORLD: Mahogany (#2a120c to #3d1c12) holds; turned brass (#c49a4a, lit #e8c77a, shade #7a5a22) is everything that moves or can be touched; silvered dial (#d6d4cc) carries every figure, engraved in black wax (#141210). Verdigris (#4f8a7b) appears only on today's index. Engraved lettering in Bodoni Moda (caps widely tracked, lining figures); the maker's cartouche alone in Pinyon Script. Brass edges are 1px lit-over-shade bevels, never shadows on flat color.

STORY: The visitor sees the Sun boiling atop the brass column and eight planets on their arms at today's places; drags the dial and the arms sweep round; taps Saturn, the camera flies in, the brass dissolves and the ringed world turns under their finger, its figures engraved on silver beneath; returns; opens the source.

FIRST VIEWPORT: Full-bleed canvas over the top 60%: night-dark room, faint stars, the orrery seen from 30 degrees above, Sun at center on its column, brass arms, engraved orbit hairlines, each planet labelled in small engraved caps beside it. Below, the mahogany case: a silvered arc dial with day ticks and the date engraved at its center under a fixed brass index, TODAY at its right; two whole rows of brass name plates (Sun to Neptune, 5 and 4 wide); the cartouche "The Orrery" in script with "distances and sizes not to scale". Primary action: drag the dial or tap a planet.

FORM: The brass orrery (18th-century clockwork orreries and their engraved dials), #2 of my ordered list after striking #1 on truth grounds, chosen by the user as the pick card over the assigned Plate Stacks. seed:ddb477fffaf95afd

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Raised lines (from the declined challengers)

- From the CRT arcade's palette law: metals by law. Brass moves (anything you drag or tap), silver tells (every figure), mahogany holds; no metal does another's job.
- From Riley's line-count emphasis: orbits are single engraved hairlines; the chosen orbit becomes a double rule, never a brighter gray.
- From the curved crease's one arc: time is scrubbed along an arc dial, not a straight slider.
- From the cloud edge's confinement: color lives in the planets; the case stays in its three metals and wood.
- From the pastel sheet's whole units: name plates sit in whole rows, never a clipped scroller.

## Signature interaction and motion grammar

- Signature: dragging the arc dial turns time; the arms sweep around the Sun at the dial's speed and coast to rest after a fling (a pan and a fling gesture).
- Fly-in: tapping a planet or its plate flies the camera in over 1.4s (ease in-out), the brass arms and orbits fade over the first half; the case slides its plates away and the silvered specification plate rises in their place (320ms, ease-out). Back reverses.
- Close-up: a pan spins the planet with fling momentum; at rest it turns at its true relative rate, scaled.
- Idle: the Sun's surface boils and the gas giants' bands drift; the planets advance in real time (imperceptibly) until the dial is touched.
- Reduced motion: the camera cuts instead of flying; no idle drift.

## Unresolved

- None at the start of the build.
