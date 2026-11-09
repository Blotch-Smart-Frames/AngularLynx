---
name: Darkroom
description: A film photo editor laid out as a proof sheet you mark up in red china marker.
colors:
  marker: 'rgba(216, 40, 47, 1)'
  paper: 'rgba(244, 243, 240, 1)'
  film: 'rgba(24, 24, 23, 1)'
  film-hole: 'rgba(0, 0, 0, 1)'
  edge: 'rgba(176, 173, 166, 1)'
  ink: 'rgba(20, 20, 20, 1)'
  ink-muted: 'rgba(104, 101, 96, 1)'
typography:
  app-name:
    fontFamily: 'EdgePrint (Share Tech Mono), monospace'
    fontSize: '17px'
    letterSpacing: '5px'
  readout:
    fontFamily: 'ChinaMarker (Permanent Marker), cursive'
    fontSize: '26px'
  mark:
    fontFamily: 'ChinaMarker (Permanent Marker), cursive'
    fontSize: '17px'
  note:
    fontFamily: 'ChinaMarker (Permanent Marker), cursive'
    fontSize: '14px'
  label:
    fontFamily: 'EdgePrint (Share Tech Mono), monospace'
    fontSize: '12px'
    letterSpacing: '2px'
  control-name:
    fontFamily: 'EdgePrint (Share Tech Mono), monospace'
    fontSize: '12px'
    letterSpacing: '1.5px'
  edge-print:
    fontFamily: 'EdgePrint (Share Tech Mono), monospace'
    fontSize: '10px'
    letterSpacing: '2px'
  edge-print-small:
    fontFamily: 'EdgePrint (Share Tech Mono), monospace'
    fontSize: '9px'
    letterSpacing: '1.5px'
  body:
    fontFamily: 'system sans-serif'
    fontSize: '12px'
    lineHeight: '17px'
  caption:
    fontFamily: 'system sans-serif'
    fontSize: '11px'
    lineHeight: '16px'
rounded:
  none: '0px'
  sprocket: '1.5px'
spacing:
  sprocket-inset: '6px'
  edge-row: '8px'
  gutter: '12px'
  frame-gap-roll: '8px'
  frame-gap-test: '10px'
components:
  film-strip:
    backgroundColor: '{colors.film}'
    textColor: '{colors.edge}'
    rounded: '{rounded.none}'
    padding: '8px 12px'
  sprocket-hole:
    backgroundColor: '{colors.film-hole}'
    rounded: '{rounded.sprocket}'
    width: '7px'
    height: '5px'
  roll-frame:
    rounded: '{rounded.none}'
    width: '84px'
    height: '56px'
  test-frame:
    rounded: '{rounded.none}'
    width: '96px'
    height: '64px'
  header-action:
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    padding: '12px 10px'
  print-action:
    textColor: '{colors.marker}'
    typography: '{typography.mark}'
    width: '66px'
    height: '40px'
  control-name:
    textColor: '{colors.ink-muted}'
    typography: '{typography.control-name}'
    height: '34px'
  control-name-set:
    textColor: '{colors.ink}'
    typography: '{typography.control-name}'
    height: '34px'
  readout:
    textColor: '{colors.marker}'
    typography: '{typography.readout}'
  ruler:
    backgroundColor: '{colors.film}'
    textColor: '{colors.edge}'
    height: '58px'
---

# Design System: Darkroom

## Overview

**Creative North Star: "The Contact Sheet"**

Darkroom is a proof sheet marked up by hand. The ground is white proof paper; every photo sits on a strip of black film, numbered and coded in the pale monospace a film carries along its edge; and every decision the person makes is a red china-marker mark on the sheet: a hand-drawn ring round the chosen frame, stock and control, the before/after line through the enlargement, the value read out large. The sheet reads top to bottom as one continuous print: header on paper, the enlargement on its film, the roll, the test strip, then the printer's controls and a ruler cut from the film's edge.

The sheet stays light whatever the phone's setting, as a print does: judging color needs the same surround every time. Density is a working sheet's, not a gallery's: strips run edge to edge and scroll sideways, the paper between them carries only a title, a note and a credit. The photo is never covered while it is judged; labels about the photo live in the film's edge print beside it.

It rejects the category's near-black editor with thin white sliders and a tray of filter thumbnails.

**Key Characteristics:**

