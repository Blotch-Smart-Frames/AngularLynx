---
name: Facet
description: A lapidary's cut sheet, ruled in hairlines on drawing paper, flooded with the chosen stone's color.
colors:
  ink: '#16181d'
  paper: '#f6f3ec'
  ink-night: '#111318'
  paper-night: '#f2efe6'
  paper-trace: '#e8e4da'
  paper-trace-night: '#24262e'
  graphite: '#5c5f66'
  graphite-night: '#a6a49c'
  stone: '#17b4c6'
  stone-padparadscha: '#ff8f72'
  stone-tanzanite: '#4b58d9'
  stone-mandarin: '#ff7a16'
  stone-muzo: '#1e9f66'
  stone-mogok: '#d9103f'
  stone-kunzite: '#e79bd9'
  stone-tsavorite: '#15a03c'
  stone-sphene: '#c8c122'
  stone-alexandrite: '#2f9d6b'
  stone-alexandrite-night: '#b4304d'
typography:
  display:
    fontFamily: 'RoutedGothicWide'
    fontSize: '36px'
    fontWeight: 400
    lineHeight: '40px'
    letterSpacing: '0px'
  headline:
    fontFamily: 'RoutedGothicWide'
    fontSize: '28px'
    fontWeight: 400
    lineHeight: '32px'
    letterSpacing: '0px'
  title:
    fontFamily: 'RoutedGothicWide'
    fontSize: '22px'
    fontWeight: 400
    lineHeight: '26px'
    letterSpacing: '0px'
  figure:
    fontFamily: 'RoutedGothicWide'
    fontSize: '18px'
    fontWeight: 400
    letterSpacing: '0px'
  body:
    fontFamily: 'RoutedGothic'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '19px'
    letterSpacing: '0px'
  caption:
    fontFamily: 'RoutedGothic'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: '18px'
    letterSpacing: '0px'
  label:
    fontFamily: 'RoutedGothicNarrow'
    fontSize: '11px'
    fontWeight: 400
    letterSpacing: '2px'
  wordmark:
    fontFamily: 'RoutedGothicWide'
    fontSize: '15px'
    fontWeight: 400
    letterSpacing: '5px'
rounded:
  none: '0px'
  disc: '9999px'
spacing:
  gutter: '20px'
  sheet-gap: '12px'
  band-main: '52px'
  note-row: '56px'
  parcel-strip: '64px'
  band-bezel: '88px'
  screen-header: '92px min'
  dock-clearance: '128px'
components:
  detent:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.none}'
    height: '40px'
  detent-on:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    typography: '{typography.label}'
    rounded: '{rounded.none}'
    height: '40px'
  chip-glass:
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.disc}'
    padding: '0 16px'
    height: '36px'
  band:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0 20px'
    height: '{spacing.band-main}'
  lot-tile:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '8px 12px 12px'
  lot-tile-plate:
    backgroundColor: '{colors.stone}'
    rounded: '{rounded.none}'
    height: '150px'
  swatch-disc:
    backgroundColor: '{colors.stone}'
    rounded: '{rounded.disc}'
    size: '30px'
  swatch-disc-selected:
    backgroundColor: '{colors.stone}'
    rounded: '{rounded.disc}'
    size: '36px'
  keep-mark:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    rounded: '{rounded.disc}'
    size: '24px'
---

<!-- cspell:words wordmark Wordmark tsavorite tanzanite Paraíba padparadscha muzo mogok -->

# Design System: Facet

## Overview

**Creative North Star: "The Lapidary's Cut Sheet"**

Facet is drawn the way a faceting diagram is drawn: one weight of line, one lettering, on drawing paper. The sheet has three values and no more. Ink rules every tick, border and detent at a single pixel; paper is the ground; the stone is one runtime variable that floods the plate, tints every chart and piece of glass, and changes the moment the visitor taps another stone. There is no gray tonal ladder to hide behind: what isn't ink or paper is the stone.

The facet geometry that builds the 3D stone is also the pattern system. The crown's plan edges, emitted as an SVG of 1px hairlines, draw the plate's diagram where there is no WebGL, each lot's tile in the collection, and, tiled at seven percent ink, the ground under every screen. Nothing is decorated with an unrelated texture; the ornament is the data.

