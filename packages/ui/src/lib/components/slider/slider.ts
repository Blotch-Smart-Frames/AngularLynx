import {
  type ElementRef,
  Component,
  Injector,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { type FormValueControl } from '@angular/forms/signals';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
  MainThreadElement,
} from '@blotch/angular-lynx';

import { DURATION, EASING } from '../../utils/animate';
import { cn } from '../../utils/cn';
import { UiGlass } from '../glass/glass';
import {
  type GlassDesign,
  injectGlassDesign,
  injectSystemDrawsGlass,
} from '../glass/glass-design';
import { injectColorScheme } from '../icon/icon-theme';

/**
 * `'default'` is a flat slider in the theme's colors on every platform.
 * `'glass'` takes each platform's own: iOS 26's, whose thumb turns into a
 * Liquid Glass lens while it's dragged; iOS 15 to 25's; and Material 3
 * Expressive's on Android (see GlassDesign).
 */
export type SliderVariant = 'default' | 'glass';

/** What the slider draws: the default look, or a platform's design. */
type SliderLook = 'default' | GlassDesign;

/** A slider's sizes in one look, in px. */
type SliderGeometry = {
  /** The control's height, which is also where it takes touches. */
  readonly height: number;
  /** The track's thickness. */
  readonly track: number;
  /** The thumb's size at rest. */
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  /** Its size while it's held: the glass lens, or Material's thin handle. */
  readonly pressedWidth: number;
  readonly pressedHeight: number;
};

/**
 * The sizes of each look:
 *
 * - `default`: a 20px round thumb on an 8px track.
 * - `glass`: iOS 26's UISlider, measured on the iOS 27 Simulator: 34pt
 *   tall, a 6pt track and a 37 by 24pt capsule thumb, which grows to a 59 by
 *   38pt glass lens (1.6 times) while it's held.
 * - `frosted`: UISlider from iOS 13 to 25: 31pt tall, a 4pt track and a 28pt
 *   round thumb that doesn't change when it's held.
 * - `material`: Material 3 Expressive's slider: a 16dp track and a 4 by 44dp
 *   bar for a handle, which narrows to 2dp while it's held.
 *
 * Every size is in px, not rem: Lynx's rem is 14px, so the thumb's offset,
 * which is in px, would drift from a rem-sized track (see the switch).
 */
const SLIDER_GEOMETRY: Readonly<Record<SliderLook, SliderGeometry>> = {
  default: {
    height: 20,
    track: 8,
    thumbWidth: 20,
    thumbHeight: 20,
    pressedWidth: 20,
    pressedHeight: 20,
  },
  glass: {
    height: 34,
    track: 6,
    thumbWidth: 37,
    thumbHeight: 24,
    pressedWidth: 59,
    pressedHeight: 38,
  },
  frosted: {
    height: 31,
    track: 4,
    thumbWidth: 28,
    thumbHeight: 28,
    pressedWidth: 28,
    pressedHeight: 28,
  },
  material: {
    height: 44,
    track: 16,
    thumbWidth: 4,
    thumbHeight: 44,
    pressedWidth: 2,
    pressedHeight: 44,
  },
};

/** How much smaller than the thumb the hidden lens is, on each side. */
const LENS_INSET = 2;

/** The gap Material 3 Expressive leaves between its handle and the track. */
const MATERIAL_GAP = 6;

/** Material's stop indicator: a dot at the end of the inactive track. */
const MATERIAL_STOP = 4;

/**
 * iOS's colors, in the app's color scheme as UIKit draws them in the
 * phone's. The filled part is the system tint UISlider takes by default,
 * the blue measured on the iOS 27 Simulator for iOS 26 and the older system
 * blue before it. The rest of the track is translucent, so it sits on any
 * background.
 */