- Paper ground, film-black strips, one red.
- Two drawn voices: monospace edge print on the film, china marker for marks.
- Hard-edged rectangles; the only curves are the sprocket holes and the hand-drawn marks.
- Flat: depth is paper versus film, never shadow.
- Selection is a drawn ring, not a fill, tint or underline.

## Colors

A proof sheet's palette: warm white paper, near-black film with deeper sprocket holes, a pale edge-print gray, ink, and one marker red. Tokens are written as `rgba()` on `page` (Lynx has no `:root`) and exposed to Tailwind as `bg-paper`, `bg-film`, `text-edge`, `text-marker` and so on; `rgba()` is the canonical form here because a hex with a digit-e-digit run is mangled by the CSS pipeline.

### Primary

- **China Marker Red** (marker): every mark the person makes: the rings round the chosen frame, stock and control; the before/after line and its grab ring; the ruler's fixed index; the readout; the PRINT action; notes in the margin; the names of kept recipes on the test strip; the tick beside a worked frame.

### Neutral

- **Proof Paper** (paper): the sheet's ground behind everything that isn't film.
- **Film Base** (film): every strip, the enlargement's rebate and the ruler.
- **Sprocket Black** (film-hole): the sprocket holes, and the backing behind a roll frame while its photo loads. Deepest black, because on a contact print the holes are where nothing held back the light.
- **Edge Print Gray** (edge): all text, ticks and arrows printed on the film.
- **Ink** (ink): the app's name, header actions and controls that have been set, on paper.
- **Faded Ink** (ink-muted): body notes, credits, the roll's code, untouched control names, START OVER.

### Named Rules

**The One Red Rule.** Marker red means "the person marked this". It never decorates, never fills a surface, and never appears as a second accent's companion; there is no second accent.

**The Ink Belongs On Paper Rule.** Ink and Faded Ink are only on paper; Edge Print Gray is only on film. Text never crosses from one surface's color to the other's.

**The Print Is Light Rule.** The sheet does not follow dark mode. Paper stays paper.

## Typography

**Display Font:** Permanent Marker, loaded as `ChinaMarker` (Apache 2.0), for marks.
**Label/Mono Font:** Share Tech Mono, loaded as `EdgePrint` (SIL OFL 1.1), for edge print.
**Body Font:** the platform's system sans, for sentences only.

**Character:** a printed code and a hand: the monospace is what the film and the machine say, the marker is what the person says. The system sans carries only prose (a stock's description, the photo's title, its credit).

### Hierarchy

- **Readout** (26px marker): the chosen control's value, one at a time, tap to reset.
- **Mark** (17px marker): the PRINT action inside its ring.
- **Name** (17px edge print, 5px tracking, caps): DARKROOM in the header.
- **Note** (14px marker): a transient note in the margin ("printed", "kept as ..."), fading after 2.6s.
- **Label** (12px edge print, 2px tracking, caps): header actions LOAD and KEEP.
- **Control name** (12px edge print, 1.5px tracking, caps): the controls along the sheet, each in a fixed-width cell (7.5px per glyph plus 20px) so ringing one never moves the others.
- **Edge print** (10px, 2px tracking, caps): strip titles with their counts, the stock and ISO above the enlargement, frame numbers and BEFORE/AFTER below it, the roll's code (11px START OVER is a variant).
- **Edge print small** (9px, 1-1.5px tracking, caps): frame numbers under roll frames, stock names under test frames, ruler figures. 9px is the floor, and only on film.
- **Body** (12px/17px system sans): the stock's note and the photo's title on paper.
- **Caption** (11px/16px system sans): the photo credit at the foot of the sheet.

### Named Rules

**The Two Hands Rule.** Monospace is the film's voice, marker is the person's. Never set a mark in monospace or edge print in marker.

**The Name Every Text Rule.** Lynx text doesn't inherit fonts: every `<text>` names its family (`font-edge`, `font-marker`) or is deliberately system sans.

## Layout

A single vertical sheet in a scroll view, full-bleed. Paper content sits on a 12px gutter (`gutter`); film strips run edge to edge, their sprocket rows inset 6px and their edge-print rows 8px from the strip's top. Strips that hold more than the width (the roll, the test strip, the control names) scroll sideways in an explicit-height `scroll-view` (Lynx requires the height), and the chosen item is scrolled to center with the element's `scrollIntoView` UI method, instantly on first open and smoothly after.

