import { Component, Injector, afterNextRender, computed, effect, inject, viewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { PokemonList } from '../components/pokemon-list';
import { PokemonApi } from '../data/pokemon-api';
import { Startup } from '../startup/app-startup';

/** The reference's (tabs)/index: the Pokédex, a page of 50 at a time. */
@Component({
  selector: 'app-pokedex',
  imports: [IonContent, PokemonList],
  template: `
    <ion-content [scrollY]="false">
      <app-pokemon-list
        headerText="Pokédex"
        emptyMessage="No Pokémon found"
        [data]="pokemon()"
        [loading]="query.isLoading()"
        [error]="query.isError()"
        [fetchingNextPage]="query.isFetchingNextPage()"
        (endReached)="loadMore()"
      />
    </ion-content>
  `,
})
export class Pokedex {
  readonly #startup = inject(Startup);
  readonly #injector = inject(Injector);
  readonly #api = inject(PokemonApi);
  readonly list = viewChild.required(PokemonList);

  protected readonly query = injectInfiniteQuery(() => this.#api.listQuery());
  protected readonly pokemon = computed(() => this.query.data()?.pages.flat() ?? []);

  constructor() {
    // Fully drawn is the first page's rows on screen, not the data arriving. The virtual scroll
    // viewport builds its rows in a change detection pass of its own after it measures, so the
    // effect waits for the rows to exist (the list's `rowsShown`) after the query succeeds;
    // afterNextRender runs once that pass is in the DOM, and the frame after it is when they're
    // drawn, as the reference's useEffect + requestAnimationFrame waits for. The plugin reports it
    // once per process.
    const shown = effect(() => {
      if (!this.query.isSuccess() || !this.list().rowsShown()) return;
      shown.destroy();
      afterNextRender(() => requestAnimationFrame(() => this.#startup.reportFullyDrawn()), {
        injector: this.#injector,
      });
    });
  }

  protected loadMore(): void {
    if (this.query.hasNextPage() && !this.query.isFetchingNextPage()) {
      void this.query.fetchNextPage();
    }
  }
}
