import {
  type ElementRef,
  type OnDestroy,
  Component,
  ViewEncapsulation,
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
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  SCALE,
  fadeIn,
  fadeOut,
  pressDown,
  pressRelease,
  slideIn,
  slideOut,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { UiIcon } from '../icon';
import { UI_ICON_COLOR } from '../icon/icon-theme';

@Component({
  selector: 'ui-nav-drawer',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
      <!-- bg-black/50 dims the content behind the drawer. The fadeIn/fadeOut in
           #animateIn/#animateOut already tween this element's opacity over
           DURATION.normal, so the dim animates in lockstep with the panel slide —
           matching the dialog/action-sheet/bottom-sheet backdrop. It's a named
           color, not a theme one, because the dim is black in light and dark
           mode alike; bg-black/50 compiles to rgb(0 0 0 / 0.5), which Lynx
           accepts. -->
      <view
        #backdrop
        class="h-full w-full bg-black/50"
        (bindtap)="onBackdropTap()"
      >
        <view
          #panel
          [class]="panelClass()"
          [style]="panelPositionStyle()"
          [accessibility-exclusive-focus]="overlayVisible()"
          (catchtap)="onPanelTap()"
        >
          <ng-content />
        </view>
      </view>
    </overlay>
  `,
})
export class UiNavDrawer implements OnDestroy {
  readonly open = model(false);
  readonly side = input<'left' | 'right'>('left');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

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

  // Required: both are always in the template (the overlay hides with
  // display:none rather than leaving the tree), and the sequences only read
  // them from timers that start after the first render.
  readonly backdropRef = viewChild.required<ElementRef>('backdrop');
  readonly panelRef = viewChild.required<ElementRef>('panel');
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
   * first run would call #doClose() and emit `closed` before the drawer
   * has ever been opened.
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

  protected readonly panelClass = computed(() =>
    cn(
      'h-full flex-col bg-background flex',
      this.side() === 'left'
        ? 'border-r border-border'
        : 'border-l border-border',
      this.userClass(),
    ),
  );

  protected readonly panelPositionStyle = computed(() => {
    const sideValue = this.side();
    return sideValue === 'left'
      ? 'position: absolute; top: 0; bottom: 0; left: 0; width: 80%;'
      : 'position: absolute; top: 0; bottom: 0; right: 0; width: 80%;';
  });

  protected onBackdropTap(): void {
    this.open.set(false);
  }

  /**
   * No-op tap handler for the panel. `catchtap` (vs `bindtap`) already stops
   * the tap from bubbling to the backdrop — Lynx controls propagation via the
   * event prefix, not at runtime. (The renderer shims `event.stopPropagation()`
   * as a no-op so DOM-style handlers don't crash, but it has no effect here.)
   */
  protected onPanelTap(): void {}

  close(): void {
    this.open.set(false);
  }

  /**
   * The drawer can be destroyed while its open or close sequence is still
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
   * Two-phase open: first make the overlay visible (so native elements exist),
   * then animate in on the next frame. Without the nested setTimeout, the
   * animate() call would target elements that haven't been flushed to native
   * yet — Lynx element.animate() requires the element to be in the tree.
   */
  #doOpen(): void {
    this.#later(() => {
      this.overlayVisible.set(true);
      this.#later(() => this.#animateIn(), 0);
    }, 0);
  }

  /**
   * Reverse of open: animate out first, then hide the overlay after the
   * animation completes. The +20ms buffer accounts for timing imprecision
   * in Lynx's timer system — removing the overlay mid-animation would
   * cause a visual glitch (elements disappear before fade completes).
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
    const direction = this.side() === 'left' ? 'left' : 'right';
    this.#panelAnim = slideIn(panel, direction, {
      duration: DURATION.slow,
      easing: EASING.sheet,
    });
    // Move a screen reader into the panel. It would otherwise stay on whatever
    // opened it, which is now behind the overlay. With the panel's
    // accessibility-exclusive-focus (see the template), it then can't leave
    // the panel until it closes.
    panel.invoke?.('requestAccessibilityFocus');
  }

  #animateOut(): void {
    const backdrop = this.backdropRef().nativeElement;
    const panel = this.panelRef().nativeElement;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeOut(backdrop, { duration: DURATION.normal });
    const direction = this.side() === 'left' ? 'left' : 'right';
    this.#panelAnim = slideOut(panel, direction, {
      duration: DURATION.normal,
      easing: EASING.accelerate,
    });
  }
}

@Component({
  selector: 'ui-nav-drawer-header',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiNavDrawerHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  // Fixes: the header title/subtitle were drawn behind the device status bar /
  // notch / dynamic island. The drawer panel is positioned top: 0; bottom: 0
  // (see UiNavDrawer.panelPositionStyle), so it spans the full screen height and
  // the header — its first child — starts at y=0, under the system inset.
  // Fix: split the padding — keep `px-4 pb-4` (1rem) and swap the top for
  // `pt-safe-4` = calc(1rem + env(safe-area-inset-top)), preserving the original
  // p-4 top padding while clearing the inset. Degrades to plain 1rem where the
  // inset is 0 (e.g. the web preview), so no platform fork is needed.
  protected readonly containerClass = computed(() =>
    cn(
      'flex-col gap-1.5 border-b border-border px-4 pb-4 flex pt-safe-4',
      this.userClass(),
    ),
  );
}

/**
 * `UiNavDrawerItem`, for `contentChildren()`. A call rather than the class
 * itself: for a class, Angular's test build keeps an arrow function that
 * nothing calls, which an app's coverage report would show as uncovered.
 */
const navDrawerItem = () => UiNavDrawerItem;

@Component({
  selector: 'ui-nav-drawer-content',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Fixes: a long item list scrolled nowhere and spilled over the header and
  // footer instead of scrolling within its own section.
  //
  // Root cause: Lynx forces `scroll-view` into linear layout, where it EXPANDS
  // to fit its content rather than accepting a flex-computed height (see
  // investigations/lynx-vs-web-differences.md, "scroll-view requires an explicit
  // height constraint to scroll"). It therefore has no bound to scroll within
  // and grows past its slot in the panel's flex-col.
  //
  // Two approaches were tried and failed, hence this shape:
  //   1. `flex-1` directly on the scroll-view — ignored, because the scroll-view
  //      sizes to content, not to the flex track. Still overflowed.
  //   2. wrapping the scroll-view in an inner `flex-1` view — the inner view is
  //      NOT the flex child of the panel; the host element is. The host still
  //      sized to content and overflowed, and the wrapper being `flex` (a ROW)
  //      also shrank the scroll-view to its content WIDTH.
  //
  // Working fix: put the flex sizing on the HOST element (the real flex child of
  // the panel's flex-col — same lesson as ui-tabs-content / ui-separator).
  // `flex-1` claims the space left between the header and footer; `flex flex-col`
  // makes the host lay the scroll-view out vertically to fill that height. The
  // panel's flex-col stretches the host to full width by default (Lynx
  // align-items: stretch), so no width class is needed on the host.
  host: {
    class: 'flex-1 flex-col flex',
  },
  // With the host now a definite height, the scroll-view fills it with `h-full`
  // (the explicit height Lynx requires to actually scroll) and `w-full` to span
  // the host width. This is the bound the scroll-view was missing above.
  //
  // (bindcontentsizechanged) fires once the scroll-view finishes laying out its
  // content (iOS/Android). That's the exact moment child frames exist, so it's
  // the precise trigger for scrolling the active item into view when the drawer
  // is first shown — see onContentLayout().
  template: `
    <scroll-view
      scroll-orientation="vertical"
      [class]="contentClass()"
      (bindcontentsizechanged)="onContentLayout()"
    >
      <ng-content />
    </scroll-view>
  `,
})
export class UiNavDrawerContent {
  readonly #drawer = inject(UiNavDrawer);

  readonly userClass = input<string>('', { alias: 'class' });

  // Every nav item projected into this section (Home + each group item). Used to
  // find the active one when the drawer opens. `descendants: true` reaches items
  // nested inside the @for group wrappers, not just the direct content children.
  readonly items = contentChildren(navDrawerItem(), { descendants: true });

  protected readonly contentClass = computed(() =>
    cn('h-full w-full', this.userClass()),
  );

  /**
   * When the drawer opens, land the user on their current route instead of the
   * top of a potentially long nav list.
   *
   * The <overlay> is display:none until open, so the scroll-view has no
   * laid-out child frames until it's shown — defer a tick so the just-shown
   * content is measured before we read it.
   *
   * This open-driven path is the fallback: it covers the web preview (where
   * contentsizechanged isn't emitted) and re-opens that don't trigger a
   * relayout. On device, onContentLayout() below is the precise trigger. Both
   * call the same instant scroll, so firing twice is a harmless no-op.
   */
  protected readonly revealActiveOnOpen = effect(() => {
    if (!this.#drawer.open()) return;
    setTimeout(() => this.#scrollActiveIntoView(), 0);
  });

  /**
   * Fired by the scroll-view once its content finishes layout. Gated on the
   * drawer being open so a close-time relayout (content collapsing as the overlay
   * hides) doesn't scroll an already-dismissed panel.
   */
  protected onContentLayout(): void {
    if (this.#drawer.open()) this.#scrollActiveIntoView();
  }

  #scrollActiveIntoView(): void {
    this.items()
      .find((item) => item.active())
      ?.scrollIntoView();
  }
}

/**
 * The color icons inside an item draw with: the destructive color in a
 * destructive item. A function of its own rather than written inline in
 * `providers`: Angular's test build keeps a second copy of an inline factory
 * that nothing calls, which an app's coverage report would show as uncovered.
 */
const itemIconColor = () => {
  const item = inject(UiNavDrawerItem);
  return computed(() =>
    item.variant() === 'destructive' ? 'var(--destructive)' : undefined,
  );
};

@Component({
  selector: 'ui-nav-drawer-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Icons projected into the item (see the variant below) inject this through
  // the item's element injector, which content projection keeps them under.
  providers: [{ provide: UI_ICON_COLOR, useFactory: itemIconColor }],
  template: `
    <view
      #container
      [class]="containerClass()"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      <ng-content />
    </view>
  `,
})
export class UiNavDrawerItem {
  readonly #drawer = inject(UiNavDrawer);

  readonly variant = input<'default' | 'destructive'>('default');
  readonly active = input(false);
  readonly autoClose = input(true);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  // `destructive` recolors the item's content, which the item doesn't render
  // itself: the label and icon are projected. Lynx doesn't inherit `color`, so
  // a text class here wouldn't reach the label. CSS variables do inherit, so
  // the item points `--foreground` at `--destructive` for everything inside
  // it: a label styled `text-foreground` (as items are) turns destructive.
  // Icons draw with SVG, which can't read CSS, so they get the same color
  // through UI_ICON_COLOR (see providers above).
  protected readonly containerClass = computed(() =>
    cn(
      'flex-row items-center gap-3 px-4 py-3 flex',
      this.active() ? 'bg-accent' : 'bg-transparent',
      this.variant() === 'destructive' && '[--foreground:var(--destructive)]',
      this.userClass(),
    ),
  );

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(
      this.containerRef()?.nativeElement,
      SCALE.pressDownLight,
    );
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    this.pressed.emit();
    if (this.autoClose()) {
      this.#drawer.close();
    }
  }

  /**
   * Scrolls the enclosing scroll-view so this item is visible. `scrollIntoView`
   * is a base LynxUI UIMethod bound to ANY (direct or indirect) child of a
   * scroll container: it walks up to the nearest <scroll-view> and scrolls that
   * container itself. Because it targets the element — not a child index/offset —
   * it's immune to the display:none control-flow anchor <view>s Angular
   * interleaves as scroll-view children for @if/@for (which would corrupt any
   * index-based scroll). UiNavDrawerContent calls this to reveal the active route
   * when the drawer opens.
   *
   * block:'center' centers the item in the viewport; behavior:'auto' positions
   * instantly (not animated) so the drawer appears already-scrolled as it slides
   * in, instead of visibly jumping after it settles.
   */
  scrollIntoView(): void {
    // The param shape differs by platform, so send both — each side reads its
    // own keys and ignores the rest:
    //  - Native Lynx (iOS/Android) reads params.scrollIntoViewOptions.
    //  - Web maps invoke() onto the DOM element.scrollIntoView(params), which
    //    reads top-level ScrollIntoViewOptions (block/behavior).
    this.containerRef()?.nativeElement.invoke('scrollIntoView', {
      scrollIntoViewOptions: { block: 'center', behavior: 'auto' },
      block: 'center',
      behavior: 'auto',
    });
  }
}

@Component({
  selector: 'ui-nav-drawer-footer',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiNavDrawerFooter {
  readonly userClass = input<string>('', { alias: 'class' });

  // Fixes (mirror of the header): the footer content was drawn behind the home
  // indicator. The footer is the last child of the top: 0; bottom: 0 panel, so
  // its lower edge reaches the very bottom of the screen, under the inset.
  // Fix: keep `px-4 pt-4` (1rem) and swap the bottom for `pb-safe-4` =
  // calc(1rem + env(safe-area-inset-bottom)), preserving the original p-4 bottom
  // padding while lifting the content clear of the inset.
  protected readonly containerClass = computed(() =>
    cn(
      'flex-col gap-2 border-t border-border px-4 pt-4 flex pb-safe-4',
      this.userClass(),
    ),
  );
}

@Component({
  selector: 'ui-nav-drawer-trigger',
  imports: [LYNX_ELEMENTS, UiIcon],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- The trigger is only an icon, so it carries the words a screen reader
         says for it. -->
    <view
      #container
      [class]="containerClass()"
      [accessibility-element]="true"
      accessibility-traits="button"
      [accessibility-label]="label()"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      <ui-icon name="menu" size="md" />
    </view>
  `,
})
export class UiNavDrawerTrigger {
  /** What a screen reader says for the trigger. */
  readonly label = input('Open navigation menu');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      'h-10 w-10 items-center rounded-md flex justify-center',
      this.userClass(),
    ),
  );

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    this.pressed.emit();
  }
}
