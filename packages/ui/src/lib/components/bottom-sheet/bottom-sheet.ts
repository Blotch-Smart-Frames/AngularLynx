// cspell:words WAAPI tweens
import {
  type OnDestroy,
  Component,
  Directive,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  MainThreadElement,
} from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  fadeIn,
  fadeOut,
  slideIn,
  slideOut,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { concentricRadius } from '../glass/concentric-radius';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';

/**
 * `'default'` is the sheet's own look, the same on every platform. `'glass'`
 * is the platform's sheet: Liquid Glass on iOS 26 and later (and in the web
 * preview, and on Android with `provideGlass({ android: 'glass' })`), the
 * opaque sheet of iOS 15 to 25, and Material 3's bottom sheet on Android.
 */
export type BottomSheetVariant = 'default' | 'glass';

/**
 * A height the sheet rests at, as iOS calls them:
 *
 * - `'fit'`: its content's height (the default).
 * - `'medium'`: half the screen.
 * - `'large'`: the whole screen below the status bar.
 */
export type SheetDetent = 'fit' | 'medium' | 'large';

/** What the sheet draws: its own default look, or a glass design's. */
type SheetLook = 'default' | GlassDesign;

/**
 * Where the sheet is going: nowhere, after the finger, to a detent, out of
 * the control that presents it, or back into it (see UiSheetSource).
 */
type SheetMotion = 'rest' | 'drag' | 'settle' | 'grow' | 'shrink';

/**
 * AngularLynx's element, which an `ElementRef` to a Lynx element holds: the
 * control a sheet grows out of.
 */
type SourceElement = { readonly element: unknown };

/**
 * The panel's place on the screen, as its style sets it: how far it is from
 * the left, right and bottom edges, and its height, in px.
 */
type PanelFrame = {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly height: number;
};

/**
 * A sheet a control presents (see UiSheetSource): `ui-bottom-sheet`, or
 * `ui-sheet`, which hands the control on to its own.
 */
export type SheetSourceTarget = {
  /** Whether the sheet covers the control now, which hides meanwhile. */
  coversSource(): boolean;
  /** @internal Called by the `uiSheetSource` directive. */
  setSource(source: SourceElement | null, glass: UiGlass | null): void;
};

/** How many sheets there have been, for their glass ids. */
let sheetCount = 0;

/**
 * An element's box on the screen, or null where it can't be measured. Lynx
 * gives a script an element's position only through `boundingClientRect`,
 * which answers later.
 */
const measure = async (element: SourceElement) => {
  try {
    return await new MainThreadElement(
      element.element as ConstructorParameters<typeof MainThreadElement>[0],
    ).getBoundingClientRect({ relativeTo: 'screen' });
  } catch {
    return null;
  }
};

// Drag-to-dismiss tuning for the handle strip at the top of the sheet.
//
// Minimum downward travel (px) before releasing dismisses the sheet instead of
// snapping it back — small enough to feel responsive, large enough that a stray
// tap or tiny movement doesn't accidentally close it.
const DISMISS_THRESHOLD = 100;
// Off-screen translateY target (px) for the dismiss slide. Deliberately larger
// than any realistic sheet height so the panel fully clears the viewport. Kept
// in px — not % — so the exit interpolates continuously from the px-based drag
// offset; WAAPI won't tween between px and % transforms. Once the screen's
// height is known, a taller screen uses that instead.
const DISMISS_TRANSLATE = 600;

// Backdrop dim tuning. The scrim sits at the look's dim (see BACKDROP_DIM)
// when the sheet is fully open and lightens toward transparent as the handle is
// dragged down, so the dimming reads as coupled to how much of the sheet is
// still on screen.
//
// Drag distance (px) over which the backdrop fades from full dim to fully clear.
// Ideally this would be the panel's own height, but measuring it on the drag's
// background thread isn't cheap (getBoundingClientRect is main-thread/async), so
// we approximate a full reveal with a fixed travel that stays within the
// DISMISS_TRANSLATE off-screen distance. The dim reduces linearly across it.
const BACKDROP_CLEAR_DISTANCE = 500;

/**
 * How dark the backdrop gets behind each look: the default's own, iOS's
 * dimming view (black at 20%, measured on the iOS 27 Simulator, which iOS 15
 * to 25 share) and Material 3's scrim (black at 32%).
 */
const BACKDROP_DIM: Readonly<Record<SheetLook, number>> = {
  default: 0.5,
  glass: 0.2,
  frosted: 0.2,
  material: 0.32,
};

/**
 * How far a drag between detents has to go before the sheet moves on to the
 * next detent rather than settling back. Lynx reports no velocity, so a short
 * flick can't be told from a nudge: the distance decides.
 */
const DETENT_THRESHOLD = 50;

/**
 * How far iOS 26 insets a partial-height sheet from the sides and bottom of
 * the screen (measured on the iOS 27 Simulator: 8pt), so content shows around
 * it.
 */
const GLASS_INSET = 8;

/**
 * The corner radius of the display iOS 26 sheets nest in: the iPhone 16 Pro's
 * and later (62pt on the iOS 27 Simulator's iPhone 18 Pro). Lynx can't read a
 * phone's own, and earlier iPhones round less, so their inset sheets sit a
 * little rounder than their screens.
 */
const DISPLAY_RADIUS = 62;

/**
 * The glass sheet's corner radius: concentric with the display's corners, so
 * the gap around the inset sheet stays 8px wide round them. One radius for
 * all four corners, because Lynx's iOS glass ignores per-corner radii (it
 * draws a square shape with them) and can't animate a radius, so it never
 * changes either: at full height the bottom corners sit under the display's
 * own, which round more.
 */
const GLASS_RADIUS = concentricRadius(DISPLAY_RADIUS, GLASS_INSET);

/**
 * Material 3's level 1 elevation, as an inline style: Tailwind's shadow
 * classes draw nothing on Lynx.
 */
const MATERIAL_ELEVATION =
  '0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)';

/**
 * How many frames the sheet waits for the screen to be laid out (see
 * #present) before it opens anyway, at its content's height.
 */
const LAYOUT_TRIES = 10;

/** One frame, for waiting on layout. */
const FRAME = 16;

