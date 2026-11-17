import { httpResource } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  Renderer2,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxMainThreadEvent,
  LynxSystemInfo,
  type MainThread,
} from '@blotch/angular-lynx';
import { API, type Artwork, type RawArtwork, toDetail } from '../data/artwork';
import { Museum } from '../data/museum';
import { SavedWorks } from '../state/saved';
import { Press } from '../wall/press';
import { TopBar } from '../wall/top-bar';

type Point = { x: number; y: number };
type View = { s: number; x: number; y: number };

/** How far in the picture goes: five times the size it fits the screen at. */
const MAX_SCALE = 5;
/** Where a double tap or the + pane zooms to. */
const STEP_SCALE = 2.5;
/** How far a drag past the picture's edge moves it: a third, like iOS. */
const RUBBER = 0.35;
/** A tap moves less than this, in px, and lifts within TAP_MS. */
const TAP_SLOP = 12;
const TAP_MS = 300;
/**
 * Two taps make a double when the second lands this soon after the first
 * lifts, and this close to it: UIKit's own allowance, measured from the
 * first lift to the second touch, so a slow second press still counts.
 */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE = 44;
/** How long a fling coasts on, and the snap back to the edges takes. */
const COAST_MS = 620;
const SNAP_MS = 340;
/** CSS's ease-out-expo, which `ease()` follows to find a moving picture. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Slides in every direction, which the picture keeps while zoomed in. */
const EVERY_SLIDE: [number, number][] = [[-180, 180]];

/**
 * Where an ease-out-expo curve is, `p` of the way through its time. Close
 * enough to `EASE` to pick up a coasting picture where it is on screen.
 */
const ease = (p: number): number => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

/**
 * Stepping up to the glass: a work's picture filling the screen, to zoom
 * into with two fingers, pan with momentum and double-tap.
 *
 * The web picture shows at once (it's the one the work's screen showed);
 * the print-resolution one, 3,400 pixels across, loads over it and clears
 * in when it arrives.
 *
 * The gesture runs in main-thread scripts: they write the picture's
 * transform on every touch move without Angular running change detection.
 * Lynx recognizes no pinch, so the scripts read every finger from the touch
 * events (the build's `multiTouch` option turns Lynx's multi-touch on: see
 * angular.json). While the picture is zoomed in it keeps sideways slides for
 * itself (`consume-slide-event`), so panning doesn't swipe the screen away;
 * at its own size a swipe goes back, as anywhere else.
 */
@Component({
  selector: 'app-viewer',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent, Press, TopBar],
  host: { class: 'relative flex flex-1 flex-col bg-bar' },
  // The picture scales about its top left, which the gesture's sums take as
  // the origin. In a class, not the element's style: the gesture writes the
  // element's inline style on every move.
  styles: `
    .zoom-layer {
      transform-origin: 0% 0%;
    }
  `,
  template: `
    <view
      class="absolute top-0 right-0 bottom-0 left-0 overflow-hidden"
      [style.touch-action]="web ? 'none' : null"
      accessibility-element="true"
      [attr.accessibility-label]="label()"
      [consume-slide-event]="zoomed() ? everySlide : []"
      [mainThreadBindtouchstart]="touchDown"
      [mainThreadBindtouchmove]="touchMove"
      [mainThreadBindtouchend]="touchUp"
      [mainThreadBindtouchcancel]="touchUp"
      [mainThreadBindmousedown]="mouseDown"
      [mainThreadBindmousemove]="mouseMove"
      [mainThreadBindmouseup]="mouseUp"
    >
      <view
        #layer
        id="zoom-layer"
        class="zoom-layer absolute top-0 left-0 h-full w-full"
      >
        @if (work(); as work) {
          <image
            class="absolute top-0 left-0 h-full w-full"
            mode="aspectFit"
            [src]="work.image.url"
          />
          @if (work.print; as print) {
            <image
              class="absolute top-0 left-0 h-full w-full"
              mode="aspectFit"
              style="transition: opacity 400ms cubic-bezier(0.22, 1, 0.36, 1)"
              [style.opacity]="sharp() ? 1 : 0"
              [src]="print.url"
              (bindload)="sharp.set(true)"
            />
          }
        }
      </view>
    </view>

    <app-top-bar
      [title]="work()?.title ?? ''"
      back="Back"
      [backRoute]="'/' + tab"
    />

    <view class="absolute right-0 bottom-0 left-0 flex flex-col">
      <view class="glazing flex h-[64px] flex-row">
        <view class="glazing relative flex-1 overflow-hidden">
          <blur-view
            class="absolute top-0 right-0 bottom-0 left-0"
            blur-effect="light"
            blur-radius="18px"
          ></blur-view>
          <view
            class="frost absolute top-0 right-0 bottom-0 left-0 flex flex-col justify-center px-3"
          >
            <text
              class="text-[14px] leading-[18px] text-ellipsis text-ink"
              [text-maxline]="2"
              >{{ caption() }}</text
            >
          </view>
        </view>
        @for (step of steps; track step.label) {
          <view
            appPress
            class="glow glazing relative w-[70px] overflow-hidden"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="step.label"
            (bindtap)="stepZoom(step.factor)"
          >
            <blur-view
              class="absolute top-0 right-0 bottom-0 left-0"
              blur-effect="light"
              blur-radius="18px"
            ></blur-view>
            <view
              class="frost absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center"
            >
              <!-- A drawn minus and plus: one bar, or two crossed. -->
              <view class="h-[2px] w-[18px] bg-ink"></view>
              @if (step.factor > 1) {
                <view class="absolute h-[18px] w-[2px] bg-ink"></view>
              }
            </view>
          </view>
        }
      </view>
      <view class="pb-home bg-bar"></view>
    </view>
  `,
})
export class Viewer {
  /** The route's `:id`. */
  readonly id = input.required<string>();

