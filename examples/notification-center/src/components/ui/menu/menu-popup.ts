import {
  type OnDestroy,
  Component,
  ElementRef,
  Renderer2,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxHaptics,
  MainThreadElement,
} from '@blotch/angular-lynx';

import { DURATION, EASING } from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { injectColorScheme } from '../icon/icon-theme';
import {
  type MenuPlacement,
  type MenuRect,
  menuStartFrame,
  placeMenu,
} from './menu-placement';
import {
  type MenuDragTarget,
  type MenuPoint,
  type MenuRow,
  type MenuRows,
} from './menu-rows';

/**
 * What a menu is: a `'pull-down'` menu opened by a button, a `'context'`
 * menu opened by a long press on an element, or a `'submenu'` opened by a
 * row of another menu, which it grows out of.
 */
export type MenuKind = 'pull-down' | 'context' | 'submenu';

/**
 * An element the menu measures or moves: AngularLynx's element, which an
 * `ElementRef` or a template reference to a Lynx element holds.
 */
export type MenuElement = { readonly element: unknown };

/**
 * Where the menu is in its open and close sequence:
 *
 * - `'closed'`: the overlay is hidden.
 * - `'measuring'`: the overlay shows with the menu off screen, at its natural
 *   size, to measure it.
 * - `'from'`: the menu sits at its start frame, the anchor's box or a corner
 *   of the menu, ready to grow.
 * - `'open'`: the menu has grown to its frame, the screen has dimmed, and a
 *   context menu's element has lifted.
 * - `'closing'`: everything goes back the way it came.
 */
export type MenuPhase = 'closed' | 'measuring' | 'from' | 'open' | 'closing';

/** How each design draws the menu. */
type MenuMetrics = {
  /** Its width, in px. */
  readonly width: number;
  /** Its corner radius, in px. */
  readonly radius: number;
  /** Space above and below the items. */
  readonly padding: string;
};

const METRICS: Readonly<Record<GlassDesign, MenuMetrics>> = {
  // iOS 26's menus: rounder, with room around the rows.
  glass: { width: 250, radius: 24, padding: 'py-1.5' },
  // iOS 15 to 25's menus: rows edge to edge.
  frosted: { width: 250, radius: 14, padding: '' },
  // Material 3 Expressive's menu.
  material: { width: 224, radius: 16, padding: 'py-2' },
};

/**
 * How long the overlay gets to lay out before the menu inside it is
 * measured. Android shows an overlay as a dialog window of its own.
 */
const LAYOUT_DELAY = 32;

/**
 * How long the menu waits at its start frame, so the native side draws it
 * there before the transition to its frame starts.
 */
const FRAME_DELAY = 16;

/** How far a context menu's element lifts. */
const LIFT_SCALE = 1.03;

/**
 * Where the overlay sits on the web, where `<overlay>` has no size of its
 * own (see dialog.ts). Native Lynx sizes it to the screen and ignores these.
 */
const OVERLAY_STYLE =
  'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999;';

const ZERO_RECT: MenuRect = { left: 0, top: 0, width: 0, height: 0 };

/**
 * How visible a menu's rows stay while a submenu is open over it, as iOS
 * fades a menu behind its submenu, so the submenu's glass doesn't show
 * them through it.
 */
const COVERED_OPACITY = 0.3;

/**
 * How long a finger sliding across the menu rests on a submenu's row before
 * the submenu opens, as UIKit's does, in ms: long enough that a finger
 * passing over the row on its way to another doesn't open it.
 */
export const SUBMENU_REST_DELAY = 500;

/** A row's box in the menu's content, from the content's top left. */
type RowOffset = MenuRect;

/**
 * An element's box on screen, or null where it can't be measured.
 *
 * Lynx gives a script an element's position only through the
 * `boundingClientRect` UI method, which answers later. Measured from the
 * screen, so that an element in the page and one in the overlay, a window
 * of its own on iOS and Android, compare. Lynx for Web measures from the
 * `<lynx-view>` either way.
 */
export const measureMenuElement = async (
  element: MenuElement,
): Promise<MenuRect | null> => {
  try {
    const { left, top, width, height } = await new MainThreadElement(
      element.element as ConstructorParameters<typeof MainThreadElement>[0],
    ).getBoundingClientRect({ relativeTo: 'screen' });
    return { left, top, width, height };
  } catch {
    return null;
  }
};