Frames are 3:2 like the film: 84x56 on the roll with 8px gaps, 96x64 on the test strip with 10px gaps. The enlargement's photo band follows the photo's aspect at full width, clamped between 200 and 330px tall, with the photo fitted inside it on film. Header and footer padding add the safe-area insets (`pt-safe-*`, `pb-safe-*`).

Platform constraints, not omissions: Lynx has no `@media`, so the sheet is one fluid column measured from layout events (`bindlayoutchange`) rather than breakpoints; there is no `:hover`, so every state is a tap state.

## Elevation & Depth

Flat. Depth is the difference between paper and film: the film strips are the dark layer, the paper is the light one, and nothing casts a shadow. Marks sit on top of what they mark (absolutely positioned SVG over the frame) the way grease pencil sits on a print.

### Named Rules

**The Paper And Film Rule.** Two surfaces only, paper and film. No cards, no shadows, no third tone between them.

## Shapes

Hard-edged rectangles: frames, strips, the ruler, the photo band all have square corners. Two curves are native to the world and belong to it: the sprocket holes (7x5px, 1.5px corners, 7px pitch), and the hand-drawn marker ring, an ellipse that wobbles and overshoots where it started, seeded so no two rings match. Arrows in the edge print are authored SVG triangles (6x7px, filled with edge gray), drawn so they're identical on every platform.

### Named Rules

**The Square Frame Rule.** A photo or a strip never has rounded corners. Round only what film rounds (sprocket holes) or what a hand draws (the ring).

## Components

### Film Strip

The sheet's signature container: a band of film with sprocket rows above and below, an edge-print row carrying its title on the left (with an edge arrow) and its count on the right ("THE ROLL / 7 FRAMES", "TEST STRIP / 9 PRINTS"). Background film, text edge gray, square corners, no border.

### Enlargement

The chosen frame on its film: edge print above (DARKROOM and the stock's ISO, the stock code and frame number), sprockets, the developing canvas, sprockets, and edge print below (frame number with arrows at both ends, BEFORE/AFTER either side of the split line, hidden when within 110px of an end). The split line is a 2px marker-red rule the height of the fitted photo, with a 38px marker ring (3px stroke) at its middle as the grab handle. Without a canvas (Lynx Explorer), the photo shows plain and the line is not drawn.

### Marker Ring (selection)

- **Shape:** a hand-drawn SVG ellipse, 2.5px stroke by default (2px on control names, 3px on the split handle), round caps.
- **Placement:** round the frame and its number together (frame plus 14px wide, plus 32px tall, offset -7/-8px), round the control name's fixed cell, round PRINT.
- **Motion:** draws in over 240ms, `cubic-bezier(0.16, 1, 0.3, 1)`, scaling from 1.15 with a -6deg turn and fading up. With reduced motion it simply appears.

### Header Actions

LOAD and KEEP are ink edge-print labels with 12px x 10px touch padding; PRINT is the one marked action, marker type inside a permanent marker ring, faded to 35% while the print is made.

### Control Names and Readout

Control names run along the paper in a horizontal scroll, ink once set or chosen, faded ink while untouched; the chosen one is ringed. Below, the value reads out in marker at 26px; tapping it resets that control. START OVER appears in faded edge print only once the photo is edited.

### Ruler

A 58px film strip of ticks (1px edge gray; 18px at every tenth step with its figure, 12px at fifths, 7px otherwise; 12px apart) that slides under a fixed 2px x 22px marker index at its center. Dragging sideways scrubs; on release it settles on the nearest step with a 160ms ease-out (snaps with reduced motion).

### Marker Tick

An 11x9px marker check beside a roll frame's number once that photo has been worked on.

## Do's and Don'ts

### Do:

- **Do** put every photo on film, with sprocket rows and an edge-print row naming it.
- **Do** mark a selection by drawing a marker ring round the item and its label, and scroll the chosen item into view.
- **Do** write anything the film or the machine says (numbers, codes, stock names, control names) in edge print caps, and anything the person did in marker.
- **Do** keep labels about the photo in the edge print beside it, never over it.
- **Do** give every SVG mark and arrow its color from the marker and edge tokens' values, and respect reduced motion in every animation.

### Don't:

- **Don't** use marker red for anything the person didn't mark.
- **Don't** round a frame, strip or band, or give anything a shadow.
- **Don't** add a dark theme; the sheet stays light.
- **Don't** set a heading or label above a strip on the paper; the strip names itself in its own edge print.
- **Don't** use thin white sliders or a filter-thumbnail tray; controls are names on the sheet and a ruler cut from the film.
