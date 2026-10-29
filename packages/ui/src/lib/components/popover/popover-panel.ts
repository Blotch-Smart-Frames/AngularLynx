import {
  type OnDestroy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import { DURATION, EASING } from '../../utils/animate';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import {
  type MenuPlacement,
  type MenuPlacementMode,
  type MenuRect,
  menuStartFrame,
  placeMenu,
} from '../menu/menu-placement';
import {
  type MenuElement,
  type MenuPhase,
  measureMenuElement,
} from '../menu/menu-popup';

/**
 * An element a popover opens from: AngularLynx's element, which an
 * `ElementRef` or a template reference to a Lynx element holds.
 */
export type PopoverAnchor = MenuElement;

/**
 * Where a popover is in its open and close sequence; see MenuPhase, whose
 * steps it shares.
 */
export type PopoverPhase = MenuPhase;

/** How each design draws and places the popover. */
type PopoverMetrics = {
  /** Its corner radius, in px. */
  readonly radius: number;
  /** Over its anchor (`'grow'`), or beside it; see MenuPlacementMode. */
  readonly mode: MenuPlacementMode;
  /** The space between the popover and an anchor it opens beside. */
  readonly gap: number;
  /** Where it grows from; see menuStartFrame. */
  readonly from: 'anchor' | 'corner' | 'edge';
};

/** The arrow of a popover before iOS 26: its base and its height, in px. */
export const ARROW_WIDTH = 26;
export const ARROW_HEIGHT = 13;
/**
 * The side of the square turned 45° whose corner pokes out as the arrow: its
 * diagonal is the arrow's base.
 */
const ARROW_SIDE = ARROW_WIDTH / Math.SQRT2;

const METRICS: Readonly<Record<GlassDesign, PopoverMetrics>> = {
  // iOS 26 grows a popover out of the control that presents it, over it,
  // and the control hides until it closes (UIPopoverPresentationController's
  // sourceItem): the pull-down menu's growth.
  glass: { radius: 24, mode: 'grow', gap: 0, from: 'anchor' },
  // iOS 15 to 25 put a popover beside its control, with an arrow pointing at
  // it, a little way off.
  frosted: {
    radius: 13,
    mode: 'beside',
    gap: ARROW_HEIGHT + 2,
    from: 'corner',
  },
  // Material 3's menu surface unfolds from the edge nearest its anchor.
  material: { radius: 16, mode: 'beside', gap: 8, from: 'edge' },
};

/** The space the popover keeps from the screen's edges, in px. */
const MARGIN = 8;

/**
 * How long the panel gets to lay out before it's measured: a frame or two.
 */
const LAYOUT_DELAY = 32;

/**
 * How long the panel waits at its start frame, so the native side draws it
 * there before the transition to its frame starts.
 */
const FRAME_DELAY = 16;

const ZERO_RECT: MenuRect = { left: 0, top: 0, width: 0, height: 0 };

/** A point, in px. */
type Offset = { readonly left: number; readonly top: number };

/**
 * Where a popover's arrow goes before iOS 26, in the same coordinates as
 * `placement`: on the edge of the popover that faces its anchor, pointing at
 * the anchor's middle, but no nearer the corners than their `radius`.
 *
 * `left` and `top` are the corner of the arrow's `ARROW_WIDTH` ×
 * `ARROW_HEIGHT` box, and `up` says it points up, at an anchor above the
 * popover. Null when the popover couldn't open beside its anchor and covers
 * it instead (see placeMenu), with nothing to point at.
 */
export const popoverArrow = (
  placement: MenuPlacement,
  radius: number,
): { left: number; top: number; up: boolean } | null => {
  const { frame, anchor, vertical } = placement;
  const up = vertical === 'top';
  const beside = up
    ? frame.top >= anchor.top + anchor.height
    : frame.top + frame.height <= anchor.top;
  if (!beside) return null;
  const middle = anchor.left + anchor.width / 2;
  const left = Math.min(
    Math.max(middle - ARROW_WIDTH / 2, frame.left + radius),
    frame.left + frame.width - radius - ARROW_WIDTH,
  );
  return {
    left,
    top: up ? frame.top - ARROW_HEIGHT : frame.top + frame.height,
    up,
  };
};

/**
 * The panel of a popover and of an action sheet opened from a control:
 * content that opens from the element that presents it and leaves the rest
 * of the screen as it was. Nothing dims, and a touch anywhere else closes it
 * and still reaches what it touched, so one tap can close a popover and
 * press the button under the finger. `ui-popover` and an anchored
 * `ui-action-sheet` hold one, and project their content into it.
 *
 * Unlike the menus' overlay, which is a window over the whole screen that
 * takes every touch, the panel is a `position: fixed` view in the page: Lynx
 * lifts it to the page root, above the content, and hit-tests it like any
 * other view. It hears touches elsewhere through `global-bind` listeners,
 * which Lynx runs for a touch on any element, and only while it's shown.
 * It tells touches on itself apart with ordinary bubbling listeners: on
 * iOS, Lynx 4.1 ran no `capture-bind` listener, on a view or a blur view.
 *
 * Opening measures the anchor, the screen's safe area (two marker views of
 * no size, which cover nothing) and the content at its natural size off
 * screen; places the panel with the pull-down menu's placeMenu; and grows it
 * from its start frame (see menuStartFrame) with CSS transitions:
 *
 * - **iOS 26 and later** (`glass`): Liquid Glass that grows out of the
 *   anchor, over it, the way UIKit's popovers and action sheets grow out of
 *   their source item. The anchor hides meanwhile (see coversAnchor).
 * - **iOS 15 to 25** (`frosted`): the frosted material beside the anchor,
 *   with an arrow pointing at it.
 * - **Android** (`material`): Material 3's menu surface, which unfolds from
 *   the edge nearest the anchor on a solid surface with a shadow. Liquid
 *   Glass, as on iOS 26, with `provideGlass({ android: 'glass' })`.
 *
 * Under Reduce Motion it appears in place and only its content fades.
 */
@Component({
  selector: 'ui-popover-panel',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- The safe area's top edge, as wide as it and no taller, and an edge
         from the top of the page to the bottom of the safe area, no wider:
         where the panel has to stay, measured without covering anything. -->
    <view
      #area
      style="position: fixed; top: env(safe-area-inset-top); left: env(safe-area-inset-left); right: env(safe-area-inset-right); height: 0;"
      (bindlayoutchange)="onAreaLayout($event)"
    ></view>
    <view
      #page
      style="position: fixed; top: 0; left: 0; bottom: env(safe-area-inset-bottom); width: 0;"
    ></view>
    @if (visible()) {
      @if (arrow(); as arrow) {
        <!-- The arrow: a frosted square turned 45°, clipped to the half that
             pokes out of the panel. -->
        <view
          class="overflow-hidden"
          style="position: fixed; z-index: 999;"
          [style.left.px]="arrow.left"
          [style.top.px]="arrow.top"
          [style.width.px]="arrowWidth"
          [style.height.px]="arrowHeight"
          (bindtouchstart)="touchedInside()"
          (bindmousedown)="touchedInside()"
        >
          <blur-view
            ui-glass
            shape="rounded"
            [radius]="3"
            class="absolute"
            style="transform: rotate(45deg);"
            [style.left.px]="arrowSquare.left"
            [style.top.px]="arrow.up ? arrowSquare.top : -arrowSquare.top"
            [style.width.px]="arrowSquare.side"
            [style.height.px]="arrowSquare.side"
          ></blur-view>
        </view>
      }
      <!-- Fixed, so Lynx lifts it to the page root, and stacked above the
           root's other children. -->
      <blur-view
        #panel
        ui-glass
        shape="rounded"
        [radius]="metrics().radius"
        class="flex-col flex overflow-hidden"
        style="position: fixed; z-index: 999;"
        [style.left.px]="panelPosition().left"
        [style.top.px]="panelPosition().top"
        [style.width.px]="frame()?.width"
        [style.height.px]="frame()?.height"
        [glassId]="glassId()"
        [style.opacity]="panelOpacity()"
        [style.visibility]="panelVisibility()"
        [style.transition]="panelTransition()"
        [style.align-items]="
          placement()?.horizontal === 'right' ? 'flex-end' : 'flex-start'
        "
        [style.justify-content]="
          placement()?.vertical === 'bottom' ? 'flex-end' : 'flex-start'
        "
        (bindtouchstart)="touchedInside()"
        (bindmousedown)="touchedInside()"
        (global-bindtouchstart)="touchedAnywhere()"
        (global-bindmousedown)="touchedAnywhere()"
      >
        <!-- Fixed at the panel's size once it's measured, and pinned to the
             edge nearest the anchor, so the content stays put while the
             glass grows around it instead of reflowing. -->
        <view
          #content
          class="shrink-0 flex-col flex"
          [style.width.px]="placement()?.frame.width ?? width()"
          [style.height.px]="placement()?.frame.height"
          [style.max-width.px]="maxWidth()"
          [style.opacity]="phase() === 'open' ? 1 : 0"
          [style.transition]="contentTransition()"
        >
          <ng-content />
        </view>
      </blur-view>
    }
  `,
})
export class UiPopoverPanel implements OnDestroy {
  /** Whether the panel is open. */
  readonly open = input(false);
  /** The element it opens from. */
  readonly anchor = input.required<PopoverAnchor>();
  /**
   * The panel's width, in px. By default, its content's natural width, as
   * wide as the screen at most.
   */
  readonly width = input<number | undefined>(undefined);
  /**
   * The id the panel's glass shares with its anchor's (see UiGlass's
   * `glassId`), so that on iOS the panel takes over a glass anchor's glass.
   */
  readonly glassId = input<string | undefined>(undefined);

  /** A touch landed outside the panel (and outside its anchor). */
  readonly dismissed = output<void>();
  /** The panel has closed and its close animation has finished. */
  readonly closed = output<void>();

  readonly #settings = inject(LynxAccessibilitySettings);

  readonly design = injectGlassDesign();
  readonly phase = signal<PopoverPhase>('closed');
  readonly placement = signal<MenuPlacement | null>(null);
  readonly metrics = computed(() => METRICS[this.design()]);

  // Required: the markers are always in the template, and the panel and
  // its content while it's shown, the only time they're read.
  readonly area = viewChild.required<ElementRef<PopoverAnchor>>('area');
  readonly page = viewChild.required<ElementRef<PopoverAnchor>>('page');
  readonly panel = viewChild.required('panel', { read: ElementRef });
  readonly content = viewChild.required<ElementRef<PopoverAnchor>>('content');

  protected readonly arrowWidth = ARROW_WIDTH;
  protected readonly arrowHeight = ARROW_HEIGHT;
  /**
   * The turned square in the arrow's box: centered on the panel's edge, so
   * half of it shows. `top` is for an arrow pointing up; one pointing down
   * hangs it from the box's top instead.
   */
  protected readonly arrowSquare = {
    side: ARROW_SIDE,
    left: (ARROW_WIDTH - ARROW_SIDE) / 2,
    top: ARROW_HEIGHT - ARROW_SIDE / 2,
  };

  readonly #reduceMotion = computed(() => this.#settings.reduceMotion());
  readonly #material = computed(() => this.design() === 'material');

  protected readonly visible = computed(() => this.phase() !== 'closed');

  /**
   * Whether the panel covers its anchor now: Liquid Glass grows out of it
   * and shrinks back into it, so the anchor hides meanwhile, as on iOS 26.
   * The other designs open beside it.
   *
   * The anchor hides with `visibility`, in the same update that shows the
   * panel at its place (see panelVisibility), and shows in the one that
   * takes the panel away. On iOS 26 and later, the shell pairs a glass
   * anchor with the panel across those changes (see glassId): the panel
   * takes over the anchor's corners, and the anchor's content fades out in
   * it, and back in as the panel closes.
   */
  readonly coversAnchor = computed(() => {
    const phase = this.phase();
    return (
      this.design() === 'glass' && phase !== 'closed' && phase !== 'measuring'
    );
  });

  /**
   * Where the safe area's top-left corner is in the page, whose corner the
   * fixed panel is placed from.
   */
  readonly #offset = signal<Offset>({ left: 0, top: 0 });

  /** The panel's box in the safe area: off screen while it's measured. */
  protected readonly frame = computed<MenuRect | null>(() => {
    const placement = this.placement();
    const phase = this.phase();
    if (!placement || phase === 'measuring') return null;
    if (phase === 'open' || this.#reduceMotion()) return placement.frame;
    return menuStartFrame(placement, this.metrics().from);
  });

  protected readonly panelPosition = computed<Offset>(() => {
    const frame = this.frame();
    const offset = this.#offset();
    return frame
      ? { left: offset.left + frame.left, top: offset.top + frame.top }
      : { left: -10000, top: 0 };
  });

  /**
   * The arrow before iOS 26, once the panel is open, in the page. It doesn't
   * grow, so it shows only while the panel is at its frame.
   */
  protected readonly arrow = computed(() => {
    const placement = this.placement();
    if (this.design() !== 'frosted' || !placement) return null;
    if (this.phase() !== 'open') return null;
    const arrow = popoverArrow(placement, this.metrics().radius);
    const offset = this.#offset();
    return (
      arrow && {
        ...arrow,
        left: offset.left + arrow.left,
        top: offset.top + arrow.top,
      }
    );
  });

  /**
   * The content's widest, until it's placed: the safe area, inside the
   * margins, so long text wraps rather than running off the screen.
   */
  protected readonly maxWidth = computed(() =>
    this.#areaWidth() > 0 ? this.#areaWidth() - 2 * MARGIN : null,
  );

  /**
   * Material's solid surface fades as it unfolds. Glass doesn't fade: iOS
   * draws a blur view with less than full opacity wrongly, so it only grows
   * and shrinks, and its content fades.
   */
  protected readonly panelOpacity = computed(() =>
    this.#material() && this.phase() !== 'open' ? 0 : 1,
  );
  protected readonly panelTransition = computed(() =>
    this.#transition(['left', 'top', 'width', 'height', 'opacity']),
  );

  /**
   * The panel is hidden while it's measured, so it shows in the same update
   * that hides its anchor (see coversAnchor).
   */
  protected readonly panelVisibility = computed(() =>
    this.phase() === 'measuring' ? 'hidden' : null,
  );
  protected readonly contentTransition = computed(() =>
    this.#transition(['opacity']),
  );

  /**
   * A transition of `properties` for the phase: springy as the panel opens,
   * quicker as it closes, none while it's placed. Under Reduce Motion
   * nothing moves or grows, and only the fades play.
   */
  #transition(properties: readonly string[]): string {
    const phase = this.phase();
    if (phase !== 'open' && phase !== 'closing') return 'none';
    const [duration, easing] =
      phase === 'open'
        ? [DURATION.slow, EASING.springSubtle]
        : [DURATION.normal, EASING.standard];
    const animated = this.#reduceMotion()
      ? properties.filter((property) => property === 'opacity')
      : properties;
    return animated
      .map((property) => `${property} ${duration}ms ${easing}`)
      .join(', ');
  }

  /**
   * Increases with every open or close request; a sequence that sees it
   * change while it waits stops, so a quick close can't be overtaken by the
   * open it interrupted.
   */
  #run = 0;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Opens or closes as `open` changes. A field rather than a constructor:
   * Angular's test build keeps a function for a constructor that nothing
   * calls, which an app's coverage report would show as uncovered.
   */
  protected readonly openOrClose = effect(() => {
    const open = this.open();
    untracked(() => {
      if (open) void this.#show();
      else this.#hide();
    });
  });

  /**
   * The safe area's width as laid out, in the app's own pixels, from its
   * `layoutchange` event; 0 until that arrives. `boundingClientRect`
   * measures in the screen's pixels, which the docs' web previews scale
   * down, so the two give the scale to undo (see UiMenuPopup, which does
   * the same).
   */
  readonly #areaWidth = signal(0);

  protected onAreaLayout(event: unknown): void {
    this.#areaWidth.set(
      (event as { detail?: { width?: number } }).detail?.width ?? 0,
    );
  }

  /**
   * Whether the touch going on now began on the panel or its anchor; see
   * touchedAnywhere.
   */
  #touchedInside = false;

  /**
   * A touch began on the panel (or its arrow).
   */
  protected touchedInside(): void {
    this.#touchedInside = true;
  }

  /**
   * A touch began on the anchor, which the element that presents the panel
   * reports: touching it toggles the panel, so it doesn't count as outside.
   */
  touchedAnchor(): void {
    if (this.visible()) this.#touchedInside = true;
  }

  /**
   * A touch began anywhere: closes the panel unless it began on the panel
   * or the anchor. Lynx runs a `global-bind` listener in the same dispatch
   * as the touched element's own listeners, before them on iOS, so the
   * check waits for the next timer, which runs after them all. Mouse
   * presses count too, for the web preview, where touch events come only
   * from a touch screen.
   */
  protected touchedAnywhere(): void {
    void this.#wait(0).then(() => {
      const inside = this.#touchedInside;
      this.#touchedInside = false;
      if (!inside) this.dismissed.emit();
    });
  }

  ngOnDestroy(): void {
    this.#run++;
    for (const timer of this.#timers) clearTimeout(timer);
  }

  /**
   * Waits `ms`, with a timer ngOnDestroy can stop.
   */
  #wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        resolve();
      }, ms);
      this.#timers.add(timer);
    });
  }

  async #show(): Promise<void> {
    const run = ++this.#run;
    // Opened again while closing: finish closing at once.
    if (this.phase() !== 'closed') this.#finishClose(false);
    this.#touchedInside = false;

    const anchor = await measureMenuElement(this.anchor());
    if (run !== this.#run) return;
    this.phase.set('measuring');

    await this.#wait(LAYOUT_DELAY);
    if (run !== this.#run) return;
    const [area, page, content] = await Promise.all([
      measureMenuElement(this.area().nativeElement),
      measureMenuElement(this.page().nativeElement),
      measureMenuElement(this.content().nativeElement),
    ]);
    if (run !== this.#run) return;

    // Measured boxes in the app's own pixels: see #areaWidth.
    const areaWidth = this.#areaWidth();
    const scale = area && areaWidth > 0 ? area.width / areaWidth : 1;
    const inPixels = (box: MenuRect | null): MenuRect => ({
      left: (box ?? ZERO_RECT).left / scale,
      top: (box ?? ZERO_RECT).top / scale,
      width: (box ?? ZERO_RECT).width / scale,
      height: (box ?? ZERO_RECT).height / scale,
    });
    const areaBox = inPixels(area);
    const pageBox = inPixels(page);
    const anchorBox = inPixels(anchor);
    const metrics = this.metrics();
    this.#offset.set({
      left: areaBox.left - pageBox.left,
      top: areaBox.top - pageBox.top,
    });
    this.placement.set(
      placeMenu({
        anchor: {
          ...anchorBox,
          left: anchorBox.left - areaBox.left,
          top: anchorBox.top - areaBox.top,
        },
        area: {
          width: areaBox.width,
          height: pageBox.top + pageBox.height - areaBox.top,
        },
        menu: {
          width: this.width() ?? inPixels(content).width,
          height: inPixels(content).height,
        },
        mode: metrics.mode,
        gap: metrics.gap,
        margin: MARGIN,
      }),
    );
    this.phase.set('from');

    await this.#wait(FRAME_DELAY);
    if (run !== this.#run) return;
    this.phase.set('open');
    // Move a screen reader into the panel: it would otherwise stay on what
    // opened it, which the panel may now cover. The rest of the screen
    // stays reachable, as the panel doesn't take over the screen.
    this.panel().nativeElement.invoke('requestAccessibilityFocus');
  }

  #hide(): void {
    const run = ++this.#run;
    const phase = this.phase();
    // Only a panel that's open or opening closes: `open` turning false again
    // reaches here only after it turned true, which ends any closing.
    if (phase === 'closed') return;
    if (phase === 'measuring') {
      this.#finishClose(true);
      return;
    }
    this.phase.set('closing');
    // +20ms: Lynx's timers can fire a little early, and the panel would
    // vanish before its transition ends.
    void this.#wait(DURATION.normal + 20).then(() => {
      if (run === this.#run) this.#finishClose(true);
    });
  }

  #finishClose(emit: boolean): void {
    this.placement.set(null);
    this.phase.set('closed');
    if (emit) this.closed.emit();
  }
}
