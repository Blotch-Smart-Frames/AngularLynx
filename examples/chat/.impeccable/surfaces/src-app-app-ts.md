---
version: 1
slug: "src-app-app-ts"
primary_target: "src/app/app.ts"
related_targets: []
---

<!-- cspell:words Aurore Rivka -->

# The chat showcase (examples/chat)

## Scope and mode

Experience. A phone-sized Lynx messaging app shown live on the landing page (third tab, after Facet and Darkroom) beside its source, in the docs' Showcase section, and run on iOS and Android. The visitor is a web developer judging whether Angular on Lynx feels native where cross-platform apps usually don't.

## Audience, job, proof, constraints

- Job: open a conversation, scroll far back (older letters load in pages without the list jumping), swipe to reply, hold to react, send a message and watch the contact write back; then open the source.
- Proof: a virtualized `<list>` loading upward, `<lynx-stack-outlet>` push and swipe-back, gestures (pan, long press), keyboard handling, `LynxImagePicker`, `LynxClipboard`, `LynxLocalStorage`, custom fonts.
- Constraints: invented contacts and content; no network; Explorer has no photo picker; the web preview has no on-screen keyboard; no `:hover`, `@media`, pseudo-elements.

## Direction contract

THESIS: Every conversation is correspondence by airmail. The inbox is a stack of envelopes, each addressed by hand and stamped with the contact's own stamp; a thread is the letters between you, postmarked as they go and as they're read. It refuses the category's rounded blue and gray bubbles.

OWN-WORLD: Aerogramme-blue paper (rgba(222,231,242)) as ground, onion-skin white (rgba(250,251,252)) for letters received, the aerogramme's own blue a shade deeper for letters sent; navy ink (rgba(27,39,72)); and the airmail edge, alternating red (rgba(200,34,48)) and blue (rgba(31,61,140)) parallelograms, used only as the envelope's border, the PAR AVION label and the unread mark. Postmarks (ring, town, date, wavy cancellation lines) in violet-black postmark ink (rgba(58,50,82)) carry every time and receipt. Contacts are perforated postage stamps, each in its own color with a drawn motif and a denomination. League Gothic for every label, name and postmark; a pen hand (La Belle Aurore) only for addresses on envelopes; message text in the system sans. Square paper corners, a hairline shadow under each letter.

STORY: The visitor sees a stack of airmail envelopes; opens Rivka's, which slides in and swipes back; scrolls up and older letters keep arriving above without a jump; swipes a letter to reply to it; holds one and sticks a stamp on it as a reaction; types and sends, sees it postmarked SENT then READ, and watches "Rivka is writing" before her reply arrives.

FIRST VIEWPORT: Header on paper: the app's name in League Gothic with a PAR AVION label edged in the airmail chevrons, and a search action. Below, envelopes: each a white envelope edged in red and blue chevrons when unread, the contact's stamp top-right with a postmark of the last letter's time striking it, the handwritten address (name and city) and the last line as the letter's opening. The newest first.

FORM: Airmail correspondence: aerogrammes, postage stamps, postmarks and PAR AVION labels (my top-ranked grounded candidate, chosen by the user as the pick card over the rolled QSL cards). seed:1d3a3ed8fc4b3632

FINISH: without the review and the documentation it is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Signature interaction and motion grammar

- Signature: a sent letter is postmarked: the SENT postmark lands beside it, then turns to READ when the contact opens it, each landing like a hand stamp (scale from 1.3, a few degrees of turn, 180ms ease-out, a short settle).
- Swipe to reply: the letter follows the finger sideways with resistance; past the threshold a reply arrow fills, and on release it settles back (an ease-out, no bounce) while the composer shows the quoted letter.
- Reactions: holding a letter lifts it and opens a sheet of stamps; a chosen stamp sticks to the letter's corner at a slight angle.
- Older letters arrive above with no movement of what's on screen.
- Reduced motion: postmarks and stamps appear without the landing; swipe has no spring.

## Unresolved

- The app's name.
- Whether to add `.test.ts` specs for the conversation paging and reply simulation.
