# AngularLynx website

Documentation website for AngularLynx, built with [Rspress](https://rspress.dev/).

## Reference Websites

Look at these for inspiration on structure, content, and tone:

- `references/lynx-website-main/` — Official Lynx website (covers React Lynx)
- `references/vue-lynx-main/website/` — Vue Lynx documentation site

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

## Sidebar Sections

- **Learn AngularLynx** — Core concepts and everyday features a new user needs to build their first app
- **Advanced** — Power-user topics: internal architecture, low-level APIs, niche platform integrations. Move docs here if a typical user won't need them in their first week.
- **Ecosystem** — Third-party packages that require separate installation (e.g. Tailwind CSS, testing library)

## Diagrams

Use **Mermaid** diagrams — not ASCII art. Rspress supports Mermaid natively.
