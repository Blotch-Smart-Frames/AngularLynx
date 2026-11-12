import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  FlingGesture,
  Gesture,
  LYNX_ELEMENTS,
  LynxGestureDetector,
  PanGesture,
} from '@blotch/angular-lynx';
import { fromToday, longDate } from '../sky/format';
import { OrreryState } from '../state/orrery-state';
import { BRUSHED_BRASS } from './materials';

/** The dial's radius and the band's width, in layout pixels. */
const R = 330;
const BAND = 28;
/** Two degrees of the dial to a day, so a week is a long tick every 14°. */
const DEGREES_PER_DAY = 2;
/** A pixel of drag turns the date by a day. */
const DAYS_PER_PIXEL = 1;
/** Running, the orrery turns this many days a second: Mercury laps in 2s. */
const RUN_DAYS_PER_SECOND = 45;
/** A Monday, so the long ticks fall on Mondays. */
const MONDAY = Date.UTC(2000, 0, 3);

/**
 * The date dial: a brass ring seen through a slot in the case, engraved
 * with a tick for every day and a long one every Monday. Drag it sideways
 * and time turns; fling it and it coasts. The index above it goes green
 * (verdigris) when the dial shows today. RUN sets the orrery turning by
 * itself; TODAY brings it back.
 */
@Component({
  selector: 'app-date-dial',
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
  host: { class: 'flex flex-col' },
  template: `
    <view
      class="relative overflow-hidden"
      style="height: 58px"
      [lynxGesture]="gesture"
      [consume-slide-event]="sideways"
      accessibility-element="true"
      accessibility-traits="adjustable"
      [accessibility-label]="'Date dial. ' + date()"
      accessibility-hint="Drag sideways to turn time"
    >
      <svg
        class="absolute"
        [style.left.px]="dialLeft()"
        style="top: 8px"
        [style.width.px]="size"
        [style.height.px]="size"
        [style.transform]="rotation()"
        style="transform-origin: 50% 50%"
        [attr.content]="ticks"
      ></svg>
      <!-- The index: fixed, over the dial's top. -->
      <svg
        class="absolute"
        [style.left.px]="width() / 2 - 7"
        style="top: 0; width: 14px; height: 14px"
        [attr.content]="state.isToday() ? indexToday : index"
      ></svg>
    </view>

    <view class="flex flex-row items-stretch px-3" style="height: 44px">
      <view
        class="brass mr-2 flex items-center justify-center"
        [style.background-image]="brass"
        style="width: 64px"
        (bindtap)="toggleRun()"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="
          running() ? 'Stop the orrery' : 'Run the orrery: time turns by itself'
        "
      >
        <text
          class="engraved font-engraved text-[10px] tracking-[1.5px] text-wax"
          >{{ running() ? 'STOP' : 'RUN' }}</text
        >
      </view>
      <view class="silver flex flex-1 flex-col items-center justify-center">
        <text
          class="engraved font-engraved text-[12px] tracking-[1px] text-wax"
          [text-maxline]="1"
          >{{ date() }}</text
        >
        <text class="engraved font-italic text-[10px] text-wax-soft">{{
          relative()
        }}</text>
      </view>
      <view
        class="brass ml-2 flex items-center justify-center"
        [style.background-image]="brass"
        style="width: 64px"
        [style.opacity]="state.isToday() ? 0.5 : 1"
        (bindtap)="today()"
        accessibility-element="true"
        accessibility-traits="button"
        accessibility-label="Back to today"
      >
        <text
          class="engraved font-engraved text-[10px] tracking-[1.5px] text-wax"
          >TODAY</text
        >
      </view>
    </view>
  `,
})
export class DateDial {
  protected readonly state = inject(OrreryState);
  /** The case's width: the dial centers on it. */
  readonly width = input(402);
  /** Idle motion allowed: RUN still works under Reduce Motion, as asked. */
  readonly motion = input(true);

