import {
  Component,
  computed,
  DestroyRef,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  type Signal,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import { DURATION, EASING } from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { injectGlassDesign } from '../glass/glass-design';
import { injectColorScheme } from '../icon/icon-theme';

/**
 * What a segmented control's host tells the control it draws: `ui-tabs-list`
 * and `ui-toggle-group` with `variant="segmented"`, or a control of your own.
 * Provide it under {@link UI_SEGMENTED_HOST} next to {@link UiSegmentedControl}.
 */
export type SegmentedHost = {
  /** Whether the host is drawn as a segmented control right now. */
  readonly segmented: Signal<boolean>;
  /** Every segment's value, in the order the segments are laid out. */
  readonly segmentValues: Signal<readonly string[]>;
  /** The selected segments' values. */
  readonly selectedValues: Signal<readonly string[]>;
  /**
   * Whether several segments can be selected at once. One indicator can't
   * mark several segments, so then each selected segment draws its own
   * thumb, and nothing slides.
   */
  readonly multiple: Signal<boolean>;
  readonly disabled: Signal<boolean>;
  /** Selects a segment the user dragged the indicator to. */
  select(value: string): void;
};

export const UI_SEGMENTED_HOST = new InjectionToken<SegmentedHost>(
  'UI_SEGMENTED_HOST',
);

/**
 * Where a segment sits in the row, which a segment tells
 * UiSegmentedControl.segmentClass(): Material rounds the group's ends on the
 * first and the last. A segment drawn by `@for` passes
 * `{ first: $first, last: $last }`, and a host's content child finds it
 * with {@link segmentPlace}.
 */
export type SegmentPlace = { readonly first: boolean; readonly last: boolean };

/**
 * A segment's place among its host's segments, in order. It's found from
 * the segments themselves rather than their values: a segment that `@for`
 * adds has no value yet while the segments before it are redrawn, and
 * Angular throws NG0950 for a required input read that early.
 */
export const segmentPlace = <T>(
  segments: readonly T[],
  segment: T,
): SegmentPlace => {
  const index = segments.indexOf(segment);
  return {
    first: index === 0,
    last: index !== -1 && index === segments.length - 1,
  };
};

/** A segment's place in the row, in px from the track's left edge. */
type SegmentFrame = { readonly left: number; readonly width: number };

/**
 * A drag of the indicator: the segment it started on, where the pointer
 * went down, and how far it has moved since.
 */
type Drag = {
  readonly start: number;
  readonly startX: number;
  readonly dx: number;
};

/**
 * The glass lens the indicator lifts into on iOS 26, as UIKit's own
 * segmented control does while its selection moves:
 *
 * - `'off'`: no lens; the indicator is the opaque thumb.
 * - `'rest'`: the lens is drawn under the thumb at the thumb's size, about
 *   to grow or just shrunk back. The opaque thumb hides it, so the glass
 *   never visibly pops in or out (Lynx can't animate glass appearing).
 * - `'open'`: the lens is larger than the thumb, and the thumb has faded out
 *   to show it.
 */
type LensPhase = 'off' | 'rest' | 'open';

/** What Lynx's touch and mouse events carry, as far as a drag reads them. */
type PointerEventLike = {
  readonly touches?: readonly { readonly pageX?: number }[];
  readonly pageX?: number;
};

/**
 * What a layoutchange event carries: its size is in `detail` on iOS and the
 * web, and in `params` on older Android.
 */
type LayoutEventLike = {
  readonly detail?: { readonly width?: number };
  readonly params?: { readonly width?: number };
};

/**
 * How far the thumb sits inside its segment, in px: 2pt in UIKit's
 * segmented control, before iOS 26 and since.
 */
const THUMB_INSET = 2;

/**
 * How far the lens reaches past the thumb on each side, in px. Measured from
 * UIKit's segmented control on the iOS 27 Simulator: its 89×28pt thumb lifts
 * into a lens about 113×38pt, taller than the 32pt track.
 */
const LENS_GROWTH = { x: 12, y: 5 } as const;

/**
 * How far, in px, the pointer moves before a press on the selected segment
 * counts as a drag, which chooses the segment it ends over. A press that
 * moves less is left to the tap.
 */
const DRAG_SLOP = 6;

/**
 * The thumb's shadow before iOS 26, from Apple's iOS 13 design resources: a
 * soft drop under a tight one.
 */
const FROSTED_THUMB_SHADOW =
  '0 3px 8px rgba(0, 0, 0, 0.12), 0 3px 1px rgba(0, 0, 0, 0.04)';

/**
 * The thumb's shadow on iOS 26. UIKit draws none, but its track is a little
 * darker than the theme's `muted`, so a hairline of shadow keeps the white
 * thumb apart from the track.
 */
const GLASS_THUMB_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.1)';

