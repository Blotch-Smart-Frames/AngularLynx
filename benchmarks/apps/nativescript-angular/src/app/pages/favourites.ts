import { Component, NO_ERRORS_SCHEMA, computed, inject } from '@angular/core';
import { PokemonList } from '../components/pokemon-list';
import { Favourites } from '../data/favourites';
import { pokemonFromId } from '../data/pokemon';

/** The reference's (tabs)/favourites: the saved ids, each row fetching its own name. */
@Component({
  selector: 'app-favourites',
  imports: [PokemonList],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <app-pokemon-list
      headerText="Favourites"
      emptyMessage="No favourite Pokémon saved"
      [data]="pokemon()"
    />
  `,
})
export class FavouritesPage {
  readonly #favourites = inject(Favourites);
  protected readonly pokemon = computed(() => this.#favourites.ids().map(pokemonFromId));
}
