import {
  Component,
  ElementRef,
  booleanAttribute,
  InjectionToken,
  Injector,
  Renderer2,
  type Signal,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { type FormValueControl } from '@angular/forms/signals';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import { DURATION, EASING } from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass, UiGlassGroup } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { injectIconColor } from '../icon/icon-theme';
import { type IconName, ICONS } from '../icon/icons';
import {
  KEYBOARD_GAP,
  type KeyboardHeightEvent,
  keyboardHeightOf,
  keyboardLift,
  keyboardScreen,
  measureForKeyboard,
} from './keyboard';

/**
 * A bar that draws a search field's shape itself and holds the field in it,
 * as the dock holds its search field in its glass. It provides this so the
 * field draws only its content: glass inside the bar's glass would be glass
 * on glass.
 */
export type SearchFieldContainer = {
  /**
   * Whether the bar is searching. While it is, Material's field shows its back
   * arrow, the way out of the search, even when it isn't `cancelable`.
   */
  readonly searching: Signal<boolean>;
  /** Called after the field's cancel (or back arrow) clears and blurs it. */
  searchCanceled(): void;
};

export const UI_SEARCH_FIELD_CONTAINER =
  new InjectionToken<SearchFieldContainer>('UI_SEARCH_FIELD_CONTAINER');

/** A search field's sizes in one design, in px. */
type SearchFieldLook = {
  /** The field's height. */
  readonly height: number;
  /** The space between the field's edge and its icons. */
  readonly inset: number;
  /** The space between the icons and the text. */
  readonly gap: number;
  readonly icon: number;
  readonly fontSize: number;
};

const LOOKS: Readonly<Record<GlassDesign, SearchFieldLook>> = {
  // iOS 26's search field at the bottom of the screen: a 48pt glass capsule,
  // as tall as the minimized tab bar beside it.
  glass: { height: 48, inset: 14, gap: 8, icon: 20, fontSize: 17 },
  // UISearchBar's field before iOS 26: a 36pt rounded rectangle.
  frosted: { height: 36, inset: 8, gap: 6, icon: 18, fontSize: 17 },
  // Material 3's search bar: 56dp, a 24dp leading icon 16dp in, body large.
  material: { height: 56, inset: 16, gap: 16, icon: 24, fontSize: 16 },
};

/** The corner radius of UISearchBar's field before iOS 26. */
const FROSTED_RADIUS = 10;

/**
 * The space between the field and its cancel button: a little more than the
 * glass group's spacing, so the two are apart at rest and merge as the
 * button grows out of the field.
 */
const CANCEL_GAP = 10;
const GLASS_SPACING = 8;

/**
 * As wide as the Cancel button before iOS 26 can be, in px: it grows from 0
 * to its label's width by its max-width, as its label's width isn't known.
 */
const FROSTED_CANCEL_MAX_WIDTH = 120;

/** How the field rises above the keyboard and settles back. */
const LIFT_TRANSITION = `transform ${DURATION.normal}ms ${EASING.sheet}`;

/** The cancel button's growth beside the field, and its content's fade. */
const GROW_TRANSITION = ['width', 'max-width', 'margin-left']
  .map((property) => `${property} ${DURATION.normal}ms ${EASING.sheet}`)
  .join(', ');
