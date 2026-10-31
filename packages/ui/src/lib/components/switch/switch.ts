import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { type FormCheckboxControl } from '@angular/forms/signals';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  springTranslateX,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { UiGlass } from '../glass/glass';
import {
  type GlassDesign,
  injectGlassDesign,
  injectSystemDrawsGlass,
} from '../glass/glass-design';
import { injectColorScheme } from '../icon/icon-theme';

/**
 * `'default'` is the flat switch in the theme's colors on every platform.
 * `'glass'` takes each platform's own: iOS 26's, whose thumb turns into a
 * Liquid Glass lens while it's touched; iOS 15 to 25's; and Material 3's on
 * Android (see GlassDesign).
 */
export type SwitchVariant = 'default' | 'glass';

/** What the switch draws: the default look, or a platform's design. */
type SwitchLook = 'default' | GlassDesign;

/** A switch's sizes in one look, in px. */
type SwitchGeometry = {
  readonly width: number;
  readonly height: number;
  /** The thumb's size at rest. Material's grows when the switch is on. */
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  /** From the track's edge to the thumb at either end. */
  readonly inset: number;
  /** The thumb's size while it's touched: iOS 26's lens, or a stretch. */
  readonly pressedWidth: number;
  readonly pressedHeight: number;
};

/**
 * The sizes of each look:
 *
 * - `default`: a 44 by 24px track and a 20px thumb, 2px in from the ends.
 * - `glass`: iOS 26's UISwitch, measured on the iOS 27 Simulator: a 63 by
 *   28pt track and a 37 by 24pt capsule thumb, which grows 1.6 times into a
 *   59 by 38pt glass lens, taller than the track, while it's touched.
 * - `frosted`: UISwitch from iOS 7 to 25: a 51 by 31pt track and a 27pt
 *   round thumb that stretches 6pt wider while it's touched.
 * - `material`: Material 3's switch: a 52 by 32dp track whose handle is 16dp
 *   off, 24dp on and 28dp while it's pressed, centered 16dp from the ends.
 *
 * Every size is in px, not rem: Lynx's rem is 14px (`DEFAULT_FONT_SIZE_DP`),
 * not the web's 16px, so a rem-sized track would be smaller than the px
 * offsets the thumb moves by, and the thumb would overshoot it.
 */
const SWITCH_GEOMETRY: Readonly<Record<SwitchLook, SwitchGeometry>> = {
  default: {
    width: 44,
    height: 24,
    thumbWidth: 20,
    thumbHeight: 20,
    inset: 2,
    pressedWidth: 20,
    pressedHeight: 20,
  },
  glass: {
    width: 63,
    height: 28,
    thumbWidth: 37,
    thumbHeight: 24,
    inset: 2,
    pressedWidth: 59,
    pressedHeight: 38,
  },
  frosted: {
    width: 51,
    height: 31,
    thumbWidth: 27,
    thumbHeight: 27,
    inset: 2,
    pressedWidth: 33,
    pressedHeight: 27,
  },
  material: {
    width: 52,
    height: 32,
    thumbWidth: 24,
    thumbHeight: 24,
    inset: 4,
    pressedWidth: 28,
    pressedHeight: 28,
  },
};

/** Material's handle while the switch is off, smaller than when it's on. */
const MATERIAL_OFF_THUMB = 16;

/** The pressed state layer around Material's handle. */
const MATERIAL_HALO = 40;

/** How much smaller than the thumb the hidden lens is, on each side. */
const LENS_INSET = 2;

/**
 * iOS's track colors, in the app's color scheme as UIKit draws them in the
 * phone's: the system green UISwitch takes when it's on (whatever the app's
 * tint), and a translucent gray when it's off, measured on the iOS 27
 * Simulator for iOS 26 and Apple's fill colors before it.
 */
const IOS_TRACK = {
  glass: {
    light: { on: '#34c759', off: 'rgba(120, 120, 128, 0.43)' },
    dark: { on: '#30d158', off: 'rgba(120, 120, 128, 0.58)' },
  },
  frosted: {
    light: { on: '#34c759', off: 'rgba(120, 120, 128, 0.16)' },
    dark: { on: '#30d158', off: 'rgba(120, 120, 128, 0.32)' },
  },
} as const;

