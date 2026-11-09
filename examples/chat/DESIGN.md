---
name: Par Avion
description: A chat app as airmail correspondence; envelopes, onion-skin letters, postage stamps and postmarks, drawn natively with AngularLynx.
colors:
  aerogramme-paper: 'rgba(222, 231, 242, 1)'
  envelope-white: 'rgba(252, 252, 250, 1)'
  onion-skin: 'rgba(250, 251, 252, 1)'
  aerogramme-deep: 'rgba(203, 218, 238, 1)'
  navy-ink: 'rgba(27, 39, 72, 1)'
  faded-ink: 'rgba(84, 96, 124, 1)'
  navy-hairline: 'rgba(27, 39, 72, 0.2)'
  airmail-red: 'rgba(200, 34, 48, 1)'
  airmail-blue: 'rgba(31, 61, 140, 1)'
  postmark-ink: 'rgba(58, 50, 82, 1)'
  stamp-ochre: 'rgba(196, 128, 22, 1)'
  stamp-green: 'rgba(34, 102, 72, 1)'
  stamp-slate: 'rgba(72, 92, 128, 1)'
  stamp-plum: 'rgba(122, 48, 92, 1)'
typography:
  display:
    fontFamily: 'League Gothic'
    fontSize: '34px'
    lineHeight: '38px'
    letterSpacing: '1px'
  title:
    fontFamily: 'League Gothic'
    fontSize: '22px'
    lineHeight: '24px'
    letterSpacing: '0.5px'
  label-action:
    fontFamily: 'League Gothic'
    fontSize: '15px'
    letterSpacing: '1px'
  label-heading:
    fontFamily: 'League Gothic'
    fontSize: '13px'
    letterSpacing: '2px'
  label:
    fontFamily: 'League Gothic'
    fontSize: '12px'
    letterSpacing: '2px'
  label-time:
    fontFamily: 'League Gothic'
    fontSize: '11px'
    letterSpacing: '1px'
  address-name:
    fontFamily: 'La Belle Aurore'
    fontSize: '23px'
    lineHeight: '30px'
  address-place:
    fontFamily: 'La Belle Aurore'
    fontSize: '16px'
    lineHeight: '24px'
  body:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '16px'
    lineHeight: '22px'
  body-preview:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '14px'
    lineHeight: '19px'
  body-quote:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '13px'
    lineHeight: '17px'
rounded:
  none: '0px'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  run: '14px'
  gutter: '16px'
  target: '44px'
components:
  envelope:
    backgroundColor: '{colors.envelope-white}'
    textColor: '{colors.navy-ink}'
    rounded: '{rounded.none}'
    padding: '12px 16px 16px'
  letter-received:
    backgroundColor: '{colors.onion-skin}'
    textColor: '{colors.navy-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.none}'
    padding: '10px 14px 0'
    width: '78%'
  letter-sent:
    backgroundColor: '{colors.aerogramme-deep}'
    textColor: '{colors.navy-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.none}'
    padding: '10px 14px 0'
    width: '78%'
  par-avion-label:
    backgroundColor: '{colors.envelope-white}'
    textColor: '{colors.airmail-blue}'
    typography: '{typography.label}'
    rounded: '{rounded.none}'
    padding: '3px 8px'
    width: '78px'
  unread-count:
    backgroundColor: '{colors.airmail-red}'
    textColor: '{colors.aerogramme-paper}'
    rounded: '{rounded.none}'
    padding: '0 6px'
    height: '18px'
  composer-field:
    backgroundColor: '{colors.onion-skin}'
    textColor: '{colors.navy-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.none}'
    padding: '0 12px'
    height: '44px'
  send-button:
    textColor: '{colors.faded-ink}'
    rounded: '{rounded.none}'
    size: '44px'
  send-button-armed:
    backgroundColor: '{colors.airmail-red}'
    textColor: '{colors.aerogramme-paper}'
    rounded: '{rounded.none}'
    size: '44px'
  sheet-action:
    backgroundColor: '{colors.onion-skin}'
    textColor: '{colors.navy-ink}'
    typography: '{typography.label-action}'
    rounded: '{rounded.none}'
    height: '44px'
  quote-slip:
    textColor: '{colors.faded-ink}'
    typography: '{typography.body-quote}'
    rounded: '{rounded.none}'
    padding: '6px 10px'
---

<!-- cspell:words Aurore Odette Rivka Tomás -->

# Design System: Par Avion

## Overview

**Creative North Star: "Correspondence by Airmail"**