const IOS_COLORS = {
  glass: {
    light: { fill: '#0088ff', track: 'rgba(0, 0, 0, 0.1)' },
    dark: { fill: '#0091ff', track: 'rgba(255, 255, 255, 0.1)' },
  },
  frosted: {
    light: { fill: '#007aff', track: 'rgba(120, 120, 128, 0.2)' },
    dark: { fill: '#0a84ff', track: 'rgba(120, 120, 128, 0.36)' },
  },
} as const;

/**
 * The shadows under iOS's white thumbs. Inline styles, because Tailwind's
 * shadow classes draw nothing on Lynx.
 */
const IOS_THUMB_SHADOW = {
  glass: '0 4px 12px rgba(0, 0, 0, 0.12), 0 0.5px 2px rgba(0, 0, 0, 0.12)',
  frosted: '0 6px 13px rgba(0, 0, 0, 0.12), 0 0.5px 4px rgba(0, 0, 0, 0.12)',
} as const;

/**
 * How far a finger moves before a press becomes a drag, in px. Below it, a
 * press is a tap or the start of a scroll, and the value stays put.
 */
const DRAG_SLOP = 6;

/** How far outside the thumb a press still picks it up, in px. */
const GRAB_SLOP = 10;

/**
 * A CSS transition of each property, for an inline `transition`.
 */
const transitionOf = (
  properties: readonly string[],
  duration: number,
  easing: string,
): string =>
  properties
    .map((property) => `${property} ${duration}ms ${easing}`)
    .join(', ');

/**
 * The thumb glides to a value set by a tap, an accessibility action or a
 * binding, and the track's parts glide with it. While it's dragged, they
 * follow the finger at once.
 */
const THUMB_GLIDE = transitionOf(
  ['transform'],
  DURATION.normal,
  EASING.decelerate,
);
const FILL_GLIDE = transitionOf(['width'], DURATION.normal, EASING.decelerate);
const TRACK_GLIDE = transitionOf(
  ['left', 'width'],
  DURATION.normal,
  EASING.decelerate,
);

/**
 * The thumb's change of size and opacity as it's picked up and let go.
 * Lynx can't animate a corner radius, but a capsule's is half its height
 * at any size (`rounded-full`), so it stays a capsule as it grows.
 */
const MORPH = transitionOf(
  ['left', 'top', 'width', 'height', 'opacity'],
  DURATION.fast,
  EASING.standard,
);

/** The names of the accessibility actions, which screen readers say. */
const INCREASE = 'Increase';
const DECREASE = 'Decrease';

/** Where a touch or the mouse is, in what Lynx sends with its events. */
type PointerEvent = {
  readonly touches?: readonly { readonly x?: number; readonly y?: number }[];
  readonly x?: number;
  readonly y?: number;
};

/** What Lynx's `layoutchange` sends, as far as the slider reads it. */
type LayoutEvent = {
  readonly detail?: { readonly width?: number };
  readonly params?: { readonly width?: number };
};

/**
 * The position of a touch, or of the mouse on the web. A desktop browser
 * sends no touch events for a mouse, so the slider listens for both.
 */
const pointOf = (event: PointerEvent): { x: number; y: number } | null => {
  const source = event.touches?.[0] ?? event;
  return typeof source.x === 'number' && typeof source.y === 'number'
    ? { x: source.x, y: source.y }
    : null;
};

/**
 * The platform, as SystemInfo names it, or undefined where there's no
 * SystemInfo to read, such as in unit tests, where LynxSystemInfo throws.
 */
const platformOf = (injector: Injector): string | undefined => {
  try {
    return injector.get(LynxSystemInfo).platform;
  } catch {
    return undefined;
  }
};

/**
 * The decimals of a step, to round away floating-point drift.
 */
const decimalsOf = (step: number): number => {
  const [, decimals = ''] = String(step).split('.');
  return decimals.length;
};

/**
 * A length in px, for a style object.
 */
const px = (value: number): string => `${value}px`;

/**
 * A press in progress: where it started, and whether it has become a drag.
 */