/**
 * The shadow under the white thumb before iOS 26. iOS 26's draws none. An
 * inline style, because Tailwind's shadow classes draw nothing on Lynx.
 */
const FROSTED_THUMB_SHADOW =
  '0 3px 8px rgba(0, 0, 0, 0.15), 0 3px 1px rgba(0, 0, 0, 0.06)';

/**
 * How far a finger moves before a press becomes a drag, in px. Below it, a
 * press is a tap, which toggles the switch, or the start of a scroll.
 */
const DRAG_SLOP = 6;

/**
 * The swipe angles, in degrees from the right, that the switch keeps from
 * the scroll views around it: within 45 degrees of sideways. On iOS a
 * scroll view's pan runs alongside Lynx's touch events, so a slightly
 * diagonal drag would also scroll the page (`consume-slide-event` fails
 * those pans). A swipe up or down still scrolls.
 */
const SIDEWAYS: [number, number][] = [
  [-45, 45],
  [135, 180],
  [-180, -135],
];

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
 * The platform designs' thumb slides across, with a slight overshoot, and
 * follows a dragging finger at once. The default look springs with
 * `springTranslateX` instead, as it always has.
 */
const THUMB_SLIDE = transitionOf(
  ['transform'],
  DURATION.normal,
  EASING.springSubtle,
);

/**
 * The thumb's change of size and opacity as it's touched and let go. Lynx
 * can't animate a corner radius, but a capsule's is half its height at any
 * size (`rounded-full`), so it stays a capsule as it grows.
 */
const MORPH = transitionOf(
  ['left', 'top', 'width', 'height', 'opacity'],
  DURATION.fast,
  EASING.standard,
);

/** The track's color change as the switch turns on or off. */
const TRACK_FADE = transitionOf(
  ['background-color'],
  DURATION.normal,
  EASING.standard,
);

/** Where a touch or the mouse is, in what Lynx sends with its events. */
type PointerEvent = {
  readonly touches?: readonly { readonly x?: number; readonly y?: number }[];
  readonly x?: number;
  readonly y?: number;
};

/**
 * The position of a touch, or of the mouse on the web. A desktop browser
 * sends no touch events for a mouse, so the switch listens for both. Only
 * how far it moves matters, so the switch doesn't need to know where it is
 * on screen: Lynx gives `x` from the element touched on iOS and Android and
 * from the `<lynx-view>` on the web, both fixed for the press.
 */
const pointOf = (event: PointerEvent): { x: number; y: number } | null => {
  const source = event.touches?.[0] ?? event;
  return typeof source.x === 'number' && typeof source.y === 'number'
    ? { x: source.x, y: source.y }
    : null;
};

/**
 * A length in px, for a style object.
 */
const px = (value: number): string => `${value}px`;

/** A press in progress: where it started and where the thumb was. */
type Press = {
  readonly startX: number;
  readonly startY: number;
  /** The thumb's center when the press started. */
  readonly from: number;
  /** It moved sideways past DRAG_SLOP, so the thumb follows it. */
  dragging: boolean;
  /** It moved up or down first: a scroll, which the switch leaves alone. */
  scrolling: boolean;
};

/**
 * An on/off switch for a setting:
 *
 * ```html
 * <ui-switch [(checked)]="wifi" accessibility-label="Wi-Fi" />
 * <ui-switch variant="glass" [(checked)]="wifi" accessibility-label="Wi-Fi" />
 * ```
 *
 * A tap toggles it, and so does dragging the thumb across: it lands on the
 * side it's let go nearer, as on iOS. A drag only starts once the finger
 * moves sideways, so a scroll that starts on the switch leaves it alone.
 *
 * `checked` is a `model()`, so it works with `[(checked)]`, with Signal
 * Forms' `[formField]` (it implements FormCheckboxControl) and, since
 * Angular 22, with reactive forms' `[formControl]` and `formControlName`
 * and with `[(ngModel)]`.
 *
 * Screen readers find it as a button with its label and an "On" or "Off"
 * value, and Android's as a switch.
 */