/** The panel's own classes in each look. */
const PANEL_CLASS: Readonly<Record<SheetLook, string>> = {
  default: 'w-full rounded-t-2xl border-t border-border bg-background',
  // The glass, drawn by the layers in the template, is the panel's surface.
  glass: '',
  // iOS 15 to 25: the system background, with 10pt corners on top.
  frosted: 'w-full rounded-t-[10px] bg-background',
  // Material 3: the surface container, with 28dp corners on top.
  material: 'w-full rounded-t-[28px] bg-secondary',
};

/** The handle strip's padding, which places the grabber, in each look. */
const HANDLE_CLASS: Readonly<Record<SheetLook, string>> = {
  default: 'pb-3 pt-2',
  glass: 'pb-[14px] pt-[6px]',
  frosted: 'pb-[14px] pt-[5px]',
  // Material's drag handle sits in a 48dp touch target.
  material: 'py-[22px]',
};

/**
 * The grabber in each look: iOS 26's is 60×4, iOS 15 to 25's 36×5, both a
 * faint gray that reads on glass and on the opaque sheet alike, and
 * Material's drag handle 32×4 in on-surface-variant at 40%.
 */
const GRABBER_CLASS: Readonly<Record<SheetLook, string>> = {
  default: 'h-1 w-10 bg-muted',
  glass: 'h-[4px] w-[60px] bg-foreground opacity-25',
  frosted: 'h-[5px] w-[36px] bg-foreground opacity-25',
  material: 'h-[4px] w-[32px] bg-muted-foreground opacity-40',
};

/**
 * The height a `layoutchange` event reports. Its template type is the DOM's
 * `Event`, which has no `detail`.
 */
const layoutHeight = (event: unknown): number =>
  (event as { readonly detail: { readonly height: number } }).detail.height;

/**
 * The width a `layoutchange` event reports; see layoutHeight.
 */
const layoutWidth = (event: unknown): number =>
  (event as { readonly detail: { readonly width: number } }).detail.width;

/**
 * Low-level bottom-sheet primitive: a full-screen `<overlay>` with a dimmed
 * backdrop and a panel docked to the bottom that slides up on open, slides
 * down on close, and can be dragged by its handle between its detents or
 * down to dismiss.
 *
 * It owns none of the content — consumers project whatever they want via
 * `<ng-content>` (a scrollable item list for `select`, arbitrary content for
 * `sheet`). This is the shared engine both those components build on, so the
 * overlay/animation/drag behavior lives in exactly one place.
 *
 * `variant="glass"` draws the platform's sheet. On iOS 26 and later a sheet
 * below full height is Liquid Glass, inset from the screen's sides and bottom
 * with corners concentric to the display's. As it's dragged up to full height
 * it meets the edges and turns opaque. Lynx can't animate `border-radius`, so
 * that transition never changes one: it animates the glass's frame, which
 * iOS's glass follows frame by frame, and fades an opaque layer in over it.
 *
 * Mark the control that presents it with `uiSheetSource`, and the Liquid
 * Glass sheet grows out of that control rather than sliding up, and shrinks
 * back into it as it closes, as iOS 26 grows a sheet out of its button.
 */
