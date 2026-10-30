import { Directive, effect, ElementRef, inject, input } from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';

/**
 * One trait of `accessibility-traits`, each of which iOS turns into a
 * UIAccessibilityTraits flag (`LynxConverter+UI.m`).
 */
export type AccessibilityTrait =
  | 'text'
  | 'image'
  | 'button'
  | 'link'
  | 'header'
  | 'search'
  | 'selected'
  | 'playable'
  | 'keyboard'
  | 'summary'
  | 'disabled'
  | 'updating'
  | 'adjustable'
  | 'tabbar'
  | 'none';

/**
 * Which traits LynxAccessibilityTraits adds, by name. `none` isn't one: it
 * says the element has no traits, so there's nothing to add.
 */
export type AccessibilityTraitStates = Partial<
  Record<Exclude<AccessibilityTrait, 'none'>, boolean>
>;

/**
 * Adds accessibility traits to an element's own `accessibility-traits` while
 * a binding says so, such as `selected` on the chosen one of several options,
 * or `disabled` on an item that can't be used now.
 *
 * Writing the state into the attribute instead,
 * `accessibility-traits="button,selected"`, works only on iOS. Android reads
 * the attribute as a single trait, so a list stops being a button there. The
 * element merges these traits into its own instead (see
 * LynxElement.setAccessibilityTrait): `button` reads `button,selected` on iOS,
 * and stays `button` on Android, which has no selected trait to add. The
 * element can still set its own traits at any time, and neither undoes the
 * other.
 *
 * A trait that turns false, or that the map leaves out, is taken away again.
 * Only the traits this directive added are: the element's own stay.
 *
 * It's part of LYNX_ELEMENTS, so a component that imports LYNX_ELEMENTS can
 * bind it on any element.
 *
 * @usageNotes
 * ```html
 * <view
 *   [accessibility-element]="true"
 *   accessibility-traits="button"
 *   [accessibility-label]="label()"
 *   [lynxAccessibilityTraits]="{ selected: selected() }"
 *   (bindtap)="chosen.emit()"
 * >
 * ```
 */
@Directive({ selector: '[lynxAccessibilityTraits]' })
export class LynxAccessibilityTraits {
  readonly lynxAccessibilityTraits = input<
    AccessibilityTraitStates | null | undefined
  >();

  readonly #element: BaseLynxElement = inject(ElementRef).nativeElement;
  /** The traits this has added, to take away those that turn off. */
  #added: string[] = [];

  constructor() {
    effect(() => {
      const states: Record<string, boolean | undefined> =
        this.lynxAccessibilityTraits() ?? {};
      const on = Object.keys(states).filter((trait) => states[trait]);
      for (const trait of this.#added) {
        if (!on.includes(trait)) {
          this.#element.setAccessibilityTrait(trait, false);
        }
      }
      for (const trait of on) this.#element.setAccessibilityTrait(trait, true);
      this.#added = on;
    });
  }
}