type Press = {
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  /** It moved sideways past DRAG_SLOP, so the thumb follows it. */
  dragging: boolean;
  /** It moved up or down first: a scroll, which the slider leaves alone. */
  scrolling: boolean;
  /**
   * Where the finger is on the thumb, from its center, so the thumb doesn't
   * jump when it's picked up. Null until the press's place in the slider is
   * known, and 0 for a press beside the thumb, which pulls it under the
   * finger.
   */
  grab: number | null;
  /** It landed on the thumb (or within GRAB_SLOP of it). */
  onThumb: boolean;
};

/**
 * A slider for picking a number in a range, such as a volume or a
 * brightness:
 *
 * ```html
 * <ui-slider [(value)]="volume" accessibility-label="Volume" />
 * <ui-slider variant="glass" [min]="0" [max]="1" [step]="0.05" [(value)]="brightness" />
 * ```
 *
 * Drag the thumb, or tap the track to move it there. A drag only starts
 * once the finger moves sideways, so a scroll that starts on the slider
 * scrolls and leaves the value alone.
 *
 * `value` is a `model()`, so it works with `[(value)]`, with Signal Forms'
 * `[formField]` (it implements FormValueControl) and, since Angular 22, with
 * reactive forms' `[formControl]` and `formControlName` and with
 * `[(ngModel)]`.
 *
 * Screen readers find it as an adjustable element with its label and value,
 * and its Increase and Decrease actions move it by a tenth of its range, or
 * one step when there are fewer.
 */
@Component({
  selector: 'ui-slider',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  // Only the root takes touches: everything inside it ignores them, so a
  // touch's `x` on iOS and Android is relative to the slider, wherever the
  // finger lands (Lynx gives `x` relative to the element touched).
  //
  // Mouse events are bound beside the touch events because a desktop
  // browser never sends touches for a mouse (see the bottom sheet). There's
  // no mouseleave: Chrome doesn't deliver it to Lynx for Web, so a move with
  // no button held ends the drag instead.
  //
  // The lens (iOS 26's glass) sits under the solid thumb, the same size,
  // so it's hidden until the thumb is picked up: then the thumb fades as
  // the lens grows. The lens is always there rather than added on press,
  // since iOS's glass pops in at once when it's added.
  template: `
    <view
      #root
      [class]="rootClass()"
      [style]="rootStyle()"
      hit-slop="8px"
      [accessibility-element]="true"
      [accessibility-traits]="disabled() ? 'adjustable,disabled' : 'adjustable'"
      accessibility-role-description="slider"
      [accessibility-label]="accessibilityLabel()"
      [accessibility-value]="accessibilityValue()"
      [accessibility-actions]="accessibilityActions"
      (bindaccessibilityaction)="onAccessibilityAction($event)"
      (bindlayoutchange)="onLayout($event)"
      (bindtouchstart)="onPressStart($event)"
      (bindtouchmove)="onPressMove($event)"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart($event)"
      (bindmousemove)="onMouseMove($event)"
      (bindmouseup)="onPressEnd()"
      (bindtap)="onTap()"
    >
      <view
        [user-interaction-enabled]="false"
        [class]="trackClass()"
        [style]="frames().track"
      ></view>
      <view
        [user-interaction-enabled]="false"
        [class]="fillClass()"
        [style]="frames().fill"
      ></view>
      @if (look() === 'material') {
        <view
          [user-interaction-enabled]="false"
          class="rounded-full bg-primary absolute"
          [style]="frames().stop"
        ></view>
      }
      @if (look() === 'glass') {
        <blur-view
          ui-glass
          variant="clear"
          class="absolute"
          [user-interaction-enabled]="false"
          [style]="frames().lens"
        ></blur-view>
      }
      <view
        [user-interaction-enabled]="false"
        [class]="thumbClass()"
        [style]="frames().thumb"
      ></view>
    </view>
  `,
})
export class UiSlider implements FormValueControl<number> {
  /** The value, between `min` and `max`. Supports `[(value)]`. */
  readonly value = model(0);
  /** The lowest value, at the start of the track. */
  readonly min = input<number | undefined>(0);
  /** The highest value, at the end of the track. */
  readonly max = input<number | undefined>(100);
  /** The values the slider stops at: `min`, `min + step` and so on. */
  readonly step = input(1);
  readonly disabled = input(false);
  /** `'default'` or `'glass'`, each platform's own design; see SliderVariant. */
  readonly variant = input<SliderVariant>('default');
  /** What a screen reader calls the slider, such as "Volume". */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  /**
   * What a screen reader says for a value. A percentage of the range
   * without it, as iOS and Android read their own sliders.
   */
  readonly valueText = input<((value: number) => string) | undefined>(
    undefined,
  );
  readonly userClass = input<string>('', { alias: 'class' });