Density is a bench sheet's: fixed tier bands with a label column, a rule and a figure, not cards. Only what floats is glass (the dock, the chips, the sheets) and only what floats is round. Night does not re-theme the app; it swaps the paper for ink and leaves the stone alone.

**Key Characteristics:**

- Three values: ink, paper and the stone; the stone is a variable, never a fixed accent.
- Every rule is a 1px hairline in the foreground color; no tints, no shadows on paper.
- Routed Gothic in three widths and one weight; emphasis is width, never boldness.
- Fixed tier bands (52 / 64 / 88px) with a 108px label column and a right-aligned 64px figure column.
- Square on paper, capsule in glass. Corners round only on things that float or on discs.
- Chosen means inverted: a detent fills with ink and its label turns to paper.
- Motion is a cut-in: scale from the top edge plus a fade, with the stone's color fading under it.

## Colors

Ink on paper, with one stone's color laid over the sheet; by night the paper goes dark and the stone keeps its color.

### Primary

- **The Stone** (`{colors.stone}`, Paraíba by default): a runtime variable, not a fixed brand color. The root view binds `--stone`, `--primary`, `--ring` and `--glass-tint` (with their `-rgb` twins) to the chosen gem's color, so the plate's background, the dock's active item, every chart series, the hardness and refraction markers, the price-change figure and "SHOW ON THE PLATE" all take it. Its ten values are the ten stones in the parcel (`stone-*`); Alexandrite alone swaps to `stone-alexandrite-night` under Night. Pure stone color is used as a flood (the plate, a lot tile's upper half) or as a point (a marker, a line); it is never used for text on paper except for one figure per screen.

### Neutral

- **Ink** (`{colors.ink}`): the day foreground, and every border, tick, hairline and chosen detent. The theme's `--foreground`, `--border`, `--input`, `--card-foreground` and `--glass-foreground` all resolve to it.
- **Paper** (`{colors.paper}`): the day ground (`--background`, `--card`, `--popover`) and the lettering on the plate. On the plate it is drawn as hairlines at 50% (`rgba(246, 243, 236, 0.5)`) and as the dial's figures at full strength; on a lot tile at 75%.
- **Paper Trace** (`{colors.paper-trace}`): the theme's `--secondary`, `--muted` and `--accent`, a slightly toned paper. Reserved for the ui components' own fills; the app's screens never lay it on the sheet.
- **Graphite** (`{colors.graphite}`): `--muted-foreground`, the lead the band labels, captions and notes are set in. The scatter chart's other-stone lots take it.
- **Night Ink** (`{colors.ink-night}`) and **Night Paper** (`{colors.paper-night}`): the `.dark` pair. Night is not a literal swap of the day values: the ground goes a step deeper than ink and the lettering a step dimmer than paper, so the stone's flood still reads as the brightest thing. Paper Trace and Graphite have night twins (`paper-trace-night`, `graphite-night`).

### Named Rules

