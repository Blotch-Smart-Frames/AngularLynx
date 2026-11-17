import { HttpClient } from '@angular/common/http';
import { Injectable, type Signal, inject, signal } from '@angular/core';

import { API } from './config';
import { type PokemonDetail, type PokemonDetailDto, mapPokemonDetail } from './pokemon';
import { retryTwice } from './retry';

/** One Pokémon's detail as a row or the sheet sees it. */
export type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'success'; readonly data: PokemonDetail };

type Entry = {
  readonly state: ReturnType<typeof signal<DetailState>>;
  /** When the data last arrived, or 0 before it has. */
  fetchedAt: number;
  fetching: boolean;
};

/**
 * How long a detail stays fresh before a row asking for it fetches it again,
 * as React Query's `staleTime` of 5 minutes in the original.
 */
const STALE_AFTER = 5 * 60 * 1000;

/**
 * Each Pokémon's detail (`GET /pokemon/{id}`), fetched once per id and kept,
 * as the original's React Query cache keeps `['pokemon', 'detail', id]`: every
 * row fetches its own Pokémon's types, and the detail sheet reads the same
 * entry, so it opens with what the row loaded.
 */
@Injectable({ providedIn: 'root' })
export class PokemonDetails {
  readonly #http = inject(HttpClient);
  readonly #entries = new Map<string, Entry>();

  /**
   * The detail of Pokémon `id`, starting its fetch if nothing has, or if
   * what's kept is over 5 minutes old (it keeps showing meanwhile).
   *
   * Rows call this from a `computed()`, whose value is the signal it
   * returns: the fetch it may start sets that signal later, never during
   * the computation.
   */
  get(id: string): Signal<DetailState> {
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = { state: signal<DetailState>({ status: 'loading' }), fetchedAt: 0, fetching: false };
      this.#entries.set(id, entry);
    }
    if (!entry.fetching && Date.now() - entry.fetchedAt > STALE_AFTER) {
      this.#fetch(id, entry);
    }
    return entry.state.asReadonly();
  }

  #fetch(id: string, entry: Entry): void {
    entry.fetching = true;
    this.#http
      .get<PokemonDetailDto>(`${API}/pokemon/${id}`)
      .pipe(retryTwice())
      .subscribe({
        next: (dto) => {
          entry.fetchedAt = Date.now();
          entry.fetching = false;
          entry.state.set({ status: 'success', data: mapPokemonDetail(dto) });
        },
        error: () => {
          entry.fetching = false;
          // Data already shown stays, as React Query keeps it after a
          // failed refetch.
          if (entry.state().status !== 'success') entry.state.set({ status: 'error' });
        },
      });
  }
}