  /**
   * The value the user settled on: when a drag ends, after a tap on the
   * track, and after an accessibility action. `valueChange` follows every
   * step of a drag.
   */
  readonly changed = output<number>();
  /**
   * The user finished changing the value, for forms, which mark the field
   * as touched (FormUiControl's `touch`).
   */
  readonly touch = output<void>();

  readonly rootRef = viewChild.required<ElementRef>('root');

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #design = injectGlassDesign();
  readonly #scheme = injectColorScheme();
  readonly #systemDrawsGlass = injectSystemDrawsGlass();
  readonly #web = platformOf(inject(Injector)) === 'web';

  protected readonly accessibilityActions = [INCREASE, DECREASE];

  /** The slider's width, from its layout; 0 until it's laid out. */
  readonly #width = signal(0);
  /** The thumb is held, by a press on it or a drag. */
  readonly #holding = signal(false);
  /** A drag is moving the thumb, which then follows it with no glide. */
  readonly #dragging = signal(false);
  #press: Press | null = null;
  /**
   * Where the slider's left edge is in the `<lynx-view>`, on the web, where
   * Lynx for Web gives `x` from the view rather than from the element
   * touched. Measured when a press starts; null until the measurement
   * arrives.
   */
  #origin: number | null = null;
  /**
   * The press that ended, in the slider, for the tap that follows it. Null
   * for a tap with no press before it: a screen reader's double tap.
   */
  #tapX: number | null = null;
  /** The press was a drag, so the tap that may follow it isn't one. */
  #suppressTap = false;

  readonly look = computed<SliderLook>(() =>
    this.variant() === 'glass' ? this.#design() : 'default',
  );

  readonly #geometry = computed(() => SLIDER_GEOMETRY[this.look()]);

