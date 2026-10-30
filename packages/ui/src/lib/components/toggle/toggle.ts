import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  contentChildren,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { UI_ICON_COLOR } from '../icon/icon-theme';
import {
  type SegmentedHost,
  UI_SEGMENTED_HOST,
  UiSegmentedControl,
  UiSegmentedIndicator,
} from '../segmented-control/segmented-control';

const toggleVariants = cva('items-center rounded-md flex justify-center', {
  variants: {
    variant: {
      default: '',
      outline: 'border border-border',
    },
    size: {
      default: 'h-10 px-3',
      sm: 'h-9 px-2.5',
      lg: 'h-11 px-5',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ToggleVariant = NonNullable<
  VariantProps<typeof toggleVariants>['variant']
>;
export type ToggleSize = NonNullable<
  VariantProps<typeof toggleVariants>['size']
>;

/**
 * A group's look: a toggle variant for every item, or `'segmented'` for the
 * platform's segmented control (see UiToggleGroup).
 */
export type ToggleGroupVariant = ToggleVariant | 'segmented';

/**
 * `UiToggleGroupItem`, for the group's content query. A call rather than
 * the class itself: for a class, Angular's test build keeps an arrow
 * function that nothing calls, which an app's coverage report would show as
 * uncovered.
 */
const itemType = () => UiToggleGroupItem;

/**
 * The group, as the segmented control it provides reads it. Named, not
 * inline: the component's metadata keeps its own copy of an inline factory,
 * which nothing calls.
 */
const toggleGroupHost = (): SegmentedHost => inject(UiToggleGroup);

/**
 * The color icons projected into an item draw with (see UI_ICON_COLOR): a
 * Material segment's content color, or else whatever surrounds the group.
 */
const itemIconColor = () => {
  const item = inject(UiToggleGroupItem);
  const surrounding = inject(UI_ICON_COLOR, { optional: true, skipSelf: true });
  return computed(() => item.iconColor() ?? surrounding?.());
};

@Component({
  selector: 'ui-toggle',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
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
export class UiToggle {
  readonly pressed = model(false);
  readonly variant = input<ToggleVariant>('default');
  readonly size = input<ToggleSize>('default');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      toggleVariants({ variant: this.variant(), size: this.size() }),
      this.pressed() ? 'bg-accent' : 'bg-transparent',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected onPressStart(): void {
    if (this.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    if (this.disabled()) return;
    this.pressed.update((v) => !v);
  }
}

/**
 * A row of toggles where one (`type="single"`) or several
 * (`type="multiple"`) are pressed. Its `variant` and `size` style every item.
 *
 * `variant="segmented"` draws the platform's segmented control instead
 * (see UiSegmentedControl): iOS 26's capsule with a thumb that lifts into
 * Liquid Glass as it slides between the items, iOS 13 to 18's raised thumb
 * before iOS 26, and Material 3 Expressive's connected button group on
 * Android. The items share the row's width. A single selection has one
 * indicator that slides, which can also be dragged across the items, and
 * keeps one item selected: tapping it again doesn't clear it, as a
 * segmented control's segment doesn't. In a multiple selection each pressed
 * item draws its own thumb, and nothing slides: one indicator can't mark
 * several items. `size` and the other variants don't apply to it.
 */
@Component({
  selector: 'ui-toggle-group',
  imports: [LYNX_ELEMENTS, UiSegmentedIndicator],
  encapsulation: ViewEncapsulation.None,
  providers: [
    UiSegmentedControl,
    { provide: UI_SEGMENTED_HOST, useFactory: toggleGroupHost },
  ],
  // The mouse leaving the row lets go of an indicator dragged in the web
  // preview, where a drag gets no touchcancel.
  template: `
    <view
      [class]="containerClass()"
      (bindmouseleave)="segmentedControl.cancel()"
    >
      @if (segmentedControl.underlay()) {
        <ui-segmented-indicator />
      }
      <ng-content />
    </view>
  `,
})
export class UiToggleGroup implements SegmentedHost {
  readonly type = input<'single' | 'multiple'>('single');
  readonly value = model<string[]>([]);
  /**
   * `'default'` or `'outline'` for every item, or `'segmented'` for the
   * platform's segmented control.
   */
  readonly variant = input<ToggleGroupVariant>('default');
  readonly size = input<ToggleSize>('default');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly segmentedControl = inject(UiSegmentedControl);
  /** The items in the group, in order. */
  readonly items = contentChildren(itemType(), { descendants: true });

  /** Whether the group is drawn as a segmented control (SegmentedHost). */
  readonly segmented = computed(() => this.variant() === 'segmented');
  /** The items' values, in order (SegmentedHost). */
  readonly segmentValues = computed(() =>
    this.items().map((item) => item.itemValue()),
  );
  /** The pressed items' values (SegmentedHost). */
  readonly selectedValues = this.value.asReadonly();
  /** Whether several items can be pressed (SegmentedHost). */
  readonly multiple = computed(() => this.type() === 'multiple');

  protected readonly containerClass = computed(() =>
    cn(
      this.segmented()
        ? this.segmentedControl.trackClass()
        : 'flex-row items-center gap-1 flex',
      this.userClass(),
    ),
  );

  toggle(val: string): void {
    if (this.disabled()) return;
    if (this.type() === 'single') {
      const current = this.value();
      // Single mode allows deselection: tapping the active item again clears
      // the selection to []. This differs from a radio group, which requires
      // one item to always be selected. A segmented control's segment stays
      // selected, as on iOS and Android.
      this.value.set(current.includes(val) && !this.segmented() ? [] : [val]);
    } else {
      this.value.update((list) =>
        list.includes(val) ? list.filter((v) => v !== val) : [...list, val],
      );
    }
  }

  /**
   * Selects one item, as dragging the segmented control's indicator onto it
   * does (SegmentedHost).
   */
  select(val: string): void {
    this.value.set([val]);
  }

  isSelected(val: string): boolean {
    return this.value().includes(val);
  }
}

@Component({
  selector: 'ui-toggle-group-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Icons projected into the item inject this: they're declared inside it.
  providers: [{ provide: UI_ICON_COLOR, useFactory: itemIconColor }],
  host: {
    '[class]': 'hostClass()',
    // The segmented control places its indicator from each item's width.
    '(bindlayoutchange)': 'measure($event)',
  },
  template: `
    <!-- A labeled item is selected to a screen reader while pressed, which
         iOS reads. lynxAccessibilityTraits adds the trait to button on iOS,
         and leaves Android, which reads one trait, with button. -->
    <view
      #container
      [class]="containerClass()"
      [style]="containerStyle()"
      [attr.accessibility-element]="accessibilityLabel() ? 'true' : null"
      [attr.accessibility-traits]="accessibilityLabel() ? 'button' : null"
      [attr.accessibility-label]="accessibilityLabel() || null"
      [lynxAccessibilityTraits]="{ selected: selectedTrait() }"
      (bindtouchstart)="onPressStart($event)"
      (bindtouchmove)="onPressMove($event)"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart($event)"
      (bindmousemove)="onPressMove($event)"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPointerLeave()"
      (bindtap)="onTap()"
    >
      @if (stateLayerClass(); as stateLayer) {
        <view [class]="stateLayer"></view>
      }
      <ng-content />
    </view>
  `,
})
export class UiToggleGroupItem {
  readonly #group = inject(UiToggleGroup);
  readonly #segmented = inject(UiSegmentedControl);

  readonly itemValue = input.required<string>({ alias: 'value' });
  /**
   * What a screen reader says for the item. With it, the item is one
   * accessibility element, a button that's `selected` while pressed. An
   * item of only an icon needs one.
   */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  readonly userClass = input<string>('', { alias: 'class' });

  // Required: always in the template.
  readonly containerRef = viewChild.required<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly isSelected = computed(() =>
    this.#group.isSelected(this.itemValue()),
  );
  /** Only a labeled item is an accessibility element to be `selected`. */
  protected readonly selectedTrait = computed(
    () => !!this.accessibilityLabel() && this.isSelected(),
  );

  /** Whether the item is a segment of a segmented control. */
  readonly #segment = computed(() => this.#segmented.enabled());

  /**
   * The color of icons projected into the item, as a token, or undefined
   * for the surrounding one. A Material segment's content takes the color
   * of its fill's content.
   */
  readonly iconColor = computed(() =>
    this.#segment() ? this.#segmented.iconColor(this.itemValue()) : undefined,
  );

  /**
   * A segment's host is the track's flex item, an equal share of it. Angular
   * puts the app's static `class` on the host as well as on the item, so the
   * two are merged here: `class="flex-[2]"` makes a wider segment.
   */
  protected readonly hostClass = computed(() =>
    this.#segment()
      ? cn(this.#segmented.segmentHostClass, this.userClass())
      : '',
  );

  protected readonly containerClass = computed(() => {
    if (this.#segment()) {
      return cn(
        this.#segmented.segmentClass(this.itemValue()),
        this.userClass(),
      );
    }
    return cn(
      toggleVariants({
        // The group's variant is a toggle variant unless it's segmented.
        variant: this.#group.variant() as ToggleVariant,
        size: this.#group.size(),
      }),
      this.isSelected() ? 'bg-accent' : 'bg-transparent',
      this.#group.disabled() && 'opacity-50',
      this.userClass(),
    );
  });

  protected readonly containerStyle = computed(() =>
    this.#segment() ? this.#segmented.segmentStyle(this.itemValue()) : null,
  );

  protected readonly stateLayerClass = computed(() =>
    this.#segment() ? this.#segmented.stateLayerClass(this.itemValue()) : null,
  );

  protected measure(event: unknown): void {
    this.#segmented.measure(this.itemValue(), event);
  }

  /**
   * A press. A segment's touches go to the segmented control, which draws
   * their feedback and moves its indicator; other items shrink under the
   * finger.
   */
  protected onPressStart(event: unknown): void {
    if (this.#group.disabled()) return;
    if (this.#segment()) {
      this.#segmented.press(this.itemValue(), event);
      return;
    }
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef().nativeElement);
  }

  protected onPressMove(event: unknown): void {
    this.#segmented.move(event);
  }

  protected onPressEnd(): void {
    if (this.#group.disabled()) return;
    if (this.#segment()) {
      this.#segmented.release();
      return;
    }
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }

  protected onPressCancel(): void {
    if (this.#segment()) {
      this.#segmented.cancel();
      return;
    }
    this.#release();
  }

  /**
   * The mouse leaving one segment doesn't end a drag across the others.
   */
  protected onPointerLeave(): void {
    if (this.#segment()) {
      this.#segmented.leave(this.itemValue());
      return;
    }
    this.#release();
  }

  protected onTap(): void {
    if (this.#segmented.tap(this.itemValue())) {
      this.#group.toggle(this.itemValue());
    }
  }

  #release(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }
}
