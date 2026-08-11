import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * A vivid, *named* Tailwind palette swatch. Named colors (bg-rose-500, …)
 * compile to hex/rgb on Lynx, so they render reliably and can vary per item —
 * unlike the semantic theme tokens, which are opaque rgba() values (see root
 * CLAUDE.md). These are the class strings the template scans, so they must
 * appear as literals for Tailwind's JIT to emit them.
 */
type Swatch = { readonly class: string; readonly label: string };

/** A semantic theme token, shown as a swatch + name + the utility that sets it. */
type Token = {
  readonly box: string;
  readonly name: string;
  readonly token: string;
};

/** A border-radius sample: one filled box per `rounded-*` step. */
type Radius = { readonly class: string; readonly label: string };

/** A spacing sample: a muted frame whose padding grows around a fixed square. */
type Spacing = { readonly class: string; readonly label: string };

/**
 * Tailwind demo — a showcase of utility-first styling on Lynx, built entirely
 * from `@blotch/dolan` components and semantic theme tokens rather than the
 * previous hand-rolled slate/blue chrome. Every surface here (bg-card,
 * text-foreground, bg-muted, …) is theme-aware, so the whole screen flips with
 * dark mode for free.
 *
 * Uses `DemoScreen` for the shared page frame (heading/category/description +
 * the page scroll-view). It has no scroll-view/list/gesture surface of its own,
 * so nesting inside DemoScreen's scroll-view is safe.
 */