**The Three Values Rule.** A screen is ink, paper and the stone. A fourth color appears only as data (the dispersion bar's spectrum, a stone disc in the parcel) and never as decoration.

**The Hairline Rule.** Every rule, tick, border and detent edge is a 1px line in `--foreground`. No 2px borders except the dispersion marker and the selected swatch's ring; no translucent rules on paper.

**The Stone Is A Variable Rule.** New surfaces read the stone through `--stone`, `--primary` or `atlas.color()`, never a literal hex. Where a `[style.--x]` binding can't reach a `var()` (the web preview), bind the color itself, as the plate does.

**The No Exponent Rule.** Token values are chosen so no hex compiles with a digit-e-digit run (`#5c5e66` would be mangled by the CSS pipeline). `graphite` is `#5c5f66` for that reason, and a new neutral must be checked the same way.

## Typography

**Display Font:** RoutedGothicWide (no fallback; Lynx text takes the face from the class)
**Body Font:** RoutedGothic
**Label Font:** RoutedGothicNarrow

**Character:** Routed Gothic is the lettering of engineering drawings, which a cut sheet is. One weight, three widths: wide for names and figures, regular for body, narrow for tracked caps. Names and screen titles are set in capitals; the lettering is the only thing on the sheet that is not a hairline, and it is still a single stroke.

### Hierarchy

- **Display** (Wide, 36px, line-height 40px): the stone's name on the plate, in paper on the stone's color. Long names step down to 26px (over 8 characters) and 22px (over 10), keeping one line beside the cut chip.
- **Headline** (Wide, 28px / 32px): screen titles (MARKET; COLLECTION at 26px / 30px).
- **Title** (Wide, 22px / 26px): sheet headers and the market's figures (price per carat, rough close).
- **Figure** (Wide, 18px): a band's value, right-aligned in its 64px column; a lot sheet's price. Lot tiles carry their carat at 20px / 24px.
- **Body** (Regular, 14px / 19px): sheet descriptions and lot facts; 13px / 18px for notes and captions in graphite; 12px / 17px for the light note and chart legends.
- **Label** (Narrow, 11px, 2px tracking, uppercase): band labels, chip text, detent text, species line, illustrative notices. Tiles track at 1px; sheet footers set it at 12px.
- **Wordmark** (Wide, 15px, 5px tracking): FACET, top-left of the plate. The dial's figures are Wide at 10px.

### Named Rules

**The Width Not Weight Rule.** Routed Gothic ships one weight. `font-medium`, `font-semibold` and `font-bold` resolve to the Wide cut at weight 400, so emphasis in any ui component (a toast's title, the dock's labels) comes from width, never a faked bold.

**The Set Face Rule.** Lynx text inherits no font. Every `<text>` is Routed Gothic by the global `text` rule; a different width is a class on that element (`font-wide`, `font-narrow`), never on a parent.

## Layout

Phone-first at 402 × 778 (the iPhone 17 Pro safe-area view) and full width on a phone; the web preview scales the same frame. One column, with a 20px gutter (`px-5`) on every screen and `pt-safe-3` under the status bar.

The atlas stacks the plate over the sheet in a single scroll-view. The plate is the stone's color edge to edge: a wordmark row (28px chip with safe-area padding), a 320px stage with the 308px dial centered, and a 56px name row with a 12px bottom margin. A main-thread scroll script moves the plate at half the scroll speed so the stone sits deeper than the paper. Below it, the sheet is a stack of tier bands separated by hairlines: the parcel strip (64px) of ten 30px discs in 36px cells, three main bands (52px) and the origin bezel (88px), then a 56px note row. Each band is a row: a 108px label column, a flexible rule or scale, and a 64px right-aligned figure column. A 128px spacer lets the last band scroll out from under the dock.

Market and Collection open with a header at least 92px tall (title bottom-left, labels or detents bottom-right) on a hairline; on a phone the safe-area inset adds to it, so it pads rather than fixes its height. Market's chart bands pad 16px top and bottom and share the hairline between them. Collection is a two-column flow list with 8px tile padding inside a 12px edge (`px-3`, `p-2`), padded 100px at the bottom for the dock.

The ground under every screen is a 3 × 9 tiling of 134px facet-map tiles (three across a phone so the repeat never shows), placed under the scroll container rather than inside it.

Sheets stack their rows with 12px gaps (`gap-3`); the cut sheet uses 20px between groups and 8px between a label and its detents.

## Elevation & Depth

The sheet is flat. Nothing on paper casts a shadow, and surfaces do not step in tone: depth on paper is drawn, as a hairline or as the ground's seven-percent facet map under the content. The parallax (the plate's stage at half scroll speed, clipped by the plate so nothing slides out over the sheet) is the only spatial cue on the atlas.

What floats is glass: the dock, the capsule chips on the plate, and the cut and lot sheets (`variant="glass"`). Glass carries the stone's tint through `--glass-tint`, so it reads as the stone's color seen through frosted paper. The glass primitive's solid fallback (Reduce Transparency, or a platform without blur) is the one shadow in the system: `0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px rgba(0, 0, 0, 0.15)`. No other element sets `box-shadow`.

### Named Rules

**The Glass Floats Rule.** Glass is for what floats over the sheet: dock, chips, sheets. A band, a tile, a detent or a header is never glass.

