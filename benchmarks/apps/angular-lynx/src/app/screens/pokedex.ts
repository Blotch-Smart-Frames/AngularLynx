import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { reportFullyDrawn } from '@blotch/angular-lynx';

import { type ListEmptyState, PokemonList } from '../components/pokemon-list';
import { TabScreenFrame } from '../components/tab-screen-frame';
import { API, PAGE_SIZE } from '../data/config';
import { type Pokemon, type PokemonListResponse, mapPokemonSummary } from '../data/pokemon';
import { PokemonDetails } from '../data/pokemon-details';
import { retryTwice } from '../data/retry';

/**
 * The Pokédex tab: every Pokémon, a page of 50 at a time, the next page
 * loading as the end of the list comes within half a screen (the original's
 * useInfiniteQuery).
 */
@Component({
  selector: 'app-pokedex',
  imports: [PokemonList, TabScreenFrame],
  host: { class: 'screen' },
  template: `
    <app-tab-screen-frame>
      <app-pokemon-list
        headerText="Pokédex"
        [data]="pokemon()"
        [emptyState]="emptyState()"
        [fetchingNextPage]="fetchingNextPage()"
        [watchLayout]="!drawn()"
        (endReached)="loadNextPage()"
        (laidOut)="laidOut()"
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
export class Pokedex {
  readonly #http = inject(HttpClient);
  readonly #details = inject(PokemonDetails);

  readonly #pages = signal<readonly (readonly Pokemon[])[]>([]);
  readonly #status = signal<'loading' | 'error' | 'success'>('loading');
  protected readonly fetchingNextPage = signal(false);
  /** Reported fully drawn: the list's layouts no longer matter. */
  protected readonly drawn = signal(false);
  /** The list endpoint has no more once a page comes back short. */
  readonly #hasNextPage = computed(() => {
    const pages = this.#pages();
    return pages.length === 0 || pages[pages.length - 1].length === PAGE_SIZE;
  });

  protected readonly pokemon = computed(() => this.#pages().flat());
  protected readonly emptyState = computed<ListEmptyState>(() => {
    const status = this.#status();
    return status === 'success' ? { message: 'No Pokémon found' } : status;
  });

  constructor() {
    this.#fetchPage(1);
  }

  protected loadNextPage(): void {
    if (this.#status() !== 'success' || !this.#hasNextPage() || this.fetchingNextPage()) return;
    this.fetchingNextPage.set(true);
    this.#fetchPage(this.#pages().length + 1);
  }

  /**
   * Fully drawn: the first page has loaded and the list has laid its rows
   * out. The rows are built when the native list asks for them, during its
   * layout after the flush that gives it the page, so the report waits for
   * the list's `layoutcomplete`, not for the data; reportFullyDrawn() then
   * waits for the next flush. The runtime reports once per process.
   */
  protected laidOut(): void {
    if (this.#pages().length === 0) return;
    reportFullyDrawn();
    this.drawn.set(true);
  }

  #fetchPage(page: number): void {
    this.#http
      .get<PokemonListResponse>(`${API}/pokemon`, {
        params: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
      })
      .pipe(retryTwice())
      .subscribe({
        next: (response) => {
          const rows = response.results.map(mapPokemonSummary);
          // Every row's detail, as soon as its page arrives, as the other
          // apps fetch them: the original's FlatList renders rows well ahead
          // of the screen (its window covers the whole page), and ReactLynx
          // renders every row's component when the page arrives. Lynx's list
          // builds a row only as it nears the screen, so without this each
          // row would fetch its types while the list scrolls, its response
          // arriving a few frames later as a change of its own (#856).
          for (const row of rows) this.#details.get(row.id);
          this.#pages.update((pages) => [...pages, rows]);
          this.#status.set('success');
          this.fetchingNextPage.set(false);
        },
        error: () => {
          // A failed next page leaves the loaded ones, as React Query does.
          if (page === 1) this.#status.set('error');
          this.fetchingNextPage.set(false);
        },
      });
  }
}