/**
 * The thumb's color in a dark theme: the gray UIKit draws it in, sampled from
 * the iOS 27 Simulator (#5A5A5F), lighter than the track. No theme token is
 * that color (`muted` is the track itself), so it's this one-off color.
 */
const DARK_THUMB_COLOR = 'rgba(90, 90, 95, 1)';

/**
 * How the indicator moves to a new segment: on iOS 26 with a slight
 * overshoot, as the liquid lens settles, and before it with the gentle
 * spring of iOS's sheets.
 */
const GLASS_SLIDE = `left ${DURATION.slow}ms ${EASING.springSubtle}, width ${DURATION.slow}ms ${EASING.springSubtle}, opacity ${DURATION.fast}ms ${EASING.standard}`;
const FROSTED_SLIDE = `left ${DURATION.normal}ms ${EASING.sheet}, width ${DURATION.normal}ms ${EASING.sheet}, opacity ${DURATION.fast}ms ${EASING.standard}`;

/** The lens grows and shrinks quickly, overshooting a little. */
const LENS_TRANSITION = ['left', 'right', 'top', 'bottom']
  .map((side) => `${side} ${DURATION.fast}ms ${EASING.springSubtle}`)
  .join(', ');

/** The thumb fades as the lens takes over, and shrinks while held. */
const THUMB_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.standard}, transform ${DURATION.fast}ms ${EASING.standard}`;

/** The separators fade as the thumb comes and goes beside them. */
const SEPARATOR_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.standard}`;

/** Material's segments change color as they're selected. */
const MATERIAL_FILL_TRANSITION = `background-color ${DURATION.normal}ms ${EASING.standard}`;

/** How strongly the separators before iOS 26 show (`muted-foreground`). */
const SEPARATOR_OPACITY = '0.3';

/**
 * Material's state layer, shown while a segment is pressed: its content's
 * color (the segment points `--foreground` at it) at 10%.
 */
const STATE_LAYER_CLASS =
  'h-full w-full bg-foreground opacity-10 absolute left-0 top-0';

/**
 * An unselected Material segment's corners: small inside the group, and
 * round at its ends, as Material's connected buttons are. The end segments
 * draw the ends themselves, rather than the track clipping them, so that
 * the outline Increase Contrast gives them follows the curve. Half the
 * track's 40px height, not `rounded-l-full`: corners too large for a box
 * are all scaled down together until they fit, so the small inner ones
 * would come out square.
 */
const materialCorners = ({ first, last }: SegmentPlace): string => {
  if (first && last) return 'rounded-full';
  if (first) return 'rounded-l-[20px] rounded-r-[8px]';
  if (last) return 'rounded-l-[8px] rounded-r-[20px]';
  return 'rounded-[8px]';
};

/**
 * Stops a timer that may not have been started: the native main thread's
 * `clearTimeout()` throws for `undefined`, which the web ignores.
 */
const stop = (timer: ReturnType<typeof setTimeout> | undefined): void => {
  if (timer !== undefined) clearTimeout(timer);
};

/**
 * A CSS length in px.
 */
const px = (value: number): string => `${value}px`;

/**
 * The pointer's horizontal position on the page: the first touch's for a
 * touch event, the mouse's for a mouse event (the web preview), or
 * undefined for an event that has none.
 */
const pointerX = (event: unknown): number | undefined => {
  const pointer = event as PointerEventLike;
  const x = (pointer.touches?.[0] ?? pointer).pageX;
  return typeof x === 'number' ? x : undefined;
};

/**
 * The width a layoutchange event reports, if it reports one.
 */
const layoutWidth = (event: unknown): number | undefined => {
  const layout = event as LayoutEventLike;
  const width = (layout.detail ?? layout.params)?.width;
  return typeof width === 'number' ? width : undefined;
};

