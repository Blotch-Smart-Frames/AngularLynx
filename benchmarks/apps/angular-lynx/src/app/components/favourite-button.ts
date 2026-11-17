import { Component, computed, inject, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { Colors } from '../data/colors';
import { Favourites } from '../data/favourites';
import { icon } from '../data/icons';

// The two drawings a button shows, made once rather than per row.
const HEART = icon('heart', Colors.textSecondary);
const HEART_SOLID = icon('heartSolid', Colors.favourite);

/**
 * The heart that adds a Pokémon to the favourites or takes it out
 * (FavouriteButton in the original): outlined gray, or solid red.
 */
@Component({
  selector: 'app-favourite-button',
  imports: [LYNX_ELEMENTS],
  template: `
    <!-- catchtap: the tap stays here, so a row's heart doesn't also open the
         row's detail. hit-slop is the original's hitSlop of 8. -->
    <view
      hit-slop="8px"
      accessibility-element="true"
      accessibility-traits="button"
      [attr.accessibility-label]="favourite() ? 'Remove from favorites' : 'Add to favorites'"
      (catchtap)="toggle()"
    >
      <svg
        [attr.content]="favourite() ? heartSolid : heart"
        [style.width.px]="size()"
        [style.height.px]="size()"
      />
    </view>
  `,
})
export class FavouriteButton {
  readonly pokemonId = input.required<string>();
  readonly size = input(20);

  readonly #favourites = inject(Favourites);

  protected readonly heart = HEART;
  protected readonly heartSolid = HEART_SOLID;
  protected readonly favourite = computed(() => this.#favourites.isFavourite(this.pokemonId()));

  protected toggle(): void {
    this.#favourites.toggle(this.pokemonId());
  }
}
