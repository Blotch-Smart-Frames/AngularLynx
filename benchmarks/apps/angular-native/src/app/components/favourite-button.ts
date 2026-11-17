import { Component, computed, inject, input } from '@angular/core';
import { Pressable } from '@ng-native/components';
import { NgIcon } from '@ng-native/icons';
import { Favourites } from '../data/favourites.ts';
import { HEART, HEART_SOLID } from '../icons.ts';

/** The reference's FavouriteButton: a heart that toggles the Pokémon in the favourites store. */
@Component({
  selector: 'app-favourite-button',
  imports: [NgIcon, Pressable],
  template: `
    <pressable
      [hitSlop]="8"
      [testID]="testID()"
      [accessibilityLabel]="favourite() ? 'Remove from favorites' : 'Add to favorites'"
      (press)="favourites.toggle(pokemonId())"
    >
      <ng-icon
        [svg]="favourite() ? heartSolid : heart"
        [size]="size()"
        [color]="favourite() ? '#E53935' : '#9E9E9E'"
      />
    </pressable>
  `,
})
export class FavouriteButton {
  readonly pokemonId = input.required<string>();
  readonly size = input(20);
  readonly testID = input<string>();

  protected readonly favourites = inject(Favourites);
  protected readonly favourite = computed(() => this.favourites.has(this.pokemonId()));
  protected readonly heart = HEART;
  protected readonly heartSolid = HEART_SOLID;
}