/**
 * The shared logic of a segmented control: the selection indicator that
 * slides between the segments, its drag, and each platform's look of the
 * track and the segments. `ui-tabs-list` and `ui-toggle-group` provide one
 * for `variant="segmented"`, and their segments draw from it.
 *
 * Provide it on the control's host component, with the host itself under
 * {@link UI_SEGMENTED_HOST}:
 *
 * ```ts
 * providers: [
 *   UiSegmentedControl,
 *   { provide: UI_SEGMENTED_HOST, useFactory: () => inject(MyControl) },
 * ],
 * ```
 *
 * Put a `<ui-segmented-indicator>` first in the track (it draws under the
 * segments), and have each segment report its width from `layoutchange`
 * (see `measure()`) and its touches (`press()`, `move()`, `release()`,
 * `cancel()`, `tap()`), and take its classes from `segmentClass()` with
 * its place in the row.
 *
 * Its look follows the platform (see GlassDesign):
 *
 * - `'glass'` (iOS 26 and later, the web, Android with the glass opt-in):
 *   iOS 26's capsule track with an opaque thumb. When the selection moves,
 *   and while the thumb is held and dragged, the thumb lifts into a Liquid
 *   Glass lens that slides to the new segment and settles back, as UIKit's
 *   segmented control does. The lens is the only glass: the segments are
 *   plain.
 * - `'frosted'` (iOS 15 to 25): the segmented control of iOS 13 to 18, a
 *   gray track with rounded corners, hairline separators and a raised white
 *   thumb that slides, and shrinks a little while held.
 * - `'material'` (Android): Material 3 Expressive's connected button group,
 *   which replaces Material's deprecated segmented buttons: segments 2dp
 *   apart with small inner corners, the selected one filled with the primary
 *   color and fully round. Nothing slides, as nothing does in Material's
 *   group.
 *
 * The segments share the track's width equally, unless an app sizes them
 * itself. The indicator follows each segment's measured width, so segments
 * of different widths, and a control that's resized or rotated, work too.
 * Under Reduce Motion the indicator jumps rather than slides, and doesn't
 * lift into glass.
 */
@Injectable()
export class UiSegmentedControl {
  readonly #injector = inject(Injector);
  #hostRef?: SegmentedHost;
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #scheme = injectColorScheme();

  /** The design on this platform, which the segments follow. */
  readonly design = injectGlassDesign();

  /** Each segment's measured width, by value. */
  readonly #widths = signal<Readonly<Record<string, number>>>({});
  /**
   * Whether the indicator has been placed on the measured segments. It's
   * placed without a transition, so it doesn't slide in from where it sat
   * before the widths were known.
   */
  readonly #placed = signal(false);
  readonly #drag = signal<Drag | null>(null);
  /** The segment a finger (or the mouse) is down on. */
  readonly #pressed = signal<string | null>(null);
  readonly #lens = signal<LensPhase>('off');

  /**
   * Set when a drag chose a segment, so the tap Lynx may send as the finger
   * lifts doesn't choose the segment the drag started on again.
   */
  #dragChose = false;
  #openTimer?: ReturnType<typeof setTimeout>;
  #settleTimer?: ReturnType<typeof setTimeout>;
  #placeTimer?: ReturnType<typeof setTimeout>;