Every conversation is a correspondence. The inbox is a stack of hand-addressed envelopes, each stamped with the contact's own postage stamp and struck by a postmark; a thread is the letters between two people, onion-skin from them and aerogramme blue from you, postmarked as they are sent and read. The world is built from the materials of the post office and nothing else: paper, ink, printed stamps, rubber-stamped postmarks, the red and blue airmail edge. It refuses the category's rounded blue and gray bubbles.

Density is a letter-writer's, not a messenger's: one envelope per correspondent, generous paper between letters, labels lettered in condensed postal caps and addresses in a pen hand. The paper stays light whatever the phone's setting, because paper is light. Motion is the motion of a hand at a counter: a postmark lands like a rubber stamp, a dragged letter settles back without a bounce, ink comes and goes while someone writes.

The app is a Lynx app (iOS, Android, Lynx for Web). Lynx CSS has no `:hover`, no `@media`, no pseudo-elements, and text doesn't inherit fonts from views, so every state is a bound class or style, every `<text>` names its own face, and the marks are SVG.

**Key Characteristics:**

- Aerogramme-blue paper ground; envelopes and letters are flat sheets on it, lifted by a single hairline shadow.
- Square paper corners everywhere; the only round shapes are ink marks (postmark rings, ink dots, the reply disc).
- Two lettering voices plus the system sans: League Gothic for every label, name and time; La Belle Aurore only for addresses; message text in the platform sans.
- The post's marks (Stamp, Postmark, AirmailEdge) are drawn SVG components and carry identity, time, receipt and reaction.
- Red is the airmail red: the unread count, the armed Send, the READ postmark, the writing status, a chosen stamp's label.

## Colors

A cool paper-and-ink palette: aerogramme blue and white paper, navy ink, and the airmail red and blue, with stamp inks as the only other hues.

### Primary

- **Airmail Red** (airmail-red): the red of the airmail chevrons, and the one call to attention: the unread count tab, Send once there is something to send, the READ postmark, "WRITING TO YOU…" under a contact's name, the reply disc once a drag passes the reply point, and a stuck stamp's label on the stamp sheet.

### Secondary

- **Airmail Blue** (airmail-blue): the blue chevrons of the airmail edge and the PAR AVION lettering. Not used for text or controls elsewhere.

### Tertiary

- **Postmark Ink** (postmark-ink): violet-black rubber-stamp ink for every postmark (day dividers, SENT and DELIVERED receipts, the inbox time on each stamp), the writing dots and "NAME IS WRITING", and the postal-caps headings of slips and sheets (RE:, REPLYING TO, STICK A STAMP ON IT).
- **Stamp inks** (stamp-ochre, stamp-green, stamp-slate, stamp-plum, with airmail-red and airmail-blue): the printing inks of the six reaction stamps (Love red, Ha ochre, Yes green, Wow blue, Sad slate, Thanks plum). Contact stamps are printed in the same family of deep, slightly dusty inks (Rivka vermilion, Odette plum, Tomás ochre, Mei green, Jonah ultramarine), each carried by the contact's data.

### Neutral

- **Aerogramme Paper** (aerogramme-paper): the ground of every screen, header and composer included; also the text color on red (unread count, armed Send icon) and of a stamp's denomination.
- **Envelope White** (envelope-white): the inbox envelopes and the PAR AVION label.
- **Onion Skin** (onion-skin): letters received, the composer field, the writing slip, the stamp sheet's action buttons. The stamps' paper margin is drawn in the same white.
- **Aerogramme Deep** (aerogramme-deep): letters the person sent, the aerogramme's own blue a shade deeper.
- **Navy Ink** (navy-ink): all body text, names, icons.
- **Faded Ink** (faded-ink): the place under an address, read previews, letter times, the quoted text, placeholders, the idle Send icon.
- **Navy Hairline** (navy-hairline): the 1px rule under the thread header and over the composer, and the full border of quote slips.

### Named Rules

