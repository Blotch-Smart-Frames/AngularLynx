import { Component, computed, inject, input } from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import type { StampMotif } from '../data/types';

/*
 * The post's marks, drawn as SVG: the colors are written out here because
 * an SVG drawn from a string can't read the stylesheet's var() colors.
 * Each matches its token in styles.css.
 */
export const AIRMAIL_RED = 'rgba(200, 34, 48, 1)';
export const AIRMAIL_BLUE = 'rgba(31, 61, 140, 1)';
export const POSTMARK_INK = 'rgba(58, 50, 82, 1)';
const PAPER = 'rgba(250, 251, 252, 1)';

const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

/**
 * A stamp's perforated edge as one path, the half-circle bites cut into each
 * side as arcs: no mask, which not every SVG renderer draws.
 */
const perforatedEdge = (w: number, h: number): string => {
  const bite = 4.2;
  const step = 10;
  const arc = (x: number, y: number) => `A${bite} ${bite} 0 0 0 ${x} ${y}`;
  let edge = 'M0 0';
  for (let x = step / 2; x < w; x += step) {
    edge += `L${x - bite} 0${arc(x + bite, 0)}`;
  }
  edge += `L${w} 0`;
  for (let y = step / 2; y < h; y += step) {
    edge += `L${w} ${y - bite}${arc(w, y + bite)}`;
  }
  edge += `L${w} ${h}`;
  for (let x = w - step / 2; x > 0; x -= step) {
    edge += `L${x + bite} ${h}${arc(x - bite, h)}`;
  }
  edge += `L0 ${h}`;
  for (let y = h - step / 2; y > 0; y -= step) {
    edge += `L0 ${y + bite}${arc(0, y - bite)}`;
  }
  return `${edge}Z`;
};

/**
 * Each motif as white line work in a 40 by 40 box: the picture printed on
 * the contact's stamp, drawn once by hand for the app.
 */
const MOTIFS: Record<StampMotif, string> = {
  // A hill tram, its pole reaching for the wire.
  tram: 'M6 30h28v-14a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3z M9 17h6v6H9z M17 17h6v6h-6z M25 17h6v6h-6z M12 30v3 M28 30v3 M20 13l6-8 M2 5h36',
  // A kettle on the boil.
  kettle:
    'M9 32h22l-2-14a9 9 0 0 0-18 0z M20 9v-3 M16 6h8 M31 20l5-5 M29 18c4-3 6-2 7 0 M12 32l-1 3h18l-1-3',
  // A gull over the swell.
  gull: 'M5 16c4-5 9-5 15 1c6-6 11-6 15-1 M3 30c4-3 7-3 11 0s7 3 11 0s7-3 12 0 M3 35c4-3 7-3 11 0s7 3 11 0s7-3 12 0',
  // A sprig of fern.
  fern: 'M20 37V5 M20 10l-7-3 M20 10l7-3 M20 16l-9-4 M20 16l9-4 M20 22l-10-4 M20 22l10-4 M20 28l-9-3 M20 28l9-3',
  // A peak with snow on it.
  mountain:
    'M3 34l12-20 6 9 5-7 11 18z M15 14l-4 7 4-2 3 3z M26 16l-3 4 3-1 2 2z',
  // The reactions' pictures, in the same hand.
  // A heart.
  heart: 'M20 34C9 26 5 20 5 14a7 7 0 0 1 15-3 7 7 0 0 1 15 3c0 6-4 12-15 20z',
  // A sun, laughing.
  sun: 'M20 12a8 8 0 1 1 0 16 8 8 0 0 1 0-16z M20 3v4 M20 33v4 M3 20h4 M33 20h4 M8 8l3 3 M29 29l3 3 M8 32l3-3 M29 11l3-3 M16 22c2 2 6 2 8 0',
  // A tick, as a clerk marks a form.
  tick: 'M7 21l9 9L33 9',
  // A star burst, surprised.
  star: 'M20 4l4 11 11 1-9 7 3 11-9-6-9 6 3-11-9-7 11-1z',
  // A raindrop.
  drop: 'M20 5c6 9 11 15 11 21a11 11 0 0 1-22 0c0-6 5-12 11-21z',
  // A flower, for thanks.
  flower:
    'M20 16a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M20 16c-3-6 3-10 0-12-3 2 3 6 0 12z M24 20c6-3 10 3 12 0-2-3-6 3-12 0z M20 24c3 6-3 10 0 12 3-2-3-6 0-12z M16 20c-6 3-10-3-12 0 2 3 6-3 12 0z',
  // A lemon on its leaf.
  lemon:
    'M8 22c0-8 6-13 13-13s12 5 12 12-5 12-12 12S8 30 8 22z M30 12c3-4 6-5 8-5-1 4-4 6-8 5z',
};

