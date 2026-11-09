# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The app is a Lynx app: it renders natively on iOS and Android and, in the docs' live preview, through Lynx for Web. Its design language is its own (CSS, Tailwind, `@blotch/ui`), not UIKit's or Material's, which is why the platform is recorded as web, as for its siblings Facet (`examples/showcase`) and Darkroom (`examples/darkroom`).

## Users

Web developers who know TypeScript, CSS and some Angular, but not Lynx or native mobile development. They land on angularlynx.js.org deciding whether AngularLynx is real. A chat app is the one they'll judge hardest: everyone uses one daily, so a list that jumps, a keyboard that covers the composer or a swipe that lags is noticed at once. They meet this app on the landing page, in a phone-sized preview beside its source, and may run it on their phone through Lynx Explorer or as an iOS/Android app.

## Product Purpose

The third showcase app: a messaging app that proves Angular on Lynx feels native in the interactions cross-platform frameworks are usually caught out by, on iOS, Android and the web alike. Success: a visitor scrolls back through a long conversation, swipes to reply, reacts, sends a message and watches the contact type back, and can't tell it isn't a native app; then opens the source and sees ordinary Angular.

## Positioning

The only Angular renderer for Lynx. Facet proves 3D on the GPU, Darkroom proves image processing; this proves the everyday native feel: virtualized lists, keyboard handling, gestures and navigation.

## Operating Context

- Lives at `examples/chat/`, built like every example (`ng build` with `@blotch/angular-lynx-build`), copied into the docs site by `packages/website/scripts/prepare-examples.mjs` and shown with `<Go example="chat">`.
- Third tab of the landing page's "Try it right here" (after Facet and Darkroom), and listed in the docs' Showcase section.
- The landing page lays it out in an iPhone-framed preview (402 wide, 62px top and 34px bottom safe-area insets); in the docs, a fitted `<Go>` preview with no insets.
- Also runs in Lynx Explorer and as iOS/Android apps built with `ng build --platform`.

## Capabilities and Constraints

Confirmed with the user:

- **Content:** invented contacts with bundled conversation histories, long enough (hundreds of messages) that scrolling up loads older pages; after the person sends, a contact "types" and replies after a delay. No network: it runs anywhere, the docs preview included.
- **Screens:** an inbox of conversations, and a thread pushed with `<lynx-stack-outlet>`, sliding in and swiping back as a native app does.
- **Infinite scroll, upwards:** a thread opens at its newest message and loads older messages in pages as the person scrolls up (a `<list>` with `upper-threshold-item-count` / `bindscrolltoupper`), without the visible messages jumping.
- **Interactions:** swipe a message sideways to reply to it (quoted in the composer); long-press for a reaction picker and copy; send photos with `LynxImagePicker` and view them full screen; a typing indicator and sent/delivered/read ticks.
- **Keyboard:** the composer sits above the on-screen keyboard and the thread stays pinned to its newest message as the keyboard opens (`bindkeyboardheightchange`).
- Whatever the person sends, reacts and reads persists with `LynxLocalStorage`; picked photos live for the session (too large for key-value storage).
- Lynx CSS: no `@media`, no `:hover`, no pseudo-elements, no inheritance except `<text>` nesting; semantic Tailwind colors or explicit rgba(); `@blotch/ui` copies only through dolan.
- Undecided: the app's name.

## Brand Commitments

- Product name "AngularLynx".
- No AI attribution anywhere in code, comments or commits (repo rule).

## Evidence on Hand

- Real: AngularLynx's feature set (`skills/angular-lynx/`, `packages/website/docs/`), and examples to build on: `examples/stack-navigation`, `examples/contact-list`, `examples/element-list`, `examples/gestures`, `examples/ui-avatar`, `examples/notification-center`.
- Absent, must not be fabricated as real: people, phone numbers, photos of real people presented as contacts, user counts or reviews. Contacts, their messages and avatars are authored for the app and read as invented.

## Product Principles

1. Prove by doing: every AngularLynx feature appears because chatting needs it.
2. Never jump: the list holds its place while older messages load, the keyboard opens, or a reply arrives.
3. Native feel over novelty: gestures, momentum and navigation behave as the phone's own apps do.
4. The source is part of the product: readable, idiomatic Angular, commented for why.
5. Degrade, never break: Lynx Explorer (no photo picker), reduced motion and the web preview (no keyboard) all look intended.

## Accessibility & Inclusion

- Honor `LynxAccessibilitySettings.reduceMotion()`.
- Every control has an `accessibility-label`; each message reads its sender, text and time; actions available by swipe or long-press are also reachable another way.