  protected readonly cleanup = inject(DestroyRef).onDestroy(() => {
    stop(this.#openTimer);
    stop(this.#settleTimer);
    stop(this.#placeTimer);
  });

  /**
   * The host, looked up when first read rather than injected: the host
   * component injects this control in its own fields, before it exists to
   * be injected itself.
   */
  #host(): SegmentedHost {
    return (this.#hostRef ??= this.#injector.get(UI_SEGMENTED_HOST));
  }

  /** Whether the host is drawn as a segmented control. */
  readonly enabled = computed(() => this.#host().segmented());

  /**
   * Whether one indicator slides between the segments: for a single
   * selection, in Apple's designs. Material's segments fill themselves.
   */
  readonly slides = computed(
    () =>
      this.enabled() &&
      !this.#host().multiple() &&
      this.design() !== 'material',
  );

  readonly #dark = computed(() => this.#scheme() === 'dark');
  readonly #animates = computed(() => !this.#settings.reduceMotion());

  /**
   * Whether the indicator lifts into glass as it moves: on glass, unless
   * Reduce Motion is on (lifting is motion) or Reduce Transparency is
   * (there'd be no glass to see through).
   */
  readonly #lifts = computed(
    () =>
      this.slides() &&
      this.design() === 'glass' &&
      this.#animates() &&
      !this.#settings.reduceTransparency(),
  );

  /**
   * Whether the track draws under its segments (see UiSegmentedIndicator):
   * the indicator and the separators of Apple's designs.
   */
  readonly underlay = computed(
    () => this.enabled() && this.design() !== 'material',
  );

  /**
   * The selected value, for a single selection: only a single selection has
   * the indicator and its drag, which read this.
   */
  readonly #selected = computed(() => this.#host().selectedValues()[0]);

  /**
   * Every segment's frame, in order, from their measured widths, and the
   * width of them all; null until every segment has been measured. The
   * segments sit side by side with no gap, so each starts where the last
   * ended. Widths, not positions, are measured: Lynx reports a layout's
   * position relative to the whole page, which goes stale for a segment
   * whose own layout didn't change when the control moved.
   */
  readonly #layout = computed(() => {
    const widths = this.#widths();
    const frames: SegmentFrame[] = [];
    let left = 0;
    for (const value of this.#host().segmentValues()) {
      const width = widths[value];
      if (width === undefined) return null;
      frames.push({ left, width });
      left += width;
    }
    return { frames, total: left };
  });

  /**
   * Where the indicator is while it's dragged: it keeps its width and
   * follows the pointer, kept within the track. `under` is the segment its
   * middle is over, which it moves to when released.
   */
  readonly #dragFrame = computed(() => {
    // The drag first: a segment reads this as it's drawn, and the layout
    // reads every segment's value, which segments drawn by `@for` don't all
    // have yet (Angular throws NG0950 for a required input read too early).
    const drag = this.#drag();
    if (!drag) return null;
    const layout = this.#layout();
    if (!layout) return null;
    // The segment it started on is gone if segments were removed mid-drag.
    const from = layout.frames[drag.start];
    if (!from) return null;
    const { width, left: start } = from;
    const left = Math.min(Math.max(start + drag.dx, 0), layout.total - width);
    const middle = left + width / 2;
    const under = layout.frames.findIndex(
      (frame) => middle < frame.left + frame.width,
    );
    return { left, width, under };
  });

  /**
   * The segment that shows as selected: the one the indicator is over while
   * it's dragged, which takes the selected label's weight as it passes.
   */
  readonly #highlighted = computed(() => {
    const dragged = this.#dragFrame();
    return dragged
      ? this.#host().segmentValues()[dragged.under]
      : this.#selected();
  });

  // ---------------------------------------------------------------------------
  // The track and the indicator
  // ---------------------------------------------------------------------------

  /** The track's classes: the row the segments sit in. */
  readonly trackClass = computed(() => {
    const design = this.design();
    return cn(
      'flex-row flex relative',
      design === 'material'
        ? // No clip: the end segments round the group's ends themselves
          // (see materialCorners), and a clip would cut their outlines.
          'h-[40px] gap-[2px]'
        : cn(
            'h-[32px] bg-muted',
            design === 'glass' ? 'rounded-full' : 'rounded-[9px]',
          ),
      this.#host().disabled() && 'opacity-50',
    );
  });

  /**
   * The indicator's frame in the track: over the selected segment, or under
   * the pointer while dragged. Until every segment is measured, it takes an
   * equal share of the track, which is right for segments of equal width,
   * the default. It slides when the selection moves, but jumps under Reduce
   * Motion, when it's first placed and while it follows a drag.
   */
  readonly frameStyle = computed(() => {
    const values = this.#host().segmentValues();
    const selected = this.#selected();
    const index = selected === undefined ? -1 : values.indexOf(selected);
    const layout = this.#layout();
    const dragged = this.#dragFrame();
    let left: string;
    let width: string;
    if (dragged) {
      left = px(dragged.left);
      width = px(dragged.width);
    } else if (layout && index !== -1) {
      left = px(layout.frames[index]!.left);
      width = px(layout.frames[index]!.width);
    } else {
      const share = 100 / Math.max(values.length, 1);
      left = `${Math.max(index, 0) * share}%`;
      width = `${share}%`;
    }
    const slides = this.#animates() && this.#placed() && !dragged;
    // The transition goes first, so it's in place for the frame it animates.
    return {
      transition: slides
        ? this.design() === 'glass'
          ? GLASS_SLIDE
          : FROSTED_SLIDE
        : 'none',
      left,
      width,
      opacity: index === -1 ? '0' : '1',
    };
  });

  /**
   * The separators between the segments before iOS 26, as each one's
   * inline style: a hairline on each boundary, hidden beside a selected
   * segment (or the thumb, while it's dragged). None until the segments are
   * measured.
   */
  readonly separators = computed(() => {
    const layout = this.#layout();
    if (this.design() !== 'frosted' || !layout) return [];
    const values = this.#host().segmentValues();
    const transition = this.#animates() ? SEPARATOR_TRANSITION : 'none';
    return layout.frames.slice(1).map((frame, index) => ({
      transition,
      // Centered on the boundary.
      left: px(frame.left - 0.5),
      opacity:
        this.isOn(values[index]!) || this.isOn(values[index + 1]!)
          ? '0'
          : SEPARATOR_OPACITY,
    }));
  });

  /** Whether the glass lens is drawn (see LensPhase). */
  readonly lensShown = computed(() => this.#lens() !== 'off');

  /** The lens's frame in the indicator: the thumb's, or larger when open. */
  readonly lensStyle = computed(() => {
    const open = this.#lens() === 'open';
    const x = open ? THUMB_INSET - LENS_GROWTH.x : THUMB_INSET;
    const y = open ? THUMB_INSET - LENS_GROWTH.y : THUMB_INSET;
    return {
      transition: LENS_TRANSITION,
      left: px(x),
      right: px(x),
      top: px(y),
      bottom: px(y),
    };
  });

  /**
   * The thumb's look, for the indicator and for a segment that draws its
   * own (see #ownThumb): a capsule on iOS 26, round corners before; white in
   * a light theme, or in a dark one the gray UIKit draws (see
   * DARK_THUMB_COLOR), opaque so the lens under it stays hidden at rest.
   */
  readonly #thumbLook = computed(() => ({
    class: cn(
      this.design() === 'glass' ? 'rounded-full' : 'rounded-[7px]',
      !this.#dark() && 'bg-background',
      this.#settings.increaseContrast() && 'border border-foreground',
    ),
    // Inline: Lynx draws no shadow classes.
    style: {
      'background-color': this.#dark() ? DARK_THUMB_COLOR : null,
      'box-shadow':
        this.design() === 'glass' ? GLASS_THUMB_SHADOW : FROSTED_THUMB_SHADOW,
    },
  }));

  readonly thumbClass = computed(() => cn('absolute', this.#thumbLook().class));

  /**
   * The indicator's thumb: inset in the segment, faded out while the lens
   * is open, and before iOS 26 a little smaller while it's held.
   */
  readonly thumbStyle = computed(() => {
    const held = this.design() === 'frosted' && !!this.#drag();
    return {
      transition: this.#animates() ? THUMB_TRANSITION : 'none',
      left: px(THUMB_INSET),
      right: px(THUMB_INSET),
      top: px(THUMB_INSET),
      bottom: px(THUMB_INSET),
      opacity: this.#lens() === 'open' ? '0' : '1',
      transform: held ? 'scale(0.95)' : 'scale(1)',
      ...this.#thumbLook().style,
    };
  });

  // ---------------------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------------------

  /**
   * The classes of a segment's host, the row's flex item: an equal share of
   * the track. Positioned, so that on the web it paints over the indicator,
   * which comes before it (see investigations/lynx-vs-web-differences.md).
   */
  readonly segmentHostClass = 'flex-1 flex-row flex relative';

  /**
   * Whether a segment shows as selected: it's selected, or for a single
   * selection, the indicator is being dragged over it.
   */
  isOn(value: string): boolean {
    return this.#host().multiple()
      ? this.#host().selectedValues().includes(value)
      : this.#highlighted() === value;
  }

  /**
   * The classes of a segment's own view, around its content. A Material
   * segment points `--foreground` at its content's color: a component can't
   * recolor text projected into it (Lynx doesn't inherit `color`), but text
   * written `text-foreground` reads the variable, which does inherit.
   *
   * `place` is where the segment sits in the row (see SegmentPlace), which
   * Material's ends follow.
   */
  segmentClass(value: string, place: SegmentPlace): string {
    const on = this.isOn(value);
    if (this.design() === 'material') {
      return cn(
        'flex-1 flex-row items-center gap-2 px-4 flex relative justify-center overflow-hidden',
        on
          ? 'rounded-full bg-primary [--foreground:var(--primary-foreground)] [--muted-foreground:var(--primary-foreground)]'
          : cn(
              materialCorners(place),
              'bg-secondary [--foreground:var(--secondary-foreground)] [--muted-foreground:var(--secondary-foreground)]',
            ),
        // Increase Contrast outlines the light unselected segments. The
        // selected one's dark fill stands out already, and its outline in
        // the fill's own color keeps every segment the same size. Named
        // colors, not `border-foreground`: the segment redefines that
        // variable for its content.
        this.#settings.increaseContrast() &&
          (on ? 'border border-primary' : 'border border-secondary-foreground'),
      );
    }
    return cn(
      'flex-1 flex-row items-center gap-1.5 px-3 flex relative justify-center',
      // In a multiple selection each segment is its own thumb, inset in its
      // slot, and drawn while selected (see #ownThumb).
      this.#host().multiple() && 'm-[2px]',
      this.#ownThumb(value) && this.#thumbLook().class,
      // A pressed segment's content dims, as UIKit highlights it, unless
      // the press took hold of the indicator and is dragging it away.
      !on && this.#pressed() === value && !this.#drag() && 'opacity-60',
    );
  }

  /**
   * A segment's inline style: Material's fill changes color smoothly, and a
   * segment that's its own thumb takes the thumb's color and shadow.
   */
  segmentStyle(value: string): Record<string, string | null> | null {
    if (this.design() === 'material') {
      return {
        transition: this.#animates() ? MATERIAL_FILL_TRANSITION : 'none',
      };
    }
    return this.#ownThumb(value) ? this.#thumbLook().style : null;
  }

  /**
   * Whether a segment draws the thumb itself: in a multiple selection,
   * which has no indicator, each selected segment does, in Apple's designs.
   * Its own view is the thumb, rather than a view under its content, which
   * the web would paint over the content (an absolute view paints above
   * static ones there).
   */
  #ownThumb(value: string): boolean {
    return (
      this.#host().multiple() &&
      this.design() !== 'material' &&
      this.isOn(value)
    );
  }

  /**
   * The classes of a segment's label, for a control that draws its own:
   * 13pt as in UIKit, medium when selected on iOS 26 and semibold before;
   * Material's label in its content color.
   */
  labelClass(value: string): string {
    const on = this.isOn(value);
    switch (this.design()) {
      case 'material':
        return cn(
          'text-[14px] font-medium',
          on ? 'text-primary-foreground' : 'text-secondary-foreground',
        );
      case 'glass':
        return cn('text-[13px] text-foreground', on && 'font-medium');
      default:
        return cn('text-[13px] text-foreground', on && 'font-semibold');
    }
  }

  /**
   * The color of icons in a segment, as a token: Material's content color,
   * or undefined for the icons' own default.
   */
  iconColor(value: string): string | undefined {
    if (this.design() !== 'material') return undefined;
    return this.isOn(value)
      ? 'var(--primary-foreground)'
      : 'var(--secondary-foreground)';
  }

  /**
   * The classes of Material's state layer on a segment, or null: it shows
   * while the segment is pressed.
   */
  stateLayerClass(value: string): string | null {
    return this.design() === 'material' && this.#pressed() === value
      ? STATE_LAYER_CLASS
      : null;
  }

  // ---------------------------------------------------------------------------
  // Events from the segments
  // ---------------------------------------------------------------------------

  /**
   * A segment's `layoutchange`: its width places the indicator.
   */
  measure(value: string, event: unknown): void {
    const width = layoutWidth(event);
    if (width === undefined || this.#widths()[value] === width) return;
    this.#widths.update((widths) => ({ ...widths, [value]: width }));
    // Once every segment is measured, the indicator moves onto them at once,
    // and slides from the next change on.
    if (!this.#placed() && this.#layout()) {
      stop(this.#placeTimer);
      this.#placeTimer = setTimeout(() => this.#placed.set(true), 0);
    }
  }

  /**
   * A finger or the mouse went down on a segment. On the selected segment
   * of a sliding control, it takes hold of the indicator, which lifts into
   * glass and follows the pointer.
   */
  press(value: string, event: unknown): void {
    if (this.#host().disabled()) return;
    this.#dragChose = false;
    this.#pressed.set(value);
    const x = pointerX(event);
    if (
      this.slides() &&
      value === this.#selected() &&
      this.#layout() &&
      x !== undefined
    ) {
      const start = this.#host().segmentValues().indexOf(value);
      this.#drag.set({ start, startX: x, dx: 0 });
      this.#lift();
    }
  }

  /**
   * The pointer moved: a held indicator follows it.
   */
  move(event: unknown): void {
    const drag = this.#drag();
    const x = pointerX(event);
    if (drag && x !== undefined) {
      this.#drag.set({ ...drag, dx: x - drag.startX });
    }
  }

  /**
   * The pointer went up. A held indicator that was dragged selects the
   * segment it's over, and settles there.
   */
  release(): void {
    this.#pressed.set(null);
    const drag = this.#drag();
    if (!drag) return;
    const dragged = this.#dragFrame();
    this.#drag.set(null);
    if (dragged && Math.abs(drag.dx) >= DRAG_SLOP) {
      this.#dragChose = true;
      const value = this.#host().segmentValues()[dragged.under]!;
      if (value !== this.#selected()) this.#host().select(value);
    }
    this.#settle(DURATION.normal);
  }

  /**
   * The touch was taken away (by a scroll, say), or the mouse left the
   * track: a held indicator goes back to the selected segment.
   */
  cancel(): void {
    this.#pressed.set(null);
    if (!this.#drag()) return;
    this.#drag.set(null);
    this.#settle(DURATION.normal);
  }

  /**
   * The mouse left a segment: it's no longer pressed. A drag goes on.
   */
  leave(value: string): void {
    if (this.#pressed() === value) this.#pressed.set(null);
  }

  /**
   * A segment was tapped. Returns whether to select it: not in a disabled
   * control, and not when the tap ends a drag, which chose already. A tap that moves the selection lifts
   * the indicator into glass for the slide.
   */
  tap(value: string): boolean {
    if (this.#host().disabled()) return false;
    if (this.#dragChose) {
      this.#dragChose = false;
      return false;
    }
    if (this.slides() && value !== this.#selected()) {
      this.#lift();
      this.#settle(DURATION.slow);
    }
    return true;
  }

  /**
   * Lifts the indicator into the glass lens (see LensPhase): the lens is
   * drawn under the thumb first, then grows a tick later, so it grows from
   * the thumb's size rather than appearing at its own.
   */
  #lift(): void {
    if (!this.#lifts()) return;
    stop(this.#settleTimer);
    if (this.#lens() === 'off') {
      this.#lens.set('rest');
      stop(this.#openTimer);
      this.#openTimer = setTimeout(() => this.#lens.set('open'), 0);
    } else {
      this.#lens.set('open');
    }
  }

  /**
   * Settles the lens back into the thumb once the indicator has arrived,
   * after `delay` ms: it shrinks under the thumb as the thumb fades back in,
   * and goes once hidden.
   */
  #settle(delay: number): void {
    if (this.#lens() === 'off') return;
    stop(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      this.#lens.set('rest');
      this.#settleTimer = setTimeout(
        () => this.#lens.set('off'),
        DURATION.fast,
      );
    }, delay);
  }
}

/**
 * What a segmented control draws under its segments (see
 * UiSegmentedControl): the selection indicator, the thumb that slides
 * between them and the glass lens it lifts into on iOS 26, and before iOS 26
 * the separators between them. Put it first in the track, when the control's
 * `underlay()` says so, so the segments draw over it.
 */
@Component({
  selector: 'ui-segmented-indicator',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  host: {
    // Absolute, so it takes no room in the track's row.
    class: 'h-full w-full absolute left-0 top-0',
    'accessibility-elements-hidden': 'true',
  },
  // The lens comes before the thumb, so the opaque thumb covers it at rest.
  // Clear glass, as UIKit's lens is: it shows the labels it passes over.
  template: `
    @for (separator of control.separators(); track $index) {
      <view
        class="w-[1px] bg-muted-foreground absolute bottom-[8px] top-[8px]"
        [style]="separator"
      ></view>
    }
    @if (control.slides()) {
      <view class="absolute bottom-0 top-0" [style]="control.frameStyle()">
        @if (control.lensShown()) {
          <blur-view
            ui-glass
            variant="clear"
            class="absolute"
            [style]="control.lensStyle()"
          ></blur-view>
        }
        <view
          [class]="control.thumbClass()"
          [style]="control.thumbStyle()"
        ></view>
      </view>
    }
  `,
})
export class UiSegmentedIndicator {
  protected readonly control = inject(UiSegmentedControl);
}
