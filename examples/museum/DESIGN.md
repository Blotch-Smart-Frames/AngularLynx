---
name: Vitrine
description: A museum collection hung as a steel-framed glass wall; every work and every fact a pane between matte black bars.
colors:
  bar: 'rgba(20, 20, 20, 1)'
  clear: 'rgba(236, 235, 230, 1)'
  clear-lit: 'rgba(252, 251, 248, 1)'
  seed: 'rgba(222, 220, 212, 1)'
  cobalt: 'rgba(29, 63, 166, 1)'
  amber: 'rgba(200, 138, 28, 1)'
  oxblood: 'rgba(94, 26, 34, 1)'
  ink: 'rgba(17, 17, 17, 1)'
  ink-soft: 'rgba(70, 68, 62, 1)'
  on-color: 'rgba(246, 244, 238, 1)'
  bar-night: 'rgba(6, 6, 6, 1)'
  clear-night: 'rgba(38, 38, 36, 1)'
  clear-lit-night: 'rgba(58, 58, 55, 1)'
  seed-night: 'rgba(48, 47, 44, 1)'
  cobalt-night: 'rgba(58, 98, 222, 1)'
  amber-night: 'rgba(224, 162, 48, 1)'
  oxblood-night: 'rgba(140, 42, 54, 1)'
  ink-night: 'rgba(236, 235, 230, 1)'
  ink-soft-night: 'rgba(184, 182, 174, 1)'
  on-color-night: 'rgba(250, 249, 245, 1)'
typography:
  display:
    fontFamily: 'SofiaSansDisplay (Sofia Sans Extra Condensed Bold)'
    fontSize: '68px'
    lineHeight: '60px'
    letterSpacing: '-0.2px'
  headline:
    fontFamily: 'SofiaSansDisplay (Sofia Sans Extra Condensed Bold)'
    fontSize: '34px'
    lineHeight: '34px'
    letterSpacing: '-0.2px'
  numeral:
    fontFamily: 'SofiaSansDisplay (Sofia Sans Extra Condensed Bold)'
    fontSize: '40px'
    lineHeight: '40px'
    letterSpacing: '-0.2px'
  title:
    fontFamily: 'SofiaSansSemibold (Sofia Sans SemiBold)'
    fontSize: '19px'
    lineHeight: '23px'
  body:
    fontFamily: 'SofiaSans (Sofia Sans Regular)'
    fontSize: '15px'
    lineHeight: '21px'
  body-long:
    fontFamily: 'SofiaSans (Sofia Sans Regular)'
    fontSize: '16px'
    lineHeight: '25px'
  label:
    fontFamily: 'SofiaSansLabel (Sofia Sans Semi Condensed SemiBold)'
    fontSize: '12px'
    letterSpacing: '1.4px'
  label-small:
    fontFamily: 'SofiaSansLabel (Sofia Sans Semi Condensed SemiBold)'
    fontSize: '11px'
    letterSpacing: '1.4px'
rounded:
  none: '0px'
spacing:
  bar: '6px'
  pane-inset: '16px'
  pane-inset-narrow: '12px'
components:
  pane:
    backgroundColor: '{colors.clear}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '12px 16px'
  pane-pressed:
    backgroundColor: '{colors.clear-lit}'
  pane-seed:
    backgroundColor: '{colors.seed}'
    textColor: '{colors.ink-soft}'
    rounded: '{rounded.none}'
    padding: '12px 16px'
  action-pane:
    backgroundColor: '{colors.clear}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.none}'
    padding: '0 12px'
    height: '56px'
  action-pane-saved:
    backgroundColor: '{colors.amber}'
    textColor: '{colors.ink}'
  rail-cobalt:
    backgroundColor: '{colors.cobalt}'
    textColor: '{colors.on-color}'
    typography: '{typography.numeral}'
    width: '92px'
  trouble-pane:
    backgroundColor: '{colors.oxblood}'
    textColor: '{colors.on-color}'
    typography: '{typography.title}'
    padding: '16px'
  tab-pane:
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    height: '52px'
  tab-pane-current:
    backgroundColor: '{colors.cobalt}'
    textColor: '{colors.on-color}'
  top-bar-pane:
    textColor: '{colors.ink}'
    height: '44px'
  search-field:
    backgroundColor: '{colors.clear}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    padding: '0 16px'
    height: '52px'
