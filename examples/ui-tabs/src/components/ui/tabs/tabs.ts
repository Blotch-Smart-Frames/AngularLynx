import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
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
  directionalSlideIn,
  revealIn,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

@Component({
  selector: 'ui-tabs',
  standalone: true,
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
  // with content sliding in from the direction of the selected tab.
  readonly #tabOrder: string[] = [];
  #previousValue: string | undefined;
  readonly direction = signal<1 | -1>(1);

  protected readonly containerClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );

  constructor() {
    // Reactively compute direction when the active value changes.
    // This handles both internal select() calls and external model changes.
    effect(() => {
      const currentValue = this.value();
      if (this.#previousValue === undefined) {
        this.#previousValue = currentValue;
        return;
      }
      if (currentValue === this.#previousValue) return;

      const prevIndex = this.#tabOrder.indexOf(this.#previousValue);
      const nextIndex = this.#tabOrder.indexOf(currentValue);
      if (prevIndex !== -1 && nextIndex !== -1 && prevIndex !== nextIndex) {
        this.direction.set(nextIndex > prevIndex ? 1 : -1);
      }
      this.#previousValue = currentValue;
    });
  }

  /**
   * Called by UiTabsTrigger to register ordering for direction detection.
   */
  registerTab(value: string): void {
    if (!this.#tabOrder.includes(value)) {
      this.#tabOrder.push(value);
    }
  }

  select(value: string): void {
    this.value.set(value);
    this.changed.emit(value);
  }
}

@Component({
  selector: 'ui-tabs-list',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="listClass()">
      <ng-content />
    </view>
  `,
})
export class UiTabsList {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly listClass = computed(() =>
    cn(
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view #trigger [class]="triggerClass()" (bindtap)="select()">
      <text [class]="textClass()"><ng-content /></text>
    </view>
  `,
})
export class UiTabsTrigger {
  readonly #tabs = inject(UiTabs);

  readonly triggerValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly triggerRef = viewChild<ElementRef>('trigger');
  #anim?: AnimationHandle;
  #previousActive?: boolean;

  protected readonly isActive = computed(
    () => this.#tabs.value() === this.triggerValue(),
  );

  constructor() {
    // Register this trigger with the parent for direction detection
    effect(() => {
      this.#tabs.registerTab(this.triggerValue());
    });

    // Animate trigger background on selection change
    effect(() => {
      const active = this.isActive();
      const el = this.triggerRef()?.nativeElement;
      if (!el || this.#previousActive === undefined) {
        this.#previousActive = active;
        return;
      }
      if (active === this.#previousActive) return;
      this.#previousActive = active;

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
  }

  protected readonly triggerClass = computed(() =>
    cn(
      // No `flex-1` here: now that the list shrinks to fit its content (see
      // `self-start` in UiTabsList), stretching triggers to equal width is
      // pointless, and `flex-basis: 0` growth combined with Lynx treating
      // `min-content` as `0px` would let triggers collapse to zero width and
      // clip their labels. Content-sized triggers match shadcn's default
      // inline tabs.
      'items-center rounded-sm px-3 py-1.5 flex justify-center',
      this.isActive() ? 'bg-background' : 'bg-transparent',
      this.userClass(),
    ),
  );

  protected readonly textClass = computed(() =>
    cn(
      'text-sm font-medium',
      this.isActive() ? 'text-foreground' : 'text-muted-foreground',
    ),
  );

  select(): void {
    this.#tabs.select(this.triggerValue());
  }
}

@Component({
  selector: 'ui-tabs-content',
  standalone: true,
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
  },
  template: `
    <view #content [class]="contentClass()">
      <ng-content />
    </view>
  `,
})
export class UiTabsContent {
  readonly #tabs = inject(UiTabs);

  readonly contentValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly contentRef = viewChild<ElementRef>('content');
  #anim?: AnimationHandle;
  #isFirstRender = true;

  protected readonly isActive = computed(
    () => this.#tabs.value() === this.contentValue(),
  );

  constructor() {
    // Animate content reveal when tab becomes active.
    //
    // The panel is ALWAYS rendered and shown/hidden via the host's `display`
    // (see the `host` block) rather than wrapped in `@if`. On Lynx, destroying a
    // subtree that holds projected `<ng-content>` sends that content through the
    // renderer's "park on the page root" path (it must keep still-alive
    // projected nodes from dying), which drops inactive panels at the bottom of
    // the page and made re-showing them unreliable — the symptom was tab content
    // that vanished and never came back. Keeping every panel mounted and only
    // toggling `display` never destroys or re-parents anything: inactive panels
    // collapse to 0×0 (Lynx `display: none`) so they take no space, and the
    // active one simply reappears in place.
    effect(() => {
      if (!this.isActive()) return;
      // Defer one tick so the display flip to 'flex' has applied before we animate.
      setTimeout(() => {
        const el = this.contentRef()?.nativeElement;
        if (!el) return;

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
  }

  // Visibility is controlled at the host (see `host` block); the inner view is
  // always a normal flex column that fills the shown host.
  protected readonly contentClass = computed(() =>
    cn('mt-2 flex-col flex', this.userClass()),
  );
}
