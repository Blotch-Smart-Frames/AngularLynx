import { Component, NO_ERRORS_SCHEMA, computed, inject, input } from '@angular/core';
import { Favourites } from '../data/favourites';

let tappedAt = 0;

/**
 * Whether a heart was tapped a moment ago. NativeScript lets every gesture recognizer under a
 * finger fire together (its delegate recognizes them simultaneously), so a tap on the heart is a
 * tap on the card around it too, where React Native's innermost touchable takes the touch alone.
 * The card asks this to leave the heart's taps to the heart.
 */
export function heartTappedRecently(): boolean {
  return Date.now() - tappedAt < 250;
}

/**
 * The reference's FavouriteButton: a heart that toggles the Pokémon in the favourites store. The
 * hearts are the reference's SVGs, as template images in the asset catalog, tinted by the Image.
 */
@Component({
  selector: 'app-favourite-button',
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <Image
      [src]="favourite() ? 'res://heart_solid' : 'res://heart'"
      [tintColor]="favourite() ? '#E53935' : '#9E9E9E'"
      [width]="size()"
      [height]="size()"
      [automationText]="testID()"
      [accessibilityLabel]="favourite() ? 'Remove from favorites' : 'Add to favorites'"
      (tap)="toggle()"></Image>
  `,
})
export class FavouriteButton {
  readonly pokemonId = input.required<string>();
  readonly size = input(20);
  readonly testID = input<string>();

  protected readonly favourites = inject(Favourites);
  protected readonly favourite = computed(() => this.favourites.has(this.pokemonId()));

  protected toggle(): void {
    tappedAt = Date.now();
    this.favourites.toggle(this.pokemonId());
  }
}