@Component({
  selector: 'ui-bottom-sheet',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  // The sheet's class is its panel's, inside the overlay. Angular also gives
  // the host every static attribute the app writes on <ui-bottom-sheet>, and
  // the host sits in the page's layout where the sheet is written, so a
  // `class="px-8"` padded the page there too. The host drops it.
  host: { '[attr.class]': 'null' },
  template: `
    <!-- Android's back button closes the sheet: while an overlay shows, it
         takes the press and fires requestclose. -->
    <overlay
      [attr.visible]="overlayVisible()"
      [style]="overlayStyle()"
      (bindrequestclose)="open.set(false)"
    >
      <!--
        The mouse drag's move/up listeners sit on the full-screen backdrop,
        not the handle: a touch keeps targeting the element it started on, but
        a mouse event targets whatever is under the cursor, so a cursor that
        outruns the thin handle strip (or drags up off the panel) would stop
        driving the drag. Mouse events bubble here from anywhere in the sheet,
        including the handle and the panel. There's no mouseleave: like a
        touch, the drag carries on until release, and Chrome doesn't deliver
        mouseleave to Lynx web anyway (see onMouseDragMove for a release
        outside the view).
      -->
      <view
        #backdrop
        class="h-full w-full"
        [style]="backdropStyle()"
        (bindtap)="onBackdropTap()"
        (bindmousedown)="onBackdropMouseDown()"
        (bindmousemove)="onMouseDragMove($event)"
        (bindmouseup)="onDragEnd()"
        (bindlayoutchange)="onScreenLayout($event)"
      >
        <!-- The screen below the status bar, which the large detent fills. -->
        <view
          class="w-0 absolute bottom-0 left-0"
          style="top: env(safe-area-inset-top);"
          (bindlayoutchange)="onLargeLayout($event)"
        ></view>
        <view
          #panel
          [class]="panelClass()"
          [style]="panelStyle()"
          [accessibility-exclusive-focus]="overlayVisible()"
          (catchtap)="onPanelTap()"
          (bindlayoutchange)="onPanelLayout($event)"
        >
          @if (look() === 'glass') {
            <!-- Behind the handle and the content: Lynx paints in source
                 order. The opaque layer overlaps the glass by 1px all round,
                 so at full height the glass's rim doesn't show at its
                 edge. -->
            <blur-view
              ui-glass
              shape="rounded"
              [radius]="glassRadius"
              [glassId]="glassId"
              class="h-full w-full absolute left-0 top-0"
              [style.visibility]="glassVisibility()"
            ></blur-view>
            <view class="bg-background absolute" [style]="opaqueStyle()"></view>
          }
          <!-- The handle and the content, which fade in as the sheet grows
               out of the control that presents it. -->
          <view class="grow flex-col flex" [style]="contentStyle()">
            <view
              [class]="handleClass()"
              [accessibility-element]="resizable()"
              [attr.accessibility-traits]="resizable() ? 'button' : null"
              [attr.accessibility-label]="resizable() ? 'Sheet grabber' : null"
              (catchtouchstart)="onHandleTouchStart($event)"
              (catchtouchmove)="onHandleTouchMove($event)"
              (catchtouchend)="onDragEnd()"
              (catchtouchcancel)="onDragEnd()"
              (catchmousedown)="onHandleMouseDown($event)"
              (catchtap)="onHandleTap()"
            >
              <view [class]="grabberClass()" />
            </view>
            <ng-content />
          </view>
        </view>
      </view>
    </overlay>
  `,
})
export class UiBottomSheet implements OnDestroy {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });
  /** `'default'` or `'glass'`; see BottomSheetVariant. */
  readonly variant = input<BottomSheetVariant>('default');
  /**
   * The heights the sheet rests at (see SheetDetent). It opens at the first,
   * and drags between them. With more than one, a tap on the grabber moves
   * to the next.
   */
  readonly detents = input<readonly SheetDetent[]>(['fit']);
  /**
   * The detent the sheet rests at while it's open, and undefined while it's
   * closed. Set it before opening to open at another detent than the first,
   * or while open to move the sheet there.
   */
  readonly detent = model<SheetDetent>();

  readonly closed = output<void>();

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #design = injectGlassDesign();

  /** The look on this platform: the default, or the glass variant's design. */
  protected readonly look = computed<SheetLook>(() =>
    this.variant() === 'glass' ? this.#design() : 'default',
  );

  protected readonly glassRadius = GLASS_RADIUS;

  /**
   * The id the sheet's glass and a glass control that presents it share
   * (see UiGlass's `glassId`), unique to the sheet, so the sheet takes over
   * the control's glass as it grows out of it.
   */
  readonly glassId = `ui-sheet-${++sheetCount}`;

  protected readonly overlayVisible = signal(false);
  /**
   * `width`/`height`/`top`/`left` are web-only necessities: on web
   * `<overlay>` has no intrinsic full-screen sizing (unlike native), so
   * without them it collapses to 0x0 and nothing renders. `z-index` keeps it
   * above sibling content that would otherwise occasionally paint on top.
   */
  protected readonly overlayStyle = computed(() =>
    this.overlayVisible()
      ? 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999;'
      : 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999; display: none;',
  );

  // Required: both are always in the template (the overlay is hidden, never
  // removed), and nothing reads them before the first render.
  readonly backdropRef = viewChild.required<ElementRef>('backdrop');
  readonly panelRef = viewChild.required<ElementRef>('panel');
  #backdropAnim?: AnimationHandle;
  #panelAnim?: AnimationHandle;
  #hasBeenOpen = false;
  // The open and close sequences' pending timers, so ngOnDestroy can stop
  // them.
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  // --- Layout, from `layoutchange` ---
  // The screen's height, the large detent's (the screen below the status
  // bar), and the panel's at its content's height. 0 until laid out.
  readonly #screenHeight = signal(0);
  readonly #screenWidth = signal(0);
  readonly #largeHeight = signal(0);
  readonly #fitHeight = signal(0);

  // --- Height ---
  // The sheet's height, from the bottom of the screen to its top, in px, or
  // null to fit its content. A glass sheet's inset comes off it (see
  // panelStyle), so a detent puts the top in the same place in every look.
  readonly #height = signal<number | null>(null);
  readonly #motion = signal<SheetMotion>('rest');
  // Whether the open sequence has started showing the sheet. Until then it's
  // laid out below the screen over a clear backdrop, so it doesn't flash at
  // its resting place while the screen is measured. Not `visibility: hidden`:
  // on iOS, glass that an ancestor hides as it's set up draws nothing once
  // shown.
  readonly #presented = signal(false);

  // --- The control that presents it (see UiSheetSource) ---
  readonly #source = signal<SourceElement | null>(null);
  // The control's own glass, which shares the sheet's glass id.
  #sourceGlass: UiGlass | null = null;
  // The control's frame while the sheet grows out of it or shrinks back
  // into it, which the panel takes instead of its own; null otherwise.
  readonly #sourceFrame = signal<PanelFrame | null>(null);
  // Increases with every open and close, so a step of one that the other
  // interrupts doesn't run.
  #sequence = 0;
  // The detent the sheet last came to rest at, to tell an app's change of
  // `detent` from the sheet's own.
  #restingAt?: SheetDetent;
  // Increases with every settle and drag, so a settle that a drag interrupts
  // doesn't end the drag when its timer fires.
  #settleRun = 0;

  // --- Drag-to-dismiss state ---
  // Live downward drag distance (px) past the smallest detent, applied to the
  // panel as a translateY via `panelStyle()` so the sheet tracks the finger
  // in real time.
  protected readonly dragOffset = signal(0);
  // Screen Y where the current drag began; the delta from here drives the
  // drag.
  #dragStartY = 0;
  // The sheet's height when the current drag began.
  #dragFrom = 0;
  // True only between touchstart and touchend on the handle, so unrelated move
  // events can't shift the sheet.
  #isDragging = false;
  // Set when a mouse drag that actually moved is released. The browser follows
  // that mouseup with a click on the nearest element under both the mousedown
  // and the mouseup: the backdrop whenever the cursor ended up off the panel,
  // or the handle when it ended up back on it. Lynx web maps that click to
  // that element's tap. Without this, a drag released above the panel (where
  // the sheet snaps back) would close it, and one released on the handle
  // would move it on to the next detent.
  #ignoreNextTap = false;
  // Whether the current drag is a mouse drag that has moved: only those are
  // followed by a click. A moved touch produces no tap.
  #mouseDragMoved = false;

  /**
   * Opens or closes the sheet as `open` changes. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   *
   * `#hasBeenOpen` prevents the close animation from running on the initial
   * effect evaluation when `open` starts as false. Without this guard, the
   * first run would call #doClose() and emit `closed` before the sheet
   * has ever been opened.
   */
  protected readonly openOrClose = effect(() => {
    const isOpen = this.open();
    if (isOpen) {
      this.#hasBeenOpen = true;
      this.#doOpen();
    } else if (this.#hasBeenOpen) {
      this.#doClose();
    }
  });

  /**
   * Moves an open sheet to the detent an app sets. The sheet's own moves set
   * `detent` too, to where it already is.
   */
  protected readonly followDetent = effect(() => {
    const detent = this.detent();
    untracked(() => {
      if (
        detent === undefined ||
        detent === this.#restingAt ||
        !this.#presented() ||
        this.#isDragging ||
        !this.#detentList().includes(detent)
      ) {
        return;
      }
      this.#settle(detent);
    });
  });

  /** The detents, or `fit` alone for an empty list. */
  readonly #detentList = computed<readonly SheetDetent[]>(() => {
    const detents = this.detents();
    return detents.length > 0 ? detents : ['fit'];
  });

  /** Whether the sheet has more than one height to rest at. */
  protected readonly resizable = computed(() => this.#detentList().length > 1);

  /** The detents from shortest to tallest. */
  readonly #ordered = computed(() =>
    [...this.#detentList()].sort(
      (a, b) => this.#detentHeight(a) - this.#detentHeight(b),
    ),
  );

  /**
   * How far a glass sheet is from partial height (0) to full height (1):
   * from the tallest detent below the large one to the large one. It sets
   * the glass sheet's inset and how opaque it is, so both follow a drag.
   */
  protected readonly progress = computed(() => {
    const large = this.#largeHeight();
    if (large <= 0) return 0;
    const height = this.#currentHeight();
    if (height >= large) return 1;
    const partial = Math.max(
      0,
      ...this.#detentList()
        .filter((detent) => detent !== 'large')
        .map((detent) => this.#detentHeight(detent)),
    );
    return Math.max(0, (height - partial) / (large - partial));
  });

  /** A glass sheet's inset from the screen's sides and bottom. */
  readonly #inset = computed(() =>
    this.look() === 'glass' ? GLASS_INSET * (1 - this.progress()) : 0,
  );

  readonly #reduceMotion = computed(() => this.#settings.reduceMotion());

  /**
   * Whether the glass variant's own motion (its slide in and out, and the
   * snap back after a drag) gives way to Reduce Motion. The default variant
   * keeps the motion it always had.
   */
  readonly #calm = computed(
    () => this.look() !== 'default' && this.#reduceMotion(),
  );

  /**
   * Whether the sheet grows out of the control that presents it, and back
   * into it, as iOS 26 grows a sheet out of its button: the Liquid Glass
   * sheet, with a control marked `uiSheetSource`, unless Reduce Motion is on.
   */
  readonly #grows = computed(
    () => this.look() === 'glass' && !this.#calm() && this.#source() !== null,
  );

  /** Whether the sheet covers its control now, which hides meanwhile. */
  readonly coversSource = computed(() => this.#grows() && this.#presented());

  /**
   * A sheet that grows out of its control shows its glass in the same update
   * that hides the control, and hides it in the one that shows the control
   * again. On iOS 26 and later the shell pairs the two across those changes
   * (see glassId): the sheet takes over a glass control's corners, and the
   * control's content fades out in it, and back in as the sheet closes.
   */
  protected readonly glassVisibility = computed(() =>
    this.#grows() && !this.#presented() ? 'hidden' : null,
  );

  /**
   * The handle and content fade in once the sheet growing out of its
   * control has room for them, and out as it shrinks back.
   */
  protected readonly contentStyle = computed(() => {
    if (!this.#grows()) return null;
    return this.#presented() && this.#sourceFrame() === null
      ? `opacity: 1; transition: opacity ${DURATION.normal}ms ${EASING.decelerate} ${DURATION.fast}ms;`
      : `opacity: 0; transition: opacity ${DURATION.fast}ms ${EASING.accelerate};`;
  });

  protected readonly panelClass = computed(() =>
    cn(
      'flex-col flex',
      PANEL_CLASS[this.look()],
      // The panel docks at bottom: 0 (see panelStyle), so its lower edge
      // sits behind the home indicator. `pb-safe` pads the bottom by
      // env(safe-area-inset-bottom), lifting the projected content clear of it
      // while the panel background still fills to the screen edge. Degrades to no
      // padding where there's no bottom inset (web/older devices). Mirrors how
      // the toast bakes the safe area into its own docked positioning.
      'pb-safe',
      this.userClass(),
    ),
  );

  protected readonly handleClass = computed(() =>
    cn('items-center flex justify-center', HANDLE_CLASS[this.look()]),
  );

  protected readonly grabberClass = computed(() =>
    cn('rounded-full', GRABBER_CLASS[this.look()]),
  );

  // Docked at the bottom, full width (a glass sheet inset from both); its
  // height, when it's at a detent other than its content's or being
  // dragged; and `translateY(dragOffset)` layers the live dismiss drag on top
  // so the sheet follows the finger. The open/close slide animations run via
  // element.animate() and override this transform while they play (see
  // #animateIn/#animateOut), then hand back to it once canceled. Settling at
  // a detent transitions the frame, which iOS's glass follows.
  protected readonly panelStyle = computed(() => {
    const inset = this.#inset();
    const height = this.#height();
    const offset = this.#presented() ? `${this.dragOffset()}px` : '110%';
    // Growing out of the control that presents it, or shrinking back into
    // it, the sheet starts from the control's frame, or ends at it.
    const source = this.#sourceFrame();
    const styles = source
      ? [
          `position: absolute; bottom: ${source.bottom}px; left: ${source.left}px; right: ${source.right}px;`,
          `transform: translateY(0px); height: ${source.height}px;`,
        ]
      : [
          `position: absolute; bottom: ${inset}px; left: ${inset}px; right: ${inset}px;`,
          `transform: translateY(${offset});`,
        ];
    if (!source && height !== null) styles.push(`height: ${height - inset}px;`);
    if (this.look() === 'material') {
      styles.push(`box-shadow: ${MATERIAL_ELEVATION};`);
    }
    const motion = this.#motion();
    if (motion === 'settle' || motion === 'grow' || motion === 'shrink') {
      // Out of the control on the sheet's curve, a little longer for the
      // way it travels (a spring that starts as quickly as the menus' covers
      // most of it in the first frame), and back into it quicker.
      const timing =
        motion === 'settle'
          ? `${DURATION.slow}ms ${EASING.sheet}`
          : motion === 'grow'
            ? `${DURATION.slow + 100}ms ${EASING.sheet}`
            : `${DURATION.normal}ms ${EASING.standard}`;
      styles.push(
        `transition: height ${timing}, left ${timing}, right ${timing}, bottom ${timing};`,
      );
    }
    // The content, laid out at the sheet's size, stays inside the glass
    // while it's smaller.
    if (motion === 'grow' || motion === 'shrink' || source) {
      styles.push('overflow: hidden;');
    }
    return styles.join(' ');
  });

  /**
   * The opaque layer a glass sheet turns into as it reaches full height: it
   * fades in over the glass with the sheet's progress. Its bottom corners
   * square off once the sheet rests at full height, where it meets the
   * screen's bottom edge: Lynx can't animate a radius, and on an iPhone the
   * display's rounder corners hide the change.
   */
  protected readonly opaqueStyle = computed(() => {
    const progress = this.progress();
    const radius = GLASS_RADIUS + 1;
    const bottom = progress === 1 && this.#motion() === 'rest' ? 0 : radius;
    const transition =
      this.#motion() === 'settle'
        ? `opacity ${DURATION.slow}ms ${EASING.standard}`
        : 'none';
    return [
      'left: -1px; right: -1px; top: -1px; bottom: -1px;',
      `opacity: ${progress};`,
      `border-top-left-radius: ${radius}px; border-top-right-radius: ${radius}px;`,
      `border-bottom-left-radius: ${bottom}px; border-bottom-right-radius: ${bottom}px;`,
      `transition: ${transition};`,
    ].join(' ');
  });

  // Backdrop scrim dimmed in tandem with the sheet's reveal: full dim while
  // docked (dragOffset 0), lightening as the handle is dragged down so the
  // content behind shows through progressively. Driven through the same live
  // `[style]` path as panelStyle — dragOffset updates on the drag's
  // background thread, and inline styles reflect there (unlike element.animate()
  // opacity tweens, which the open/close fade uses on the main thread instead).
  // The alpha lives in the background-color rather than the element's opacity so
  // it composes cleanly with the fadeIn/fadeOut opacity animations without the
  // two mechanisms fighting over the same property. Clear until the sheet is
  // presented.
  //
  // A sheet growing out of its control, or shrinking back into it, dims
  // the backdrop through this color, with a transition, rather than fading
  // the backdrop itself in and out: the panel is in the backdrop, and on
  // screen meanwhile, and glass under a fading parent would vanish with it,
  // or draw washed out.
  protected readonly backdropStyle = computed(() => {
    const motion = this.#motion();
    const revealed =
      this.#presented() && motion !== 'shrink'
        ? Math.max(0, 1 - this.dragOffset() / BACKDROP_CLEAR_DISTANCE)
        : 0;
    const color = `background-color: rgba(0, 0, 0, ${BACKDROP_DIM[this.look()] * revealed});`;
    return this.#sourceFrame() || motion === 'grow' || motion === 'shrink'
      ? `${color} transition: background-color ${DURATION.normal}ms ${EASING.standard};`
      : color;
  });

  protected onScreenLayout(event: unknown): void {
    this.#screenHeight.set(layoutHeight(event));
    this.#screenWidth.set(layoutWidth(event));
  }

  protected onLargeLayout(event: unknown): void {
    this.#largeHeight.set(layoutHeight(event));
  }

  /**
   * The panel's height at its content's height, the fit detent. Ignored
   * while the panel has a height of its own.
   */
  protected onPanelLayout(event: unknown): void {
    if (this.#height() === null && this.#sourceFrame() === null) {
      this.#fitHeight.set(layoutHeight(event));
    }
  }

  /**
   * @internal Called by the `uiSheetSource` directive: the control that
   * presents the sheet, and its glass, which pairs with the sheet's.
   */
  setSource(source: SourceElement | null, glass: UiGlass | null): void {
    this.#sourceGlass?.pair(null);
    this.#source.set(source);
    this.#sourceGlass = glass;
    glass?.pair(this.glassId);
  }

  protected onBackdropTap(): void {
    if (this.#ignoreNextTap) {
      this.#ignoreNextTap = false;
      return;
    }
    this.open.set(false);
  }

  /**
   * A fresh press starts a fresh click, so drop any ignore left over from a
   * drag whose release didn't produce a backdrop click (one released over the
   * panel, whose `catchtap` swallows it). Otherwise the next real backdrop tap
   * would be ignored. The handle catches its own mousedown, which is fine: it
   * starts a new drag that resets the flag on release.
   */
  protected onBackdropMouseDown(): void {
    this.#ignoreNextTap = false;
  }

  /**
   * No-op tap handler for the panel. `catchtap` (vs `bindtap`) already stops
   * the tap from bubbling to the backdrop — Lynx controls propagation via the
   * event prefix, not at runtime. (The renderer shims `event.stopPropagation()`
   * as a no-op so DOM-style handlers don't crash, but it has no effect here.)
   */
  protected onPanelTap(): void {}

  /**
   * A tap on the grabber moves a resizable sheet to its next detent, and from
   * the tallest back to the shortest, as iOS's grabber does. It's how
   * VoiceOver and TalkBack users resize it too.
   */
  protected onHandleTap(): void {
    if (this.#ignoreNextTap) {
      this.#ignoreNextTap = false;
      return;
    }
    if (!this.resizable()) return;
    const ordered = this.#ordered();
    const at = ordered.findIndex((detent) => detent === this.detent());
    this.#settle(ordered[(at + 1) % ordered.length]);
  }

  /**
   * Begin a drag on the handle strip.
   */
  protected onHandleTouchStart(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    this.#startDrag(y);
  }

  protected onHandleTouchMove(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    if (!this.#isDragging) return;
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    this.#moveDrag(y);
  }

  /**
   * The mouse twin of onHandleTouchStart, so the handle drags on web. A
   * desktop browser fires no touch events for a mouse, and Lynx web passes
   * DOM events straight through rather than turning mouse input into touches.
   * On a touch-only device no mouse events fire, so touch keeps driving it.
   *
   * Reads `y`, not `clientY`: Lynx PC reports a mouse event's clientY relative
   * to the element under the cursor, which changes as the cursor moves across
   * the sheet, while `y` is relative to the Lynx view on PC and web alike.
   */
  protected onHandleMouseDown(e: { y: number }): void {
    this.#startDrag(e.y);
  }

  /**
   * Bound on the backdrop (see the template), so it also sees every move the
   * cursor makes over an open sheet. Only those during a drag count.
   */
  protected onMouseDragMove(e: { y: number; buttons: number }): void {
    if (!this.#isDragging) return;
    // No button held means the mouseup happened where the sheet couldn't see
    // it: a release outside the Lynx view (past the edge of a docs preview, or
    // outside the browser window) goes to the page, and web-core only listens
    // inside the view. Treat the first move back as the release, or the panel
    // would stay mid-drag.
    if (e.buttons === 0) {
      this.onDragEnd();
      return;
    }
    this.#mouseDragMoved = true;
    this.#moveDrag(e.y);
  }

  /**
   * Release the drag, from a touchend, touchcancel or mouseup, or a mouse
   * move with no button held. Dragged down past the threshold below the
   * shortest detent, we set `open` to false and let the effect drive teardown
   * (#doClose → drag-aware #animateOut), which keeps the two-way `open`
   * binding in sync and reuses the `closed` emit. Short of it, the sheet
   * springs back up to its shortest detent. Released between detents, it
   * settles at one (see #detentAfterDrag).
   */
  protected onDragEnd(): void {
    if (!this.#isDragging) return;
    this.#isDragging = false;
    this.#ignoreNextTap = this.#mouseDragMoved;
    const offset = this.dragOffset();
    if (offset > DISMISS_THRESHOLD) {
      this.open.set(false);
    } else if (offset > 0) {
      this.#snapBack(offset);
      this.#settle(this.#ordered()[0]);
    } else {
      this.#settle(this.#detentAfterDrag());
    }
  }

  /**
   * The open slideIn holds the panel at translateY(0%) via fill:'forwards',
   * which would override our inline transform — cancel it so `dragOffset`
   * (applied through panelStyle) actually moves the panel from here on.
   */
  #startDrag(y: number): void {
    this.#panelAnim?.cancel();
    this.#isDragging = true;
    this.#mouseDragMoved = false;
    this.#dragStartY = y;
    this.#dragFrom = this.#currentHeight();
    this.#settleRun++;
    this.#motion.set('drag');
  }

  /**
   * Between the shortest and the tallest detent the sheet's height follows
   * the finger. Below the shortest it rests there and moves down instead,
   * toward dismissal. It doesn't go above the tallest.
   */
  #moveDrag(y: number): void {
    const ordered = this.#ordered();
    const shortest = this.#detentHeight(ordered[0]);
    const tallest = this.#detentHeight(ordered[ordered.length - 1]);
    const target = this.#dragFrom - (y - this.#dragStartY);
    if (target > shortest && tallest > shortest) {
      this.#height.set(Math.min(target, tallest));
      this.dragOffset.set(0);
    } else {
      this.#height.set(this.#restingHeight(ordered[0]));
      this.dragOffset.set(Math.max(0, shortest - target));
    }
  }

  /**
   * The detent a drag that ended between detents settles at: the nearest one
   * past where it began, in the direction it went, once it has gone further
   * than DETENT_THRESHOLD; otherwise the nearest one, which is where it
   * began.
   */
  #detentAfterDrag(): SheetDetent {
    const height = this.#currentHeight();
    const moved = height - this.#dragFrom;
    const all = this.#detentList();
    const onward =
      Math.abs(moved) < DETENT_THRESHOLD
        ? []
        : all.filter(
            (detent) =>
              (this.#detentHeight(detent) - this.#dragFrom) * moved > 0,
          );
    return (onward.length > 0 ? onward : all).reduce((nearest, detent) =>
      Math.abs(this.#detentHeight(detent) - height) <
      Math.abs(this.#detentHeight(nearest) - height)
        ? detent
        : nearest,
    );
  }

  /**
   * A detent's height, from the bottom of the screen to the sheet's top.
   * The fit detent's is its content's, with a glass sheet's inset, and no
   * taller than the large detent.
   */
  #detentHeight(detent: SheetDetent): number {
    switch (detent) {
      case 'medium':
        return this.#screenHeight() / 2;
      case 'large':
        return this.#largeHeight();
      default: {
        const fit =
          this.#fitHeight() + (this.look() === 'glass' ? GLASS_INSET : 0);
        const large = this.#largeHeight();
        return large > 0 ? Math.min(fit, large) : fit;
      }
    }
  }

  /**
   * The sheet's height at rest at a detent: null fits its content.
   */
  #restingHeight(detent: SheetDetent): number | null {
    return detent === 'fit' ? null : this.#detentHeight(detent);
  }

  /**
   * The sheet's height now.
   */
  #currentHeight(): number {
    return this.#height() ?? this.#detentHeight('fit');
  }

  /**
   * Comes to rest at a detent, transitioning the sheet's frame there: its
   * height and, for glass, its inset, with the opaque layer's fade. A sheet
   * fitting its content takes its content's height once the transition has
   * reached it. Under Reduce Motion it moves at once.
   */
  #settle(detent: SheetDetent): void {
    this.#restingAt = detent;
    this.detent.set(detent);
    const target = this.#restingHeight(detent);
    const run = ++this.#settleRun;
    if (this.#reduceMotion() || this.#height() === target) {
      this.#height.set(target);
      this.#motion.set('rest');
      return;
    }
    if (this.#height() === null) {
      // A transition can't start from a height that fits the content (a CSS
      // transition from `auto` jumps), so pin the content's height for a
      // frame first.
      this.#height.set(this.#detentHeight('fit'));
      this.#later(() => {
        if (run === this.#settleRun) this.#transitionTo(detent, target, run);
      }, FRAME);
      return;
    }
    this.#transitionTo(detent, target, run);
  }

  #transitionTo(detent: SheetDetent, target: number | null, run: number): void {
    this.#motion.set('settle');
    this.#height.set(this.#detentHeight(detent));
    // +20ms: Lynx's timers can fire a little early (see #doClose).
    this.#later(() => {
      if (run !== this.#settleRun) return;
      this.#height.set(target);
      this.#motion.set('rest');
    }, DURATION.slow + 20);
  }

  /**
   * The sheet can be destroyed while its open or close sequence is still
   * running, for example by an `@if` around it or a route change right after
   * closing it. The rest of the sequence then ran on the destroyed component:
   * it animated detached elements and emitted `closed` from a destroyed
   * output, which Angular warns about in dev builds (NG0953).
   */
  ngOnDestroy(): void {
    for (const timer of this.#timers) clearTimeout(timer);
  }

  /**
   * `setTimeout`, tracked so that ngOnDestroy can cancel it.
   */
  #later(callback: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      callback();
    }, ms);
    this.#timers.add(timer);
  }

  /**
   * Two-phase open: make the overlay visible first so native elements exist
   * in the tree, then animate on the next frame. Without this, animate()
   * targets elements that haven't been flushed to native yet and silently fails.
   */
  #doOpen(): void {
    const sequence = ++this.#sequence;
    this.#later(() => {
      this.overlayVisible.set(true);
      this.#later(() => this.#present(LAYOUT_TRIES, sequence), 0);
    }, 0);
  }

  /**
   * Shows the sheet at its first detent, or at `detent` when the app chose
   * one. A detent other than the content's height needs the screen's: if it
   * hasn't been laid out yet (the first time the overlay shows), wait for it,
   * a frame at a time, then open at the content's height if it still isn't.
   */
  #present(tries: number, sequence: number): void {
    const detents = this.#detentList();
    const laidOut = this.#screenHeight() > 0 && this.#largeHeight() > 0;
    // Growing out of its control needs the screen's size, as other detents
    // than the content's height do.
    const needsLayout =
      this.#grows() || detents.some((detent) => detent !== 'fit');
    if (needsLayout && !laidOut && tries > 0) {
      this.#later(() => this.#present(tries - 1, sequence), FRAME);
      return;
    }
    const chosen = this.detent();
    const detent =
      chosen !== undefined && detents.includes(chosen) ? chosen : detents[0];
    this.#restingAt = detent;
    this.detent.set(detent);
    this.#height.set(laidOut ? this.#restingHeight(detent) : null);
    this.#motion.set('rest');
    const source = this.#grows() ? this.#source() : null;
    if (source && laidOut) {
      void this.#growIn(source, detent, sequence);
      return;
    }
    this.#presented.set(true);
    this.#animateIn();
  }

  /**
   * Grows the sheet out of the control that presents it: the panel shows at
   * the control's frame, in the same update that hides the control, then
   * moves and resizes to its detent, which iOS's glass follows frame by
   * frame. A control that can't be measured gets the slide instead.
   */
  async #growIn(
    source: SourceElement,
    detent: SheetDetent,
    sequence: number,
  ): Promise<void> {
    const frame = await this.#measureSource(source);
    this.#inSequence(sequence, () => {
      this.#sourceFrame.set(frame);
      this.#presented.set(true);
      if (!frame) {
        this.#animateIn();
        return;
      }
      // The backdrop dims through its color (see backdropStyle).
      this.#backdropAnim?.cancel();
      // See #animateIn.
      this.panelRef().nativeElement.invoke?.('requestAccessibilityFocus');
      // A frame at the control's place, so the native side draws it there,
      // then on to the detent, with a height to transition to (one that
      // fits the content is `auto`, which a transition jumps to), which the
      // content's own takes over at rest.
      this.#later(
        () =>
          this.#inSequence(sequence, () => {
            this.#height.set(this.#detentHeight(detent));
            this.#motion.set('grow');
            this.#sourceFrame.set(null);
            // +20ms: Lynx's timers can fire a little early (see #doClose).
            this.#later(
              () =>
                this.#inSequence(sequence, () => {
                  // A drag that began meanwhile has the sheet now.
                  if (this.#motion() !== 'grow') return;
                  this.#height.set(this.#restingHeight(detent));
                  this.#motion.set('rest');
                }),
              DURATION.slow + 120,
            );
          }),
        FRAME,
      );
    });
  }

  /**
   * Runs `step` of the open or close sequence numbered `sequence`, unless
   * another has started since.
   */
  #inSequence(sequence: number, step: () => void): void {
    if (sequence === this.#sequence) step();
  }

  /**
   * The control's frame, as the panel's style places it, or null when it
   * can't be measured. Measured boxes are in the screen's pixels, which the
   * docs' web previews scale down: the backdrop's measured width against its
   * laid out one undoes that (see UiMenuPopup, which does the same).
   */
  async #measureSource(source: SourceElement): Promise<PanelFrame | null> {
    const [box, screen] = await Promise.all([
      measure(source),
      measure(this.backdropRef().nativeElement),
    ]);
    const width = this.#screenWidth();
    // Gone, or nowhere: a control removed, or hidden with `display: none`.
    if (!box || !screen || !box.width || !width) return null;
    const scale = screen.width / width;
    const left = (box.left - screen.left) / scale;
    const top = (box.top - screen.top) / scale;
    const height = box.height / scale;
    return {
      left,
      right: width - left - box.width / scale,
      bottom: this.#screenHeight() - top - height,
      height,
    };
  }

  /**
   * Reverse: animate out first, then hide the overlay once the animation
   * completes. The +20ms buffer absorbs timer imprecision in the Lynx
   * runtime — hiding the overlay mid-animation causes elements to vanish
   * before the fade finishes.
   */
  #doClose(): void {
    const sequence = ++this.#sequence;
    this.#later(() => {
      // A sheet dragged down goes on down, from the finger.
      const source =
        this.#grows() && this.#presented() && this.dragOffset() === 0
          ? this.#source()
          : null;
      if (source) {
        void this.#shrinkOut(source, sequence);
        return;
      }
      this.#animateOut();
      this.#later(() => this.#finishClose(), DURATION.normal + 20);
    }, 0);
  }

  /**
   * Shrinks the sheet back into the control that presented it, wherever the
   * control is now, or slides it down if it can't be measured.
   */
  async #shrinkOut(source: SourceElement, sequence: number): Promise<void> {
    const frame = await this.#measureSource(source);
    this.#inSequence(sequence, () => {
      if (!frame) {
        this.#animateOut();
        this.#later(() => this.#finishClose(), DURATION.normal + 20);
        return;
      }
      // The backdrop clears through its color (see backdropStyle).
      this.#backdropAnim?.cancel();
      // A height to transition from (see #growIn) for a frame, then into
      // the control.
      this.#height.set(this.#currentHeight());
      this.#motion.set('shrink');
      this.#later(
        () =>
          this.#inSequence(sequence, () => {
            this.#sourceFrame.set(frame);
            this.#later(() => this.#finishClose(), DURATION.normal + 20);
          }),
        FRAME,
      );
    });
  }

  /**
   * Hides the overlay once the sheet has gone. A sheet that grew out of its
   * control hides its glass here too, in the update that shows the control.
   */
  #finishClose(): void {
    this.overlayVisible.set(false);
    this.#presented.set(false);
    this.#sourceFrame.set(null);
    this.#motion.set('rest');
    this.closed.emit();
    // Reset for the next open: the sheet returns to its docked position
    // while hidden, so a fresh open animates cleanly from off-screen,
    // at its first detent unless the app sets another.
    this.dragOffset.set(0);
    this.#restingAt = undefined;
    this.detent.set(undefined);
  }

  #animateIn(): void {
    const backdrop = this.backdropRef().nativeElement;
    const panel = this.panelRef().nativeElement;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeIn(backdrop, { duration: DURATION.normal });
    // Move a screen reader into the panel. It would otherwise stay on whatever
    // opened it, which is now behind the overlay. With the panel's
    // accessibility-exclusive-focus (see the template), it then can't leave
    // the panel until it closes.
    panel.invoke?.('requestAccessibilityFocus');
    this.#panelAnim = this.#slideIn(panel);
  }

  /**
   * Slides the panel up from below the screen. Glass slides without fading
   * on its own: iOS draws glass under a fading parent as a washed-out patch,
   * so it only fades with the backdrop it sits on, which the slide outruns.
   * Under Reduce Motion the glass variant doesn't slide: it fades in with the
   * backdrop where it rests.
   */
  #slideIn(panel: Element): AnimationHandle | undefined {
    const options = { duration: DURATION.slow, easing: EASING.sheet };
    if (this.#calm()) return undefined;
    if (this.look() !== 'glass') return slideIn(panel, 'up', options);
    // 110%: the inset glass sheet sits 8px above the screen's bottom edge,
    // which 100% would leave showing.
    return panel.animate(
      [{ transform: 'translateY(110%)' }, { transform: 'translateY(0%)' }],
      { ...options, fill: 'forwards' },
    );
  }

  #animateOut(): void {
    const backdrop = this.backdropRef().nativeElement;
    const panel = this.panelRef().nativeElement;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeOut(backdrop, { duration: DURATION.normal });
    this.#panelAnim = this.#slideOut(panel);
  }

  /**
   * The reverse of #slideIn. Under Reduce Motion the glass variant fades out
   * with the backdrop where it rests.
   */
  #slideOut(panel: Element): AnimationHandle | undefined {
    const options = {
      duration: DURATION.normal,
      easing: EASING.accelerate,
      fill: 'forwards' as const,
    };
    if (this.#calm()) return undefined;
    const glass = this.look() === 'glass';
    // If the sheet was dragged, continue from the finger's offset off-screen
    // (px → px) rather than slideOut's 0% → 100%, which would snap it up first.
    const offset = this.dragOffset();
    if (offset > 0) {
      const to = `translateY(${Math.max(DISMISS_TRANSLATE, this.#screenHeight())}px)`;
      const from = `translateY(${offset}px)`;
      return panel.animate(
        glass
          ? [{ transform: from }, { transform: to }]
          : [
              { transform: from, opacity: 1 },
              { transform: to, opacity: 0.8 },
            ],
        options,
      );
    }
    return glass
      ? panel.animate(
          [{ transform: 'translateY(0%)' }, { transform: 'translateY(110%)' }],
          options,
        )
      : slideOut(panel, 'down', options);
  }

  /**
   * Release below the dismiss threshold: spring the sheet back to fully open,
   * continuing smoothly from wherever the finger let go (px → 0px). Under
   * Reduce Motion the glass variant goes straight back.
   */
  #snapBack(fromOffset: number): void {
    this.#panelAnim?.cancel();
    this.#panelAnim = this.#calm()
      ? undefined
      : this.panelRef().nativeElement.animate(
          [
            { transform: `translateY(${fromOffset}px)` },
            { transform: 'translateY(0px)' },
          ],
          { duration: DURATION.fast, easing: EASING.spring, fill: 'forwards' },
        );
    // Match the inline transform to the animation's resting state so the two
    // agree once fill:'forwards' hands control back to the style binding.
    this.dragOffset.set(0);
  }
}