  protected readonly brass = BRUSHED_BRASS;
  protected readonly size = (R + 6) * 2;
  protected readonly ticks = dialSvg();
  protected readonly index = indexSvg('#c49a4a', '#7a5a22');
  protected readonly indexToday = indexSvg('#5aa08d', '#2f5a4f');
  protected readonly running = signal(false);
  protected readonly sideways: [number, number][] = [
    [-45, 45],
    [135, 180],
    [-180, -135],
  ];

  protected readonly dialLeft = computed(
    () => this.width() / 2 - this.size / 2,
  );
  protected readonly rotation = computed(() => {
    const days = (this.state.time() - MONDAY) / 86_400_000;
    const degrees = -((days * DEGREES_PER_DAY) % 360);
    return `rotate(${degrees.toFixed(2)}deg)`;
  });
  protected readonly date = computed(() => longDate(this.state.time()));
  protected readonly relative = computed(() =>
    fromToday(this.state.offsetDays()),
  );

  #lastX = 0;
  readonly #pan = new PanGesture()
    .minDistance(2)
    .onStart(() => {
      this.#lastX = 0;
      this.running.set(false);
    })
    .onUpdate((event) => {
      const dx = event.translationX - this.#lastX;
      this.#lastX = event.translationX;
      // Dragging right turns the ring right, bringing earlier days under
      // the index, like a real dial; time goes the other way.
      this.state.turn(-dx * DAYS_PER_PIXEL);
    });
  readonly #fling = new FlingGesture().onUpdate((event) => {
    const dx = Number(event.params?.['deltaX'] ?? 0);
    if (dx) this.state.turn(-dx * DAYS_PER_PIXEL);
  });
  protected readonly gesture = Gesture.Simultaneous(this.#pan, this.#fling);

  #frame = 0;
  #last = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.#frame));
  }

  protected toggleRun(): void {
    if (this.running()) {
      this.#stop();
      return;
    }
    this.running.set(true);
    this.#last = 0;
    const step = (now: number) => {
      if (!this.running()) return;
      if (this.#last)
        this.state.turn(((now - this.#last) / 1000) * RUN_DAYS_PER_SECOND);
      this.#last = now;
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  protected today(): void {
    this.#stop();
    this.state.backToToday();
  }

  #stop(): void {
    this.running.set(false);
    cancelAnimationFrame(this.#frame);
  }
}

/**
 * The ring: a brass band with a tick a day, longer every seventh, between
 * two engraved rules. One drawing; turning it is a CSS rotation, so a drag
 * moves pixels, not SVG.
 */
const dialSvg = (): string => {
  const c = R + 6;
  const parts: string[] = [
    `<circle cx="${c}" cy="${c}" r="${R - BAND / 2}" fill="none" stroke="#b68b3e" stroke-width="${BAND}"/>`,
    `<circle cx="${c}" cy="${c}" r="${R - 1}" fill="none" stroke="#ecd08a" stroke-width="1"/>`,
    `<circle cx="${c}" cy="${c}" r="${R - BAND + 1}" fill="none" stroke="#6e4f1c" stroke-width="1"/>`,
    `<circle cx="${c}" cy="${c}" r="${R - 4}" fill="none" stroke="#3a2a10" stroke-width="0.6"/>`,
  ];
  const ticks = 360 / DEGREES_PER_DAY;
  for (let i = 0; i < ticks; i++) {
    const a = (i * DEGREES_PER_DAY * Math.PI) / 180;
    const long = i % 7 === 0;
    const inner = R - (long ? BAND - 4 : 13);
    const outer = R - 4;
    const [s, k] = [Math.sin(a), -Math.cos(a)];
    parts.push(
      `<line x1="${(c + s * inner).toFixed(2)}" y1="${(c + k * inner).toFixed(2)}" x2="${(c + s * outer).toFixed(2)}" y2="${(c + k * outer).toFixed(2)}" stroke="#2e2110" stroke-width="${long ? 1.4 : 0.8}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c * 2} ${c * 2}">${parts.join('')}</svg>`;
};

/**
 * The index: a small pointed fid over the dial's top.
 */
const indexSvg = (fill: string, edge: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><path d="M1 1 L13 1 L7 13 Z" fill="${fill}" stroke="${edge}" stroke-width="1"/></svg>`;
