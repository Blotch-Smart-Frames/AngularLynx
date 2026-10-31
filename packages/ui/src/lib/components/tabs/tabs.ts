import {
  type ElementRef,
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
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  directionalSlideIn,
  revealIn,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import {
  type SegmentedHost,
  segmentPlace,
  UI_SEGMENTED_HOST,
  UiSegmentedControl,
  UiSegmentedIndicator,
} from '../segmented-control/segmented-control';

/**
 * A tab list's look: shadcn's tabs, or `'segmented'` for the platform's
 * segmented control (see UiTabsList).
 */
export type TabsListVariant = 'default' | 'segmented';

/**
 * `UiTabsTrigger`, for the list's content query. A call rather than the
 * class itself: for a class, Angular's test build keeps an arrow function
 * that nothing calls, which an app's coverage report would show as
 * uncovered.
 */
const triggerType = () => UiTabsTrigger;

/**
 * The list, as the segmented control it provides reads it. Named, not
 * inline: the component's metadata keeps its own copy of an inline factory,
 * which nothing calls.
 */
const tabsListHost = (): SegmentedHost => inject(UiTabsList).segmentedHost;

@Component({
  selector: 'ui-tabs',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiTabs {
  readonly value = model<string>('');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();

  // Direction tracking for content slide animations. Each UiTabsTrigger
  // registers itself in order via registerTab(), building an ordered list.
  // When the active tab changes, we compare the old and new index in this
  // list to determine slide direction (1 = right, -1 = left). This creates
  // a spatial relationship: tabs feel like they're arranged left-to-right,
  // with content sliding in from the direction of the selected tab. A Set
  // keeps the order tabs first registered in and ignores a re-registration
  // (a trigger re-created by `@if` or `@for`).
  readonly #tabOrder = new Set<string>();
  #previousValue: string | undefined;
  readonly direction = signal<1 | -1>(1);

  protected readonly containerClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );

  /**
   * Computes the slide direction when the active value changes, whether from
   * select() or from the model being set. A field rather than a constructor:
   * Angular's test build keeps a function for a constructor that nothing
   * calls, which an app's coverage report would show as uncovered.
   */
  protected readonly trackingDirection = effect(() => {
    const currentValue = this.value();
    if (this.#previousValue === undefined) {
      this.#previousValue = currentValue;
      return;
    }
    // The value can change and change back before the effect runs (two taps
    // in one frame): the tab didn't move, so the direction stays.
    if (currentValue === this.#previousValue) return;

    const order = [...this.#tabOrder];
    const prevIndex = order.indexOf(this.#previousValue);
    const nextIndex = order.indexOf(currentValue);
    // A value with no trigger has no place in the order to slide from or to.
    // Two different registered values always have different indexes.
    if (prevIndex !== -1 && nextIndex !== -1) {
      this.direction.set(nextIndex > prevIndex ? 1 : -1);
    }
    this.#previousValue = currentValue;
  });

  /**
   * Called by UiTabsTrigger to register ordering for direction detection.
   */
  registerTab(value: string): void {
    this.#tabOrder.add(value);
  }

  select(value: string): void {
    this.value.set(value);
    this.changed.emit(value);
  }
}

/**
 * The row of tab triggers.
 *
 * `variant="segmented"` draws the platform's segmented control instead (see
 * UiSegmentedControl), Apple's control for switching between closely
 * related views: iOS 26's capsule with a thumb that lifts into Liquid Glass
 * as it slides between the tabs (it can be dragged across them too), iOS 13
 * to 18's raised thumb before iOS 26, and Material 3 Expressive's connected
 * button group on Android. It fills the width it's given, and the tabs
 * share it.
 *
 * The row is a tab bar to VoiceOver (`tabbar`), which reads each trigger as
 * a tab, and the selected one as selected.
 */
@Component({
  selector: 'ui-tabs-list',
  imports: [LYNX_ELEMENTS, UiSegmentedIndicator],
  encapsulation: ViewEncapsulation.None,
  providers: [
    UiSegmentedControl,
    { provide: UI_SEGMENTED_HOST, useFactory: tabsListHost },
  ],
  // The mouse leaving the row lets go of an indicator dragged in the web
  // preview, where a drag gets no touchcancel.
  template: `
    <view
      accessibility-traits="tabbar"
      [class]="listClass()"
      (bindmouseleave)="segmentedControl.cancel()"
    >
      @if (segmentedControl.underlay()) {
        <ui-segmented-indicator />
      }
      <ng-content />
    </view>
  `,
})
export class UiTabsList {
  /**
   * `'default'`, or `'segmented'` for the platform's segmented control.
   */
  readonly variant = input<TabsListVariant>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #tabs = inject(UiTabs);
  protected readonly segmentedControl = inject(UiSegmentedControl);
  /** The triggers in the list, in order. */
  readonly triggers = contentChildren(triggerType(), { descendants: true });

  /** What the segmented control reads from the list. */
  readonly segmentedHost: SegmentedHost = {
    segmented: computed(() => this.variant() === 'segmented'),
    segmentValues: computed(() =>
      this.triggers().map((trigger) => trigger.triggerValue()),
    ),
    selectedValues: computed(() => [this.#tabs.value()]),
    // One tab is active at a time, and tabs are never disabled.
    multiple: signal(false).asReadonly(),
    disabled: signal(false).asReadonly(),
    select: (value) => this.#tabs.select(value),
  };

  protected readonly listClass = computed(() =>
    this.segmentedControl.enabled()
      ? // A segmented control fills the width it's given, as UIKit's does
        // in a form, and its tabs share it.
        cn(this.segmentedControl.trackClass(), this.userClass())
      : cn(
          // `self-start` keeps the tab bar hugging its triggers. The parent <ui-tabs>
          // is a `flex flex-col` column, and in Lynx's linear/flex layout a child with
          // no explicit width stretches to fill the parent's cross axis — so without
          // it the muted pill spans the full width, leaving empty space around the
          // tabs. Same lever as the badge fix: Lynx has no `inline-flex`, so
          // align-self is how you opt a child into shrink-to-fit.
          'flex-row items-center self-start rounded-lg bg-muted p-1 flex',
          this.userClass(),
        ),
  );
}

@Component({
  selector: 'ui-tabs-trigger',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    // The segmented control places its indicator from each tab's width.
    '(bindlayoutchange)': 'measure($event)',
  },
  // The label is the accessibility element, a button (a tab, in the list's
  // tab bar) named by its own text. A view would need a label of its own.
  // The selected tab is `selected` to a screen reader, which iOS reads:
  // lynxAccessibilityTraits adds the trait to `button` on iOS, and leaves
  // Android, which reads one trait, with `button`.
  template: `
    <view
      #trigger
      [class]="triggerClass()"
      [style]="triggerStyle()"
      (bindtap)="onTap()"
      (bindtouchstart)="press($event)"
      (bindtouchmove)="move($event)"
      (bindtouchend)="release()"
      (bindtouchcancel)="cancel()"
      (bindmousedown)="press($event)"
      (bindmousemove)="move($event)"
      (bindmouseup)="release()"
      (bindmouseleave)="leave()"
    >
      @if (stateLayerClass(); as stateLayer) {
        <view [class]="stateLayer"></view>
      }
      <text
        accessibility-traits="button"
        [lynxAccessibilityTraits]="{ selected: isActive() }"
        [class]="textClass()"
        ><ng-content
      /></text>
    </view>
  `,
})
export class UiTabsTrigger {
  readonly #tabs = inject(UiTabs);
  readonly #settings = inject(LynxAccessibilitySettings);
  // Both absent for a trigger outside a <ui-tabs-list>.
  readonly #list = inject(UiTabsList, { optional: true });
  readonly #segmented = inject(UiSegmentedControl, { optional: true });

  readonly triggerValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly triggerRef = viewChild.required<ElementRef>('trigger');
  #anim?: AnimationHandle;
  #previousActive?: boolean;

  protected readonly isActive = computed(
    () => this.#tabs.value() === this.triggerValue(),
  );

  /**
   * The segmented control this trigger is a segment of, or null when its
   * list is the default tabs (or it has no list).
   */
  readonly #segment = computed(() =>
    this.#segmented?.enabled() ? this.#segmented : null,
  );

  /**
   * A segment's host is the track's flex item, an equal share of it. Angular
   * puts the app's static `class` on the host as well as on the trigger, so
   * the two are merged here: `class="flex-[2]"` makes a wider tab.
   */
  protected readonly hostClass = computed(() => {
    const segment = this.#segment();
    return segment ? cn(segment.segmentHostClass, this.userClass()) : '';
  });

  protected readonly triggerStyle = computed(
    () => this.#segment()?.segmentStyle(this.triggerValue()) ?? null,
  );

  protected readonly stateLayerClass = computed(
    () => this.#segment()?.stateLayerClass(this.triggerValue()) ?? null,
  );

  /** Registers this trigger with the parent for direction detection. */
  protected readonly registering = effect(() => {
    this.#tabs.registerTab(this.triggerValue());
  });

  /** Animates the trigger's background when it's selected or deselected. */
  protected readonly animatingSelection = effect(() => {
    const active = this.isActive();
    const el = this.triggerRef().nativeElement;
    const wasActive = this.#previousActive;
    this.#previousActive = active;
    // The first run only records the starting state, and only a change has
    // anything to animate. (`isActive` is a computed, so the effect only
    // re-runs once it changes; the second check is a safeguard.) A segment
    // doesn't animate itself: the segmented control's indicator moves. Under
    // Reduce Motion the trigger changes at once.
    if (
      wasActive === undefined ||
      wasActive === active ||
      this.#segment() ||
      this.#settings.reduceMotion()
    ) {
      return;
    }

    this.#anim?.cancel();

    if (active) {
      // Activation: spring-based scale + opacity for a lively entrance
      this.#anim = el.animate(
        [
          { transform: 'scaleX(0.95)', opacity: 0.7 },
          { transform: 'scaleX(1)', opacity: 1 },
        ],
        {
          duration: DURATION.normal,
          easing: EASING.springSubtle,
          fill: 'forwards',
        },
      );
    } else {
      // Deactivation: quick shrink + fade for a graceful exit
      this.#anim = el.animate(
        [
          { transform: 'scaleX(1)', opacity: 1 },
          { transform: 'scaleX(0.97)', opacity: 0.7 },
        ],
        {
          duration: DURATION.fast,
          easing: EASING.accelerate,
          fill: 'forwards',
        },
      );
    }
  });

  protected readonly triggerClass = computed(() => {
    const segment = this.#segment();
    if (segment) {
      // The list provides the segmented control, so a segment is in one.
      const place = segmentPlace(this.#list!.triggers(), this);
      return cn(
        segment.segmentClass(this.triggerValue(), place),
        this.userClass(),
      );
    }
    return cn(
      // No `flex-1` here: now that the list shrinks to fit its content (see
      // `self-start` in UiTabsList), stretching triggers to equal width is
      // pointless, and `flex-basis: 0` growth combined with Lynx treating
      // `min-content` as `0px` would let triggers collapse to zero width and
      // clip their labels. Content-sized triggers match shadcn's default
      // inline tabs.
      'items-center rounded-sm px-3 py-1.5 flex justify-center',
      this.isActive() ? 'bg-background' : 'bg-transparent',
      this.userClass(),
    );
  });

  protected readonly textClass = computed(
    () =>
      this.#segment()?.labelClass(this.triggerValue()) ??
      cn(
        'text-sm font-medium',
        this.isActive() ? 'text-foreground' : 'text-muted-foreground',
      ),
  );

  select(): void {
    this.#tabs.select(this.triggerValue());
  }

  protected measure(event: unknown): void {
    this.#segmented?.measure(this.triggerValue(), event);
  }

  /**
   * A press. A segment's touches go to the segmented control, which draws
   * their feedback and moves its indicator.
   */
  protected press(event: unknown): void {
    this.#segment()?.press(this.triggerValue(), event);
  }

  protected move(event: unknown): void {
    this.#segment()?.move(event);
  }

  protected release(): void {
    this.#segment()?.release();
  }

  protected cancel(): void {
    this.#segment()?.cancel();
  }

  protected leave(): void {
    this.#segment()?.leave(this.triggerValue());
  }

  /**
   * A tap that ends a drag of the indicator doesn't select this tab: the
   * drag chose already.
   */
  protected onTap(): void {
    if (this.#segment()?.tap(this.triggerValue()) === false) return;
    this.select();
  }
}

@Component({
  selector: 'ui-tabs-content',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    // Hide the WHOLE host when inactive so it reserves no layout space.
    //
    // The caller writes `class="flex-1"` on <ui-tabs-content>, and Angular
    // applies that to the host element. All three content hosts live as siblings
    // inside the flex-col <ui-tabs>, so three flex-1 hosts each grow to fill a
    // third of the available height — pushing each panel lower than the last
    // (the "Done tab starts at the very bottom" stacking). Hiding only the inner
    // view doesn't help: the flex-1 host still claims its third.
    //
    // Toggling the host's own `display` collapses inactive hosts to 0×0 (Lynx
    // `display: none`) so they claim no space at all, while the single active
    // host keeps its flex-1 and fills the tabs area. `flex-direction: column`
    // makes the host lay its content out vertically when shown.
    '[style.display]': "isActive() ? 'flex' : 'none'",
    '[style.flexDirection]': "'column'",
    // A hidden panel's 0×0 doesn't stop iOS drawing its text: each line is
    // laid out at 0×0 too, and its glyphs spill out from the panel's corner,
    // over the tab list. Clipping the hidden host to its 0×0 hides them.
    '[style.overflow]': "isActive() ? null : 'hidden'",
  },
  template: `
    <view #content [class]="contentClass()">
      <ng-content />
    </view>
  `,
})
export class UiTabsContent {
  readonly #tabs = inject(UiTabs);
  readonly #settings = inject(LynxAccessibilitySettings);

  readonly contentValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly contentRef = viewChild.required<ElementRef>('content');
  #anim?: AnimationHandle;
  #isFirstRender = true;

  protected readonly isActive = computed(
    () => this.#tabs.value() === this.contentValue(),
  );

  /**
   * Animates the content's reveal when its tab becomes active.
   *
   * The panel is ALWAYS rendered and shown/hidden via the host's `display`
   * (see the `host` block) rather than wrapped in `@if`. On Lynx, destroying a
   * subtree that holds projected `<ng-content>` sends that content through the
   * renderer's "park on the page root" path (it must keep still-alive
   * projected nodes from dying), which drops inactive panels at the bottom of
   * the page and made re-showing them unreliable — the symptom was tab content
   * that vanished and never came back. Keeping every panel mounted and only
   * toggling `display` never destroys or re-parents anything: inactive panels
   * collapse to 0×0 (Lynx `display: none`) so they take no space, and the
   * active one simply reappears in place. That also means the content view
   * always exists, so `contentRef` is required.
   */
  protected readonly revealing = effect(() => {
    if (!this.isActive()) return;
    // Defer one tick so the display flip to 'flex' has applied before we animate.
    setTimeout(() => {
      // Under Reduce Motion the panel just appears.
      if (this.#settings.reduceMotion()) return;
      const el = this.contentRef().nativeElement;

      this.#anim?.cancel();

      if (this.#isFirstRender) {
        // First render: subtle vertical reveal (no directional context yet)
        this.#isFirstRender = false;
        this.#anim = revealIn(el, { fromY: 6, duration: DURATION.normal });
      } else {
        // Subsequent renders: direction-aware horizontal slide
        const dir = this.#tabs.direction();
        this.#anim = directionalSlideIn(el, dir, {
          distance: 24,
          duration: 300,
        });
      }
    }, 0);
  });

  // Visibility is controlled at the host (see `host` block); the inner view is
  // always a normal flex column that fills the shown host.
  protected readonly contentClass = computed(() =>
    cn('mt-2 flex-col flex', this.userClass()),
  );
}
