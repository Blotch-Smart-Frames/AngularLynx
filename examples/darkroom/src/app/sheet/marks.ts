import { Component, computed, inject, input } from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

/** The china marker's red, the one color the sheet's marks are made in. */
export const MARKER = 'rgba(216, 40, 47, 1)';

/**
 * A ring drawn round a frame with a china marker, as an SVG path: an ellipse
 * that wobbles a little and overshoots where it started, the way a hand
 * closes a loop. `seed` changes the wobble, so no two rings match.
 */
export const ringPath = (width: number, height: number, seed = 1): string => {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2 - 3;
  const ry = height / 2 - 3;
  const points: string[] = [];
  // From a little past the top-left, round once and on for a tenth more.
  const start = -2.2 + (seed % 5) * 0.11;
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * Math.PI * 2.12;
    const wobble =
      1 + 0.035 * Math.sin(t * 3 + seed) + 0.02 * Math.cos(t * 5 + seed * 2);
    // The loop drifts outward as it goes round, so the ends don't meet.
    const drift = 1 + (i / steps) * 0.05;
    const x = cx + Math.cos(t) * rx * wobble * drift - (i / steps) * 2;
    const y = cy + Math.sin(t) * ry * wobble * drift;
    points.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
};

/**
 * The marker ring, as an element over what it marks: `position: absolute`
 * on its host, sized by the caller. It's drawn when it appears (scaling in,
 * turning a little, fading up), unless the phone asks for less motion.
 */
@Component({
  selector: 'app-ring',
  imports: [LYNX_ELEMENTS],
  host: {
    class: 'absolute',
    '[class.ring-in]': '!reduceMotion()',
    '[style.width.px]': 'width()',
    '[style.height.px]': 'height()',
  },
  styles: `
    @keyframes ring-in {
      from {
        opacity: 0;
        transform: scale(1.15) rotate(-6deg);
      }
      to {
        opacity: 1;
        transform: scale(1) rotate(0deg);
      }
    }
    .ring-in {
      animation: ring-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
    }
  `,
  template: `<svg
    [style.width.px]="width()"
    [style.height.px]="height()"
    [attr.content]="svg()"
  ></svg>`,
})
export class MarkerRing {
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  readonly seed = input(1);
  /** Thicker for the big marks, like a marker pressed harder. */
  readonly stroke = input(2.5);

  protected readonly reduceMotion = inject(LynxAccessibilitySettings)
    .reduceMotion;

  protected readonly svg = computed(() => {
    const width = this.width();
    const height = this.height();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${ringPath(width, height, this.seed())}" fill="none" stroke="${MARKER}" stroke-width="${this.stroke()}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  });
}

/**
 * A strip's sprocket holes: a row of small rounded holes punched in the film
 * at the film's own pitch. Purely the film's look, so hidden from
 * accessibility.
 */
@Component({
  selector: 'app-sprockets',
  imports: [LYNX_ELEMENTS],
  host: {
    class: 'flex flex-row items-center',
    'accessibility-element': 'false',
  },
  template: `
    @for (hole of holes(); track hole) {
      <view
        class="shrink-0 rounded-[1.5px] bg-film-hole"
        style="width: 7px; height: 5px; margin-right: 7px"
      ></view>
    }
  `,
})
export class Sprockets {
  /** How many holes: enough to run the strip's length. */
  readonly count = input(40);
  protected readonly holes = computed(() =>
    Array.from({ length: this.count() }, (_, index) => index),
  );
}

/**
 * The marker's tick beside a frame that's been worked on.
 */
@Component({
  selector: 'app-tick',
  imports: [LYNX_ELEMENTS],
  host: { 'accessibility-element': 'false' },
  template: `<svg style="width: 11px; height: 9px" [attr.content]="svg"></svg>`,
})
export class MarkerTick {
  protected readonly svg = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="9" viewBox="0 0 11 9"><path d="M1.2 4.8 L4 7.6 L9.8 1.2" fill="none" stroke="${MARKER}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** The edge print's gray, for marks the film carries rather than the marker. */
const EDGE = 'rgba(176, 173, 166, 1)';

/**
 * The arrow a film prints along its edge beside each frame number, pointing
 * the way the film winds. Drawn, so it's the same on every platform.
 */
@Component({
  selector: 'app-edge-arrow',
  imports: [LYNX_ELEMENTS],
  host: { 'accessibility-element': 'false' },
  template: `<svg style="width: 6px; height: 7px" [attr.content]="svg"></svg>`,
})
export class EdgeArrow {
  protected readonly svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="7" viewBox="0 0 6 7"><path d="M0 0 L6 3.5 L0 7 Z" fill="${EDGE}"/></svg>`;
}
