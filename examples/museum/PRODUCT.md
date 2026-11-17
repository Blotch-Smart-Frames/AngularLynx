# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The app is a Lynx app: it renders natively on iOS and Android and, in the docs' live preview, through Lynx for Web. Its design language is its own (CSS, Tailwind, `@blotch/ui`), not UIKit's or Material's, which is why the platform is recorded as web, as for its siblings Facet (`examples/showcase`), Darkroom (`examples/darkroom`), Par Avion (`examples/chat`) and the Orrery (`examples/solar-system`).

## Users

Web developers who know TypeScript, CSS and some Angular, but not Lynx or native mobile development. They land on angularlynx.js.org deciding whether AngularLynx is real: whether Angular can produce a native app that looks, moves and performs like one. A museum app is a kind of app they know from their phones: tabs along the bottom, screens that push and swipe back, search, pictures that load as they scroll and zoom under two fingers. They meet this app on the landing page, in a phone-sized preview beside its source, and may run it on their phone through Lynx Explorer or as an iOS/Android app.

## Product Purpose

A companion to a real museum's collection, and the fifth showcase app for AngularLynx. It exists to prove what the other showcases don't: an app built on live data from a real public API (Angular's `HttpClient` / `httpResource`, with loading, empty, error and offline states), inside the shell most real apps have, tabs that each keep their own stack of screens. Success: a visitor browses what's on view, searches the collection, opens a painting and zooms into its brushwork with two fingers, saves it, switches tabs and comes back to find everything where they left it; then opens the source and sees ordinary Angular.

## Positioning

The only Angular renderer for Lynx. Facet proves 3D, Darkroom image processing, Par Avion the feel of a chat app, the Orrery hand-written shaders; this one proves a real app's architecture: network data, tab and stack navigation, launch (splash screen, app shortcuts) and gesture-driven motion.

## Operating Context

- Lives at `examples/museum/`, built like every example (`ng build` with `@blotch/angular-lynx-build`), copied into the docs site by `packages/website/scripts/prepare-examples.mjs` and shown with `<Go example="museum">`.
- Fifth tab of the landing page's "Try it right here", after Par Avion and before the furniture shop (confirmed), and listed in the docs' Showcase section.
- The landing page lays it out in an iPhone-framed preview (402 wide, 62px top and 34px bottom safe-area insets); in the docs, a fitted `<Go>` preview with no insets.
- Also runs in Lynx Explorer and as iOS/Android apps built with `ng build --platform`.

## Capabilities and Constraints

Confirmed with the user:

- **Live data:** the Cleveland Museum of Art's Open Access API (`https://openaccess-api.clevelandart.org/api/artworks/`), no key, CORS open. Records come with title, creators, date, culture, technique, department, type, measurements, descriptions and "did you know" facts, gallery location (`current_location`, such as "208 American Gilded Age and Realism") and images: `web` (about 900px) and `print` (about 3400px) JPEGs on `openaccess-cdn.clevelandart.org`. Filters include `q`, `department`, `type`, `highlight`, `currently_on_view`, `has_image`, `cc0`, `skip` and `limit`. Only CC0 works with images are shown.
- The museum was first planned as the Art Institute of Chicago; its image server answers automated and native requests with a Cloudflare challenge (HTTP 403), which a phone's image loader can't pass, so the app uses Cleveland's instead.
- **App shell (confirmed):** `<lynx-tab-outlet>` with a `<lynx-stack-outlet>` in each tab; tabs kept alive (scroll and stack intact on return), lazy and prebuilt tabs; the tab bar and the top bar are the app's own, frosted `<blur-view>` panes between black bars, built on the runtime's API for bars of your own (`LynxStackBottomBar`), with a large title that gives way to a compact one as content scrolls.
- **Launch (confirmed):** a splash screen (`splash` option, `provideSplashScreen`) and app shortcuts in `angular.json` that open screens of the app (Siri / App Shortcuts on iOS, launcher shortcuts on Android).
- **Gesture-driven motion (confirmed):** pinch and pan to zoom into an artwork's print-resolution image, with momentum, run by main-thread scripts; transitions between a list's picture and the artwork screen.
- **States:** the API can be slow, down, or the phone offline; the app shows loading, empty, error and retry states, and must still show something in the landing page if the API fails.
- Saved works persist with `LynxLocalStorage` (ids and the few fields needed to list them offline).
- Lynx CSS: no `@media`, no `:hover`, no pseudo-elements, no inheritance except `<text>` nesting; semantic Tailwind colors or explicit rgba(); never raw HSL; `@blotch/ui` copies only through dolan (never hand-edit `src/components/ui`).
- Must build with `ng build`, lint and format with the repo's oxlint/oxfmt.
- Name: Vitrine (a museum's glass display case), authored during the build.

## Brand Commitments

- Product name "AngularLynx".
- The app is not the museum's app and never poses as it: its name and look are its own, with no museum logo or branding. It credits the source plainly ("Collection data and images: The Cleveland Museum of Art, Open Access, CC0").
- No AI attribution anywhere in code, comments or commits (repo rule).

## Evidence on Hand

- Real: the Cleveland Museum of Art's Open Access data and images (CC0), fetched live. Example probe (2026-11-16): 143 highlights currently on view with images, such as William Merritt Chase's _Portrait of Dora Wheeler_ (gallery 208), George Bellows's _Stag at Sharkey's_ (208), Thomas Eakins's _The Biglin Brothers Turning the Stake_ (207) and Frederic Edwin Church's _Twilight in the Wilderness_ (206).
- Real: AngularLynx's feature set (`skills/angular-lynx/`, `packages/website/docs/`); examples to build on: `examples/ui-dock`, `examples/ui-tab-bar`, `examples/ui-navigation-bar`, `examples/stack-navigation`, `examples/splash-screen`, `examples/shortcuts`, `examples/gestures`, `examples/main-thread`, `examples/persistent-storage`.
- Absent, must not be fabricated: opening hours, ticket prices, visitor counts, ratings or reviews, events, or any claim to speak for the museum. Anything the API doesn't say, the app doesn't either.

## Product Principles

1. Prove by doing: every AngularLynx feature appears because a museum app needs it, not as a demo tile.
2. The art leads: pictures are the content; chrome stays out of their way.
3. Real data, honest states: loading, empty, error and offline each look intended, and nothing invented fills a gap.
4. Nothing lost: switching tabs, going back or relaunching returns the person to where they were.
5. The source is part of the product: readable, idiomatic Angular, commented for why.

## Accessibility & Inclusion

- Honor `LynxAccessibilitySettings.reduceMotion()`.
- Every artwork image carries an accessibility label from its title and creator; controls get `accessibility-label`s.