---

# Design System: Vitrine

## Overview

**Creative North Star: "The Glazed Partition"**

The collection is a steel-framed glass wall you walk along. Every work is a pane between matte black glazing bars, every fact a pane of its own, and saturated glass appears only where something matters now. The black of the bars is the screen's own background (`page` is painted `bar`); panes are laid on it with a 6px gap, so the gap is the line. There are no other lines, no rounded corners, no shadows and no cards.

Hierarchy comes from pane size and glass color first: the widest pane holds the lead work, a narrow rail pane carries a gallery number, a flooded pane says "here" or "saved". Type sits inside a pane, never across a bar: an extra condensed face, big and tight in caps, for titles and numbers; a quiet grotesque for reading; a semi condensed tracked caps label for controls and field names. A semibold weight names makers and state headings, the one place weight carries rank.

At night (the phone's dark appearance, `page.dark`) the wall is lit from behind: panes go smoked, the bars go deeper, and the three colors brighten into glow. Motion is light, not travel: glass brightens under a finger, floods with color when selected, pictures clear in from frosted glass, and loading is daylight crossing the panes. Nothing in the world slides; the stack's push and swipe-back are the platform's.

**Key Characteristics:**

- One line in the whole system: the 6px black bar between panes.
- Square glass everywhere (0px radius); depth is frosting and blur, never shadow.
- Three meaning colors, each with one job: cobalt for where you are and what's on view, amber for saved, oxblood for failure.
- Titles in extra condensed caps, set tight; labels in semi condensed tracked caps.
- Floating bars are real frosted glass over the scrolling wall.

## Colors

A neutral glass ground of warm off-whites and near-black bars, with three saturated glasses reserved for state.

### Primary

- **Gallery Cobalt** (cobalt; at night cobalt-night): where you are and what's on view. The current tab pane, the count pane beside a screen's title, the "On view" and gallery panes on a work's screen, the department filter, and the gallery number on a seeded rail. Text on it is on-color.

### Secondary

- **Saved Amber** (amber; at night amber-night): what you've saved, and only that. A work's Save pane once saved, the saved count in the tab bar, the Saved screen's count pane, and the rail of a saved work on On View and Search. Light enough to carry ink, not on-color.

### Tertiary

- **Oxblood** (oxblood; at night oxblood-night): what failed. The trouble pane that states an error or offline wall, with its way out in a clear pane beside it. Text on it is on-color.

### Neutral

- **Glazing Black** (bar; bar-night): the bars, the page background, the status-bar and home-indicator strips, and each floating pane's 3px border.
- **Clear Glass** (clear; clear-night): the default pane, for titles, facts, actions and fields.
- **Lit Glass** (clear-lit; clear-lit-night): a clear pane under a finger, and the light that crosses loading panes.
- **Seeded Glass** (seed; seed-night): the calmer pane for notes, credits, empty states, the pane behind a picture before it loads, and rails where color would mark nothing.
- **Ink** (ink; ink-night): text on clear and seeded glass and on amber; also the drawn chevron and plus/minus bars.
- **Soft Ink** (ink-soft; ink-soft-night): bylines, notes, credits and field labels.
- **On-Color** (on-color; on-color-night): text on cobalt and oxblood.
- **Frost** (clear's channels at 0.72 alpha, `--frost-rgb`): the tint over a `<blur-view>` in the floating bars, so the wall reads blurred through the glass.

### Named Rules

**The One Job Rule.** Each saturated glass means one thing: cobalt is place and on view, amber is saved, oxblood is failure. Never use one decoratively or for a second meaning.

**The Color That Marks Everything Marks Nothing Rule.** Where every work on a wall shares a state, that state's color drops out: On View's rails are seeded glass with the number in cobalt, and no rail on Saved turns amber.

**The rgba Rule.** Colors are authored as `rgba()` values in custom properties on `page`, with their night values under `page.dark`; translucency comes from a `-rgb` channel twin (`--frost-rgb`). Hex is not used in source.

## Typography

**Display Font:** Sofia Sans Extra Condensed Bold (family `SofiaSansDisplay`)
**Body Font:** Sofia Sans Regular (`SofiaSans`), with Sofia Sans SemiBold (`SofiaSansSemibold`) for names and state headings
**Label Font:** Sofia Sans Semi Condensed SemiBold (`SofiaSansLabel`)

**Character:** One quiet grotesque in three widths: the extra condensed cut stands tall and tight like stencilled gallery signage, the regular width reads easily at length, the semi condensed caps label things the way a wall label does. Lynx's `@font-face` takes no weight, so every weight is a family of its own.

### Hierarchy

- **Display** (68px, 60px line, -0.2px): a tab's title in its transom pane, one line per `<text>` (Lynx keeps no line breaks), in caps. Search's is 60px on 54px.
- **Headline** (34px, 34px line): a work's title on its screen. Wall titles step down with their pane: 28px on 30px in a lead bay, 24px on 26px in an offset bay, 21px in the top bar.
- **Numeral** (40px, 40px line): counts in a title's count pane; gallery numbers at 34px (work screen), 26px (lead rail) and 17px (pair rail).
- **Title** (SemiBold 19px, 23 to 24px line): the heading of an empty or trouble state; SemiBold 17px on 22px for a maker; 15px on 19px for a pair's title.
- **Body** (15px, 21px line): notes, summaries, bylines (often ink-soft). Long reading is 16px on 25px; a "did you know" fact is 21px on 28px; credits 14px on 20px.
- **Label** (12px, 1.4px tracking, caps): controls (Save, Zoom in, Share, Clear, tab names at 13px) and field names (Date, Medium, Gallery, Works at 11px).

### Named Rules

**The Caps Come From The Text Rule.** Lynx has no `text-transform`: display and label text is set in caps by Angular's `uppercase` pipe or written in caps, and accessibility labels keep sentence case.

**The Pane Holds The Type Rule.** Text sits inside a pane with its inset; it never crosses a bar or sits directly on the black.

## Layout

A single column of bays, inset 6px from the screen edge, with 6px between every pane and every row (`gap-1.5`, the list's `list-main-axis-gap: 6px`). A wall hangs its works in a repeating four-bay rhythm so it never reads as a feed: a **lead** bay (one work at its own proportions, clamped 0.78 to 1.6, beside a 56px rail), an **offset** bay (a 38% seeded naming pane beside a 230px-tall picture), then two **pair** bays (two works cropped to 196px, each over an 84px row of a title pane and a 40px rail; the second pair mirrored so the narrow panes don't stack).

A tab's first screen opens with a transom: the title pane filling the row beside a 92px colored count pane. Rows of facts are two equal panes. Panes inset text 16px on wide panes and 12px on narrow ones. Touch targets: action panes 56px tall, the search field 52px, a department filter 44px, tab panes 52px and top-bar panes 44px inside their bars.

The top bar and tab bar float over the wall; screens pad for them (`pt-top-bar` 62px plus the status bar, `pb-tab-bar` 70px plus the home indicator) and for the safe areas. A short wall ends in empty glass panes in the same rhythm rather than in black.

## Elevation & Depth

There are no shadows. Depth is material: the floating bars are frosted glass, a `<blur-view>` (light, 18px) under a frost tint of clear at 0.72, so the wall shows blurred through them as it scrolls. Pressing brightens glass rather than lifting it. At night the wall is lit from behind instead of lit from the front.

### Named Rules

**The Glass Not Paper Rule.** Nothing casts a shadow or floats on a card. A surface is either a pane in the wall or frosted glass over it.

**The Glazing Is A Border Rule.** A floating bar's black bars are each pane's own 3px black border (two panes meet at 6px), never a black backing, which the blur would turn gray.

## Shapes

Every pane is a square-cornered rectangle (0px radius). The only geometry beyond rectangles is drawn from borders and bars: Back's chevron is two 2px sides of a 9px square rotated 45°, and the zoom controls are an 18px by 2px bar and its crossed twin. Pictures are clipped to their pane, cropped (`aspectFill`) on the wall and whole (`aspectFit`) on their own screen.

## Components

### Buttons (action panes)

Tactile glass, labeled in caps.

- **Shape:** a full pane, square (0px), sharing its row with its siblings at equal width.
- **Default:** clear glass, ink label; 56px tall in a work's action row, 12px inset.
- **Pressed:** the `pressed` class from the Press directive (touch and mouse events, since Lynx applies no `:active`) brightens clear glass to lit glass; colored glass and pictures brighten through `filter: brightness(1.14)` instead.
- **Selected:** floods with its meaning color over 280ms (`cubic-bezier(0.22, 1, 0.36, 1)`); Save becomes amber and reads SAVED.

### Cards / Containers (panes)

- **Corner Style:** square (0px).
- **Background:** clear for content, seeded for notes, credits, empty states and loading.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** none in the wall; the 6px gap is the bar.
- **Internal Padding:** 16px (12px in narrow panes), 12 to 16px top, 16 to 20px bottom.

### Inputs / Fields

- **Style:** the search field is a clear pane 52px tall with 16px inset, body text at 17px, placeholder in ink-soft; a CLEAR pane joins it once there's a query.
- **Filter:** a chosen department is a cobalt pane under the field, its name and ALL DEPARTMENTS in on-color labels; tapping it clears the filter.

### Navigation

- **Tab bar:** three frosted panes in a row between black bars, labels in caps at 13px. The current tab floods cobalt (marked from the tap, before its tab builds). Saved carries an amber count chip, 20px square. A pushed work takes the bar away with the stack.
- **Top bar:** black strip under the status bar, then frosted panes 44px inside their bars: a 118px Back pane (chevron and the screen it returns to) and the title pane in display type. On a tab's first screen it fades in (280ms) once the transom title has scrolled under it.

### Rails

The narrow pane beside a work carrying its gallery number: seeded with a cobalt number on On View, cobalt with on-color where on-view works mix with stored ones, amber once saved. No rail for a stored, unsaved work.

### Trouble

An oxblood pane stating what went wrong (SemiBold title, body detail, both on-color) beside a 104px clear pane with the way out (TRY AGAIN).

### Daylight (loading)

Seeded panes in the wall's own pair layout, with lit glass crossing them (opacity 0 to 0.75 to 0, 1600ms, staggered 140ms per pane left to right, top to bottom). Never a spinner. Still under Reduce Motion.

### Picture

A seeded pane until its image loads, then the image fades in over 400ms. The viewer layers the print-resolution image over the web one and clears it in the same way.

## Do's and Don'ts

### Do:

- **Do** separate every pane with the 6px black bar, and inset the wall 6px from the screen edge.
- **Do** give each saturated glass its one job: cobalt for place and on view, amber for saved, oxblood for failure.
- **Do** set titles and numbers in Sofia Sans Extra Condensed Bold, in caps, tight (line height at or under the size), and labels in Sofia Sans Semi Condensed SemiBold caps at 12px with 1.4px tracking.
- **Do** show pressed state by brightening glass (lit glass, or `brightness(1.14)` on color and pictures), and selection by flooding over 280ms with `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Do** make floating bars from frosted `<blur-view>` panes with 3px black borders.
- **Do** author colors as `rgba()` custom properties with a night value under `page.dark`.
- **Do** show loading as daylight crossing seeded panes laid out like the content they stand in for.

### Don't:

- **Don't** round a corner, cast a shadow, or put content on a card.
- **Don't** draw lines other than the bars: no hairline dividers, no outlines on wall panes.
- **Don't** set text across a bar or directly on the black.
- **Don't** use a saturated glass where every item on the screen shares its meaning.
- **Don't** use a spinner, or slide anything in the world's own motion.
- **Don't** use icon glyphs or icon fonts; the chevron and the zoom marks are drawn from borders and bars.
- **Don't** author hex or space-separated color functions; Lynx's build and parser mangle or drop them.