/**
 * A postage stamp: the contact's color framing their motif, the
 * denomination in the corner, and the perforated edge a sheet of stamps is
 * torn from. It stands where another app shows an avatar.
 */
@Component({
  selector: 'app-stamp',
  imports: [LYNX_ELEMENTS],
  host: {
    class: 'relative',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size() * 1.2',
    'accessibility-element': 'false',
  },
  template: `
    <svg
      [style.width.px]="size()"
      [style.height.px]="size() * 1.2"
      [attr.content]="drawing()"
    ></svg>
    <text
      class="absolute font-postal text-paper"
      [style.font-size.px]="size() * 0.2"
      [style.right.px]="size() * 0.16"
      [style.top.px]="size() * 0.12"
      >{{ value() }}</text
    >
  `,
})
export class Stamp {
  readonly color = input.required<string>();
  readonly motif = input.required<StampMotif>();
  readonly value = input('');
  /** The stamp's width in layout pixels; it's 1.2 times as tall. */
  readonly size = input(44);

  protected readonly drawing = computed(() => {
    const w = 100;
    const h = 120;
    const edge = perforatedEdge(w, h);
    const color = this.color();
    const body =
      // The edge drawn in a faint line too, so the perforation shows on a
      // white envelope as well as on the blue paper.
      `<path d="${edge}" fill="${PAPER}" stroke="${POSTMARK_INK}" stroke-opacity="0.35" stroke-width="1.6"/>` +
      `<rect x="9" y="9" width="${w - 18}" height="${h - 18}" fill="${color}"/>` +
      `<g transform="translate(20 34) scale(1.5)" fill="none" stroke="${PAPER}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${MOTIFS[this.motif()]}"/></g>`;
    return svg(w, h, body).replace(
      `width="${w}" height="${h}" viewBox`,
      `width="${this.size()}" height="${this.size() * 1.2}" viewBox`,
    );
  });
}

/**
 * A postmark: the ring with the town along its top and the date or time in
 * the middle, and, unless `plain`, the wavy cancellation lines running off
 * to its right, as a post office strikes a stamp. Struck, it lands: from a
 * little larger, turned a few degrees, unless the phone asks for less
 * motion.
 */
@Component({
  selector: 'app-postmark',
  imports: [LYNX_ELEMENTS],
  host: {
    class: 'relative flex flex-row items-center',
    '[class.struck]': 'struck() && !reduceMotion()',
    '[style.transform]': '"rotate(" + tilt() + "deg)"',
    'accessibility-element': 'false',
  },
  styles: `
    @keyframes strike {
      0% {
        opacity: 0;
        transform: scale(1.35) rotate(-14deg);
      }
      70% {
        opacity: 1;
        transform: scale(0.96) rotate(-7deg);
      }
      100% {
        opacity: 1;
        transform: scale(1) rotate(-8deg);
      }
    }
    .struck {
      animation: strike 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
    }
  `,
  template: `
    <view
      class="relative flex flex-col items-center justify-center"
      [style.width.px]="size()"
      [style.height.px]="size()"
    >
      <svg
        class="absolute top-0 left-0"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [attr.content]="ring()"
      ></svg>
      <text
        class="font-postal tracking-[1px]"
        [style.color]="ink()"
        [style.font-size.px]="topSize()"
        >{{ top() }}</text
      >
      <text
        class="font-postal"
        [style.color]="ink()"
        [style.font-size.px]="size() * 0.24"
        [style.line-height.px]="size() * 0.26"
        >{{ middle() }}</text
      >
      @if (year()) {
        <text
          class="font-postal"
          [style.color]="ink()"
          [style.font-size.px]="size() * 0.15"
          >{{ year() }}</text
        >
      }
    </view>
    @if (!plain()) {
      <svg
        [style.width.px]="size() * 1.1"
        [style.height.px]="size() * 0.6"
        [attr.content]="waves()"
      ></svg>
    }
  `,
})
export class Postmark {
  /** The town around the ring's top, in caps. */
  readonly top = input('');
  /** The date or time in the middle. */
  readonly middle = input('');
  /** A line under it, smaller: the year, as a dated postmark has. */
  readonly year = input('');
  readonly size = input(52);
  /** No cancellation lines: a receipt mark beside a letter. */
  readonly plain = input(false);
  /** Lands with a strike when it appears. */
  readonly struck = input(false);
  /** The postmark's ink; READ marks are struck in airmail red. */
  readonly ink = input(POSTMARK_INK);
  /** How far it's turned, as a hand stamps it, never quite straight. */
  readonly tilt = input(-8);