/**
 * Marks the control that presents a sheet, which then grows out of it, as
 * iOS 26 grows a sheet out of the button that presents it, and shrinks back
 * into it as it closes.
 *
 * ```html
 * <blur-view
 *   ui-glass
 *   shape="circle"
 *   class="h-11 w-11 items-center flex justify-center"
 *   [uiSheetSource]="sheet"
 *   (bindtap)="open.set(true)"
 * >
 *   <ui-icon name="plus" />
 * </blur-view>
 * <ui-sheet #sheet variant="glass" [(open)]="open">…</ui-sheet>
 * ```
 *
 * It only says where the sheet comes from: open it as before. The Liquid
 * Glass sheet (`variant="glass"` on iOS 26 and later, in the web preview,
 * and on Android with `provideGlass({ android: 'glass' })`) grows out of the
 * control, which hides meanwhile. A control that's glass itself shares the
 * sheet's glass id, so on iOS the sheet takes its glass over (see UiGlass's
 * `glassId`). Elsewhere, and under Reduce Motion, the sheet slides up as it
 * does without one.
 */
@Directive({
  selector: '[uiSheetSource]',
  host: {
    '[style.visibility]': 'sheet().coversSource() ? "hidden" : null',
  },
})
export class UiSheetSource {
  /** The sheet this control presents: a `ui-sheet` or `ui-bottom-sheet`. */
  readonly sheet = input.required<SheetSourceTarget>({
    alias: 'uiSheetSource',
  });

  readonly #element =
    inject<ElementRef<SourceElement>>(ElementRef).nativeElement;
  readonly #glass = inject(UiGlass, { self: true, optional: true });

  /**
   * Points the sheet at this control, and away from it when the directive
   * is destroyed or points at another sheet.
   */
  protected readonly register = effect((onCleanup) => {
    const sheet = this.sheet();
    sheet.setSource(this.#element, this.#glass);
    onCleanup(() => sheet.setSource(null, null));
  });
}