@Component({
  selector: 'ui-switch',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  // Only the root takes touches: what's inside ignores them, so every touch
  // and its `x` belong to the switch.
  //
  // The track is drawn by a view of its own under the thumb, not by the root.
  // Lynx for Web's glass refracts the nearest ancestor that paints a
  // background, cut to that ancestor's box, and the lens is bigger than the
  // track: as the lens's parent, the track would leave the lens blank where
  // it reaches past it. iOS's glass shows what's on screen either way.
  //
  // Mouse events are bound beside the touch events because a desktop
  // browser never sends touches for a mouse (see the bottom sheet). There's
  // no mouseleave: Chrome doesn't deliver it to Lynx for Web, so a move with
  // no button held ends the drag instead.
  //
  // iOS 26's lens sits under the solid thumb, a little smaller, so it's
  // hidden until the switch is touched: then the thumb fades as the lens
  // grows. It's always there rather than added on touch, since iOS's glass
  // pops in at once when it's added.
  template: `
    <view
      [class]="rootClass()"
      [style]="rootStyle()"
      hit-slop="8px"
      [consume-slide-event]="sideways"
      [accessibility-element]="true"
      [accessibility-traits]="disabled() ? 'button,disabled' : 'button'"
      accessibility-role-description="switch"
      [accessibility-label]="accessibilityLabel()"
      [accessibility-value]="shownChecked() ? 'On' : 'Off'"
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
        [style]="trackStyle()"
      ></view>
      @if (look() === 'material') {
        @if (!shownChecked()) {
          <view
            [user-interaction-enabled]="false"
            class="rounded-full border-2 border-muted-foreground absolute bottom-0 left-0 right-0 top-0"
          ></view>
        }
        <view
          [user-interaction-enabled]="false"
          [class]="haloClass()"
          [style]="frames().halo"
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
        #thumb
        [user-interaction-enabled]="false"
        [class]="thumbClass()"
        [style]="frames().thumb"
      ></view>
    </view>
  `,
})
export class UiSwitch implements FormCheckboxControl {
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** `'default'` or `'glass'`, each platform's own design; see SwitchVariant. */
  readonly variant = input<SwitchVariant>('default');
  /** What a screen reader calls the switch, such as "Wi-Fi". */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  readonly userClass = input<string>('', { alias: 'class' });

  /** The new state, after each tap or drag that changes it. */
  readonly changed = output<boolean>();

  protected readonly sideways = SIDEWAYS;

  /** The thumb is always in the template, so the switch can always slide it. */
  readonly thumbRef = viewChild.required<ElementRef>('thumb');

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #design = injectGlassDesign();
  readonly #scheme = injectColorScheme();
  readonly #systemDrawsGlass = injectSystemDrawsGlass();
  #activeAnimation?: AnimationHandle;
  #press: Press | null = null;
  /** The press was a drag, so the tap that may follow it isn't one. */
  #suppressTap = false;

  /** The switch is touched: iOS 26's thumb is a lens, Material's grows. */
  readonly #holding = signal(false);
  /** Where a dragging finger has the thumb's center, or null. */
  readonly #dragCenter = signal<number | null>(null);

  readonly look = computed<SwitchLook>(() =>
    this.variant() === 'glass' ? this.#design() : 'default',
  );

  readonly #geometry = computed(() => SWITCH_GEOMETRY[this.look()]);