  protected readonly reduceMotion = inject(LynxAccessibilitySettings)
    .reduceMotion;

  /** The town fits inside the ring: a long name is set smaller. */
  protected readonly topSize = computed(
    () => this.size() * Math.min(0.17, 1.15 / Math.max(1, this.top().length)),
  );

  protected readonly ring = computed(() => {
    const s = 100;
    return svg(
      s,
      s,
      `<circle cx="50" cy="50" r="46" fill="none" stroke="${this.ink()}" stroke-width="3.5"/><circle cx="50" cy="50" r="38" fill="none" stroke="${this.ink()}" stroke-width="1.5" opacity="0.6"/>`,
    ).replace(
      'width="100" height="100" viewBox',
      `width="${this.size()}" height="${this.size()}" viewBox`,
    );
  });

  protected readonly waves = computed(() => {
    const w = 110;
    const h = 60;
    let lines = '';
    for (let i = 0; i < 5; i++) {
      const y = 10 + i * 10;
      lines += `<path d="M0 ${y} q 9 -6 18 0 t 18 0 t 18 0 t 18 0 t 18 0 t 18 0" fill="none" stroke="${this.ink()}" stroke-width="2.4"/>`;
    }
    return svg(w, h, lines).replace(
      `width="${w}" height="${h}" viewBox`,
      `width="${this.size() * 1.1}" height="${this.size() * 0.6}" viewBox`,
    );
  });
}

/**
 * The airmail edge: red and blue parallelograms on white, slanting the same
 * way, as round an airmail envelope. `length` is how far it runs.
 */
@Component({
  selector: 'app-airmail-edge',
  imports: [LYNX_ELEMENTS],
  host: { 'accessibility-element': 'false' },
  template: `<svg
    [style.width.px]="length()"
    [style.height.px]="thickness()"
    [attr.content]="drawing()"
  ></svg>`,
})
export class AirmailEdge {
  readonly length = input(402);
  readonly thickness = input(6);

  protected readonly drawing = computed(() => {
    const t = this.thickness();
    const unit = t * 2.6;
    let bars = '';
    let i = 0;
    for (let x = -unit; x < this.length() + unit; x += unit, i++) {
      const color = i % 2 ? AIRMAIL_BLUE : AIRMAIL_RED;
      const w = unit * 0.62;
      bars += `<path d="M${x + t} 0h${w}l${-t} ${t}h${-w}z" fill="${color}"/>`;
    }
    return svg(this.length(), t, bars);
  });
}

/**
 * The stamps a letter can be marked with: each a stamp of its own, drawn in
 * the same hand as the contacts', in its own ink. Stored by `id`.
 */
export const REACTIONS = [
  { id: 'heart', label: 'Love', color: 'rgba(200, 34, 48, 1)' },
  { id: 'sun', label: 'Ha', color: 'rgba(196, 128, 22, 1)' },
  { id: 'tick', label: 'Yes', color: 'rgba(34, 102, 72, 1)' },
  { id: 'star', label: 'Wow', color: 'rgba(31, 61, 140, 1)' },
  { id: 'drop', label: 'Sad', color: 'rgba(72, 92, 128, 1)' },
  { id: 'flower', label: 'Thanks', color: 'rgba(122, 48, 92, 1)' },
] as const satisfies readonly {
  id: StampMotif;
  label: string;
  color: string;
}[];

export type Reaction = (typeof REACTIONS)[number];

export const reactionById = (id: string): Reaction | undefined =>
  REACTIONS.find((reaction) => reaction.id === id);
