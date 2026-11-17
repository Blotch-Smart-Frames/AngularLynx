import { Component, computed, inject } from '@angular/core';

import { PokemonList } from '../components/pokemon-list';
import { TabScreenFrame } from '../components/tab-screen-frame';
import { Favourites } from '../data/favourites';
import { pokemonFromId } from '../data/pokemon';

/**
 * The Favourites tab: the favourited Pokémon, each row fetching its detail
 * for its name.
 */
@Component({
  selector: 'app-favourites',
  imports: [PokemonList, TabScreenFrame],
  template: `
    <app-tab-screen-frame>
      <app-pokemon-list
        headerText="Favourites"
        [data]="pokemon()"
        [emptyState]="{ message: 'No favourite Pokémon saved' }"
      />
    </app-tab-screen-frame>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
  `,
})
export class FavouritesScreen {
  readonly #favourites = inject(Favourites);
  protected readonly pokemon = computed(() => this.#favourites.ids().map(pokemonFromId));
}
