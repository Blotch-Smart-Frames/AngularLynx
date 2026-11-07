import {
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
} from '@angular/core';
import { type BaseLynxElement, LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiBottomSheet } from '../bottom-sheet/bottom-sheet';
import { cn } from '../../utils/cn';

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * `UiSelectItem`, for `contentChildren()`. A call rather than the class
 * itself: for a class, Angular's test build keeps an arrow function that
 * nothing calls, which an app's coverage report would show as uncovered.
 */
const selectItem = () => UiSelectItem;

/**
 * The host is the field's column, its label above the field, as ui-input's
 * is, and takes the app's class. Angular gives a component's host every
 * static attribute the app writes on it, so a class on <ui-select> lands on
 * the host whatever the component does: passed on to an element inside it as
 * well, a margin applied twice. The trigger that takes the tap fills the
 * field, beside the sheet rather than around it, so a tap in the sheet
 * doesn't bubble to the trigger. The placeholder is shown in a text, and the
 * accessibility label belongs to the trigger, so the host drops its copies:
 * an element with the attribute is a second match for getByPlaceholderText
 * or getByLabelText.
 */
@Component({
  selector: 'ui-select',
  imports: [LYNX_ELEMENTS, UiBottomSheet],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[attr.placeholder]': 'null',
    '[attr.accessibility-label]': 'null',
  },
  // `sheetOpen` is bound both ways by hand rather than with `[(open)]`: for a
  // two-way binding Angular also compiles a fallback that assigns the field,
  // which never runs for a signal and so shows as an uncovered branch in an
  // app's coverage report.
  template: `
    <!-- The trigger carries the label as its accessibility-label, so screen
         readers read it with the field. Hidden here, or VoiceOver and
         TalkBack would stop on it a second time. -->
    @if (label()) {
      <text [class]="labelClass()" accessibility-elements-hidden="true">{{
        label()
      }}</text>
    }
    <view [class]="fieldClass()">
      <!-- The trigger fills the field: the row stretches it to its height.
           It's one accessibility element, a button: a <view> isn't one by
           default, so VoiceOver and TalkBack read only the text inside it,
           with nothing to say it opens anything. Its label names the field,
           and its value is what the field shows, so VoiceOver says "Country,
           Germany, button". Without a name, the text it shows is its label.
           A disabled select is dimmed to VoiceOver too. -->
      <view
        class="flex-1 flex-row items-center px-3 py-2 flex justify-between"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="triggerLabel()"
        [accessibility-value]="triggerValue()"
        [lynxAccessibilityTraits]="{ disabled: disabled() }"
        (bindtap)="toggle()"
      >
        <text [class]="valueTextClass()">{{ displayText() }}</text>
        <svg [attr.content]="chevronSvg" style="width: 16px; height: 16px;" />
      </view>
      <ui-bottom-sheet
        [open]="sheetOpen()"
        (openChange)="sheetOpen.set($event)"
      >
        <scroll-view scroll-orientation="vertical" style="max-height: 300px;">
          <view class="flex-col pb-4 flex">
            <ng-content />
          </view>
        </scroll-view>
      </ui-bottom-sheet>
    </view>
  `,
})
export class UiSelect {
  readonly value = model<string>('');
  readonly placeholder = input('Select...');
  /**
   * The field's name, shown above it and read by screen readers as the
   * trigger's label.
   */
  readonly label = input<string>('');
  /**
   * What a screen reader calls the field when it's shown without a label,
   * such as beside a label of the app's own. `label` wins when both are set.
   */
  readonly accessibilityLabel = input<string>('', {
    alias: 'accessibility-label',
  });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();

  protected readonly chevronSvg = CHEVRON_SVG;

  // Drives the shared bottom-sheet's `open` model. All the overlay/animation/
  // drag behavior lives in ui-bottom-sheet; select only decides when the sheet
  // is open.
  protected readonly sheetOpen = signal(false);

  // The projected items, so the trigger can show the chosen one's label.
  readonly itemRefs = contentChildren(selectItem());

  protected readonly displayText = computed(() => {
    const val = this.value();
    if (!val) return this.placeholder();
    const item = this.itemRefs().find((i) => i.itemValue() === val);
    return item?.label() ?? val;
  });

  /**
   * The field's name for screen readers: the label, the accessibility label,
   * or, with neither, the text the field shows, so the button still says
   * what it holds.
   */
  protected readonly triggerLabel = computed(
    () => this.label() || this.accessibilityLabel() || this.displayText(),
  );

  /**
   * What the field shows, read after its name. Left out when the name is
   * that text already, or a screen reader would say it twice.
   */
  protected readonly triggerValue = computed(() =>
    this.label() || this.accessibilityLabel() ? this.displayText() : null,
  );

  protected readonly hostClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );

  protected readonly labelClass = computed(() =>
    cn('text-sm font-medium text-foreground'),
  );

  protected readonly fieldClass = computed(() =>
    cn(
      'h-10 flex-row rounded-md border border-input bg-background flex',
      this.disabled() && 'opacity-50',
    ),
  );

  protected readonly valueTextClass = computed(() => {
    const val = this.value();
    return cn(
      'flex-1 text-sm',
      val ? 'text-foreground' : 'text-muted-foreground',
    );
  });

  select(value: string): void {
    this.value.set(value);
    this.changed.emit(value);
    this.close();
  }

  toggle(): void {
    if (this.disabled()) return;
    this.sheetOpen.update((v) => !v);
  }

  open(): void {
    if (this.disabled()) return;
    this.sheetOpen.set(true);
  }

  close(): void {
    this.sheetOpen.set(false);
  }
}

/**
 * Each item is its host, styled through `host` (see UiSelect). The host is
 * one accessibility element, a button named by its label: VoiceOver and
 * TalkBack read it as something to tap rather than as plain text. The
 * accessibility attributes are attribute bindings: a property binding on a
 * component's host is checked against the DOM schema, which has no
 * `accessibility-label`.
 */
@Component({
  selector: 'ui-select-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '[attr.accessibility-element]': "'true'",
    '[attr.accessibility-traits]': "'button'",
    '[attr.accessibility-label]': 'label()',
    '(bindtap)': 'onTap()',
  },
  template: `
    <text [class]="labelClass()">{{ label() }}</text>
    @if (isSelected()) {
      <svg [attr.content]="checkSvg" style="width: 16px; height: 16px;" />
    }
  `,
})
export class UiSelectItem {
  readonly #select = inject(UiSelect);
  readonly #host: BaseLynxElement = inject(ElementRef).nativeElement;

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly label = input.required<string>();
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly checkSvg = CHECK_SVG;

  protected readonly isSelected = computed(
    () => this.#select.value() === this.itemValue(),
  );

  /**
   * The chosen item is `selected` to a screen reader, as its check mark
   * shows. The trait is added to the host's own `button`, as
   * lynxAccessibilityTraits does on an element in a template, which a host
   * can't take: on iOS it reads `button,selected`, and Android, which reads
   * one trait, keeps `button`.
   */
  protected readonly markingSelected = effect(() => {
    this.#host.setAccessibilityTrait('selected', this.isSelected());
  });

  protected readonly containerClass = computed(() =>
    cn(
      'flex-row items-center px-4 py-3 flex justify-between',
      this.isSelected() && 'bg-accent',
      this.userClass(),
    ),
  );

  protected readonly labelClass = computed(() => cn('text-sm text-foreground'));

  protected onTap(): void {
    this.#select.select(this.itemValue());
  }
}
