---
name: The Orrery
description: The solar system as an 18th-century brass orrery in a mahogany case, every planet on its arm where it really is on the date its dial shows.
colors:
  brass: 'rgba(196, 154, 74, 1)'
  brass-lit: 'rgba(236, 204, 132, 1)'
  brass-shade: 'rgba(122, 90, 34, 1)'
  verdigris: 'rgba(90, 160, 141, 1)'
  silver: 'rgba(214, 212, 204, 1)'
  silver-shade: 'rgba(160, 157, 148, 1)'
  wax: 'rgba(20, 18, 16, 1)'
  wax-soft: 'rgba(72, 66, 58, 1)'
  mahogany: 'rgba(52, 22, 14, 1)'
  night: 'rgba(4, 4, 7, 1)'
  orbit-hairline: 'rgba(217, 179, 106, 1)'
typography:
  cartouche:
    fontFamily: 'Copperplate (Pinyon Script), cursive'
    fontSize: '30px'
    lineHeight: '38px'
  plate-title:
    fontFamily: 'EngravedDisplay (Bodoni Moda Display), serif'
    fontSize: '26px'
    lineHeight: '30px'
    letterSpacing: '3px'
  date:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '12px'
    letterSpacing: '1px'
  figure:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '12px'
    lineHeight: '16px'
  key-label:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '10px'
    letterSpacing: '1.5px'
  plate-name:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '10px'
    letterSpacing: '1.2px'
  sky-label:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '10px'
    letterSpacing: '1.6px'
  numeral:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '8px'
    letterSpacing: '1px'
  figure-label:
    fontFamily: 'Engraved (Bodoni Moda), serif'
    fontSize: '8px'
    letterSpacing: '1.2px'
  note:
    fontFamily: 'EngravedItalic (Bodoni Moda Italic), serif'
    fontSize: '11px'
    lineHeight: '15px'
  aside:
    fontFamily: 'EngravedItalic (Bodoni Moda Italic), serif'
    fontSize: '10px'
    lineHeight: '14px'
rounded:
  silver: '2px'
  brass: '3px'
spacing:
  plate-gap: '6px'
  key-gap: '8px'
  gutter: '12px'
  cartouche-inset: '16px'
components:
  brass-key:
    backgroundColor: '{colors.brass}'
    textColor: '{colors.wax}'
    typography: '{typography.key-label}'
    rounded: '{rounded.brass}'
    width: '64px'
    height: '44px'
  brass-key-pressed:
    backgroundColor: '{colors.brass-shade}'
    textColor: '{colors.wax}'
    rounded: '{rounded.brass}'
  name-plate:
    backgroundColor: '{colors.brass}'
    textColor: '{colors.wax}'
    typography: '{typography.plate-name}'
    rounded: '{rounded.brass}'
    height: '42px'
  name-plate-pressed:
    backgroundColor: '{colors.brass-shade}'
    textColor: '{colors.wax}'
    typography: '{typography.plate-name}'
    rounded: '{rounded.brass}'
    height: '42px'
  back-key:
    backgroundColor: '{colors.brass}'
    textColor: '{colors.wax}'
    typography: '{typography.key-label}'
    rounded: '{rounded.brass}'
    padding: '0 12px'
    height: '34px'
  step-key:
    backgroundColor: '{colors.brass}'
    rounded: '{rounded.brass}'
    width: '40px'
    height: '30px'
  date-window:
    backgroundColor: '{colors.silver}'
    textColor: '{colors.wax}'
    typography: '{typography.date}'
    rounded: '{rounded.silver}'
    height: '44px'
  spec-plate:
    backgroundColor: '{colors.silver}'
    textColor: '{colors.wax}'
    typography: '{typography.figure}'
    rounded: '{rounded.silver}'
    padding: '8px 12px 10px'
  case:
    backgroundColor: '{colors.mahogany}'
    textColor: '{colors.brass}'
    padding: '0 12px'
  sky-label:
    textColor: '{colors.brass-lit}'
    typography: '{typography.sky-label}'
---

# Design System: The Orrery

