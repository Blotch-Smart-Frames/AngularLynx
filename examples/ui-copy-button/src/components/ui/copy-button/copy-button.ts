import {
  Component,
  DestroyRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  type ClipboardError,
  LYNX_ELEMENTS,
  LynxAccessibility,
  LynxClipboard,
} from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import {
  type ButtonSize,
  type ButtonVariant,
  UiButton,
} from '../button/button';
import { UiIcon } from '../icon/icon';

/**
 * Does nothing: a screen reader that couldn't be told about the copy loses
 * only the announcement, as where Lynx has no announcer (the web preview).
 */
const ignore = (): void => undefined;

/**
 * A button that copies `value` to the clipboard. For a moment afterwards its
 * icon turns to a check and its label to "Copied", and a screen reader
 * announces it.
 *
 * Android 13 and later show every copy themselves, in a panel at the bottom
 * of the screen that TalkBack reads, and ask apps not to say it again, so
 * there the button stays as it is (see `LynxClipboard.confirmsCopies`).
 *
 * The host is the box the button fills, so a class on `<ui-copy-button>`
 * places and sizes it (`class="w-full"`); `variant` and `size` style it.
 */
@Component({
  selector: 'ui-copy-button',
  imports: [LYNX_ELEMENTS, UiButton, UiIcon],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  // The label is text inside the button's <text>, where it's projected: the
  // copied label replaces the app's while it shows.
  template: `
    <ui-button
      class="grow"
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      [accessibility-label]="buttonLabel()"
      (pressed)="copy()"
    >
      <ui-icon [name]="showCopied() ? 'check' : 'copy'" [size]="iconSize()" />
      @if (showCopied()) {
        {{ copiedLabel() }}
      } @else {
        <ng-content />
      }
    </ui-button>
  `,
})
export class UiCopyButton {
  /** The text the button copies. */
  readonly value = input.required<string>();
  /** The button's look, as `ui-button`'s. */
  readonly variant = input<ButtonVariant>('default');
  /** The button's height and padding, as `ui-button`'s. `'icon'` shows only the icon. */
  readonly size = input<ButtonSize>('default');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** What the button says after it copies, and the screen reader announces. */
  readonly copiedLabel = input('Copied');
  /** How long, in milliseconds, it says so. */
  readonly duration = input(2000);
  /**
   * What a screen reader says for the button. An icon-only button needs
   * one; a button with a label reads its label without it.
   */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  readonly userClass = input<string>('', { alias: 'class' });

  /** Emits the text once it's on the clipboard. */
  readonly copied = output<string>();
  /**
   * Emits why the text couldn't be copied, such as in Lynx Explorer, which
   * has no clipboard. The button then says nothing.
   */
  readonly copyFailed = output<ClipboardError>();

  readonly #clipboard = inject(LynxClipboard);
  readonly #accessibility = inject(LynxAccessibility);
  #timer?: ReturnType<typeof setTimeout>;

  /** The button says it copied. */
  protected readonly showCopied = signal(false);

  // A field, not a constructor (see the ui-component skill): a timer left
  // running would set a signal of a destroyed view.
  protected readonly stopTimer = inject(DestroyRef).onDestroy(() =>
    clearTimeout(this.#timer),
  );

  protected readonly containerClass = computed(() =>
    cn('flex-row flex', this.userClass()),
  );

  /**
   * An icon-only button's label says it copied too, for a screen reader that
   * reaches the button after the announcement.
   */
  protected readonly buttonLabel = computed(() => {
    const label = this.accessibilityLabel();
    return label && this.showCopied() ? this.copiedLabel() : label;
  });

  protected readonly iconSize = computed(() =>
    this.size() === 'sm' ? ('xs' as const) : ('sm' as const),
  );

  /**
   * Copies at once, in the tap's handler: the web preview's browser copies
   * only for something the person did.
   */
  protected copy(): void {
    const value = this.value();
    this.#clipboard.setString(value).then(
      () => this.#confirm(value),
      (error: ClipboardError) => this.copyFailed.emit(error),
    );
  }

  #confirm(value: string): void {
    this.copied.emit(value);
    if (this.#clipboard.confirmsCopies) return;
    this.showCopied.set(true);
    this.#accessibility.announce(this.copiedLabel()).catch(ignore);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.showCopied.set(false), this.duration());
  }
}