  readonly #museum = inject(Museum);
  readonly #saved = inject(SavedWorks);
  readonly #renderer = inject(Renderer2);
  readonly #reduceMotion = inject(LynxAccessibilitySettings).reduceMotion;
  readonly layer = viewChild.required<ElementRef>('layer');

  /**
   * Whether this is Lynx for Web. It measures a touch's `x`/`y` from the
   * Lynx view, where native Lynx gives `pageX`/`pageY`. And its touch
   * listeners can't stop the browser pinch-zooming the page as well, so the
   * picture says `touch-action: none`, which native Lynx doesn't have (a
   * stylesheet rule for it is dropped from the iOS and Android bundles with
   * a build warning, so it's set here, on the web only).
   */
  protected readonly web =
    String(inject(LynxSystemInfo).platform).toLowerCase() === 'web';
  /** The tab this screen is in, where Back goes if there's nothing under it. */
  protected readonly tab =
    inject(ActivatedRoute).snapshot.pathFromRoot[1]?.routeConfig?.path ??
    'on-view';

  protected readonly everySlide = EVERY_SLIDE;
  protected readonly steps = [
    { label: 'Zoom out', factor: 1 / STEP_SCALE },
    { label: 'Zoom in', factor: STEP_SCALE },
  ];

  /** The record, only when a list or Saved didn't have the work. */
  readonly #record = httpResource(
    () =>
      this.#museum.known(Number(this.id())) ? undefined : `${API}${this.id()}`,
    { parse: (body) => toDetail((body as { data: RawArtwork }).data) },
  );
  protected readonly work = computed<Artwork | null>(() => {
    const id = Number(this.id());
    return (
      this.#museum.known(id) ??
      this.#saved.works().find((work) => work.id === id) ??
      (this.#record.hasValue() ? this.#record.value() : null)
    );
  });

  /** Whether the print-resolution picture has loaded over the web one. */
  protected readonly sharp = linkedSignal({
    source: () => this.work()?.print?.url,
    computation: () => false,
  });
  /** Whether the picture is bigger than the screen fits it. */
  protected readonly zoomed = signal(false);
  /** The zoom as a percentage, set as a gesture ends rather than per move. */
  protected readonly percent = signal(100);

  protected readonly label = computed(() => {
    const work = this.work();
    return work
      ? `${work.title}. Pinch or double-tap to zoom in.`
      : 'Loading the picture';
  });
  protected readonly caption = computed(() => {
    const print = this.work()?.print;
    if (this.zoomed()) return `${this.percent()}%. Double-tap to fit.`;
    if (print && !this.sharp()) return 'Loading the full picture…';
    if (print) {
      const width = String(print.width).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return `Full resolution, ${width} px. Pinch or double-tap to zoom.`;
    }
    return 'Pinch or double-tap to zoom.';
  });

  // The gesture's state. Everything below runs on the main thread, as the
  // rest of the app does; the scripts read it through `this`.
  #box = { w: 0, h: 0 };
  #view: View = { s: 1, x: 0, y: 0 };
  readonly #fingers = new Map<number, Point>();
  #pinch: { d: number; m: Point; from: View } | null = null;
  #pan: { p: Point; from: View } | null = null;
  /**
   * The gesture since the first finger landed: when, where, and whether it
   * has moved or had two fingers, which make it something other than a tap.
   */
  #gesture: { start: Point; time: number; moved: boolean } | null = null;
  #trail: { p: Point; t: number }[] = [];
  #lastTap: { p: Point; t: number } | null = null;
  #flight: { from: View; to: View; start: number; ms: number } | null = null;

  constructor() {
    // The viewer's size, which the gesture's limits are worked out from, with
    // ResizeObserver as on the web: AngularLynx gives it Lynx elements (the
    // browser's own in the web preview, which measures the app at its own
    // size even where the page scales it down).
    const host = inject(ElementRef).nativeElement;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        this.#box = { w: entry.contentRect.width, h: entry.contentRect.height };
      }
    });
    afterNextRender(() => observer.observe(host));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  // --- Touch -----------------------------------------------------------

  protected readonly touchDown = (event: MainThread.TouchEvent) => {
    'main thread';
    this.#land(event.currentTarget);
    if (this.#fingers.size === 0) this.#gesture = null;
    for (const touch of event.changedTouches) {
      this.#fingers.set(touch.identifier, this.#point(touch));
    }
    this.#grip();
  };

  protected readonly touchMove = (event: MainThread.TouchEvent) => {
    'main thread';
    for (const touch of event.changedTouches) {
      if (this.#fingers.has(touch.identifier)) {
        this.#fingers.set(touch.identifier, this.#point(touch));
      }
    }
    this.#follow(event.currentTarget);
  };

  protected readonly touchUp = (event: MainThread.TouchEvent) => {
    'main thread';
    // A batch can reach this handler twice (once per element the fingers
    // started on); the second finds them gone already, and does nothing.
    let lifted = false;
    for (const touch of event.changedTouches) {
      lifted = this.#fingers.delete(touch.identifier) || lifted;
    }
    if (!lifted) return;
    if (this.#fingers.size > 0) this.#grip();
    else this.#release(event.currentTarget);
  };

  // --- Mouse (the web preview on a computer, which sends no touches) ----

  protected readonly mouseDown = (event: MainThread.MouseEvent) => {
    'main thread';
    this.#land(event.currentTarget);
    this.#gesture = null;
    this.#fingers.set(-1, { x: event.x, y: event.y });
    this.#grip();
  };

  protected readonly mouseMove = (event: MainThread.MouseEvent) => {
    'main thread';
    if (!this.#fingers.has(-1)) return;
    this.#fingers.set(-1, { x: event.x, y: event.y });
    this.#follow(event.currentTarget);
  };

  protected readonly mouseUp = (event: MainThread.MouseEvent) => {
    'main thread';
    if (!this.#fingers.delete(-1)) return;
    this.#release(event.currentTarget);
  };

  // --- The gesture -------------------------------------------------------

  /**
   * A touch's position in the viewer, the same way on every platform.
   */
  #point(touch: { x: number; y: number; pageX: number; pageY: number }): Point {
    return this.web
      ? { x: touch.x, y: touch.y }
      : { x: touch.pageX, y: touch.pageY };
  }

  /**
   * A finger landed: a coasting picture stops where it is on screen, so
   * it's caught rather than jumping to where it was going.
   */
  #land(area: MainThread.Element): void {
    const flight = this.#flight;
    if (!flight) return;
    this.#flight = null;
    const p = ease((Date.now() - flight.start) / flight.ms);
    this.#view = {
      s: flight.from.s + (flight.to.s - flight.from.s) * p,
      x: flight.from.x + (flight.to.x - flight.from.x) * p,
      y: flight.from.y + (flight.to.y - flight.from.y) * p,
    };
    this.#write(area, 0);
  }

  /**
   * The fingers changed: two start a pinch from where the picture is, one
   * a pan. Starting again on each change keeps the picture under the
   * fingers as one lifts or another lands.
   */
  #grip(): void {
    const [a, b] = [...this.#fingers.values()];
    this.#pinch = null;
    this.#pan = null;
    if (a && !this.#gesture) {
      this.#gesture = { start: a, time: Date.now(), moved: false };
    }
    if (b && this.#gesture) this.#gesture.moved = true;
    if (a && b) {
      this.#pinch = {
        d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        from: { ...this.#view },
      };
    } else if (a) {
      this.#pan = { p: a, from: { ...this.#view } };
      this.#trail = [{ p: a, t: Date.now() }];
    }
  }

  #follow(area: MainThread.Element): void {
    const [a, b] = [...this.#fingers.values()];
    const pinch = this.#pinch;
    const pan = this.#pan;
    if (pinch && a && b) {
      // The point of the picture under the fingers' midpoint stays under it
      // as they spread and move: with the transform's origin at the top
      // left, a picture point p is on screen at view + s·p.
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const raw = (pinch.from.s * d) / pinch.d;
      // Past the limits the zoom gives way slowly, and springs back on release.
      const s =
        raw > MAX_SCALE
          ? MAX_SCALE + (raw - MAX_SCALE) * RUBBER
          : raw < 1
            ? 1 - (1 - raw) * RUBBER
            : raw;
      const px = (pinch.m.x - pinch.from.x) / pinch.from.s;
      const py = (pinch.m.y - pinch.from.y) / pinch.from.s;
      this.#view = { s, x: m.x - s * px, y: m.y - s * py };
      this.#write(area, 0);
    } else if (pan && a) {
      const gesture = this.#gesture;
      if (
        gesture &&
        Math.hypot(a.x - gesture.start.x, a.y - gesture.start.y) > TAP_SLOP
      ) {
        gesture.moved = true;
      }
      if (this.#view.s <= 1.001) return;
      const x = pan.from.x + a.x - pan.p.x;
      const y = pan.from.y + a.y - pan.p.y;
      const bounds = this.#bounds(this.#view.s);
      this.#view = {
        s: this.#view.s,
        x: rubber(x, bounds.minX, bounds.maxX),
        y: rubber(y, bounds.minY, bounds.maxY),
      };
      const now = Date.now();
      this.#trail.push({ p: a, t: now });
      while (this.#trail.length > 2 && now - this.#trail[0]!.t > 90) {
        this.#trail.shift();
      }
      this.#write(area, 0);
    }
  }

  /**
   * The last finger lifted: a tap, a fling, or a settle into bounds.
   */
  #release(area: MainThread.Element): void {
    const pan = this.#pan;
    const gesture = this.#gesture;
    this.#pinch = null;
    this.#pan = null;
    this.#gesture = null;
    const now = Date.now();
    if (gesture && !gesture.moved && now - gesture.time < TAP_MS) {
      const at = gesture.start;
      const last = this.#lastTap;
      if (
        last &&
        gesture.time - last.t < DOUBLE_TAP_MS &&
        Math.hypot(at.x - last.p.x, at.y - last.p.y) < DOUBLE_TAP_DISTANCE
      ) {
        this.#lastTap = null;
        this.#zoomTo(area, this.#view.s > 1.05 ? 1 : STEP_SCALE, at);
        return;
      }
      this.#lastTap = { p: at, t: now };
      return;
    }
    // A fling: coast on at the finger's speed, slowing to a stop inside the
    // picture's edges.
    let target: View = { ...this.#view };
    const first = this.#trail[0];
    const last = this.#trail.at(-1);
    if (pan && first && last && last.t > first.t && this.#view.s > 1.001) {
      const dt = last.t - first.t;
      const vx = (last.p.x - first.p.x) / dt;
      const vy = (last.p.y - first.p.y) / dt;
      if (Math.hypot(vx, vy) > 0.25) {
        target = { ...target, x: target.x + vx * 240, y: target.y + vy * 240 };
      }
    }
    this.#trail = [];
    this.#settle(area, target, target === this.#view ? SNAP_MS : COAST_MS);
  }

  /**
   * Zooms to `scale` with the picture point under `at` staying there.
   */
  #zoomTo(area: MainThread.Element | null, scale: number, at: Point): void {
    const s = Math.min(MAX_SCALE, Math.max(1, scale));
    const px = (at.x - this.#view.x) / this.#view.s;
    const py = (at.y - this.#view.y) / this.#view.s;
    this.#settle(area, { s, x: at.x - s * px, y: at.y - s * py }, SNAP_MS);
  }

  /**
   * Moves the picture to `target`, inside its limits and edges, over `ms`.
   */
  #settle(area: MainThread.Element | null, target: View, ms: number): void {
    const s = Math.min(MAX_SCALE, Math.max(1, target.s));
    // A pinch that ended past a limit zooms about the screen's middle.
    const scaled =
      s === target.s
        ? target
        : {
            s,
            x: this.#box.w / 2 - (s * (this.#box.w / 2 - target.x)) / target.s,
            y: this.#box.h / 2 - (s * (this.#box.h / 2 - target.y)) / target.s,
          };
    const bounds = this.#bounds(s);
    const to = {
      s,
      x: Math.min(bounds.maxX, Math.max(bounds.minX, scaled.x)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, scaled.y)),
    };
    const from = { ...this.#view };
    this.#view = to;
    const animate = !this.#reduceMotion();
    this.#flight = animate ? { from, to, start: Date.now(), ms } : null;
    this.#write(area, animate ? ms : 0);
    this.#zoomChanged();
  }

  /**
   * The furthest the picture can move at scale `s`: its edges stay at or
   * past the screen's, and a picture narrower than the screen stays centered.
   */
  #bounds(s: number): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const fit = this.#fit();
    const span = (screen: number, start: number, size: number) => {
      if (size * s <= screen) {
        const centered = (screen - size * s) / 2 - s * start;
        return [centered, centered] as const;
      }
      return [screen - s * (start + size), -s * start] as const;
    };
    const [minX, maxX] = span(this.#box.w, fit.x, fit.w);
    const [minY, maxY] = span(this.#box.h, fit.y, fit.h);
    return { minX, maxX, minY, maxY };
  }

  /**
   * Where the picture sits at its own size, fitted to the screen.
   */
  #fit(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.#box;
    const image = this.work()?.image;
    if (!image || !w || !h) return { x: 0, y: 0, w, h };
    const ratio = image.width / image.height;
    if (ratio > w / h) {
      const fh = w / ratio;
      return { x: 0, y: (h - fh) / 2, w, h: fh };
    }
    const fw = h * ratio;
    return { x: (w - fw) / 2, y: 0, w: fw, h };
  }

  /**
   * Writes the picture's transform, moving over `ms`, or at once.
   */
  #write(area: MainThread.Element | null, ms: number): void {
    const { s, x, y } = this.#view;
    const transform = `translate(${round(x)}px, ${round(y)}px) scale(${round(s, 1000)})`;
    const transition = ms > 0 ? `transform ${ms}ms ${EASE}` : 'none';
    const layer = area?.querySelector('#zoom-layer');
    if (layer) {
      layer.setStyleProperties({ transition, transform });
    } else {
      // From a pane's tap, which has no main-thread element in hand.
      const element = this.layer().nativeElement;
      this.#renderer.setStyle(element, 'transition', transition);
      this.#renderer.setStyle(element, 'transform', transform);
    }
  }

  /**
   * Tells the template, which changes only as a gesture ends.
   */
  #zoomChanged(): void {
    const zoomed = this.#view.s > 1.001;
    if (zoomed !== this.zoomed()) this.zoomed.set(zoomed);
    this.percent.set(Math.round(this.#view.s * 100));
  }

  /**
   * The − and + panes: a step out or in about the screen's middle.
   */
  protected stepZoom(factor: number): void {
    this.#flight = null;
    const s = this.#view.s;
    const target = factor > 1 ? Math.max(STEP_SCALE, s * 2) : s / 2;
    this.#zoomTo(null, target, { x: this.#box.w / 2, y: this.#box.h / 2 });
  }
}

/**
 * A move past `min`..`max` goes a third as far, like iOS's edges.
 */
const rubber = (value: number, min: number, max: number): number =>
  value < min
    ? min - (min - value) * RUBBER
    : value > max
      ? max + (value - max) * RUBBER
      : value;

const round = (value: number, precision = 100): number =>
  Math.round(value * precision) / precision;