## Overview

**Creative North Star: "The Instrument Maker's Bench"**

The app is the machine itself: an 18th-century brass orrery standing in a dark room, its arms carrying each planet to where it really is on the date shown, and below it the mahogany case that holds its controls. The top of the screen is the machine in 3D, full bleed over a night sky; the bottom is the case, separated from it by a brass edge, holding a brass date dial seen through a slot, a silvered window engraved with the date, and either two whole rows of brass name plates with the maker's cartouche, or, flown in to a body, a silvered specification plate. Flying in, the brass and the orbits fall away and the model becomes the real world.

The world is a material law before it is a palette: brass is what moves or can be touched, silver carries every figure, black wax fills every engraving, mahogany holds it all. Color lives in the planets (real NASA/USGS maps and live GLSL); the case stays in its metals and wood. It is dark whatever the phone's setting, because it's a machine in a room at night.

It refuses the dark space explorer with glowing cyan HUD and frosted glass cards.

**Key Characteristics:**

- Three metals and a wood, each with one job: brass moves, silver tells, wax engraves, mahogany holds.
- One engraved serif in three cuts, caps widely tracked for everything cut into metal; a copperplate script for the cartouche alone.
- Depth by bevels: 1px lit-over-shade rules on brass and silver, never drop shadows.
- Real materials: brushed brass and mahogany grain are procedural rasters bound inline; silvered plate is a smooth gradient.
- One green, verdigris, and only on the dial's index when it shows today.

## Colors

A cabinet of instrument materials: turned brass in three lights, silvered plate in two, black engraving wax in two, mahogany, and the night the machine stands in. Tokens are written as `rgba()` on `page` (Lynx has no `:root`) and exposed to Tailwind as `bg-brass`, `text-wax`, `text-brass-lit` and so on; `rgba()` is canonical because a hex with a digit-e-digit run is mangled by the CSS pipeline. SVG drawn as strings cannot read CSS variables, so the dial, the index, the plan and the chevrons carry literal hex copies of these values.

### Primary

- **Turned Brass** (brass): every key and plate that can be pressed (RUN, TODAY, the name plates, the back key, the step keys) under the brushed-brass raster; the 3D arms, column and calendar ring (fully metallic, roughness 0.34, reflecting a warm room); the dial's index at rest; the cartouche's notes and the loading line.
- **Lit Brass** (brass-lit): the top and left bevel of brass, the case's 1px top edge, the cartouche "The Orrery", the planets' names over the sky and their 1px leader hairlines (at 55% opacity).
- **Brass Shade** (brass-shade): the bottom and right bevel of brass, the 2px rule under the case's top edge, and the pressed plate's ground.

### Secondary

- **Verdigris** (verdigris): the dial's index fid, edged in a darker verdigris, while the dial shows today. Nowhere else.

### Neutral

- **Silvered Plate** (silver): the date window and the specification plate; every figure the app states sits on it.
- **Silver Shade** (silver-shade): silver's top and left bevel (silver is set into the case, so its lit edge is the bottom), the spec plate's hairline rule, and the no-canvas plan's note.
- **Black Wax** (wax): engraved text and strokes on brass and silver: key labels, plate names, the date, figure values, chevrons.
- **Soft Wax** (wax-soft): secondary engraving: the plate numerals, figure labels, the relative date, the spec plate's note.
- **Mahogany** (mahogany): the case, under the procedural mahogany-grain raster.
- **Night** (night): the app's ground behind the canvas. The 3D room itself is `#0b0806` and the sky shader a faint Milky Way over near-black.
- **Orbit Hairline** (orbit-hairline): the engraved orbit rings in 3D, at 34% opacity, fading to nothing as the camera flies in.

### Named Rules

**The Metals By Law Rule.** Brass moves (anything you drag or tap), silver tells (every figure), mahogany holds. No metal does another's job: a figure is never set on brass, a control is never silver.

**The Color Lives In The Planets Rule.** The case stays in its metals and wood. The only hue outside them is verdigris on today's index; planet colors appear only on the planets themselves (and the plan's discs).