**The Flat Paper Rule.** No shadows, gradients or tonal steps on paper. If a surface needs separating, rule it.

## Shapes

Square on paper, round in glass. The theme's `--radius` is 0px, so every ui component on the sheet (toast, detent, tile, band, input) has square corners; `rounded-lg` and `rounded-md` resolve to 0. The only round shapes are discs and capsules: the parcel's stone discs (30px, 36px when chosen, with a 2px ink ring), the chart's 8px legend dots, the keep mark (24px disc of ink with a paper check), the dock (62px capsule bar and action, 48px accessory capsule), the plate's chips (28px and 36px capsules) and the glass sheets, whose corners are concentric with the display's.

Borders are 1px hairlines in `--foreground`, drawn as `border`, `border-b`, `border-l` on views; ticks are views with a left border and a height, never images. The index dial is a 1px circle with 96 ticks (4 / 7 / 12px, longer every fourth and eighth tooth) and figures every eighth, turned to read along the rim. The facet map is the crown's plan edges at a 1px stroke; it is scaled from a 2.4-girdle-unit plan to its box, so one geometry serves the 308px plate, the 134px tile and the 104px lot diagram.

## Components

### Detents

A pressed detent inverts; it never tints.

- **Shape:** square, 1px ink border (`{rounded.none}`), 40px tall in sheets, 36px in the market header, 48px in a sheet footer, flexing to equal widths with 8px (sheet) or 4px (header) gaps.
- **Rest:** transparent fill, label in `{colors.ink}` (Narrow 11px, 2px tracking, uppercase).
- **Chosen / Pressed:** fill `--foreground`, label `text-background`; the fill transitions over 120ms ease-out. The KEEP detent inverts while the finger is down, cut and light and range detents stay inverted while selected.
- **Ghost action:** a 48px row with no border, label in the stone's color (SHOW ON THE PLATE).

### Chips

Glass capsules on the plate.

- **Style:** `blur-view ui-glass shape="capsule"`, text `text-glass-foreground` in Narrow 11px with 2px tracking; 28px tall with 12px side padding (renderer chip) or 36px tall with 16px side padding and `interactive` (the cut chip, which the cut sheet grows out of through `uiSheetSource`).
- **State:** interactive chips carry `accessibility-traits="button"`; the glass takes the stone's tint.

### Bands

A cut sheet's row.

