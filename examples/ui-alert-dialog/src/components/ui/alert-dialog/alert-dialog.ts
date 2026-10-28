import { NgTemplateOutlet } from '@angular/common';
import {
  type OnDestroy,
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  SCALE,
  fadeIn,
  fadeOut,
  scaleIn,
  scaleOut,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';

/**
 * `'default'` is the alert dialog's own panel on every platform. `'glass'`
 * draws the platform's alert: Liquid Glass on iOS 26 and later, the frosted
 * alert of iOS 15 to 25, and Material 3's dialog on Android (see
 * GlassDesign).
 */
export type AlertDialogVariant = 'default' | 'glass';

/**
 * What the alert dialog draws: its own panel, or the glass variant's form on
 * this platform.
 */
export type AlertDialogLook = 'default' | GlassDesign;

/**
 * `'cancel'` backs out of the alert, `'destructive'` deletes or can't be
 * undone, and `'default'` is any other action.
 */
export type AlertDialogActionVariant = 'default' | 'cancel' | 'destructive';

/**
 * How a glass alert's footer lays out its actions: `'auto'` side by side for
 * up to two and stacked for more, as iOS does, or always `'horizontal'` or
 * `'vertical'`, for labels too long to sit side by side.
 */
export type AlertDialogFooterOrientation = 'auto' | 'horizontal' | 'vertical';

/**
 * How a panel moves: the scale and offset it opens from and the curve it
 * settles by, and the scale and offset it fades out to.
 */
type AlertMotion = {
  readonly fromScale: number;
  readonly fromY: number;
  readonly easing: string;
  readonly toScale: number;
  readonly toY: number;
};

/** The default panel rises and grows in with a slight overshoot. */
const DEFAULT_MOTION: AlertMotion = {
  fromScale: SCALE.dialogFrom,
  fromY: 10,
  easing: EASING.springSubtle,
  toScale: SCALE.dialogTo,
  toY: 10,
};

/**
 * Apple's alerts shrink into place from a little larger as they fade in, and
 * only fade as they go (frames of UIKit's own, slowed down).
 */
const APPLE_MOTION: AlertMotion = {
  fromScale: 1.15,
  fromY: 0,
  easing: EASING.sheet,
  toScale: 1,
  toY: 0,
};

/** How each design draws the glass variant's panel. */
type AlertMetrics = {
  /** The panel's corner radius, in px. */
  readonly radius: number;
  /** The panel's width. */
  readonly width: string;
  /** The space around its content. */
  readonly padding: string;
  readonly motion: AlertMotion;
};

/**
 * Measured from UIKit's alerts on the iOS 27 Simulator, Apple's earlier
 * alerts, and Material 3's dialog spec.
 */
const METRICS: Readonly<Record<GlassDesign, AlertMetrics>> = {
  // iOS 26's alert: 320pt wide, with its 48pt capsule buttons inset 16pt
  // from the edge, so the corners are concentric with theirs (24 + 16).
  glass: {
    radius: 40,
    width: 'w-full max-w-[320px]',
    padding: 'px-[16px] pb-[16px] pt-[22px]',
    motion: APPLE_MOTION,
  },
  // iOS 15 to 25's alert: 270pt wide, 14pt corners, its buttons edge to
  // edge.
  frosted: {
    radius: 14,
    width: 'w-[270px]',
    padding: '',
    motion: APPLE_MOTION,
  },
  // Material 3's basic dialog: 280 to 560dp wide, 28dp corners, 24dp
  // padding. It grows in from a little smaller, and shrinks back as it fades.
  material: {
    radius: 28,
    width: 'w-full min-w-[280px] max-w-[560px]',
    padding: 'p-[24px]',
    motion: {
      fromScale: SCALE.dialogFrom,
      fromY: 0,
      easing: EASING.decelerate,
      toScale: SCALE.dialogTo,
      toY: 0,
    },
  },
};

/**
 * An alert dialog: a panel that asks the user to confirm or cancel an
 * important action, and closes only when they choose one.
 *
 * ```html
 * <ui-alert-dialog variant="glass" [(open)]="open">
 *   <ui-alert-dialog-header>
 *     <ui-alert-dialog-title>Delete Account?</ui-alert-dialog-title>
 *     <ui-alert-dialog-description>This can't be undone.</ui-alert-dialog-description>
 *   </ui-alert-dialog-header>
 *   <ui-alert-dialog-footer>
 *     <ui-alert-dialog-action variant="cancel">Cancel</ui-alert-dialog-action>
 *     <ui-alert-dialog-action variant="destructive" (pressed)="delete()">
 *       Delete
 *     </ui-alert-dialog-action>
 *   </ui-alert-dialog-footer>
 * </ui-alert-dialog>
 * ```
 *
 * With `variant="glass"` it draws the platform's own alert (see
 * AlertDialogVariant), on a `<blur-view ui-glass>`. A blur view can't fade
 * itself: on iOS its material vanishes at less than full opacity. So the
 * glass sits in a plain view that scales and fades, under which iOS draws
 * it as a translucent sheet until it's opaque again, as UIKit draws its own
 * alerts coming and going. The screen's dimming is a layer beside it rather
 * than around it, so it fades on its own.
 *
 * Under Reduce Motion nothing scales, in either variant: the dimming and the
 * panel only fade.
 */
@Component({
  selector: 'ui-alert-dialog',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
      <!-- The overlay sizes only its first child, to the screen. With the
           @if straight inside it, the glass panel drew in the top-left
           corner on iOS (see investigations/lynx-vs-web-differences.md). -->
      <view class="h-full w-full">
        @if (look() === 'default') {
          <view #backdrop [class]="backdropClass()">
            <view
              #panel
              [class]="panelClass()"
              [accessibility-exclusive-focus]="overlayVisible()"
              (catchtap)="onPanelTap()"
            >
              <ng-container [ngTemplateOutlet]="content" />
            </view>
          </view>
        } @else {
          <view
            class="h-full w-full items-center px-[40px] flex justify-center"
          >
            <view #backdrop [class]="dimClass()"></view>
            <!-- What scales and fades: see the class's comment. A view of its
                 own (not flattened into its parent): on Android, the shadow
                 of the Material panel inside an animated flattened view drew
                 at twice the view's offset, off at the screen's corner. -->
            <view
              #shell
              class="w-full flex-col items-center flex"
              [flatten]="false"
            >
              <blur-view
                #panel
                ui-glass
                shape="rounded"
                [radius]="metrics().radius"
                [class]="panelClass()"
                [accessibility-exclusive-focus]="overlayVisible()"
                (catchtap)="onPanelTap()"
              >
                <ng-container [ngTemplateOutlet]="content" />
              </blur-view>
            </view>
          </view>
        }
      </view>
    </overlay>

    <!-- One copy of the content, for whichever panel the dialog draws:
         Angular projects content once, so it can't be in both branches. -->
    <ng-template #content><ng-content /></ng-template>
  `,
})
export class UiAlertDialog implements OnDestroy {
  readonly open = model(false);
  /** `'default'` or `'glass'`; see AlertDialogVariant. */
  readonly variant = input<AlertDialogVariant>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

  protected readonly overlayVisible = signal(false);

  readonly #design = injectGlassDesign();
  readonly #settings = inject(LynxAccessibilitySettings);

  /**
   * What the dialog draws (see AlertDialogLook), which its header, title,
   * description, footer and actions follow.
   */
  readonly look = computed<AlertDialogLook>(() =>
    this.variant() === 'glass' ? this.#design() : 'default',
  );

  /** How the glass variant draws its panel on this platform. */
  readonly metrics = computed(() => METRICS[this.#design()]);

  /** How the panel moves as it opens and closes. */
  readonly #motion = computed(() =>
    this.look() === 'default' ? DEFAULT_MOTION : this.metrics().motion,
  );

  // Required: they're always in the template (the overlay hides with
  // display:none rather than leaving the tree), and the sequences only read
  // them from timers that start after the first render. The panel is read as
  // an element: in the glass variant its tag holds the glass component.
  readonly backdropRef = viewChild.required<ElementRef>('backdrop');
  readonly panelRef = viewChild.required('panel', { read: ElementRef });
  /**
   * What scales and fades in the glass variant: the view the glass sits in
   * (see the class's comment). Only read in that variant, where it's in the
   * template.
   */
  readonly shellRef = viewChild.required<ElementRef>('shell');
  #backdropAnim?: AnimationHandle;
  #panelAnim?: AnimationHandle;
  #hasBeenOpen = false;
  // The open and close sequences' pending timers, so ngOnDestroy can stop
  // them.
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Plays the open or close sequence whenever `open` changes. A field rather
   * than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   *
   * `#hasBeenOpen` prevents the close animation from running on the initial
   * effect evaluation when `open` starts as false. Without this guard, the
   * first run would call #doClose() immediately and emit `closed` before the
   * dialog has ever been opened.
   */
  protected readonly openAndClose = effect(() => {
    const isOpen = this.open();
    if (isOpen) {
      this.#hasBeenOpen = true;
      this.#doOpen();
    } else if (this.#hasBeenOpen) {
      this.#doClose();
    }
  });

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

  // `bg-black/50` supplies the dim. It lives on the backdrop specifically so
  // the existing fadeIn/fadeOut (opacity 0↔1, staggered 30ms ahead of the
  // panel scale-in) animate the dim in lockstep with the dialog appearing —
  // no separate animation needed. It's a named color, not a theme one,
  // because the dim is black in light and dark mode alike; it compiles to
  // `rgb(0 0 0 / 0.5)`, which Lynx accepts.
  protected readonly backdropClass = computed(() =>
    cn('items-center flex justify-center', 'h-full w-full', 'bg-black/50'),
  );

  /**
   * The glass variant dims the screen as its platform does: black at 20%
   * behind Apple's alerts (measured on the iOS 27 Simulator), and Material
   * 3's scrim at 32%. Only a dimming layer, with no blur: neither platform
   * blurs the screen behind an alert, and a plain color draws the same on
   * iOS, Android and the web. (Tailwind's `backdrop-blur-*` would draw
   * nothing there: Lynx has no `backdrop-filter`, and the Lynx preset doesn't
   * generate the classes.)
   */
  protected readonly dimClass = computed(() =>
    cn(
      'h-full w-full absolute left-0 top-0',
      this.look() === 'material' ? 'bg-black/[0.32]' : 'bg-black/20',
    ),
  );

  protected readonly panelClass = computed(() =>
    this.look() === 'default'
      ? cn(
          'w-4/5 flex-col rounded-lg border border-border bg-background p-6 flex',
          this.userClass(),
        )
      : cn(
          'flex-col flex overflow-hidden',
          this.metrics().width,
          this.metrics().padding,
          this.userClass(),
        ),
  );

  /**
   * No-op tap handler for the panel. `catchtap` (vs `bindtap`) already stops
   * the tap from bubbling to the backdrop — Lynx controls propagation via the
   * event prefix, not at runtime. (The renderer shims `event.stopPropagation()`
   * as a no-op so DOM-style handlers don't crash, but it has no effect here.)
   */
  protected onPanelTap(): void {}

  /**
   * The alert dialog can be destroyed while its open or close sequence is still
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
   * Two-phase open: make overlay visible first (so native elements exist in
   * the tree), then animate on the next frame. See nav-drawer for the same
   * pattern — Lynx animate() requires elements to be mounted before use.
   */
  #doOpen(): void {
    this.#later(() => {
      this.overlayVisible.set(true);
      this.#later(() => this.#animateIn(), 0);
    }, 0);
  }

  /**
   * Animate out before hiding; +20ms guards against Lynx timer imprecision
   * causing elements to disappear before the animation finishes.
   */
  #doClose(): void {
    this.#later(() => {
      this.#animateOut();
      this.#later(() => {
        this.overlayVisible.set(false);
        this.closed.emit();
      }, DURATION.normal + 20);
    }, 0);
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

    // 30ms stagger: let the backdrop fade start first so the panel scale-in
    // feels like it's emerging from behind the dimmed overlay rather than
    // appearing simultaneously with it.
    this.#later(() => {
      const motion = this.#motion();
      this.#panelAnim = this.#settings.reduceMotion()
        ? fadeIn(this.#animated(), { duration: DURATION.normal })
        : scaleIn(this.#animated(), {
            duration: DURATION.slow,
            easing: motion.easing,
            fromScale: motion.fromScale,
            fromY: motion.fromY,
          });
    }, 30);
  }

  #animateOut(): void {
    const backdrop = this.backdropRef().nativeElement;
    const motion = this.#motion();

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#panelAnim = this.#settings.reduceMotion()
      ? fadeOut(this.#animated(), { duration: 180 })
      : scaleOut(this.#animated(), {
          duration: 180,
          easing: EASING.accelerate,
          toScale: motion.toScale,
          toY: motion.toY,
        });

    this.#backdropAnim = fadeOut(backdrop, { duration: DURATION.normal });
  }

  /**
   * What the open and close animations scale and fade: the panel, or in the
   * glass variant the view the glass sits in (see the class's comment).
   */
  #animated(): unknown {
    return this.look() === 'default'
      ? this.panelRef().nativeElement
      : this.shellRef().nativeElement;
  }
}