  readonly #range = computed(() => {
    const min = this.min() ?? 0;
    const max = this.max() ?? 100;
    return { min, max: Math.max(min, max) };
  });

  /**
   * The value as the slider shows it: within the range and on a step, as
   * the bound value may not be.
   */
  readonly #current = computed(() => this.#snap(this.value()));

  readonly #fraction = computed(() => {
    const { min, max } = this.#range();
    return max > min ? (this.#current() - min) / (max - min) : 0;
  });

  /** The thumb's center, from the slider's left edge. */
  readonly #center = computed(() => {
    const { thumbWidth } = this.#geometry();
    const travel = Math.max(0, this.#width() - thumbWidth);
    return thumbWidth / 2 + this.#fraction() * travel;
  });

  readonly #animate = computed(() => !this.#settings.reduceMotion());

  /**
   * Where the runtime draws the glass (Android and the web), Reduce
   * Transparency turns it into an opaque surface, which as a lens would hide
   * the track. The solid thumb grows instead. iOS adapts its own glass.
   */
  readonly #lensIsGlass = computed(
    () => this.#systemDrawsGlass || !this.#settings.reduceTransparency(),
  );

  protected readonly accessibilityValue = computed(() => {
    const format = this.valueText();
    return format
      ? format(this.#current())
      : `${Math.round(this.#fraction() * 100)}%`;
  });

  protected readonly rootClass = computed(() =>
    cn('w-full relative', this.userClass()),
  );

  protected readonly rootStyle = computed(() => ({
    height: px(this.#geometry().height),
    opacity: this.disabled()
      ? this.look() === 'material'
        ? '0.38'
        : '0.5'
      : null,
  }));

  protected readonly trackClass = computed(() => {
    switch (this.look()) {
      case 'default':
        return 'rounded-full bg-secondary absolute left-0 right-0';
      case 'material':
        return 'rounded-l-[2px] rounded-r-full bg-secondary absolute';
      default:
        return 'rounded-full absolute left-0 right-0';
    }
  });

  protected readonly fillClass = computed(() => {
    switch (this.look()) {
      case 'default':
        return 'rounded-full bg-primary absolute left-0';
      case 'material':
        return 'rounded-l-full rounded-r-[2px] bg-primary absolute left-0';
      default:
        return 'rounded-full absolute left-0';
    }
  });

  protected readonly thumbClass = computed(() => {
    switch (this.look()) {
      case 'default':
        return 'rounded-full border-2 border-primary bg-background absolute';
      case 'material':
        return 'rounded-[2px] bg-primary absolute';
      default:
        return 'rounded-full bg-white absolute';
    }
  });

  /**
   * Each part's frame: the track and its filled part, Material's stop
   * indicator, the lens and the thumb. The thumb and lens sit at the
   * slider's left edge, centered on it, and a transform moves them to the
   * value, so a change of size (picking the thumb up) keeps them centered
   * while a drag moves them.
   */
  protected readonly frames = computed(() => {
    const look = this.look();
    const geometry = this.#geometry();
    const width = this.#width();
    const center = this.#center();
    const holding = this.#holding();
    const animate = this.#animate();
    const glide = animate && !this.#dragging();
    // Glides, and the morph, together on the thumb: an element has one
    // `transition`.
    const thumbTransition =
      [animate && MORPH, glide && THUMB_GLIDE].filter(Boolean).join(', ') ||
      'none';
    const fillTransition = glide ? FILL_GLIDE : 'none';
    const trackTop = (geometry.height - geometry.track) / 2;
    const track = { top: px(trackTop), height: px(geometry.track) };
    const transform = `translateX(${center}px)`;

    const shape = (shapeWidth: number, shapeHeight: number) => ({
      left: px(-shapeWidth / 2),
      top: px((geometry.height - shapeHeight) / 2),
      width: px(shapeWidth),
      height: px(shapeHeight),
      transform,
    });
    const atRest = shape(geometry.thumbWidth, geometry.thumbHeight);
    const held = shape(geometry.pressedWidth, geometry.pressedHeight);

    if (look === 'material') {
      // The handle stands in a gap in the track: the filled part ends
      // before it, and the rest starts after it.
      const handle = geometry.thumbWidth / 2 + MATERIAL_GAP;
      const inactiveLeft = Math.min(width, center + handle);
      const inactiveWidth = Math.max(0, width - inactiveLeft);
      return {
        track: {
          ...track,
          left: px(inactiveLeft),
          width: px(inactiveWidth),
          transition: glide ? TRACK_GLIDE : 'none',
        },
        fill: {
          ...track,
          width: px(Math.max(0, center - handle)),
          transition: fillTransition,
        },
        // The stop goes once the handle nears it, as Material's does.
        stop: {
          top: px((geometry.height - MATERIAL_STOP) / 2),
          right: px(MATERIAL_STOP),
          width: px(MATERIAL_STOP),
          height: px(MATERIAL_STOP),
          opacity: inactiveWidth > MATERIAL_STOP * 4 ? '1' : '0',
        },
        lens: null,
        thumb: { ...(holding ? held : atRest), transition: thumbTransition },
      };
    }

    const colors =
      look === 'glass' || look === 'frosted'
        ? IOS_COLORS[look][this.#scheme()]
        : null;
    const lensShows = look === 'glass' && holding && this.#lensIsGlass();
    // The thumb grows with the lens and fades into it. Without the lens,
    // it grows itself (see #lensIsGlass).
    const thumb =
      look === 'glass' && holding
        ? { ...held, opacity: lensShows ? '0' : '1' }
        : { ...atRest, opacity: '1' };
    return {
      track: { ...track, 'background-color': colors?.track ?? null },
      fill: {
        ...track,
        width: px(center),
        'background-color': colors?.fill ?? null,
        transition: fillTransition,
      },
      stop: null,
      // Hidden under the thumb at rest: a little smaller, so its rim
      // doesn't show around it.
      lens: {
        ...(lensShows
          ? held
          : shape(
              geometry.thumbWidth - LENS_INSET * 2,
              geometry.thumbHeight - LENS_INSET * 2,
            )),
        transition: thumbTransition,
      },
      thumb: {
        ...thumb,
        'box-shadow':
          look === 'glass' || look === 'frosted'
            ? IOS_THUMB_SHADOW[look]
            : null,
        transition: thumbTransition,
      },
    };
  });

  protected onLayout(event: unknown): void {
    const { detail, params } = event as LayoutEvent;
    const width = (detail ?? params)?.width;
    if (typeof width === 'number') this.#width.set(width);
  }

  protected onPressStart(event: PointerEvent): void {
    // A new press starts a new tap, so the last drag's tap can't eat it.
    this.#suppressTap = false;
    this.#tapX = null;
    const point = pointOf(event);
    if (this.disabled() || !point) return;
    const press: Press = {
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      dragging: false,
      scrolling: false,
      grab: null,
      onThumb: false,
    };
    this.#press = press;
    if (this.#web) {
      this.#origin = null;
      void this.#measureOrigin(press);
    }
    this.#locatePress(press);
  }

  protected onPressMove(event: PointerEvent): void {
    const press = this.#press;
    const point = pointOf(event);
    if (!press || !point || press.scrolling) return;
    press.lastX = point.x;
    if (!press.dragging) {
      const dx = Math.abs(point.x - press.startX);
      const dy = Math.abs(point.y - press.startY);
      if (dx >= DRAG_SLOP && dx > dy) {
        press.dragging = true;
        this.#dragging.set(true);
        this.#holding.set(true);
      } else if (dy >= DRAG_SLOP) {
        // A scroll, which the scroll view may or may not take over: Android
        // doesn't always cancel the touch. Either way, the slider sits it
        // out.
        press.scrolling = true;
        this.#holding.set(false);
        return;
      } else {
        return;
      }
    }
    this.#follow(press);
  }

  /**
   * The mouse's twin of onPressMove, on the web. A move with no button held
   * means the button came up outside the slider, where it couldn't see it.
   */
  protected onMouseMove(event: PointerEvent & { buttons?: number }): void {
    if (event.buttons === 0) {
      this.onPressEnd();
      return;
    }
    this.onPressMove(event);
  }

  /**
   * The finger lifted or the mouse button came up. A press beside the thumb
   * that didn't move is a tap, which moves the thumb there when Lynx sends
   * it; one on the thumb leaves it where it is.
   */
  protected onPressEnd(): void {
    const press = this.#release();
    if (
      press &&
      !press.dragging &&
      !press.scrolling &&
      press.grab !== null &&
      !press.onThumb
    ) {
      this.#tapX = this.#local(press.startX);
    }
  }

  /**
   * A scroll view took the touch over. A drag keeps the value it reached,
   * as iOS's slider does, and no tap follows.
   */
  protected onPressCancel(): void {
    this.#release();
  }

  /**
   * A tap on the track moves the thumb there. A screen reader's double tap
   * has no press before it, so it does nothing: its actions move the value.
   */
  protected onTap(): void {
    const x = this.#tapX;
    this.#tapX = null;
    if (this.#suppressTap) {
      this.#suppressTap = false;
      return;
    }
    if (this.disabled() || x === null) return;
    this.#set(this.#valueAt(x));
    this.#finish();
  }

  protected onAccessibilityAction(event: unknown): void {
    const name = (event as { detail?: { name?: string } }).detail?.name;
    if (this.disabled() || (name !== INCREASE && name !== DECREASE)) return;
    const step = this.#accessibilityStep();
    this.#set(this.#current() + (name === INCREASE ? step : -step));
    this.#finish();
  }

  /**
   * A tenth of the range, as iOS's own slider moves for VoiceOver, rounded
   * to whole steps, and never less than one.
   */
  readonly #accessibilityStep = computed(() => {
    const { min, max } = this.#range();
    const step = this.#stepSize();
    return step * Math.max(1, Math.round((max - min) / 10 / step));
  });

  readonly #stepSize = computed(() => {
    const step = this.step();
    return step > 0 ? step : 1;
  });

  /**
   * Ends the press, finishing a drag, and returns it.
   */
  #release(): Press | null {
    const press = this.#press;
    this.#press = null;
    this.#holding.set(false);
    this.#dragging.set(false);
    if (press?.dragging) {
      // Lynx may still send a tap for a short drag, and the browser always
      // clicks after a mouse drag: that tap isn't one.
      this.#suppressTap = true;
      this.#finish();
    }
    return press;
  }

  /**
   * Once the press's place in the slider is known (at once on iOS and
   * Android, after the measurement on the web), a press on the thumb picks
   * it up, keeping where the finger is on it, and one beside it will pull
   * it under the finger if it drags.
   */
  #locatePress(press: Press): void {
    const x = this.#local(press.startX);
    if (x === null) return;
    const offset = x - this.#center();
    const reach = this.#geometry().thumbWidth / 2 + GRAB_SLOP;
    press.onThumb = Math.abs(offset) <= reach;
    press.grab = press.onThumb ? offset : 0;
    if (press.onThumb) this.#holding.set(true);
    if (press.dragging) this.#follow(press);
  }

  /**
   * Moves the value to where the dragging finger has the thumb.
   */
  #follow(press: Press): void {
    const x = this.#local(press.lastX);
    if (x === null || press.grab === null) return;
    this.#set(this.#valueAt(x - press.grab));
  }

  /**
   * Measures where the slider is in the `<lynx-view>`, for the web. In the
   * docs' scaled previews the measurement is in screen pixels while events
   * and layout are in the app's, so the layout width gives the scale.
   */
  async #measureOrigin(press: Press): Promise<void> {
    let origin = 0;
    try {
      const rect = await new MainThreadElement(
        this.rootRef().nativeElement.element as ConstructorParameters<
          typeof MainThreadElement
        >[0],
      ).getBoundingClientRect();
      const width = this.#width();
      const scale = width > 0 && rect.width > 0 ? rect.width / width : 1;
      origin = rect.left / scale;
    } catch {
      // Measured from the view's edge, the drag still moves the thumb, if
      // not under the finger.
    }
    if (this.#press !== press) return;
    this.#origin = origin;
    this.#locatePress(press);
  }

  /**
   * A position from an event, in the slider, or null until it's known.
   */
  #local(x: number): number | null {
    if (!this.#web) return x;
    return this.#origin === null ? null : x - this.#origin;
  }

  /**
   * The value at a position of the thumb's center in the slider.
   */
  #valueAt(center: number): number {
    const { min, max } = this.#range();
    const { thumbWidth } = this.#geometry();
    const travel = this.#width() - thumbWidth;
    const fraction =
      travel > 0
        ? Math.min(1, Math.max(0, (center - thumbWidth / 2) / travel))
        : 0;
    return min + fraction * (max - min);
  }

  /**
   * The nearest step to a value, within the range.
   */
  #snap(value: number): number {
    const { min, max } = this.#range();
    const step = this.#stepSize();
    const steps = Math.round(
      (Math.min(max, Math.max(min, value)) - min) / step,
    );
    const snapped = Math.min(max, min + steps * step);
    return Number(snapped.toFixed(decimalsOf(step)));
  }

  #set(value: number): void {
    const next = this.#snap(value);
    if (next !== this.value()) this.value.set(next);
  }

  #finish(): void {
    this.changed.emit(this.#current());
    this.touch.emit();
  }
}