@Component({
  selector: 'app-tailwind-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ScreenHost must live on THIS routed host (not only on DemoScreen): the
  // app-tailwind-demo element is the real flex child of the app body, and it
  // arrives unstyled, so without flex-1 it collapses to content height. Then
  // DemoScreen's inner scroll-view resolves h-full against a content-sized
  // ancestor and, per Lynx's rule, expands to fit its content instead of
  // scrolling. Every DemoScreen consumer applies ScreenHost for this reason.
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiText,
    UiBadge,
    UiButton,
  ],
  // No styleUrl — every style here is a global Tailwind utility (styles.css is
  // injected via angular.json → source.preEntry at build time).
  template: `
    <app-demo-screen
      heading="Tailwind"
      category="Styling"
      description="Utility-first CSS running on Lynx. Named palette colors compile to rgb; the semantic tokens below (bg-card, bg-primary, …) power this very screen and switch with dark mode."
    >
      <!-- ── Colors ── -->
      <ui-card>
        <ui-card-header class="p-4 pb-2">
          <ui-card-title>Colors</ui-card-title>
          <ui-card-description>
            The named Tailwind palette, plus the theme's semantic tokens.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-4 p-4 pt-0 flex">
          <view class="flex-row flex-wrap gap-4 flex">
            @for (c of palette; track c.label) {
              <view class="flex-col items-center gap-1 flex">
                <view [class]="'h-16 w-16 rounded-xl ' + c.class"></view>
                <text class="text-xs text-muted-foreground">{{ c.label }}</text>
              </view>
            }
          </view>

          <view class="flex-col gap-2 pt-1 flex">
            <ui-text variant="small">Semantic tokens</ui-text>
            @for (t of tokens; track t.token) {
              <view class="flex-row items-center gap-3 flex">
                <view [class]="'h-9 w-9 rounded-md ' + t.box"></view>
                <ui-text variant="small">{{ t.name }}</ui-text>
                <view class="flex-1 flex"></view>
                <ui-badge variant="outline" [animated]="false">
                  {{ t.token }}
                </ui-badge>
              </view>
            }
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Typography ── -->
      <ui-card>
        <ui-card-header class="p-4 pb-2">
          <ui-card-title>Typography</ui-card-title>
          <ui-card-description>
            The type scale via ui-text variants.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-2 p-4 pt-0 flex">
          <ui-text variant="h3">Heading</ui-text>
          <ui-text variant="large">Large & semibold</ui-text>
          <ui-text variant="p">
            Paragraph body copy sits at the base size.
          </ui-text>
          <ui-text variant="small">Small label</ui-text>
          <ui-text variant="muted">Muted caption text</ui-text>
        </ui-card-content>
      </ui-card>

      <!-- ── Spacing ── -->
      <ui-card>
        <ui-card-header class="p-4 pb-2">
          <ui-card-title>Spacing</ui-card-title>
          <ui-card-description>
            Padding utilities — the muted frame grows around a fixed square.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content
          class="flex-row flex-wrap items-end gap-4 p-4 pt-0 flex"
        >
          @for (s of spacing; track s.label) {
            <view class="flex-col items-center gap-1 flex">
              <view [class]="'rounded-lg bg-muted ' + s.class">
                <view class="h-8 w-8 rounded bg-primary"></view>
              </view>
              <text class="text-xs text-muted-foreground">{{ s.label }}</text>
            </view>
          }
        </ui-card-content>
      </ui-card>

      <!-- ── Border radius ── -->
      <ui-card>
        <ui-card-header class="p-4 pb-2">
          <ui-card-title>Radius</ui-card-title>
          <ui-card-description>
            From sharp corners to a full pill.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content
          class="flex-row flex-wrap items-center gap-4 p-4 pt-0 flex"
        >
          @for (r of radii; track r.label) {
            <view class="flex-col items-center gap-1 flex">
              <view [class]="'h-14 w-14 bg-primary ' + r.class"></view>
              <text class="text-xs text-muted-foreground">{{ r.label }}</text>
            </view>
          }
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive ── -->
      <ui-card>
        <ui-card-header class="p-4 pb-2">
          <ui-card-title>Interactive</ui-card-title>
          <ui-card-description>
            Live signal state driving press-animated dolan buttons.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view class="items-center py-2 flex">
            <text class="text-5xl font-bold text-foreground">{{
              count()
            }}</text>
          </view>
          <view class="flex-row gap-2 flex">
            <ui-button variant="outline" class="flex-1" (pressed)="decrement()">
              Decrement
            </ui-button>
            <ui-button class="flex-1" (pressed)="increment()">
              Increment
            </ui-button>
          </view>
          <ui-button variant="ghost" (pressed)="resetCount()">Reset</ui-button>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class TailwindDemo {
  readonly count = signal(0);

  // Named colors compile to rgb on Lynx (unlike the opaque rgba() theme tokens),
  // so they render vividly and are safe to vary per item — see Swatch above.
  readonly palette: readonly Swatch[] = [
    { class: 'bg-rose-500', label: 'rose' },
    { class: 'bg-orange-500', label: 'orange' },
    { class: 'bg-amber-500', label: 'amber' },
    { class: 'bg-emerald-500', label: 'emerald' },
    { class: 'bg-sky-500', label: 'sky' },
    { class: 'bg-indigo-500', label: 'indigo' },
    { class: 'bg-violet-500', label: 'violet' },
    { class: 'bg-pink-500', label: 'pink' },
  ];

  // The light-gray tokens carry a border so they stay visible on the white card;
  // in dark mode the same tokens invert automatically.
  readonly tokens: readonly Token[] = [
    { box: 'bg-primary', name: 'Primary', token: 'bg-primary' },
    {
      box: 'bg-secondary border border-border',
      name: 'Secondary',
      token: 'bg-secondary',
    },
    { box: 'bg-muted border border-border', name: 'Muted', token: 'bg-muted' },
    { box: 'bg-destructive', name: 'Destructive', token: 'bg-destructive' },
  ];

  readonly radii: readonly Radius[] = [
    { class: 'rounded-none', label: 'none' },
    { class: 'rounded-md', label: 'md' },
    { class: 'rounded-lg', label: 'lg' },
    { class: 'rounded-xl', label: 'xl' },
    { class: 'rounded-full', label: 'full' },
  ];

  readonly spacing: readonly Spacing[] = [
    { class: 'p-2', label: 'p-2' },
    { class: 'p-4', label: 'p-4' },
    { class: 'p-6', label: 'p-6' },
    { class: 'p-8', label: 'p-8' },
  ];

  increment(): void {
    this.count.update((n) => n + 1);
  }

  decrement(): void {
    this.count.update((n) => n - 1);
  }

  resetCount(): void {
    this.count.set(0);
  }
}
