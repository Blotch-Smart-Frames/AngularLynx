import { Component, Injector, afterNextRender, computed, effect, inject } from '@angular/core';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { PokemonList } from '../components/pokemon-list.ts';
import { TabScreenFrame } from '../components/tab-screen-frame.ts';
import { PokemonApi } from '../data/pokemon-api.ts';
import { AppStartup } from '../startup/app-startup.ts';

/** The reference's (tabs)/index: the Pokédex, a page of 50 at a time. */
@Component({
  selector: 'app-pokedex',
  imports: [PokemonList, TabScreenFrame],
  host: { style: 'flex: 1' },
  template: `
    <app-tab-screen-frame>
      <app-pokemon-list
        headerText="Pokédex"
        emptyMessage="No Pokémon found"
        [data]="pokemon()"
        [loading]="query.isLoading()"
        [error]="query.isError()"
        [fetchingNextPage]="query.isFetchingNextPage()"
        (endReached)="loadMore()"
      />
    </app-tab-screen-frame>
  `,
})
export class Pokedex {
  readonly #startup = inject(AppStartup);
  readonly #injector = inject(Injector);
  readonly #api = inject(PokemonApi);

  protected readonly query = injectInfiniteQuery(() => this.#api.listQuery());
  protected readonly pokemon = computed(() => this.query.data()?.pages.flat() ?? []);

  constructor() {
    // Fully drawn is the first page's rows on screen, not the data arriving. The effect sees the
    // query succeed in the same change detection pass that renders the rows; afterNextRender runs
    // once that pass has been committed to Fabric, and the frame after it is when they are drawn,
    // as the reference's useEffect + requestAnimationFrame waits for. The module reports it once
    // per process, so a later success (a refetch) adds nothing.
    const succeeded = effect(() => {
      if (!this.query.isSuccess()) return;
      succeeded.destroy();
      afterNextRender(
        () => requestAnimationFrame(() => this.#startup.reportFullyDrawn()),
        { injector: this.#injector },
      );
    });
  }

  protected loadMore(): void {
    if (this.query.hasNextPage() && !this.query.isFetchingNextPage()) {
      void this.query.fetchNextPage();
    }
  }
}