const FADE_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.standard}`;

/** What Lynx sends with an `<input>`'s `input` and `confirm` events. */
type InputEvent = { detail: { value: string } };

/**
 * An icon's markup, drawn in `color`.
 */
const iconSvg = (icon: IconName, color: string): string =>
  // split/join, not replaceAll(), which PrimJS's ES2019 runtime lacks.
  ICONS[icon].split('currentColor').join(color);

/**
 * A search field: a magnifier, the text, and a button that clears it.
 *
 * ```html
 * <ui-search-field [(value)]="query" (submitted)="search($event)" />
 * <ui-search-field [(value)]="query" placeholder="Songs and artists" cancelable />
 * ```
 *
 * The keyboard's return key reads Search and emits `submitted`. With
 * `cancelable`, a Cancel button shows while the field is in use, which clears
 * it, closes the keyboard and emits `canceled`. The value is a `model()`, so
 * `[(value)]` and Angular's Signal Forms (`[formField]`) both work.
 *
 * Its form follows the platform (see GlassDesign):
 *
 * - `'glass'` (iOS 26 and later, the web, Android with the glass opt-in): a
 *   Liquid Glass capsule, for a field that floats over the content. Its cancel
 *   is a glass circle that grows out of it, as on iOS 26.
 * - `'frosted'` (iOS 15 to 25): UISearchBar's field, a rounded rectangle on a
 *   gray fill, with a Cancel button that slides in beside it.
 * - `'material'` (Android): Material 3's search bar, a 56dp capsule on a tonal
 *   surface, whose search icon turns into a back arrow that cancels.
 *
 * A field the keyboard would cover rises above it while it's focused. Put it
 * in a `<ui-dock>` to search from the bottom of the screen, as iOS 26 does.
 */
@Component({
  selector: 'ui-search-field',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass, UiGlassGroup],
  encapsulation: ViewEncapsulation.None,
  // Angular gives a component's host every static attribute the app writes on
  // it. The placeholder belongs to the <input>, so the host drops its copy: a
  // second element with it is a second match for getByPlaceholderText.
  host: {
    '[class]': 'hostClass()',
    '[attr.placeholder]': 'null',
  },
  template: `
    <ng-template #field>
      @if (showsBack()) {
        <!-- Material's search icon turns into a back arrow, which cancels. -->
        <view
          class="shrink-0 items-center flex justify-center"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="cancelLabel()"
          [style]="iconButtonStyle()"
          (bindtap)="cancel()"
        >
          <svg [attr.content]="backIcon()" [style]="iconStyle()" />
        </view>
      } @else {
        <svg
          class="shrink-0"
          [attr.content]="searchIcon()"
          [style]="iconStyle()"
        />
      }
      <!-- [value], not [attr.value]: only the setValue UI method changes a
           native input's text (see LynxInput). The placeholder goes while
           there's text: iOS can draw both when the text is set from code. -->
      <input
        #input
        confirm-type="search"
        accessibility-element="true"
        accessibility-traits="search"
        [attr.accessibility-label]="placeholder()"
        [attr.placeholder]="value() ? null : placeholder()"
        [attr.placeholder-color]="placeholderColor()"
        [attr.disabled]="disabled() || undefined"
        [value]="value()"
        [class]="inputClass()"
        [style.font-size.px]="look().fontSize"
        (bindinput)="onInput($any($event))"
        (bindconfirm)="onConfirm($any($event))"
        (bindfocus)="onFocus()"
        (bindblur)="onBlur()"
        (bindkeyboardheightchange)="onKeyboard($any($event))"
      />
      @if (value() && !disabled()) {
        <view
          class="shrink-0 items-center flex justify-center"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="clearLabel()"
          [style]="iconButtonStyle()"
          (bindtap)="clear()"
        >
          @if (design() === 'material') {
            <svg [attr.content]="clearIcon()" [style]="iconStyle()" />
          } @else {
            <!-- UIKit's clear button: an x cut out of a filled circle. -->
            <view [class]="clearCircleClass()">
              <svg
                [attr.content]="clearIcon()"
                style="width: 10px; height: 10px;"
              />
            </view>
          }
        </view>
      }
    </ng-template>

    <view [class]="frameClass()" [style]="frameStyle()">
      @switch (form()) {
        @case ('glass') {
          <blur-view
            ui-glass-group
            class="flex-1 flex-row items-center flex"
            [spacing]="glassSpacing"
          >
            <blur-view
              ui-glass
              interactive
              [class]="shapeClass()"
              [style]="shapeStyle()"
            >
              <ng-container [ngTemplateOutlet]="field" />
            </blur-view>
            @if (cancelable()) {
              <!-- iOS 26's cancel: a glass circle that grows out of the
                   field, which shrinks to make room. -->
              <blur-view
                ui-glass
                interactive
                shape="circle"
                class="items-center flex justify-center overflow-hidden"
                accessibility-element="true"
                accessibility-traits="button"
                [attr.accessibility-label]="cancelLabel()"
                [attr.accessibility-elements-hidden]="!cancelShown() || null"
                [style]="glassCancelStyle()"
                (bindtap)="cancel()"
              >
                <svg [attr.content]="closeIcon()" [style]="closeIconStyle()" />
              </blur-view>
            }
          </blur-view>
        }
        @case ('filled') {
          <view [class]="shapeClass()" [style]="shapeStyle()">
            <ng-container [ngTemplateOutlet]="field" />
          </view>
          @if (cancelable() && design() === 'frosted') {
            <!-- UISearchBar's Cancel, which slides in beside the field. -->
            <view
              class="flex-row items-center flex overflow-hidden"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="cancelLabel()"
              [attr.accessibility-elements-hidden]="!cancelShown() || null"
              [style]="frostedCancelStyle()"
              (bindtap)="cancel()"
            >
              <text class="text-[17px] text-primary" [text-maxline]="1">{{
                cancelLabel()
              }}</text>
            </view>
          }
        }
        @default {
          <ng-container [ngTemplateOutlet]="field" />
        }
      }
    </view>
  `,
})
export class UiSearchField implements FormValueControl<string> {
  readonly value = model<string>('');
  /** What the field searches, shown while it's empty. */
  readonly placeholder = input('Search');
  readonly disabled = input(false, { transform: booleanAttribute });
  /**
   * Shows a Cancel button while the field is in use (focused, or holding
   * text): the glass circle with an x of iOS 26, UISearchBar's Cancel before
   * it, Material's back arrow.
   */
  readonly cancelable = input(false, { transform: booleanAttribute });
  /** The Cancel button's label, which a screen reader reads too. */
  readonly cancelLabel = input('Cancel');
  /** What a screen reader says for the button that clears the text. */
  readonly clearLabel = input('Clear text');
  readonly userClass = input<string>('', { alias: 'class' });

  /** Emits the text when the keyboard's Search key is pressed. */
  readonly submitted = output<string>();
  /** Emits after Cancel clears the field and closes the keyboard. */
  readonly canceled = output<void>();
  readonly focused = output<void>();
  readonly blurred = output<void>();

  readonly #container = inject(UI_SEARCH_FIELD_CONTAINER, { optional: true });
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #resolveColor = injectIconColor();
  readonly #injector = inject(Injector);
  readonly #renderer = inject(Renderer2);
  readonly #host = inject(ElementRef);
  readonly inputRef = viewChild.required<ElementRef>('input');

  /** The design on this platform (see GlassDesign). */
  readonly design = injectGlassDesign();
  protected readonly look = computed(() => LOOKS[this.design()]);
  protected readonly glassSpacing = GLASS_SPACING;

  readonly #hasFocus = signal(false);
  /** Whether the field has the keyboard's focus. */
  readonly hasFocus = this.#hasFocus.asReadonly();

  readonly #keyboardHeight = signal(0);
  /**
   * The keyboard's height in px while the field has focus, and 0 otherwise:
   * a bar holding the field (see SearchFieldContainer) moves itself above the
   * keyboard by it.
   */
  readonly keyboardHeight = this.#keyboardHeight.asReadonly();

  /** How far the field has risen to clear the keyboard, in px. */
  readonly #lift = signal(0);
  /** Each keyboard change's measuring, so a late answer can't win. */
  #measuring = 0;

  /** Whether the field is in use: focused, or holding text. */
  readonly #inUse = computed(() => this.#hasFocus() || this.value() !== '');

  /**
   * Whether the Cancel button shows: while the field is in use, when it's
   * `cancelable`. A bar that draws the field's Cancel itself reads it.
   */
  readonly cancelShown = computed(() => this.cancelable() && this.#inUse());

  readonly #animate = computed(() => !this.#settings.reduceMotion());

  /**
   * How the field draws itself: `'glass'` for its own glass, `'filled'` for
   * its own fill, or `'content'` for only its content, in a bar that draws its
   * shape (see SearchFieldContainer). A bar draws no shape before iOS 26,
   * which had no glass to hold it in, so the field keeps its own fill there.
   */
  protected readonly form = computed(() => {
    const design = this.design();
    if (this.#container && design !== 'frosted') return 'content';
    return design === 'glass' ? 'glass' : 'filled';
  });

  /**
   * Material's back arrow, in place of its search icon: while the field is in
   * use and `cancelable`, and always while the bar holding it searches.
   */
  protected readonly showsBack = computed(
    () =>
      this.design() === 'material' &&
      (this.cancelShown() || !!this.#container?.searching()),
  );

  /** In a bar, the field fills the space the bar gives it. */
  protected readonly hostClass = computed(() =>
    cn(
      'flex-row items-center flex',
      this.#container && 'flex-1 self-stretch',
      this.userClass(),
    ),
  );

  protected readonly frameClass = computed(() =>
    cn(
      'flex-1 flex-row items-center flex',
      this.form() === 'content' && 'self-stretch',
    ),
  );

  protected readonly shapeClass = computed(() =>
    cn(
      'flex-1 flex-row items-center flex',
      this.design() === 'glass' && 'overflow-hidden',
      this.design() === 'frosted' ? 'bg-muted' : 'rounded-full',
      this.design() === 'material' && 'bg-secondary',
    ),
  );

  protected readonly shapeStyle = computed(() => {
    const look = this.look();
    return {
      height: `${look.height}px`,
      'border-radius':
        this.design() === 'frosted' ? `${FROSTED_RADIUS}px` : null,
      'padding-left': `${look.inset}px`,
      'padding-right': `${look.inset}px`,
      'column-gap': `${look.gap}px`,
    };
  });

  /**
   * The field rises inside its host to clear the keyboard, so the host stays
   * where the layout put it, for measuring. In a bar's shape, the content
   * takes the field's padding, so its icons sit as far in as on a field of
   * its own.
   */
  protected readonly frameStyle = computed(() => {
    const lift = this.#lift();
    const inset = this.form() === 'content' ? `${this.look().inset}px` : null;
    return {
      'padding-left': inset,
      'padding-right': inset,
      'column-gap': this.form() === 'content' ? `${this.look().gap}px` : null,
      transform: lift ? `translateY(-${lift}px)` : null,
      transition: this.#animate() ? LIFT_TRANSITION : 'none',
    };
  });

  /**
   * On glass, the text takes the glass's foreground, as `ui-glass` sets it.
   * The text gives up its width first as the field shrinks for its Cancel,
   * and the icons keep theirs: `w-0` with `flex-1` grows it from nothing.
   * (Not `min-w-0`: Lynx for Web's `<x-input>` passes its width on to the
   * input inside, but not its min-width.)
   */
  protected readonly inputClass = computed(() =>
    cn(
      'h-full w-0 flex-1',
      this.design() === 'glass' ? 'text-glass-foreground' : 'text-foreground',
      this.disabled() && 'opacity-50',
    ),
  );

  /**
   * The colors of the icons and the placeholder, as theme tokens: on glass,
   * the glass's muted foreground, full strength under Increase Contrast, as
   * `ui-glass` makes `text-glass-muted-foreground`; elsewhere the muted
   * foreground of the field's fill.
   */
  readonly #mutedColor = computed(() => {
    if (this.design() !== 'glass') return 'var(--muted-foreground)';
    return this.#settings.increaseContrast()
      ? 'var(--glass-foreground)'
      : 'var(--glass-muted-foreground)';
  });

  // The icons are drawn here, rather than by nested <ui-icon>s, so their color
  // is resolved to a value and written into the markup, as an SVG can't read
  // a text class or a CSS variable (see icon-theme.ts). So is the
  // placeholder's: an attribute can't read a CSS variable either.
  protected readonly placeholderColor = computed(() =>
    this.#resolveColor(this.#mutedColor()),
  );

  protected readonly searchIcon = computed(() =>
    iconSvg('search', this.#resolveColor(this.#mutedColor())),
  );

  protected readonly backIcon = computed(() =>
    iconSvg('arrow-left', this.#resolveColor('var(--foreground)')),
  );

  /**
   * The clear button's x: Material's in the muted foreground, and UIKit's cut
   * out of its circle, in the color of what's behind.
   */
  protected readonly clearIcon = computed(() =>
    iconSvg(
      'x',
      this.#resolveColor(
        this.design() === 'material'
          ? 'var(--muted-foreground)'
          : 'var(--background)',
      ),
    ),
  );

  protected readonly closeIcon = computed(() =>
    iconSvg('x', this.#resolveColor('var(--glass-foreground)')),
  );

  protected readonly clearCircleClass = computed(() =>
    cn(
      'h-[18px] w-[18px] items-center rounded-full opacity-70 flex justify-center',
      this.design() === 'glass'
        ? 'bg-glass-muted-foreground'
        : 'bg-muted-foreground',
    ),
  );

  protected readonly iconStyle = computed(() => ({
    width: `${this.look().icon}px`,
    height: `${this.look().icon}px`,
  }));

  /**
   * A button around an icon, as tall as the field and a little wider than
   * the icon, so a finger finds it. Its space before the text is the gap.
   */
  protected readonly iconButtonStyle = computed(() => ({
    height: `${this.look().height}px`,
    'min-width': `${this.look().icon + this.look().gap}px`,
  }));

  /**
   * The glass cancel button: a circle as tall as the field, which grows out
   * of the field's end while the field is in use, and back into it after.
   */
  protected readonly glassCancelStyle = computed(() => {
    const shown = this.cancelShown();
    const size = this.look().height;
    return {
      width: `${shown ? size : 0}px`,
      height: `${size}px`,
      'margin-left': `${shown ? CANCEL_GAP : 0}px`,
      transition: this.#animate() ? GROW_TRANSITION : 'none',
    };
  });

  protected readonly closeIconStyle = computed(() => ({
    width: '20px',
    height: '20px',
    opacity: this.cancelShown() ? '1' : '0',
    transition: this.#animate() ? FADE_TRANSITION : 'none',
  }));

  protected readonly frostedCancelStyle = computed(() => {
    const shown = this.cancelShown();
    return {
      'max-width': `${shown ? FROSTED_CANCEL_MAX_WIDTH : 0}px`,
      'margin-left': `${shown ? 8 : 0}px`,
      height: `${this.look().height}px`,
      transition: this.#animate() ? GROW_TRANSITION : 'none',
    };
  });

  /**
   * Gives the field the keyboard's focus, which shows the keyboard.
   */
  focus(): void {
    this.inputRef().nativeElement.invoke('focus');
  }

  /**
   * Takes the keyboard's focus from the field, which closes the keyboard.
   */
  blur(): void {
    this.inputRef().nativeElement.invoke('blur');
  }

  /**
   * Clears the text, keeping the field focused as UIKit's clear button does.
   */
  clear(): void {
    this.value.set('');
  }

  /**
   * What Cancel does: clears the text, closes the keyboard and emits
   * `canceled`.
   */
  cancel(): void {
    this.value.set('');
    this.blur();
    this.canceled.emit();
    this.#container?.searchCanceled();
  }

  protected onFocus(): void {
    this.#hasFocus.set(true);
    this.focused.emit();
  }

  protected onBlur(): void {
    this.#hasFocus.set(false);
    this.#keyboardHeight.set(0);
    this.#settle();
    this.blurred.emit();
  }

  /**
   * Lynx input events carry the text in `event.detail.value`, not on the
   * event's target as on the web.
   */
  protected onInput(event: InputEvent): void {
    if (this.disabled()) return;
    this.value.set(event.detail.value);
  }

  protected onConfirm(event: InputEvent): void {
    this.submitted.emit(event.detail.value);
  }

  protected onKeyboard(event: KeyboardHeightEvent): void {
    const screen = keyboardScreen(this.#injector);
    if (!screen) return;
    const height = keyboardHeightOf(event, screen);
    this.#keyboardHeight.set(height);
    // In a bar, the bar moves itself and the field with it.
    if (this.#container || height <= 0) {
      this.#settle();
      return;
    }
    // The host stays where the layout put it, so measuring it gives the
    // same answer however far the field has risen.
    const measuring = ++this.#measuring;
    measureForKeyboard(this.#renderer, this.#host.nativeElement).then(
      (measured) => {
        if (measuring !== this.#measuring || !measured) return;
        this.#lift.set(
          keyboardLift(
            measured.element,
            measured.page,
            height,
            screen,
            KEYBOARD_GAP,
          ),
        );
      },
    );
  }

  /**
   * Brings a risen field back down, past any measuring still to answer.
   */
  #settle(): void {
    this.#measuring++;
    this.#lift.set(0);
  }
}
