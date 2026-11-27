import { Component, Injector, NO_ERRORS_SCHEMA, afterNextRender, computed, effect, inject } from '@angular/core';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { PokemonList } from '../components/pokemon-list';
import { PokemonApi } from '../data/pokemon-api';
import { Startup } from '../startup/app-startup';

/** The reference's (tabs)/index: the Pokédex, a page of 50 at a time. */
@Component({
  selector: 'app-pokedex',
  imports: [PokemonList],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <app-pokemon-list
      headerText="Pokédex"
      emptyMessage="No Pokémon found"
      [data]="pokemon()"
      [loading]="query.isLoading()"
      [error]="query.isError()"
      [fetchingNextPage]="query.isFetchingNextPage()"
      (endReached)="loadMore()"
    />
  `,
})
export class Pokedex {
  readonly #startup = inject(Startup);
  readonly #injector = inject(Injector);
  readonly #api = inject(PokemonApi);

  protected readonly query = injectInfiniteQuery(() => this.#api.listQuery());
  protected readonly pokemon = computed(() => this.query.data()?.pages.flat() ?? []);

  constructor() {
    // Fully drawn is the first page's rows on screen, not the data arriving. The effect sees the
    // query succeed in the change detection pass that hands the rows to the ListView;
    // afterNextRender runs once that pass is done, when UITableView has been told to reload. The
    // table builds its visible cells (and the rows' Angular views) in its next layout pass, at the
    // end of this run loop turn, so a frame later (`requestAnimationFrame`, a CADisplayLink in
    // NativeScript) they exist and are drawn, as the reference's useEffect + requestAnimationFrame
    // waits for. The native class reports it once per process.
    const succeeded = effect(() => {
      if (!this.query.isSuccess()) return;
      succeeded.destroy();
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
