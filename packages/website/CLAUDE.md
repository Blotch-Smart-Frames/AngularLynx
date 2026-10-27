# AngularLynx website

Documentation website for AngularLynx, built with [Rspress](https://rspress.dev/).

## Reference Websites

Look at these for inspiration on structure, content, and tone:

- [lynxjs.org](https://lynxjs.org/) ([source](https://github.com/lynx-family/lynx-website)) — Official Lynx website (covers React Lynx)
- [vue.lynxjs.org](https://vue.lynxjs.org/) ([source](https://github.com/Huxpro/vue-lynx/tree/main/website)) — Vue Lynx documentation site

## Writing Principles

User-friendliness, readability, and short attention spans are the top priority. Write docs as if the reader has ADHD and is scanning on a phone.

- **Lead with the payoff.** First sentence answers "what does this do for me?" — not history or theory.
- **One idea per paragraph.** If a paragraph covers two concepts, split it.
- **Short sentences.** Max ~20 words. Cut filler words ruthlessly ("In order to" → "To", "It should be noted that" → delete).
- **Scannable structure.** Use headings, bullet lists, and code blocks liberally. Walls of prose lose readers instantly.
- **Code first, explanation second.** Show a working example up front, then explain what it does. Most readers copy-paste before reading.
- **Progressive disclosure.** Start with the simplest usage. Put edge cases, options, and caveats further down — not in the opening section.
- **Bold key terms** on first use so scanners can anchor on them.
- **No jargon without context.** If you must use a Lynx-specific term (main thread, background thread, element pool), link or briefly define it inline.
- **Keep pages short.** If a page exceeds ~300 lines, split it into sub-pages or move details into a collapsed section.

## Guide vs API

The docs are split like [lynxjs.org](https://lynxjs.org/api/): each half has its own navbar link and sidebar.

- **`docs/guide/`** — Pages that teach: tutorials, how-tos and explanations of a concept
- **`docs/api/`** — Reference: one page per named thing (an element, an export, a builder option) listing its attributes, events, signatures or options

If a page documents a single element or export, it goes in `docs/api/`. Link guide pages to the matching API pages, and API pages back to the guide that explains them.

Moving or renaming a page changes its URL. Add a redirect for the old URL to `vercel.json`.

## Reader

Write for a web developer who knows TypeScript and CSS, and maybe some Angular, but not Lynx or native mobile development (Swift, Kotlin, Xcode, Gradle, signing, app stores). Define every Lynx or native term where it first appears, and link it to its entry in `docs/guide/glossary.mdx`. Add new terms to the glossary.

- Explain implementation internals (`__CreateElement`, `__FlushElementTree`, PrimJS, `LynxRendererFactory2`) only on the Renderer Internals page.
- Don't explain anything by comparison with React Lynx or Vue Lynx.
- Threads: Angular runs on the main thread only, where it draws the UI and runs template event handlers. The background thread runs background functions and AngularLynx's calls to background-only APIs. Link to `/guide/concepts/threads`, and its Event handlers section, rather than re-explaining it. Handlers can navigate, open overlays and start animations directly: don't wrap those in `setTimeout` (the old "`setTimeout` rule" was measured false on Lynx 4.1; see `investigations/lynx-vs-web-differences.md`).

## Page Types

Each page does one job, following the [four documentation types](https://diataxis.fr/):

- **Tutorial** — Quick Start and the Tutorial only: numbered steps that end in a visible result
- **How-to** — most Guide pages: a task, the smallest working code first, then options, limitations and related links
- **Explanation** — Core Concepts: why things work the way they do
- **Reference** — the API section and the UI components' API tables: complete, consistent tables and signatures, no teaching

API element pages share one heading order: Usage, Attributes, Events, Methods, Children, Platform support, Related. Attribute tables have the columns Attribute | Type | Default | Description, and event tables Event | `detail` | Description. UI component pages share: Installation, Usage (variants as H3s), API, Accessibility, Related.

## Sidebar Sections

Guide sidebar (`/guide/` in `rspress.config.ts`), in reading order:

- **Get Started** — What is AngularLynx, Quick Start, the Tutorial, Coming from Web Angular
- **Core Concepts** — How a Lynx app runs, threads, signals, the JavaScript environment, the glossary
- **Build the UI** — Elements, events, gestures, overlays, forms, accessibility
- **Style** — CSS on Lynx, Tailwind, CSS Modules, dark mode, fonts, safe area, animations
- **App Features** — Routing, `@defer`, visibility detection, i18n
- **Debug & Test** — Debugging, errors, profiling, testing
- **Ship** — Building, running on iOS and Android, publishing, embedding in a native app
- **Advanced** — Power-user topics: main-thread scripts, multi-page apps, low-level APIs, renderer internals. Move docs here if a typical user won't need them in their first week.

API sidebar (`/api/`):

- **@blotch/angular-lynx** — One page per export or small group of exports, grouped as App Setup, Device and Host, UI Services, Debugging, Gestures and Main Thread, plus Schematics
- **Tooling** — The build and testing-library packages
- **Elements** — One page per Lynx element

## Diagrams

Use **Mermaid** diagrams — not ASCII art. Rspress supports Mermaid natively.