**The Always Night Rule.** The app does not follow light mode.

## Typography

**Display Font:** Bodoni Moda Display, loaded as `EngravedDisplay` (SIL OFL 1.1).
**Body Font:** Bodoni Moda (text cut) as `Engraved`, and its italic as `EngravedItalic` (SIL OFL 1.1). Static instances of the variable font, since Lynx picks no axes.
**Script Font:** Pinyon Script, loaded as `Copperplate` (SIL OFL 1.1), for the cartouche alone.

**Character:** the high-contrast roman of the engraver's era, cut into metal: names and labels in widely tracked caps, figures in lining numerals, notes in italic. Every engraved label carries a 1px lit lip under it (`text-shadow: 0 1px 0 rgba(255, 238, 196, 0.75)`), the light catching the cut's lower edge.

### Hierarchy

- **Cartouche** (30px/38px script, lit brass): "The Orrery", the maker's name on the case.
- **Plate title** (26px/30px display, 3px tracking, caps, wax): the body's name on the specification plate.
- **Date** (12px, 1px tracking, wax): the long date in the date window, one line.
- **Figure** (12px/16px, wax): figure values on the specification plate, one line each.
- **Key label** (10px, 1.5px tracking, caps, wax): RUN, STOP, TODAY, ORRERY.
- **Plate name** (10px, 1.2px tracking, caps, wax): planet names on the name plates.
- **Sky label** (10px, 1.6px tracking, caps, lit brass): planet names placed beside them over the 3D view.
- **Numeral / Figure label** (8px, 1-1.2px tracking, caps, soft wax): the plate's number from the Sun in Roman numerals (STAR for the Sun), and the figure names (DIAMETER, GRAVITY...). 8px is the floor, and only engraved on metal.
- **Note** (11px/15px italic, soft wax): the body's kind and note on the specification plate, two lines at most.
- **Aside** (10px/14px italic): the relative date under the date (soft wax), and the cartouche's two lines in brass ("Distances and sizes not to scale.", "Positions true for the date · drawn with ...").

### Named Rules

**The One Hand Rule.** Copperplate script is the maker's signature and appears once, in the cartouche. Everything else is engraved Bodoni.

**The Name Every Text Rule.** Lynx text doesn't inherit fonts: every `<text>` names its family (`font-engraved`, `font-display`, `font-italic`, `font-script`).

## Layout

A fixed two-part column, full bleed. The top is the 3D view, `flex-1`, with the canvas filling it and planet labels positioned absolutely where the scene projects each planet, placed beside, above or a step out (with a 1px leader), never below (the arms are there), never over another name or planet. The bottom is the case: a 1px lit-brass edge over a 2px shade rule, the date dial's 58px window, a 44px row of RUN / date window / TODAY on a 12px gutter (64px keys, 8px gaps), then a fixed 194px well holding either the name plates (5 then 4 across, 42px tall, 6px gaps, whole rows, never scrolling) with the cartouche row inset 16px, or the specification plate. The well's fixed height means flying in never moves the dial. Safe-area insets are added to the case's bottom padding and the back key's top (`pb-safe-*`, `pt-safe-*`).

The 3D camera is a 46° perspective; the overview sees the orrery from above at an angle with the Sun on its column at center. Planets are drawn at 1.55x their model radius in the overview, easing to 1x in close.

Platform constraints, not omissions: Lynx has no `@media`, so the case is one fluid column at the phone's width; no `:hover`, so every state is a tap state.

## Elevation & Depth

Bevels, not shadows. Brass is raised: lit brass on its top and left 1px border, shade on its bottom and right. Silver is set in: shade on top and left, near-white `rgba(242, 241, 236, 1)` on bottom and right. Pressing brass inverts its bevel and sinks its ground to a shade gradient. The engraved lip is the only text effect. No `box-shadow` anywhere in the case.

In 3D, depth is real light: ACES filmic tone mapping (exposure 1.05), brass reflecting a generated room (a tall warm window, a dim lamp), per-planet atmosphere halos, Earth's ocean glint, the Sun's corona and glare.