  /** The thumb's center when the switch is off, and when it's on. */
  readonly #ends = computed(() => {
    const { width, thumbWidth, inset } = this.#geometry();
    const off = inset + thumbWidth / 2;
    return { off, on: width - off };
  });

  /**
   * On or off as the switch shows it: the side a dragging thumb is on, so
   * the track changes color as the thumb crosses the middle, as on iOS.
   */
  readonly shownChecked = computed(() => {
    const center = this.#dragCenter();
    if (center === null) return this.checked();
    const { off, on } = this.#ends();
    return center > (off + on) / 2;
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

  protected readonly rootClass = computed(() =>
    cn(
      'relative',
      this.disabled() &&
        (this.look() === 'material' ? 'opacity-[0.38]' : 'opacity-50'),
      this.userClass(),
    ),
  );

  protected readonly rootStyle = computed(() => {
    const { width, height } = this.#geometry();
    return { width: px(width), height: px(height) };
  });

  protected readonly trackClass = computed(() => {
    const look = this.look();
    const on = this.shownChecked();
    return cn(
      'rounded-full absolute bottom-0 left-0 right-0 top-0',
      look === 'default' && (on ? 'bg-primary' : 'bg-input'),
      look === 'material' && (on ? 'bg-primary' : 'bg-secondary'),
    );
  });

  protected readonly trackStyle = computed(() => {
    const look = this.look();
    const colors =
      look === 'glass' || look === 'frosted'
        ? IOS_TRACK[look][this.#scheme()]
        : null;
    let background: string | null = null;
    if (colors) background = this.shownChecked() ? colors.on : colors.off;
    return {
      'background-color': background,
      transition: this.#animate() ? TRACK_FADE : 'none',
    };
  });

  protected readonly thumbClass = computed(() => {
    switch (this.look()) {
      case 'default':
        return 'rounded-full bg-background absolute';
      case 'material':
        return cn(
          'rounded-full absolute',
          this.shownChecked() ? 'bg-primary-foreground' : 'bg-muted-foreground',
        );
      default:
        return 'rounded-full bg-white absolute';
    }
  });

  protected readonly haloClass = computed(() =>
    cn(
      'rounded-full absolute',
      this.shownChecked() ? 'bg-primary' : 'bg-foreground',
    ),
  );

  /**
   * The frames of the thumb and what goes with it (iOS 26's lens, Material's
   * pressed halo). Each sits at the track's left edge, centered on it, and a
   * transform moves it along, so a change of size keeps it centered while a
   * drag moves it.
   */
  protected readonly frames = computed(() => {
    const look = this.look();
    const geometry = this.#geometry();
    const on = this.shownChecked();
    const holding = this.#holding();
    const dragging = this.#dragCenter() !== null;
    const center =
      this.#dragCenter() ?? this.#ends()[this.checked() ? 'on' : 'off'];
    const animate = this.#animate();
    // The default look springs its thumb with an animation, which plays
    // over the transform (see #settle).
    const slide = animate && !dragging && look !== 'default';
    const transition =
      [animate && MORPH, slide && THUMB_SLIDE].filter(Boolean).join(', ') ||
      'none';

    const shape = (width: number, height: number) => {
      // A stretched thumb keeps inside the track, growing toward the middle
      // from the end it's at, as iOS's did before iOS 26.
      const inner = geometry.width - geometry.inset * 2;
      const left =
        look === 'frosted'
          ? Math.min(
              Math.max(center - width / 2, geometry.inset),
              geometry.inset + inner - width,
            ) - center
          : -width / 2;
      return {
        left: px(left),
        top: px((geometry.height - height) / 2),
        width: px(width),
        height: px(height),
        transform: `translateX(${center}px)`,
        transition,
      };
    };

    let rest = shape(geometry.thumbWidth, geometry.thumbHeight);
    if (look === 'material' && !on) {
      rest = shape(MATERIAL_OFF_THUMB, MATERIAL_OFF_THUMB);
    }
    const held = shape(geometry.pressedWidth, geometry.pressedHeight);
    const lensShows = look === 'glass' && holding && this.#lensIsGlass();
    const thumb = holding && look !== 'default' ? held : rest;
    return {
      thumb: {
        ...thumb,
        opacity: lensShows ? '0' : '1',
        'box-shadow': look === 'frosted' ? FROSTED_THUMB_SHADOW : null,
      },
      // Hidden under the thumb at rest: a little smaller, so its rim
      // doesn't show around it.
      lens: lensShows
        ? held
        : shape(
            geometry.thumbWidth - LENS_INSET * 2,
            geometry.thumbHeight - LENS_INSET * 2,
          ),
      // Material's state layer: the thumb's color at a tenth, while it's
      // pressed.
      halo: {
        ...shape(MATERIAL_HALO, MATERIAL_HALO),
        opacity: holding ? '0.1' : '0',
      },
    };
  });

  /**
   * Turns the switch on or off, sliding the thumb across. Does nothing while
   * it's disabled.
   */
  toggle(): void {
    if (this.disabled()) return;
    const from = this.#ends()[this.checked() ? 'on' : 'off'];
    this.#settle(!this.checked(), from);
  }

  protected onPressStart(event: PointerEvent): void {
    // A new press starts a new tap, so the last drag's tap can't eat it.
    this.#suppressTap = false;
    const point = pointOf(event);
    if (this.disabled() || !point) return;
    this.#press = {
      startX: point.x,
      startY: point.y,
      from: this.#ends()[this.checked() ? 'on' : 'off'],
      dragging: false,
      scrolling: false,
    };
    this.#holding.set(true);
  }

  protected onPressMove(event: PointerEvent): void {
    const press = this.#press;
    const point = pointOf(event);
    if (!press || !point || press.scrolling) return;
    const dx = point.x - press.startX;
    if (!press.dragging) {
      const dy = Math.abs(point.y - press.startY);
      if (Math.abs(dx) >= DRAG_SLOP && Math.abs(dx) > dy) {
        press.dragging = true;
        // The default look's spring would hold the thumb where it ended.
        this.#activeAnimation?.cancel();
      } else if (dy >= DRAG_SLOP) {
        // A scroll, which the scroll view may or may not take over: Android
        // doesn't always cancel the touch. Either way, the switch sits it
        // out.
        press.scrolling = true;
        this.#holding.set(false);
        return;
      } else {
        return;
      }
    }
    const { off, on } = this.#ends();
    this.#dragCenter.set(Math.min(on, Math.max(off, press.from + dx)));
  }

  /**
   * The mouse's twin of onPressMove, on the web. A move with no button held
   * means the button came up outside the switch, where it couldn't see it.
   */
  protected onMouseMove(event: PointerEvent & { buttons?: number }): void {
    if (event.buttons === 0) {
      this.onPressEnd();
      return;
    }
    this.onPressMove(event);
  }

  /**
   * The finger lifted or the mouse button came up. A drag lands on the
   * side it's let go nearer; the tap Lynx may still send for a short drag,
   * and the click the browser sends after a mouse drag, aren't taps.
   */
  protected onPressEnd(): void {
    if (this.#release()) this.#suppressTap = true;
  }

  /**
   * A scroll view took the touch over: a drag still lands on a side.
   */
  protected onPressCancel(): void {
    this.#release();
  }

  protected onTap(): void {
    if (this.#suppressTap) {
      this.#suppressTap = false;
      return;
    }
    this.toggle();
  }

  /**
   * Ends the press, landing a drag, and says whether it was one.
   */
  #release(): boolean {
    const center = this.#dragCenter();
    this.#press = null;
    this.#holding.set(false);
    if (center === null) return false;
    const on = this.shownChecked();
    this.#dragCenter.set(null);
    this.#settle(on, center);
    return true;
  }

  /**
   * Turns the switch on or off from where the thumb is now. The platform
   * designs' thumb slides with a CSS transition. The default look's
   * springs across, squishing halfway, with `element.animate()`, which
   * plays over its transform without holding it after (`fill: 'none'`), so
   * a later change of `checked` from a binding still moves it.
   */
  #settle(next: boolean, from: number): void {
    if (this.look() === 'default' && this.#animate()) {
      this.#activeAnimation?.cancel();
      this.#activeAnimation = springTranslateX(
        this.thumbRef().nativeElement,
        from,
        this.#ends()[next ? 'on' : 'off'],
        { fill: 'none' },
      );
    }
    if (next === this.checked()) return;
    this.checked.set(next);
    this.changed.emit(next);
  }
}
