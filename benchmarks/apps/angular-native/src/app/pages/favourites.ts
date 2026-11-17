import { Component, computed, inject } from '@angular/core';
import { PokemonList } from '../components/pokemon-list.ts';
import { TabScreenFrame } from '../components/tab-screen-frame.ts';
import { Favourites } from '../data/favourites.ts';
import { pokemonFromId } from '../data/pokemon.ts';

/** The reference's (tabs)/favourites: the saved ids, each row fetching its own name. */
@Component({
  selector: 'app-favourites',
  imports: [PokemonList, TabScreenFrame],
  host: { style: 'flex: 1' },
  template: `
    <app-tab-screen-frame>
      <app-pokemon-list
        headerText="Favourites"
        emptyMessage="No favourite Pokémon saved"
        [data]="pokemon()"
      />
    </app-tab-screen-frame>
  `,
})
export class FavouritesPage {
  readonly #favourites = inject(Favourites);
  protected readonly pokemon = computed(() => this.#favourites.ids().map(pokemonFromId));
}