/**
 * The look of the alert dialog a part is in; `'default'` outside one.
 */
const injectAlertLook = () => {
  const dialog = inject(UiAlertDialog, { optional: true });
  return computed<AlertDialogLook>(() => dialog?.look() ?? 'default');
};

@Component({
  selector: 'ui-alert-dialog-header',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiAlertDialogHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #look = injectAlertLook();

  /**
   * iOS 26 sets its text 30pt from the panel's edge, further in than its
   * buttons; before iOS 26 Apple centered it, with room above and below
   * before the separator over the buttons.
   */
  protected readonly containerClass = computed(() =>
    cn(
      'flex-col flex',
      {
        default: 'gap-1.5',
        glass: 'gap-[5px] px-[14px]',
        frosted: 'items-center gap-[2px] px-[16px] pb-[20px] pt-[20px]',
        material: 'gap-[16px]',
      }[this.#look()],
      this.userClass(),
    ),
  );
}

@Component({
  selector: 'ui-alert-dialog-title',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiAlertDialogTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #look = injectAlertLook();

  /**
   * Apple's alert titles are 17pt semibold, leading from iOS 26 and centered
   * before it. Material's headline is 24sp regular.
   */
  protected readonly textClass = computed(() =>
    cn(
      {
        default: 'text-lg font-semibold text-foreground',
        glass: 'text-[17px] font-semibold leading-[22px] text-glass-foreground',
        frosted:
          'text-[17px] font-semibold leading-[22px] text-glass-foreground text-center',
        material: 'text-[24px] leading-[32px] text-glass-foreground',
      }[this.#look()],
      this.userClass(),
    ),
  );
}

@Component({
  selector: 'ui-alert-dialog-description',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiAlertDialogDescription {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #look = injectAlertLook();

  /**
   * iOS 26's message is 15pt in the secondary color; before it, 13pt in the
   * label color. Material's supporting text is 14sp in on-surface-variant.
   */
  protected readonly textClass = computed(() =>
    cn(
      {
        default: 'text-sm text-muted-foreground',
        glass: 'text-[15px] leading-[20px] text-glass-muted-foreground',
        frosted: 'text-[13px] leading-[16px] text-glass-foreground text-center',
        material: 'text-[14px] leading-[20px] text-glass-muted-foreground',
      }[this.#look()],
      this.userClass(),
    ),
  );
}

/**
 * `UiAlertDialogAction`, for `contentChildren()`. A call rather than the
 * class itself: the query's metadata keeps an arrow function of its own for
 * a class, which nothing calls, so an app's coverage report would show it as
 * uncovered.
 */
const actionType = () => UiAlertDialogAction;

@Component({
  selector: 'ui-alert-dialog-footer',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      @if (separated()) {
        <!-- The hairline over the buttons of Apple's alerts before iOS 26. -->
        <view
          class="h-[0.5px] w-full bg-glass-foreground opacity-20 absolute left-0 top-0"
        ></view>
      }
      <ng-content />
    </view>
  `,
})
export class UiAlertDialogFooter {
  readonly userClass = input<string>('', { alias: 'class' });
  /**
   * How a glass alert lays out its actions; see AlertDialogFooterOrientation.
   * The default variant always puts them in a row.
   */
  readonly orientation = input<AlertDialogFooterOrientation>('auto');

  readonly #look = injectAlertLook();

  /** The actions in the footer, in the order they're written. */
  readonly actions = contentChildren(actionType(), { descendants: true });

  /**
   * Whether the glass variant stacks the actions: Apple's alerts put two side
   * by side and stack three. Material's dialog keeps its text buttons in a
   * row.
   */
  readonly stacked = computed(() => {
    const orientation = this.orientation();
    if (orientation !== 'auto') return orientation === 'vertical';
    return this.#look() !== 'material' && this.actions().length > 2;
  });

  /**
   * The actions in the order the glass variant shows them. Apple and Material
   * both put the cancel action on the leading side of a row, and Apple puts
   * it at the bottom of a stack, wherever it's written, as UIKit does.
   */
  readonly order = computed(() => {
    const actions = this.actions();
    const cancels = actions.filter((action) => action.variant() === 'cancel');
    const others = actions.filter((action) => action.variant() !== 'cancel');
    return this.stacked() ? [...others, ...cancels] : [...cancels, ...others];
  });

  /** Whether an action is preferred, which takes the cancel's emphasis. */
  readonly hasPreferred = computed(() =>
    this.actions().some((action) => action.preferred()),
  );

  protected readonly separated = computed(() => this.#look() === 'frosted');

  protected readonly containerClass = computed(() => {
    const look = this.#look();
    if (look === 'default') {
      return cn('flex-row gap-2 pt-4 flex justify-end', this.userClass());
    }
    return cn(
      this.stacked() ? 'flex-col' : 'flex-row',
      'flex',
      {
        glass: 'mt-[20px] gap-[8px]',
        frosted: 'relative',
        material: 'mt-[24px] gap-[8px] justify-end',
      }[look],
      this.userClass(),
    );
  });
}

/**
 * One of an alert dialog's buttons. Pressing it emits `pressed` and closes
 * the dialog, as every alert button does.
 *
 * ```html
 * <ui-alert-dialog-action variant="cancel">Cancel</ui-alert-dialog-action>
 * <ui-alert-dialog-action variant="destructive" (pressed)="delete()">
 *   Delete
 * </ui-alert-dialog-action>
 * ```
 *
 * Put it in a `<ui-alert-dialog-footer>`. Each look draws it as its
 * platform does:
 *
 * - **Default:** an outline button for cancel, a filled primary or
 *   destructive one otherwise.
 * - **iOS 26 and later:** a 48pt capsule on a light fill, with the preferred
 *   action filled with the tint.
 * - **iOS 15 to 25:** a 44pt text button in the tint between hairlines, the
 *   preferred action, or else the cancel, in bold.
 * - **Material:** a text button in the primary color.
 *
 * Destructive actions read in the destructive color everywhere.
 */
@Component({
  selector: 'ui-alert-dialog-action',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[style.order]': 'position()',
    '[style.opacity]': 'hostOpacity()',
    // An action with an accessibility label is one element that says it;
    // without one, its label's own text is read, as a button (see the
    // template), as `ui-button` does.
    '[attr.accessibility-element]': "accessibilityLabel() ? 'true' : null",
    '[attr.accessibility-traits]': "accessibilityLabel() ? 'button' : null",
    '[attr.accessibility-label]': 'accessibilityLabel() || null',
    // Touch for native, mouse for Lynx for Web, which never sends touches
    // from a mouse (see `ui-button`).
    '(bindtouchstart)': 'hold(true)',
    '(bindtouchend)': 'hold(false)',
    '(bindtouchcancel)': 'hold(false)',
    '(bindmousedown)': 'hold(true)',
    '(bindmouseup)': 'hold(false)',
    '(bindmouseleave)': 'hold(false)',
    '(bindtap)': 'choose()',
  },
  template: `
    @if (layerClass(); as layer) {
      <!-- The capsule's fill and pressed highlight, or the pressed
           highlight alone: a view of its own, so it can be translucent
           under an opaque label. -->
      <view [class]="layer" [style.opacity]="layerOpacity()"></view>
    }
    @if (separatorClass(); as line) {
      <view [class]="line"></view>
    }
    <text
      [attr.accessibility-traits]="accessibilityLabel() ? null : 'button'"
      [class]="labelClass()"
      ><ng-content
    /></text>
  `,
})
export class UiAlertDialogAction {
  /** `'default'`, `'cancel'` or `'destructive'`; see AlertDialogActionVariant. */
  readonly variant = input<AlertDialogActionVariant>('default');
  /**
   * The action to take when the user reads the alert and agrees, such as
   * Save. iOS 26 fills it with the tint and earlier iOS sets it in bold, the
   * way `UIAlertController.preferredAction` draws. Never the cancel action.
   */
  readonly preferred = input(false, { transform: booleanAttribute });
  /** What a screen reader reads, when the label isn't enough. */
  readonly accessibilityLabel = input<string | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  /** The action was chosen. The dialog closes. */
  readonly pressed = output<void>();

  readonly #dialog = inject(UiAlertDialog);
  readonly #footer = inject(UiAlertDialogFooter);

  /** Whether a finger (or the mouse) is down on the action. */
  protected readonly held = signal(false);

  readonly #look = computed(() => this.#dialog.look());
  readonly #row = computed(() => !this.#footer.stacked());
  readonly #destructive = computed(() => this.variant() === 'destructive');

  /**
   * Where the action is in its footer as the glass variant shows it (see
   * UiAlertDialogFooter.order); the default variant keeps the written order.
   */
  protected readonly position = computed(() =>
    this.#look() === 'default' ? null : this.#footer.order().indexOf(this),
  );

  protected readonly hostClass = computed(() => {
    const destructive = this.#destructive();
    const row = this.#row();
    switch (this.#look()) {
      case 'default':
        return cn(
          'h-10 items-center rounded-md px-4 py-2 flex justify-center',
          this.variant() === 'cancel'
            ? 'border border-border bg-background'
            : destructive
              ? 'bg-destructive'
              : 'bg-primary',
          this.userClass(),
        );
      case 'glass':
        return cn(
          'h-[48px] items-center rounded-full px-[16px] flex relative justify-center overflow-hidden',
          row && 'flex-1',
          this.preferred() &&
            (destructive ? 'bg-destructive' : 'bg-glass-tint'),
          this.userClass(),
        );
      case 'frosted':
        return cn(
          'h-[44px] items-center px-[8px] flex relative justify-center',
          row && 'flex-1',
          this.userClass(),
        );
      default:
        return cn(
          'h-[40px] items-center rounded-full px-[12px] flex relative justify-center overflow-hidden',
          this.userClass(),
        );
    }
  });

  /** The default variant's solid buttons dim while pressed. */
  protected readonly hostOpacity = computed(() =>
    this.#look() === 'default' && this.held() ? 0.8 : null,
  );

  /**
   * iOS 26's capsules sit on a light fill of the glass's foreground, which
   * deepens under the finger (a preferred capsule lightens instead); the
   * other looks only light up while pressed: Material's state layer, in the
   * label's color.
   */
  protected readonly layerClass = computed(() => {
    const look = this.#look();
    if (look === 'default') return null;
    const fill =
      look === 'glass' && this.preferred()
        ? 'bg-glass-tint-foreground'
        : look === 'material'
          ? this.#destructive()
            ? 'bg-destructive'
            : 'bg-primary'
          : 'bg-glass-foreground';
    return cn('h-full w-full absolute left-0 top-0', fill);
  });

  protected readonly layerOpacity = computed(() => {
    const held = this.held();
    if (this.#look() === 'glass' && !this.preferred()) {
      return held ? 0.2 : 0.12;
    }
    return held ? 0.1 : 0;
  });

  /**
   * The hairline between the buttons of Apple's alerts before iOS 26: beside
   * every button but the first in a row, and above every button but the
   * first in a stack. The footer draws the one above them all.
   */
  protected readonly separatorClass = computed(() => {
    if (this.#look() !== 'frosted' || this.position() === 0) return null;
    return cn(
      'bg-glass-foreground opacity-20 absolute left-0 top-0',
      this.#row() ? 'h-full w-[0.5px]' : 'h-[0.5px] w-full',
    );
  });

  protected readonly labelClass = computed(() => {
    const destructive = this.#destructive();
    switch (this.#look()) {
      case 'default':
        return cn(
          'text-sm font-medium',
          this.variant() === 'cancel'
            ? 'text-foreground'
            : destructive
              ? 'text-destructive-foreground'
              : 'text-primary-foreground',
        );
      case 'glass':
        return cn(
          'text-[17px] text-center',
          this.preferred()
            ? cn(
                'font-semibold',
                destructive
                  ? 'text-destructive-foreground'
                  : 'text-glass-tint-foreground',
              )
            : cn(
                'font-medium',
                destructive ? 'text-destructive' : 'text-glass-foreground',
              ),
        );
      case 'frosted':
        // UIKit sets the preferred action in bold, or else the cancel.
        return cn(
          'text-[17px] text-center',
          destructive ? 'text-destructive' : 'text-glass-tint',
          (this.preferred() ||
            (this.variant() === 'cancel' && !this.#footer.hasPreferred())) &&
            'font-semibold',
        );
      default:
        return cn(
          'text-[14px] font-medium text-center',
          destructive ? 'text-destructive' : 'text-primary',
        );
    }
  });

  protected hold(down: boolean): void {
    this.held.set(down);
  }

  /**
   * Emits `pressed` and closes the dialog, once: a second tap while the
   * dialog closes does nothing, as on iOS.
   */
  protected choose(): void {
    if (!this.#dialog.open()) return;
    this.pressed.emit();
    this.#dialog.open.set(false);
  }
}
