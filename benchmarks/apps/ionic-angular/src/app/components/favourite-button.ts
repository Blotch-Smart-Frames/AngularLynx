import { Component, computed, inject, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { Favourites } from '../data/favourites';

/** The reference's FavouriteButton: a heart that toggles the Pokémon in the favourites store. */
@Component({
  selector: 'app-favourite-button',
  imports: [IonIcon],
  template: `
    <button
      type="button"
      [attr.data-testid]="testID()"
      [attr.aria-label]="favourite() ? 'Remove from favorites' : 'Add to favorites'"
      (click)="toggle($event)"
    >
      <ion-icon
        [src]="favourite() ? 'assets/icons/heart-solid.svg' : 'assets/icons/heart.svg'"
        [style.font-size.px]="size()"
        [style.color]="favourite() ? '#E53935' : '#9E9E9E'"
      />
    </button>
  `,
  styles: `
    button {
      display: flex;
      /* The reference's hitSlop of 8. */
      margin: -8px;
      padding: 8px;
      border: 0;
      background: none;
    }
  `,
})
export class FavouriteButton {
  readonly pokemonId = input.required<string>();
  readonly size = input(20);
  readonly testID = input<string>();

  protected readonly favourites = inject(Favourites);
  protected readonly favourite = computed(() => this.favourites.has(this.pokemonId()));

  protected toggle(event: Event): void {
    // The heart sits in the row, whose tap opens the detail.
    event.stopPropagation();
    this.favourites.toggle(this.pokemonId());
  }
}
