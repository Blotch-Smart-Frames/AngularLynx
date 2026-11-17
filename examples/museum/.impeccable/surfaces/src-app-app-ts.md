---
version: 1
slug: "src-app-app-ts"
primary_target: "src/app/app.ts"
related_targets: []
---

# The museum showcase (examples/museum): Vitrine

## Scope and mode

Experience. A phone-sized Lynx app over the Cleveland Museum of Art's Open Access collection, shown live on the landing page (fifth tab, after Par Avion) beside its source, in the docs' Showcase section, and run on iOS and Android. The visitor is a web developer judging whether Angular on Lynx can carry a real app: live network data inside tabs that each keep a stack.

## Audience, job, proof, constraints

- Job: browse what's on view, open a work, read it, zoom into its brushwork, save it, search the whole collection in another tab, come back to find everything as left; then open the source.
- Proof: `httpResource`/`HttpClient` against a real API with loading, empty, error and offline states; `<lynx-tab-outlet>` with a `<lynx-stack-outlet>` per tab, lazy and prebuilt tabs; bars of the app's own on `LynxStackBottomBar`; a collapsing large title; a virtualized `<list>` with infinite paging; two-finger zoom with momentum in main-thread scripts; `LynxLocalStorage`; `LynxShare`; splash screen; app shortcuts.
- Constraints: CC0 works with images only; credit the source plainly, never pose as the museum; no invented hours, prices, events or reviews; Lynx's `PinchGesture` never fires (zoom comes from raw touches); no `:hover`, `@media`, pseudo-elements.

## Direction contract

THESIS: The collection is a steel-framed glass wall you walk along: every work a pane between matte black glazing bars, every fact a pane of its own, saturated glass only where something matters now. It refuses the category's white feed of rounded image cards under a serif title.

OWN-WORLD: Matte black bars at a true 6px are the only line; clear and seeded-white glass panes are the calm ground; cobalt marks where you are and what's on view, amber what you've saved, oxblood what failed. Sofia Sans set inside a pane, never across a bar; Sofia Sans Extra Condensed for titles, big and tight, in caps. One pane, one statement; hierarchy from pane size and glass color, never type weight. No rounded corners, no shadows, no cards.

STORY: The visitor sees what's on view as a glazed wall, taps a painting's pane, reads it pane by pane, steps up to the glass and zooms into the brushwork, floods the save pane amber, searches the whole collection in the next tab, and returns to find the wall where they left it.

FIRST VIEWPORT: The On View tab, as the chosen sketch: a clear transom pane with ON VIEW NOW in the condensed face on two lines beside a cobalt pane; the lead highlight in the widest pane; a seeded pane naming its gallery and title beside a second work; the wall continuing in two columns with narrow color panes between; the tab bar a row of three frosted panes, the current one flooded cobalt.

FORM: Glass partition: the catalog challenger, chosen by the user over the rolled Registrar's Card Drawer. seed:16661558f51d5fe6

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction and motion grammar

- Signature, stepping up to the glass: tapping a work's pane opens the viewer, where the print-resolution image clears in over the web image; two fingers zoom into it, a drag pans it with momentum, a double tap zooms to that point and back.
- Press: a pane backlights under the finger (brightens in 120ms) and settles on release.
- Selection floods: the active tab pane and a saved work's save pane fill with their glass color over 280ms, ease-out.
- Loading is daylight crossing the wall: frosted panes brighten one after another, never a spinner. Images clear into their pane on load (400ms cross-fade from frosted).
- In-world nothing slides; the stack's push and swipe-back are the platform's own.
- Reduced motion: floods and clears land at once; zoom keeps no momentum.

## Translations from the brief

- The tab bar and the navigation bar are the app's own, built on `LynxStackBottomBar` and the stack's back navigation, rather than `@blotch/ui`'s bars: the world rebuilds every atom. The tab panes are real frosted glass (`<blur-view>`), so the brief's glass tab bar stays glass.
- The large title is the transom pane; it scrolls away and the compact bar's title brightens in, as iOS does.

## Unresolved

- Two-finger zoom: verified on Lynx for Web; on iOS and Android it relies on the new `multiTouch` build option (Lynx's `enableMultiTouch` page config), which needs a pinch on a simulator or phone to confirm.

## Decided during the build

- Night: the phone's dark appearance draws the wall lit from behind, smoked panes with the colors glowing (`page.dark` in styles.css).
- On View's rails are seeded glass with the gallery number in cobalt (every work there is on view); cobalt rails mark on-view works where a wall mixes them with works in storage (Search and Saved), amber marks a saved work everywhere but Saved. The floating bars' glazing is each pane's black border, so the wall shows blurred through their glass.
