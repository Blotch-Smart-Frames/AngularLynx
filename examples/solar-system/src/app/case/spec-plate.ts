import { Component, computed, inject } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { BODIES, type Body } from '../sky/bodies';
import {
  AU_LIGHT_MINUTES,
  distance,
  distanceFromEarth,
} from '../sky/ephemeris';
import { fixed, grouped } from '../sky/format';
import { OrreryState } from '../state/orrery-state';
import { BRUSHED_BRASS } from './materials';

/**
 * The specification plate, flown in to a body: its name and figures
 * engraved on silver, with where it is on the date the dial shows. Two
 * brass keys step to its neighbors, in order from the Sun.
 */
@Component({
  selector: 'app-spec-plate',
  imports: [LYNX_ELEMENTS],
  host: { class: 'flex flex-col px-3' },
  template: `
    @if (state.body(); as body) {
      <view class="silver flex flex-col px-3 pt-2 pb-2.5">
        <view class="flex flex-row items-center justify-between">
          <text
            class="engraved font-display text-[26px] leading-[30px] tracking-[3px] text-wax"
            >{{ upper(body.name) }}</text
          >
          <view class="flex flex-row">
            <view
              class="brass flex items-center justify-center"
              [style.background-image]="brass"
              style="width: 40px; height: 30px"
              (bindtap)="state.step(-1)"
              accessibility-element="true"
              accessibility-traits="button"
              [accessibility-label]="'Fly to ' + previous().name"
            >
              <svg
                style="width: 10px; height: 12px"
                [attr.content]="arrows.left"
              ></svg>
            </view>
            <view
              class="brass ml-1.5 flex items-center justify-center"
              [style.background-image]="brass"
              style="width: 40px; height: 30px"
              (bindtap)="state.step(1)"
              accessibility-element="true"
              accessibility-traits="button"
              [accessibility-label]="'Fly to ' + next().name"
            >
              <svg
                style="width: 10px; height: 12px"
                [attr.content]="arrows.right"
              ></svg>
            </view>
          </view>
        </view>
        <text
          class="engraved mt-1 font-italic text-[11px] leading-[15px] text-wax-soft"
          [text-maxline]="2"
          >{{ body.kind }}. {{ body.note }}</text
        >
        <view class="rule mt-2"></view>
        @for (row of figures(); track $index) {
          <view class="flex flex-row pt-1.5">
            @for (figure of row; track figure.label) {
              <view class="flex flex-1 flex-col">
                <text
                  class="engraved font-engraved text-[8px] tracking-[1.2px] text-wax-soft"
                  >{{ figure.label }}</text
                >
                <text
                  class="engraved font-engraved text-[12px] leading-[16px] text-wax"
                  [text-maxline]="1"
                  >{{ figure.value }}</text
                >
              </view>
            }
          </view>
        }
      </view>
    }
  `,
  styles: [
    `
      .rule {
        height: 1px;
        background-color: var(--silver-shade);
      }
    `,
  ],
})
export class SpecPlate {
  protected readonly state = inject(OrreryState);

  protected readonly brass = BRUSHED_BRASS;
  protected readonly arrows = {
    left: arrow('M9 1 L2 6 L9 11'),
    right: arrow('M1 1 L8 6 L1 11'),
  };
  protected readonly previous = computed(() => this.#neighbor(-1));
  protected readonly next = computed(() => this.#neighbor(1));

  /** Three rows of three: what it is, how it moves, where it is today. */
  protected readonly figures = computed(() => {
    const body = this.state.body();
    if (!body) return [];
    const time = this.state.time();
    const rows: { label: string; value: string }[][] = [
      [
        { label: 'DIAMETER', value: `${grouped(body.diameterKm)} km` },
        { label: 'GRAVITY', value: `${fixed(body.gravity, 1)} m/s²` },
        {
          label: body.id === 'sun' ? 'SURFACE' : 'MEAN TEMP.',
          value: body.id === 'sun' ? '5,500 °C' : body.temperature,
        },
      ],
      [
        { label: 'DAY', value: body.day },
        {
          label: body.id === 'sun' ? 'PLANETS' : 'YEAR',
          value: body.id === 'sun' ? '8' : body.year,
        },
        {
          label: body.id === 'sun' ? 'AGE' : 'MOONS',
          value: body.id === 'sun' ? '4.6 bn years' : body.moons,
        },
      ],
    ];
    if (body.id === 'sun') {
      const earth = distance('earth', time);
      rows.push([
        { label: 'FROM EARTH', value: `${fixed(earth, 3)} au` },
        {
          label: 'LIGHT TAKES',
          value: `${fixed(earth * AU_LIGHT_MINUTES, 1)} min`,
        },
        { label: 'MASS', value: '333,000 Earths' },
      ]);
    } else {
      const fromSun = distance(body.id, time);
      const fromEarth = distanceFromEarth(body.id, time);
      rows.push([
        { label: 'FROM THE SUN', value: `${fixed(fromSun, 2)} au` },
        {
          label: 'FROM EARTH',
          value: body.id === 'earth' ? '—' : `${fixed(fromEarth, 2)} au`,
        },
        {
          label: 'SUNLIGHT TAKES',
          value: lightTime(fromSun * AU_LIGHT_MINUTES),
        },
      ]);
    }
    return rows;
  });

  protected upper(text: string): string {
    return text.toUpperCase();
  }

  #neighbor(by: 1 | -1): Body {
    const id = this.state.focus();
    const index = BODIES.findIndex((body) => body.id === id);
    return BODIES[(index + by + BODIES.length) % BODIES.length]!;
  }
}

/**
 * Minutes of light as "8.3 min" or "4 h 10 min".
 */
const lightTime = (minutes: number): string => {
  if (minutes < 60) return `${fixed(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${Math.round(minutes - hours * 60)} min`;
};

/**
 * A key's chevron, engraved: a stroke, not a glyph from the font.
 */
const arrow = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12"><path d="${path}" fill="none" stroke="#141210" stroke-width="1.6" stroke-linejoin="miter"/></svg>`;