- **Corner Style:** none.
- **Background:** transparent over the ground.
- **Border:** `border-b` hairline.
- **Internal Padding:** 20px gutters; fixed heights 52px (main), 64px (parcel strip), 88px (bezel with origin, locality and formula stacked), 56px (note row).
- **Anatomy:** label (108px, Narrow, graphite) · scale (a 14px-tall strip with a hairline at 7px and 8px ticks; the stone's range as a rounded bar or 10px disc) · figure (64px, Wide 18px, right-aligned). The dispersion scale is the one gradient in the app (`#6a4cff → #2f8bff → #19c6a8 → #ffd23a → #ff7a16 → #ff2d55`, 4px tall) with a 2px ink marker.

### Lot Tiles

The collection's two-column list.

- **Corner Style:** none, 1px ink border.
- **Plate:** a 150px flood of the lot's stone color with the cut's 104px facet map at 75% paper.
- **Sheet:** `bg-background` under a hairline, padded 12px / 8px top / 12px bottom: carat (Wide 20px / 24px), stone and cut (Narrow 11px, 1px tracking, graphite), price (Regular 14px) with a 4px gap above.
- **Kept:** a 24px ink disc with a paper check at the top-right (8px in).
- **Gesture:** tap opens the lot sheet, hold keeps the lot and raises a toast.

### Parcel Discs

Ten 30px discs in the stone colors, in 36px cells across a 64px strip. The chosen disc scales to 1.2 and takes a 2px ink ring, both over 300ms ease-out. Alexandrite's disc shows its night color at night.

### Sheets

`ui-sheet variant="glass"`, growing from the chip or opening from the bottom. Header: title (Wide 22px / 26px, uppercase) over a description (Regular 14px / 19px, graphite). Body rows with 12px gaps. Footer: a full-width KEEP detent and a ghost action.

### Navigation

The iOS 26 dock design: a 62px glass capsule with Atlas, Market and Collection, a 62px circular search action beside it, and a 48px accessory capsule (the search field) above. The active item's icon takes the stone's color through `UI_THEME_COLORS` (a signal the app provides, read by the icon and chart token tables on every platform), and its label `--primary`, which is the stone on a phone and, in the web preview, where the binding does not reach `var()`, ink by day and paper under Night. Labels use the dock's own type, in the Wide cut by the width rule. Scroll-views and lists opt in with `ui-dock-scroll` so the dock minimizes as they scroll.

### The Plate (signature)

The stone's color edge to edge, with the FACET wordmark and the renderer chip (METAL / GL ES / WEBGL2 / NO CANVAS) in a row above, the 308px index dial around the 3D stone, and the name row below. The dial, its figures and the stone turn together under a sideways drag (420px per turn) with fling momentum; the dial's `transition` is `none` under the finger. The plate's background fades over 600ms ease-out when the stone changes, and the 3D material's color eases over the same time while its optics (ior, dispersion) switch at once. The name cuts in: `cut-enter` (opacity 0 → 1, `translateY(14px) scaleY(0.7)` → identity, 320ms ease-out) and `cut-leave` (the reverse upward, 200ms ease-in) through `lynx-transition-group`. Without WebGL the crown's facet map stands in for the stone at 50% paper.

### Market Bands (signature)

Each chart band waits at `opacity 0.02, translateY(18px) scaleY(0.8)` (not opacity 0: Lynx never reports a fully transparent element as exposed) and cuts in over 420ms ease-out when `lynxExposure` sees it; under Reduce Motion it is simply shown. Charts take the stone as their series color, the area at 22% fill, bars at radius 0, the candlesticks' down color in `--foreground`, the scatter's other-stone lots in graphite.

### The Ground (signature)

`view[appGround]`, an absolute layer under every screen's scroll container: 27 facet-map tiles of 134px, ruled at `rgba(22, 24, 29, 0.07)` by day and `rgba(242, 239, 230, 0.07)` by night, redrawn with the chosen cut. It is never placed inside a scroll-view or list (an absolute child would take the scroll gesture).

## Do's and Don'ts

### Do:

- **Do** read the stone through `--stone` / `--primary` / `atlas.color()`, and bind the color itself on an element whose `var()` must change in the web preview.
- **Do** rule with 1px hairlines in `--foreground` (`border-b`, `border-l` on views) for every separator, tick and scale.
- **Do** set emphasis with the Wide cut and labels with the Narrow cut at 11px / 2px tracking, uppercase.
- **Do** keep the tier heights (52 / 64 / 88 / 56 / 92px) and the 108px label and 64px figure columns when adding a band.
- **Do** invert ink and paper for a chosen or pressed state, transitioned over 120ms ease-out.
- **Do** enter new content with a cut-in (scaleY from the top plus a fade, 320ms ease-out in, 200ms ease-in out; 420ms for a band revealed on scroll) and fade a recolor over 600ms.
- **Do** write theme colors as complete `rgba()` with `-rgb` twins, and check a new hex for a digit-e-digit run before committing it.
- **Do** honor Reduce Motion (static bands, no lamp orbit) and give every control an `accessibility-label`, interactive glass `accessibility-traits="button"`.

### Don't:

- **Don't** add a fourth color, a gray scale or a tinted hover state; the only colors are ink, paper, the stone and data.
- **Don't** round a corner on paper. `--radius` is 0; rounding belongs to discs, capsules and glass sheets only.
- **Don't** cast a shadow or lay a gradient on the sheet; the dispersion bar's spectrum is data, not a precedent.
- **Don't** make a band, tile, detent or header glass; glass is for the dock, chips and sheets.
- **Don't** fake bold: Routed Gothic has one weight, and `font-bold` already resolves to Wide.
- **Don't** author HSL, set a font on a parent view, or hide a band at opacity 0 (it never becomes exposed).
- **Don't** tint a pressed detent with the stone or a translucent ink; chosen is a full inversion.