**The Paper and Ink Rule.** Every surface is a paper the post uses (aerogramme, envelope, onion skin) and every mark is an ink (navy, postmark, airmail red, a stamp's ink). A color that is neither has no place.

**The Airmail Edge Rule.** The red and blue chevrons appear in exactly two places: across the top edge of an envelope with letters unread, and above and below the PAR AVION label. Elsewhere a division is the navy hairline.

**The Always Paper Rule.** The world is light whatever the phone's appearance setting; the palette is set on `page` and is not switched for dark mode.

## Typography

**Display / Label Font:** League Gothic (SIL OFL 1.1, bundled; registered as the font family `Postal`)
**Address Font:** La Belle Aurore (SIL OFL 1.1, bundled; registered as `Hand`)
**Body Font:** the platform's system sans (no family set)

**Character:** Condensed postal caps, as on labels, counters and postmarks, against a quick pen hand on the envelopes, with message text left in the phone's own sans so a letter reads as a message.

### Hierarchy

- **Display** (League Gothic, 34px/38px, 1px tracking): the inbox title, "Letters". One per screen.
- **Title** (League Gothic, 22px/24px, 0.5px tracking): the contact's name in the thread header.
- **Label, action** (League Gothic, 15px, 1px tracking, caps): REPLY and COPY on the stamp sheet.
- **Label, heading** (League Gothic, 13px, 2px tracking, caps): sheet and list headings (STICK A STAMP ON IT, THE FIRST LETTER BETWEEN YOU). The writing line runs a step larger (14px, 1.5px tracking).
- **Label** (League Gothic, 12px, 1–2px tracking, caps): PAR AVION, the city under a header name, RE: and REPLYING TO on slips, the unread count.
- **Label, time** (League Gothic, 11px, 1px tracking): the time in a letter's lower right corner and the stamp names on the sheet.
- **Address** (La Belle Aurore, name 23px/30px, place 16px/24px): the name, then "City, Country", on an inbox envelope.
- **Body** (system sans, 16px/22px): letter text and the composer and search fields. Previews 14px/19px (two lines), quotes 13px/17px, the held letter on the sheet 15px/20px (three lines).

Postmark lettering scales with the mark: the town at up to 0.17 of its diameter (smaller for long names, so it fits the ring), the time at 0.24, the year at 0.15.

### Named Rules

**The Two Voices Rule.** League Gothic speaks for the post (labels, names, times, marks); the pen hand only writes addresses on envelopes. The hand never labels a control or sets message text.

**The Every Text Names Its Face Rule.** Lynx text doesn't inherit a font from its view, so each `<text>` carries its own family class; a label without `font-postal` silently falls back to the system sans.

## Layout

A single phone-width column. Screens keep a 16px gutter (envelopes, writing slip, sheets); letters sit 12px from the edge, received to the left and sent to the right, at most 78% of the screen wide; a postcard photo is 60% wide. Envelopes stack with 12px of paper between them. In a thread, the first letter of a run from one side starts 14px below the last, and letters within a run 4px apart.

The thread's non-letter rows have fixed heights (day postmark 80px, the loading and first-letter rows 64px), so older letters loading above can put the visible ones back exactly where they were. Every control you tap is at least 44px square. The header sits on safe-area top padding and the stamp sheet on safe-area bottom padding; the composer rides above the keyboard.

A list item clips what overflows it, so anything that sits outside a letter (stamps stuck on its top corner) is given room inside the row (14px of top padding) rather than hanging out of it.

## Elevation & Depth

Paper on paper. Depth is one hairline shadow under every sheet (envelopes, letters, the PAR AVION label, the composer field, sheet actions, the writing slip, the postcard), enough to show a sheet's edge on the blue paper and no more. Overlays dim the screen with navy (the stamp sheet's scrim) or near-black (the postcard viewer) rather than lifting anything higher.

### Shadow Vocabulary

- **Letter hairline** (`box-shadow: 0 1px 2px rgba(27, 39, 72, 0.14)`): every paper sheet, always; it doesn't change with state.

### Named Rules

**The One Sheet Thick Rule.** There is a single elevation. A held letter is shown lifted by turning it a degree (-1deg) on the sheet, not by a larger shadow.

## Shapes

Square paper corners (0px) on every sheet, field, button, label and slip. Round shapes belong to ink: postmark rings, the writing dots (7px), the reply disc (36px). Marks are set never quite straight: postmarks turned (-8deg by default; on the inbox -10, -4 and 2deg in rotation; day postmarks -4deg), stuck stamps at -6 and 7deg alternately, the postcard at -1.5deg. Stamps have a drawn perforated edge (half-circle bites on a 10-unit step) and are 1.2 times as tall as wide.

## Components

### Envelope (inbox row)

Hand-addressed and stamped. An envelope-white sheet with the letter hairline: the address (name, then city and country) in the pen hand, then the latest letter's opening in body sans (navy if unread, faded if read; "You: " before the person's own). Top right, the contact's stamp (48px) with a plain postmark (48px) placed after it so the ring overlaps the stamp's lower left corner while its town and time stay on the envelope. Unread: the airmail edge (6px) across the top, and a red count tab overhanging the bottom left corner by 8px.

### Letter

