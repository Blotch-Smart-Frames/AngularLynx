import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, popIn, popOut } from '../../utils/animate';
import { cn } from '../../utils/cn';
import { injectIconColor } from '../icon/icon-theme';

/**
 * The check mark, with a heavier stroke than the icon set's: at 14px a
 * 2px-in-24 line is barely a pixel.
 */
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * How far the touch target reaches past the box, on every side, when the
 * checkbox has no label: 22px to 48px, Android's 48dp target, which covers
 * iOS's 44pt. With a label the row is 44px tall, so 2px does.
 */
const BOX_HIT_SLOP = '13px';
const ROW_HIT_SLOP = '2px';

/**
 * A checkbox, with its label beside it when it's given one:
 *
 * ```html
 * <ui-checkbox [(checked)]="terms" label="Accept terms and conditions" />
 * ```
 *
 * The host is the checkbox: the box, and with a `label` the row that holds
 * both, which toggles wherever it's tapped. On a phone the words are the
 * easier target, and Lynx has no `<label for>` to tie a separate label to
 * the box. Angular gives a component's host every static attribute the app
 * writes on it, so a class on <ui-checkbox> lands there.
 *
 * Without a label the host is only the box, and Lynx's hit-slop gives it a
 * full touch target without the room one takes: padding around the box set
 * it in from everything it should line up with.
 *
 * It's one accessibility element, a button whose value says whether it's
 * checked. The attributes are attribute bindings: a property binding on a
 * component's host is checked against the DOM schema, which has no
 * `accessibility-label`.
 */
@Component({
  selector: 'ui-checkbox',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[attr.hit-slop]': 'hitSlop()',
    '[attr.accessibility-element]': "'true'",
    '[attr.accessibility-traits]': "disabled() ? 'button,disabled' : 'button'",
    '[attr.accessibility-role-description]': "'checkbox'",
    '[attr.accessibility-label]': 'label() || accessibilityLabel() || null',
    '[attr.accessibility-value]': "checked() ? 'Checked' : 'Unchecked'",
    '(bindtap)': 'toggle()',
  },
  template: `
    <view [class]="boxClass()">
      <svg
        #checkmark
        [attr.content]="checkSvg()"
        [style]="
          checked()
            ? 'width: 14px; height: 14px; opacity: 1;'
            : 'width: 14px; height: 14px; opacity: 0;'
        "
      />
    </view>
    <!-- The host carries the label for screen readers. Hidden here, or
         VoiceOver and TalkBack would stop on it a second time. -->
    @if (label()) {
      <text [class]="labelClass()" accessibility-elements-hidden="true">{{
        label()
      }}</text>
    }
  `,
})
export class UiCheckbox {
  readonly checked = model(false);
  /**
   * What the checkbox is for, shown beside the box. The whole row then
   * toggles it.
   */
  readonly label = input<string>('');
  /**
   * What a screen reader calls a checkbox shown without a label, such as
   * one in a row of the app's own. `label` wins when both are set.
   */
  readonly accessibilityLabel = input<string>('', {
    alias: 'accessibility-label',
  });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<boolean>();

  readonly checkmarkRef = viewChild.required<ElementRef>('checkmark');
  readonly #resolveColor = injectIconColor();
  #checkAnim?: AnimationHandle;
  #previousChecked?: boolean;

  /**
   * Pops the checkmark in when checked and out when unchecked. A field rather
   * than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   *
   * `#previousChecked === undefined` guards the first run: we don't want to
   * pop in the checkmark when the component mounts already checked. The
   * equality guard skips a run that isn't a change: `checked` set and set
   * back before the effect runs (two taps in one frame) still re-runs it.
   */
  protected readonly checkmarkAnimation = effect(() => {
    const isChecked = this.checked();
    const el = this.checkmarkRef().nativeElement;
    if (this.#previousChecked === undefined) {
      this.#previousChecked = isChecked;
      return;
    }
    if (isChecked === this.#previousChecked) return;
    this.#previousChecked = isChecked;

    this.#checkAnim?.cancel();
    this.#checkAnim = isChecked ? popIn(el) : popOut(el);
  });

  /**
   * The check in the color of what sits on the primary, resolved and written
   * into the markup: an SVG can't read a text class or a CSS variable (see
   * icon-theme.ts). It was a `✓` character, whose shape and weight were
   * whatever the phone's font drew.
   */
  protected readonly checkSvg = computed(() =>
    // split/join, not replaceAll(), which PrimJS's ES2019 runtime lacks.
    CHECK_SVG.split('currentColor').join(
      this.#resolveColor('var(--primary-foreground)'),
    ),
  );

  protected readonly hostClass = computed(() =>
    cn(
      'flex-row items-center flex',
      // A row is 44px at least, and its label wraps beside the box.
      this.label() && 'min-h-11 gap-3',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly hitSlop = computed(() =>
    this.label() ? ROW_HIT_SLOP : BOX_HIT_SLOP,
  );

  /**
   * The box, in px: a control's size, not text that scales. Unchecked, its
   * edge is the muted foreground, which stands out from the page (3:1 and
   * more) without the weight of the primary, kept for the checked state.
   */
  protected readonly boxClass = computed(() =>
    cn(
      'h-[22px] w-[22px] shrink-0 items-center rounded-[6px] border-[1.5px] flex justify-center',
      this.checked()
        ? 'border-primary bg-primary'
        : 'border-muted-foreground bg-transparent',
    ),
  );

  protected readonly labelClass = computed(() =>
    cn('text-base text-foreground'),
  );

  toggle(): void {
    if (this.disabled()) return;
    const next = !this.checked();
    this.checked.set(next);
    this.changed.emit(next);
  }
}