### Named Rules

**The Bevel Not Shadow Rule.** Raised and sunk are 1px lit and shade borders on the metal's own color. Never a drop shadow on a flat fill.

## Shapes

Small, turned corners: brass plates and keys at 3px, silvered plate at 2px. The case itself is square-edged and full width. Curves belong to the machine: the dial is an arc of a 330px-radius brass ring seen through the slot; orbits are circles; the index is a small pointed fid (14px). Chevrons on the step and back keys are stroked SVG (1.6px wax, mitred), never font glyphs.

### Named Rules

**The Whole Units Rule.** Plates sit in whole rows; nothing in the case is clipped or scrolled.

**The Double Rule Rule.** Orbits are single engraved hairlines; the chosen planet's orbit becomes a double rule, never a brighter or thicker line.

## Components

### Brass Key

RUN/STOP and TODAY (64x44), the back key ORRERY (34px tall, 12px side padding, top-left under the notch), the spec plate's step keys (40x30, chevrons). Brushed-brass raster bound inline over the brass fill, 3px corners, raised bevel, wax engraved label. TODAY fades to 50% opacity while the dial already shows today.

### Name Plate

A brass plate per body in two whole rows (Sun and the rocky four, then the four giants), each engraved with its numeral over its name. Tapping flies to the body. The last one flown to shows pressed: shade gradient ground (`rgba(126, 92, 34, 1)` to `rgba(170, 128, 52, 1)`), inverted bevel, no brushed raster.

### Date Dial (signature)

A brass ring (band `#b68b3e`, lit rule `#ecd08a`, shade rule `#6e4f1c`, ticks `#2e2110`) of 330px radius seen through a 58px slot, a tick a day (2° each), a long tick every Monday. Dragging sideways turns time a day per pixel; a fling coasts. The ring turns by CSS rotation of one SVG, so a drag moves pixels, not SVG. A fixed brass index fid sits over its top, verdigris when the dial shows today. RUN turns time by itself at 45 days a second.

### Date Window

Silvered plate between RUN and TODAY: the long date engraved in wax, the relative date beneath in soft-wax italic.

### Specification Plate

Silvered plate replacing the name plates when flown in: the body's name in the display cut with two brass step keys at right, a two-line italic note, a 1px silver-shade rule, then three rows of three figures (8px label over 12px value).

### Sky Label

Planet names in lit-brass engraved caps beside each planet over the 3D view; placed a step out with a 1px lit-brass leader at 55% when crowded. The Sun is not labeled.

### Motion

- **Fly-in:** the camera flies over 1400ms with a symmetric ease-in-out; the brass and orbit hairlines fade out over the first 60% of the approach; the other planets hide past halfway. Back reverses. Under reduced motion the camera cuts.
- **Case swap:** the specification plate replaces the name plates in place, immediately, in the fixed 194px well.
- **Idle:** the Sun boils, the giants' bands drift, the stars twinkle; off under reduced motion. RUN still works under reduced motion, because it's asked for.

## Do's and Don'ts

### Do:

- **Do** make every touchable thing brass with the brushed raster bound inline from `case/materials.ts`, and every stated figure silver.
- **Do** bevel metal with 1px lit and shade borders; brass raised, silver set in, pressed brass inverted.
- **Do** engrave text in wax with the 1px lit lip, caps tracked 1-3px for names and labels.
- **Do** give literal SVG strokes and fills the hex of the matching token, since SVG can't read CSS variables.
- **Do** keep plates in whole rows and the case's well a fixed height.
- **Do** honor reduced motion: cut the flight, stop idle drift.

### Don't:

- **Don't** put a drop shadow on brass or silver, or any shadow on a flat fill.
- **Don't** use verdigris anywhere but today's index, or bring any other hue into the case.
- **Don't** use the copperplate script for anything but the cartouche.
- **Don't** brighten or thicken an orbit to select it; double it.
- **Don't** write a `url()` raster in styles.css; it doesn't draw on iOS.
- **Don't** add a light theme, glowing HUD lines or frosted glass cards.