- **Received:** onion skin, left. **Sent:** aerogramme deep, right. Square, hairline shadow, max 78% wide.
- **Contents in order:** a quote slip if it answers a letter, a postcard if it carries a photo (white 6px border, turned -1.5deg, tap to view full screen), the text, then the time in postal caps at the lower right.
- **Stamps stuck on it:** 22px reaction stamps over its outer top corner, each at its own angle.
- **Receipt:** under the person's latest letter, a plain 40px postmark reading SENT, DELIVERED or READ with the time, in postmark ink, READ in airmail red. It lands with the strike.
- **Swipe to reply:** leftward only (a rightward drag belongs to the screen's swipe back). The letter follows the finger, with resistance (0.35) past the 56px reply point, to at most 84px; a 36px disc behind it fills from 10% navy to airmail red at the reply point. On release it settles back over 240ms (cubic-bezier(0.22, 1, 0.36, 1)), no bounce.

### Quote slip

The letter being answered, as an inset slip of translucent paper with a full navy hairline border (no side stripe): RE: or REPLYING TO and the name in postal caps in postmark ink, then the quoted text in faded ink, two lines in a letter and one in the composer.

### Postmark

A double ring (outer 3.5, inner 1.5 at 60%) with the town along its top and the time or day in the middle, optionally the year; with cancellation lines (five wavy lines to its right) as a day divider, plain as a receipt or on an envelope. **Strike:** from scale 1.35 turned -14deg to scale 0.96, settling at 1 and -8deg over 220ms (cubic-bezier(0.2, 0.9, 0.3, 1)). Reduced motion: it appears without the strike.

### Stamp

A perforated postage stamp: white margin edged with a faint postmark-ink line, a field in its ink, a white line motif, and the denomination in postal caps in the corner. It stands where another app shows an avatar (48px on an envelope, 34px in the thread header) and is also the reaction: the six reactions are drawn stamps in the same drawing.

### Stamp sheet (hold a letter)

A navy scrim (35%) with an aerogramme-paper sheet from the bottom: the held letter turned -1deg, STICK A STAMP ON IT, the six reaction stamps (40px) with their names (a stuck one raised 4px and turned -5deg, its name in red), then REPLY and COPY as onion-skin sheet actions with icons.

### Header

Aerogramme paper, no fill change. Inbox: "Letters" in display with the PAR AVION label (envelope white, airmail edge 4px above and below, airmail-blue caps) and a search action. Thread: back, the contact's stamp, name in title and the city in label caps (or WRITING TO YOU… in red), over a navy hairline.

### Inputs / Fields

- **Composer field:** an onion-skin sheet, 44px, square, hairline shadow, body text in navy, placeholder in faded ink. Flanked by the camera (postcard) and Send, both 44px; Send is a bare faded icon until there's text, then a square of airmail red with a paper icon.
- **Search:** a bare field on the paper, ruled below by navy at 30%.
- **Focus:** the platform's caret; no focus ring is drawn.

### Writing indicator

Three 7px postmark-ink dots on an onion-skin slip, pulsing in opacity (0.35 to 1, 700ms ease-in-out, alternating, 180ms apart), beside "NAME IS WRITING" in postal caps in postmark ink.

### Icons

Line icons from the `ui-icon` set (search, x, chevron-left, camera, send, reply, copy), tinted navy or faded ink.

## Do's and Don'ts

### Do:

- **Do** put every surface on a postal paper (aerogramme paper, envelope white, onion skin, aerogramme deep) with the letter hairline shadow.
- **Do** let marks carry time and status: a postmark for days and receipts, a stamp for a person or a reaction.
- **Do** set labels, names and times in League Gothic caps with tracking, and give every `<text>` its own family class.
- **Do** keep corners square (0px) on sheets and controls; keep round shapes for ink marks.
- **Do** turn marks a few degrees, never quite straight.
- **Do** honor reduced motion: no strike, no settle transition.
- **Do** write SVG mark colors as the constants in `marks.ts`, matching their tokens; an SVG drawn from a string can't read `var()`.
- **Do** set an input's placeholder color both as `placeholder-color` and as the `-x-placeholder-color` style; iOS reads only the style.
- **Do** write colors as `rgba()`.

### Don't:

- **Don't** use rounded chat bubbles or a gray and blue bubble pair.
- **Don't** use the airmail chevrons as a general border or divider; dividers are the navy hairline.
- **Don't** use the pen hand for anything but an address on an envelope.
- **Don't** add a second shadow depth; a held or chosen thing is shown by a turn or a small raise.
- **Don't** switch the palette for dark mode.
- **Don't** use `:hover`, `@media` or pseudo-elements; Lynx doesn't support them.
