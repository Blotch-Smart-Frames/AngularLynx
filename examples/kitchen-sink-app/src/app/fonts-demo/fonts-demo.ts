import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * One custom font registered via `@font-face` in `styles.css`. Each family is a
 * separate `@font-face` rule pointing at a `.ttf` in `src/assets/fonts/` — Lynx
 * loads the file and exposes the family name to CSS `font-family`.
 *
 * `family` is bound with `[style]="'font-family: ...'"` rather than Tailwind's
 * `font-[Name]` utility because arbitrary Tailwind classes are compiled
 * statically at build time and can't be generated from `@for` loop data. The
 * raw inline-style string produces the exact same `font-family` declaration the
 * utility would, so it renders identically on Lynx.
 */
type FontSpecimen = {
  /** The `@font-face` family name; bound directly to CSS `font-family`. */
  family: string;
  /** Human-friendly label shown as the specimen heading. */
  name: string;
  /** Classification chip (Sans-serif, Serif, Script, Monospace, …). */
  category: string;
  /** One line on the font's character and where you'd reach for it. */
  note: string;
  /** Specimen text, chosen to flatter each family's personality. */
  sample: string;
  /** Static Tailwind size class — listed literally so the JIT scanner sees it. */
  sampleClass: string;
};

@Component({
  selector: 'app-fonts-demo',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, DemoScreen],
  template: `
    <app-demo-screen
      heading="Custom Fonts"
      category="Platform"
      description="Eight custom .ttf families loaded via @font-face and rendered natively by Lynx."
    >
      <!-- ── Specimen gallery ─────────────────────────────────────────────
           One card per family. The heading/category render in the system font
           for legibility; only the specimen line uses the custom font, so you
           can see exactly what each face contributes. -->
      @for (font of fonts; track font.family) {
        <view class="rounded-lg border border-border bg-card p-4">
          <view class="mb-3 flex-row items-center flex justify-between">
            <text class="text-[15px] font-semibold text-foreground">
              {{ font.name }}
            </text>
            <view class="rounded-full bg-muted px-2 py-0.5">
              <text
                class="uppercase text-[10px] font-semibold tracking-[0.5px] text-muted-foreground"
              >
                {{ font.category }}
              </text>
            </view>
          </view>

          <text
            class="mb-3 text-foreground {{ font.sampleClass }}"
            [style]="'font-family: ' + font.family"
          >
            {{ font.sample }}
          </text>

          <view class="flex-row items-center flex justify-between">
            <text class="text-[12px] text-muted-foreground">{{
              font.note
            }}</text>
            <!-- Echo the CSS value in monospace so the wiring is obvious. -->
            <text
              class="text-[11px] text-muted-foreground"
              style="font-family: SpaceMono"
            >
              {{ font.family }}
            </text>
          </view>
        </view>
      }

      <!-- ── Custom vs. system font ───────────────────────────────────────
           Same pangram rendered twice to make the substitution unmistakable. -->
      <view class="rounded-lg border border-border bg-card p-4">
        <text class="mb-3 text-[15px] font-semibold text-foreground">
          Custom vs. system
        </text>

        <text class="mb-1 text-[12px] text-muted-foreground">
          Roboto (custom @font-face)
        </text>
        <text
          class="mb-4 text-[18px] text-foreground"
          style="font-family: Roboto"
        >
          The quick brown fox jumps over the lazy dog
        </text>

        <text class="mb-1 text-[12px] text-muted-foreground">
          System default (no font-family)
        </text>
        <text class="text-[18px] text-foreground">
          The quick brown fox jumps over the lazy dog
        </text>
      </view>

      <!-- ── Size scale ───────────────────────────────────────────────────
           A single family across sizes: fonts stay crisp because Lynx renders
           the real vector outlines, not a bitmap. -->
      <view class="rounded-lg border border-border bg-card p-4">
        <text class="mb-3 text-[15px] font-semibold text-foreground">
          Size scale — Playfair Display
        </text>
        <view class="flex-col gap-2 flex">
          @for (size of sizeScale; track size.px) {
            <view class="flex-row items-baseline gap-3 flex">
              <text class="w-12 text-[11px] text-muted-foreground">
                {{ size.px }}px
              </text>
              <text
                class="text-foreground {{ size.class }}"
                style="font-family: PlayfairDisplay"
              >
                Lynx
              </text>
            </view>
          }
        </view>
      </view>

      <!-- ── Character set ────────────────────────────────────────────────
           Uppercase, lowercase, numerals and symbols in a monospace face so
           every glyph lines up on a fixed grid. -->
      <view class="rounded-lg border border-border bg-card p-4">
        <text class="mb-3 text-[15px] font-semibold text-foreground">
          Character set — Space Mono
        </text>
        <view class="rounded-md bg-muted p-3">
          <text
            class="mb-1 text-[13px] text-foreground"
            style="font-family: SpaceMono"
          >
            ABCDEFGHIJKLMNOPQRSTUVWXYZ
          </text>
          <text
            class="mb-1 text-[13px] text-foreground"
            style="font-family: SpaceMono"
          >
            abcdefghijklmnopqrstuvwxyz
          </text>
          <text
            class="text-[13px] text-foreground"
            style="font-family: SpaceMono"
          >
            0123456789 !&#64;#$%^&amp;*()
          </text>
        </view>
      </view>

      <!-- ── How it works ─────────────────────────────────────────────────
           The registration snippet plus the one Lynx gotcha worth knowing. -->
      <view class="rounded-lg border border-border bg-card p-4">
        <text class="mb-3 text-[15px] font-semibold text-foreground">
          How it works
        </text>
        <text class="mb-3 text-[13px] text-muted-foreground">
          Drop a .ttf in assets/fonts, register it in styles.css, then reference
          the family by name:
        </text>
        <view class="mb-3 rounded-md bg-muted p-3">
          <text
            class="text-[12px] text-foreground"
            style="font-family: SpaceMono"
          >
            {{ fontFaceSnippet }}
          </text>
        </view>
        <text class="text-[12px] text-muted-foreground">
          Lynx's @font-face ignores font-weight and font-style descriptors, so
          each weight needs its own family name (e.g. Roboto-Light vs
          Roboto-Bold) or a variable font.
        </text>
      </view>
    </app-demo-screen>
  `,
})
export class FontsDemo {
  /** Families registered in styles.css, ordered from workhorse to novelty. */
  protected readonly fonts: readonly FontSpecimen[] = [
    {
      family: 'Roboto',
      name: 'Roboto',
      category: 'Sans-serif',
      note: 'Clean, neutral UI text',
      sample: 'The quick brown fox jumps over the lazy dog',
      sampleClass: 'text-[18px]',
    },
    {
      family: 'PlayfairDisplay',
      name: 'Playfair Display',
      category: 'Serif',
      note: 'High-contrast editorial headlines',
      sample: 'Elegant Headlines',
      sampleClass: 'text-[26px]',
    },
    {
      family: 'DancingScript',
      name: 'Dancing Script',
      category: 'Handwriting',
      note: 'Casual flowing signature',
      sample: 'Hello, beautiful world!',
      sampleClass: 'text-[26px]',
    },
    {
      family: 'Lobster',
      name: 'Lobster',
      category: 'Script',
      note: 'Bold retro signage',
      sample: 'Fresh Baked Daily',
      sampleClass: 'text-[28px]',
    },
    {
      family: 'Pacifico',
      name: 'Pacifico',
      category: 'Brush',
      note: 'Friendly rounded strokes',
      sample: 'Surf & Sunshine',
      sampleClass: 'text-[26px]',
    },
    {
      family: 'BebasNeue',
      name: 'Bebas Neue',
      category: 'Condensed',
      note: 'Tall all-caps impact',
      sample: 'BIG BOLD IMPACT',
      sampleClass: 'text-[32px]',
    },
    {
      family: 'SpaceMono',
      name: 'Space Mono',
      category: 'Monospace',
      note: 'Fixed-width code & data',
      sample: 'const answer = 42;',
      sampleClass: 'text-[18px]',
    },
    {
      family: 'PressStart2P',
      name: 'Press Start 2P',
      category: 'Retro pixel',
      note: '8-bit arcade nostalgia',
      sample: 'GAME OVER',
      sampleClass: 'text-[14px]',
    },
  ];

  /** Sizes for the size-scale card; classes are literal so Tailwind emits them. */
  protected readonly sizeScale: readonly { px: number; class: string }[] = [
    { px: 14, class: 'text-[14px]' },
    { px: 20, class: 'text-[20px]' },
    { px: 28, class: 'text-[28px]' },
    { px: 40, class: 'text-[40px]' },
  ];

  /** Registration snippet shown in the "How it works" card. */
  protected readonly fontFaceSnippet = `@font-face {
  font-family: 'Lobster';
  src: url('./assets/fonts/Lobster-Regular.ttf')
       format('truetype');
}`;
}
