import { Component, computed, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { PokemonList } from '../components/pokemon-list';
import { Favourites } from '../data/favourites';
import { pokemonFromId } from '../data/pokemon';

/** The reference's (tabs)/favourites: the saved ids, each row fetching its own name. */
@Component({
  selector: 'app-favourites',
  imports: [IonContent, PokemonList],
  template: `
    <ion-content [scrollY]="false">
      <app-pokemon-list
        headerText="Favourites"
        emptyMessage="No favourite Pokémon saved"
        [data]="pokemon()"
      />
    </ion-content>
  `,
})
export class FavouritesPage {
  readonly #favourites = inject(Favourites);
  protected readonly pokemon = computed(() => this.#favourites.ids().map(pokemonFromId));
}