/**
 * The overlay of a menu and a context menu: the glass menu itself, placed
 * against the element that opened it and kept on screen, with the screen
 * dimmed and the element lifted for a context menu. `ui-menu` and
 * `ui-context-menu` hold one, and project their items into it.
 *
 * Opening measures the anchor (the button or the pressed element), shows
 * the overlay, measures the menu and the safe area, places the menu (see
 * placeMenu), and then grows it from its start frame (see menuStartFrame)
 * with CSS transitions, which Lynx plays on iOS, Android and the web alike.
 * The menu is one glass shape whose frame grows: iOS's Liquid Glass follows
 * a moving or resizing shape frame by frame. It shows at the trigger's place
 * in the same update that hides the trigger, and hides in the one that shows
 * the trigger again, so the shell can pair a glass trigger with it (see
 * glassId).
 *
 * A context menu's element is lifted by moving the element itself into the
 * overlay, above the dimming layer, at the same place on screen, and back
 * when the menu closes: no copy and no snapshot, so it stays live and looks
 * exactly as it did. The element it came from keeps its size meanwhile (see
 * placeholder), so the page doesn't move under it.
 */
@Component({
  selector: 'ui-menu-popup',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay
      [attr.visible]="visible()"
      [style]="overlayStyle()"
      (bindrequestclose)="dismissed.emit()"
    >
      <!-- The overlay sizes only its first child, to the screen. A tap
           anywhere outside the menu lands here and dismisses it. -->
      <view class="h-full w-full" (bindtap)="onBackdropTap()">
        @if (blurs()) {
          <!-- Before iOS 26, a context menu blurred the screen. -->
          <blur-view
            class="h-full w-full absolute left-0 top-0"
            [blur-effect]="blurEffect()"
            blur-radius="12px"
            [style.opacity]="dimOpacity()"
            [style.transition]="dimTransition"
          ></blur-view>
        }
        @if (dims()) {
          <view
            class="h-full w-full bg-glass-dim absolute left-0 top-0"
            [style.opacity]="dimOpacity()"
            [style.transition]="dimTransition"
          ></view>
        }
        <!-- The screen inside its safe area, where the menu has to stay. -->
        <view
          #area
          style="position: absolute; top: env(safe-area-inset-top); bottom: env(safe-area-inset-bottom); left: env(safe-area-inset-left); right: env(safe-area-inset-right);"
          (bindlayoutchange)="onAreaLayout($event)"
        >
          <!-- A context menu's element, lifted above the dimming layer. -->
          <view
            #slot
            class="flex-col flex absolute"
            [style.left.px]="liftFrame()?.left"
            [style.top.px]="liftFrame()?.top"
            [style.width.px]="liftFrame()?.width"
            [style.transform]="liftTransform()"
            [style.transition]="liftTransition()"
          ></view>
          <blur-view
            #panel
            ui-glass
            shape="rounded"
            [radius]="metrics().radius"
            class="flex-col flex absolute overflow-hidden"
            [style.left.px]="frame()?.left ?? offScreen"
            [style.top.px]="frame()?.top ?? 0"
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
            [accessibility-exclusive-focus]="phase() === 'open'"
            (catchtap)="onPanelTap()"
          >
            <!-- Fixed at the menu's size (its natural size while it's
                 measured), and pinned to the edge nearest the anchor, so the
                 items stay put while the glass grows around them instead of
                 reflowing. A menu taller than the screen scrolls. -->
            <scroll-view
              scroll-orientation="vertical"
              class="shrink-0"
              [style.width.px]="placement()?.frame.width ?? metrics().width"
              [style.height.px]="placement()?.frame.height"
              [style.opacity]="contentOpacity()"
              [style.transition]="contentTransition()"
            >
              <!-- Reversed, an Apple menu that opens upward lists its items
                   from the bottom up (see MenuRows' reversed). -->
              <view
                #content
                [class]="contentClass()"
                [style.flex-direction]="
                  rows()?.reversed() ? 'column-reverse' : 'column'
                "
              >
                <ng-content />
              </view>
            </scroll-view>
          </blur-view>
        </view>
      </view>
    </overlay>
  `,
})
export class UiMenuPopup implements OnDestroy, MenuDragTarget {
  /** Whether the menu is open. */
  readonly open = input(false, { transform: booleanAttribute });
  /** The element the menu opens from: a button, or the pressed element. */
  readonly anchor = input.required<MenuElement>();
  /** A `'pull-down'` or a `'context'` menu; see MenuKind. */
  readonly kind = input<MenuKind>('pull-down');
  /**
   * Where a context menu's lifted element goes back to: the element it was
   * in. Without one, the element isn't lifted.
   */
  readonly anchorHome = input<MenuElement | null>(null);
  /**
   * The id the menu's glass shares with its trigger's (see UiGlass's
   * `glassId`), so that on iOS the menu takes over a glass trigger's glass.
   */
  readonly glassId = input<string | undefined>(undefined);
  /**
   * The rows a finger can slide onto and lift on to choose (see MenuPress),
   * which the menu measures as it opens. The menu also writes its order and
   * state there for its items.
   */
  readonly rows = input<MenuRows | null>(null);

  /** The user tapped outside the menu, or pressed Android's back button. */
  readonly dismissed = output<void>();
  /** The menu has closed and its close animation has finished. */
  readonly closed = output<void>();

  readonly #renderer = inject(Renderer2);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #haptics = inject(LynxHaptics);
  readonly #scheme = injectColorScheme();

  readonly design = injectGlassDesign();
  readonly phase = signal<MenuPhase>('closed');
  readonly placement = signal<MenuPlacement | null>(null);
  /**
   * The size the lifted element's home keeps while the element is in the
   * overlay, so the page doesn't move. Null while nothing is lifted.
   */
  readonly placeholder = signal<MenuRect | null>(null);

  // Required: all are always in the template, and only read once the overlay
  // shows.
  readonly area = viewChild.required<ElementRef<MenuElement>>('area');
  readonly slot = viewChild.required<ElementRef<MenuElement>>('slot');
  readonly panel = viewChild.required('panel', { read: ElementRef });
  readonly content = viewChild.required<ElementRef<MenuElement>>('content');

  protected readonly offScreen = -10000;
  protected readonly dimTransition = `opacity ${DURATION.normal}ms ${EASING.standard}`;

  readonly metrics = computed(() => METRICS[this.design()]);

  /**
   * Material menus open beside their anchor without dimming the screen or
   * lifting it, on a solid surface. Apple's context menus dim the screen and
   * lift the pressed element.
   */
  readonly #material = computed(() => this.design() === 'material');
  readonly #context = computed(() => this.kind() === 'context');
  protected readonly dims = computed(
    () => this.#context() && !this.#material(),
  );
  protected readonly blurs = computed(
    () => this.dims() && this.design() === 'frosted',
  );
  readonly #submenu = computed(() => this.kind() === 'submenu');
  readonly #lifts = computed(() => this.dims() && !!this.anchorHome());
  readonly #reduceMotion = computed(() => this.#settings.reduceMotion());

  protected readonly visible = computed(() => this.phase() !== 'closed');
  protected readonly overlayStyle = computed(() =>
    this.visible() ? OVERLAY_STYLE : `${OVERLAY_STYLE} display: none;`,
  );
  protected readonly blurEffect = computed(() =>
    this.#scheme() === 'dark' ? 'dark' : 'light',
  );
  protected readonly dimOpacity = computed(() =>
    this.phase() === 'open' ? 1 : 0,
  );

  /** Where the anchor was on screen when the menu opened, in the area. */
  readonly #anchorRect = signal<MenuRect>(ZERO_RECT);
  /** Whether the anchor is in the slot. */
  #lifted = false;

  /**
   * Where the lifted element sits: over the spot it left, and, once open,
   * wherever the placement moved it to make room for the menu.
   */
  protected readonly liftFrame = computed(() => {
    const placement = this.placement();
    if (!placement || !this.#lifts()) return null;
    return this.phase() === 'open' || this.#reduceMotion()
      ? placement.anchor
      : this.#anchorRect();
  });
  protected readonly liftTransform = computed(() =>
    this.phase() === 'open' && !this.#reduceMotion()
      ? `scale(${LIFT_SCALE})`
      : 'scale(1)',
  );
  protected readonly liftTransition = computed(() =>
    this.#transition(['transform', 'top']),
  );

  /** The menu's box now: off screen while measuring, then start or frame. */
  protected readonly frame = computed<MenuRect | null>(() => {
    const placement = this.placement();
    const phase = this.phase();
    if (!placement || phase === 'measuring') return null;
    if (phase === 'open' || this.#reduceMotion()) return placement.frame;
    return menuStartFrame(
      placement,
      this.#material() ? 'edge' : this.#context() ? 'corner' : 'anchor',
    );
  });

  /**
   * The items fade in once the menu is open, and fade most of the way out
   * while a submenu is open over it.
   */
  protected readonly contentOpacity = computed(() => {
    if (this.phase() !== 'open') return 0;
    return this.rows()?.covered() ? COVERED_OPACITY : 1;
  });

  /**
   * Material's solid surface fades as it unfolds. Glass doesn't fade: iOS
   * draws a blur view with less than full opacity wrongly, so it only grows
   * and shrinks, and its items fade.
   */
  protected readonly panelOpacity = computed(() =>
    this.#material() && this.phase() !== 'open' ? 0 : 1,
  );
  protected readonly panelTransition = computed(() =>
    this.#transition(['left', 'top', 'width', 'height', 'opacity']),
  );

  /**
   * The menu's glass is hidden until it's at its start frame, so it shows in
   * the same update that hides the trigger it grows out of, and hides in the
   * one that shows the trigger again: on iOS the shell pairs the two across
   * those changes (see glassId).
   */
  protected readonly panelVisibility = computed(() => {
    const phase = this.phase();
    return phase === 'closed' || phase === 'measuring' ? 'hidden' : null;
  });
  protected readonly contentTransition = computed(() =>
    this.#transition(['opacity']),
  );

  protected readonly contentClass = computed(() =>
    cn('flex-col flex', this.metrics().padding),
  );

  /**
   * A transition of `properties` for the phase: springy as the menu opens,
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
    return animated.length
      ? animated
          .map((property) => `${property} ${duration}ms ${easing}`)
          .join(', ')
      : 'none';
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
   * `layoutchange` event; 0 until that arrives.
   *
   * `boundingClientRect` measures in the screen's pixels, and the docs' web
   * previews draw the app scaled down to fit their pane, so there it gave
   * boxes 0.68 of their size, and the menu opened in the wrong place and
   * too short for its items. The previews hand `layoutchange` to the app in
   * its own pixels, so the two widths give the scale to undo. On a phone
   * they're the same.
   */
  #areaWidth = 0;

  protected onAreaLayout(event: unknown): void {
    this.#areaWidth =
      (event as { detail?: { width?: number } }).detail?.width ?? 0;
  }

  /**
   * A tap outside the menu dismisses it, unless it ends the press that
   * opened it: a trigger wider than the menu leaves the finger over the
   * backdrop, and Lynx sends the press's tap there (see MenuRows' ownsTap).
   */
  protected onBackdropTap(): void {
    if (!this.rows()?.ownsTap()) this.dismissed.emit();
  }

  /**
   * No-op tap handler for the menu. `catchtap` (vs `bindtap`) stops a tap on
   * the menu from reaching the backdrop behind it, which would dismiss it.
   */
  protected onPanelTap(): void {}

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
    this.rows()?.shown.set(true);

    const anchor = await measureMenuElement(this.anchor());
    if (run !== this.#run) return;
    this.phase.set('measuring');

    await this.#wait(LAYOUT_DELAY);
    if (run !== this.#run) return;
    const [area, content] = await Promise.all([
      measureMenuElement(this.area().nativeElement),
      measureMenuElement(this.content().nativeElement),
    ]);
    if (run !== this.#run) return;

    // Measured boxes in the app's own pixels: see #areaWidth.
    const scale =
      area && this.#areaWidth > 0 ? area.width / this.#areaWidth : 1;
    const inPixels = (box: MenuRect | null): MenuRect => ({
      left: (box?.left ?? 0) / scale,
      top: (box?.top ?? 0) / scale,
      width: (box?.width ?? 0) / scale,
      height: (box?.height ?? 0) / scale,
    });
    const areaRect = inPixels(area);
    const anchorRect = inPixels(anchor);
    const inArea: MenuRect = {
      ...anchorRect,
      left: anchorRect.left - areaRect.left,
      top: anchorRect.top - areaRect.top,
    };
    this.#anchorRect.set(inArea);
    this.placement.set(
      placeMenu({
        anchor: inArea,
        area: areaRect,
        menu: {
          width: this.metrics().width,
          height: inPixels(content).height,
        },
        // A submenu grows out of its row, over the menu it's in, as on iOS;
        // on Android it takes the menu's place, as a Material submenu does.
        mode:
          this.#submenu() || !(this.#material() || this.#context())
            ? 'grow'
            : 'beside',
        movableAnchor: this.#lifts(),
      }),
    );
    this.#areaRect = areaRect;
    this.#scale = scale;
    this.rows()?.reversed.set(
      this.placement()?.vertical === 'bottom' && !this.#material(),
    );
    this.#lift();
    this.phase.set('from');

    await this.#wait(FRAME_DELAY);
    if (run !== this.#run) return;
    // Laid out in its order by now: where each row will be once the menu
    // has grown, for a finger sliding across it. Measured meanwhile, so the
    // menu doesn't wait to grow.
    void this.#measureRows(run);
    this.phase.set('open');
    // Move a screen reader into the menu: it would otherwise stay on what
    // opened it, now behind the overlay. With the menu's
    // accessibility-exclusive-focus, it then stays there until it closes.
    this.panel().nativeElement.invoke('requestAccessibilityFocus');
  }

  #hide(): void {
    const run = ++this.#run;
    const phase = this.phase();
    // Only a menu that's open or opening closes: `open` turning false again
    // reaches here only after it turned true, which ends any closing.
    if (phase === 'closed') return;
    this.#stopResting();
    this.#rowOffsets = new Map();
    this.rows()?.highlighted.set(null);
    this.rows()?.shown.set(false);
    if (phase === 'measuring') {
      this.#finishClose(true);
      return;
    }
    this.phase.set('closing');
    // +20ms: Lynx's timers can fire a little early, and the menu would
    // vanish before its transition ends.
    void this.#wait(DURATION.normal + 20).then(() => {
      if (run === this.#run) this.#finishClose(true);
    });
  }

  /** The safe area on screen, in the app's pixels, as the menu opened. */
  #areaRect: MenuRect = ZERO_RECT;
  /** The screen's pixels per app pixel, as the menu opened (#areaWidth). */
  #scale = 1;
  /** Where each row is in the menu's content, once measured. */
  #rowOffsets = new Map<MenuRow, RowOffset>();
  /** The rows' version (see MenuRows) that #rowOffsets is for. */
  #measuredVersion = -1;

  /**
   * Measures each row against the menu's content. The content keeps its
   * size as the menu grows and ends up at the menu's frame, so that's where
   * each row will be. Until the answer comes, no row is chosen: the old
   * boxes may be other rows' places now.
   */
  async #measureRows(run: number): Promise<void> {
    const menuRows = this.rows();
    if (!menuRows) return;
    const version = menuRows.version;
    this.#measuredVersion = version;
    this.#rowOffsets = new Map();
    const rows = menuRows.all();
    if (!rows.length) return;
    const [content, ...boxes] = await Promise.all([
      measureMenuElement(this.content().nativeElement),
      ...rows.map((row) => measureMenuElement(row.element())),
    ]);
    // Dropped if the menu closed, or the rows changed again meanwhile: a
    // newer measurement is on its way.
    if (run !== this.#run || version !== menuRows.version || !content) return;
    const offsets = new Map<MenuRow, RowOffset>();
    rows.forEach((row, index) => {
      const box = boxes[index];
      if (!box) return;
      offsets.set(row, {
        left: (box.left - content.left) / this.#scale,
        top: (box.top - content.top) / this.#scale,
        width: box.width / this.#scale,
        height: box.height / this.#scale,
      });
    });
    this.#rowOffsets = offsets;
  }

  /**
   * The row under `point`, in the window's coordinates, once the menu is
   * open and its rows measured. Only inside the menu's frame: a tall menu
   * clips the rows past it. An app can add or take away a row while the
   * finger is down, which moves the rows after it: then none is chosen
   * until they're measured again.
   */
  #rowAt(rows: MenuRows, point: MenuPoint): MenuRow | null {
    const frame = this.placement()?.frame;
    if (!frame || this.phase() !== 'open') return null;
    const x = point.x / this.#scale - this.#areaRect.left - frame.left;
    const y = point.y / this.#scale - this.#areaRect.top - frame.top;
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
    if (rows.version !== this.#measuredVersion) {
      void this.#measureRows(this.#run);
      return null;
    }
    for (const [row, box] of this.#rowOffsets) {
      if (
        x >= box.left &&
        x < box.left + box.width &&
        y >= box.top &&
        y < box.top + box.height
      ) {
        return row;
      }
    }
    return null;
  }

  /**
   * Lights up the row under a finger sliding across the menu, with a light
   * tap as it moves onto each, as iOS gives. Null turns the light off.
   */
  dragTo(point: MenuPoint | null): void {
    const rows = this.rows();
    if (!rows) return;
    // An open submenu covers this menu: the finger is over its rows now.
    if (rows.openSubmenu) {
      rows.openSubmenu.dragTo(point);
      return;
    }
    const row = point ? this.#rowAt(rows, point) : null;
    const target = row && !row.disabled() ? row : null;
    if (target === rows.highlighted()) return;
    this.#stopResting();
    rows.highlighted.set(target);
    if (!target) return;
    this.#haptics.selection();
    if (target.opensSubmenu) this.#restOn(rows, target);
  }

  /**
   * Chooses the row under a finger that lifted there after sliding across
   * the menu, as a tap on it would, or the open submenu's row under it.
   */
  dropAt(point: MenuPoint): void {
    const rows = this.rows();
    if (!rows) return;
    this.#stopResting();
    rows.highlighted.set(null);
    if (rows.openSubmenu) {
      rows.openSubmenu.dropAt(point);
      return;
    }
    const row = this.#rowAt(rows, point);
    if (row && !row.disabled()) row.choose();
  }

  /** The timer that opens the submenu a finger rests on (see #restOn). */
  #resting: ReturnType<typeof setTimeout> | null = null;

  /**
   * Opens a submenu once the finger has rested on its row for
   * SUBMENU_REST_DELAY, as UIKit's does, so the same finger carries on into
   * its items and lifts on one to choose it. The submenu then measures its
   * own rows as it opens, and later moves go to it (see MenuRows'
   * openSubmenu). Moving off the row first stops the timer, and so does a
   * change to the rows, as it does #rowAt's measurements.
   */
  #restOn(rows: MenuRows, row: MenuRow): void {
    const version = rows.version;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.#resting = null;
      // The app added or took away a row meanwhile: this one may be gone, or
      // have moved out from under the finger, which hasn't moved since.
      if (rows.version !== version) return;
      rows.highlighted.set(null);
      row.choose();
    }, SUBMENU_REST_DELAY);
    this.#timers.add(timer);
    this.#resting = timer;
  }

  #stopResting(): void {
    if (this.#resting === null) return;
    clearTimeout(this.#resting);
    this.#timers.delete(this.#resting);
    this.#resting = null;
  }

  /**
   * Moves a context menu's element into the overlay, where it was.
   */
  #lift(): void {
    if (!this.#lifts()) return;
    this.placeholder.set(this.#anchorRect());
    this.#renderer.appendChild(
      this.slot().nativeElement,
      this.anchor() as unknown,
    );
    this.#lifted = true;
  }

  #finishClose(emit: boolean): void {
    if (this.#lifted) {
      this.#renderer.appendChild(this.anchorHome(), this.anchor() as unknown);
      this.#lifted = false;
    }
    this.placeholder.set(null);
    this.placement.set(null);
    this.#rowOffsets = new Map();
    const rows = this.rows();
    if (rows) {
      rows.highlighted.set(null);
      rows.reversed.set(false);
      rows.shown.set(false);
      rows.covered.set(false);
    }
    this.phase.set('closed');
    if (emit) this.closed.emit();
  }
}
