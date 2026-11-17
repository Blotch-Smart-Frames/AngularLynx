import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions, queryOptions } from '@tanstack/angular-query-experimental';
import { firstValueFrom, timeout } from 'rxjs';
import { API } from './config.ts';
import {
  mapPokemonDetail,
  mapPokemonSummary,
  type Pokemon,
  type PokemonDetail,
  type PokemonDetailDto,
  type PokemonListResponse,
} from './pokemon.ts';

/** The reference's axios client gives up after 10 s; so does this. */
const TIMEOUT_MS = 10_000;

export const PAGE_SIZE = 50;

/**
 * The reference app's lib/services/pokemon.ts, on Angular's HttpClient. `provideNativeHttpClient()`
 * backs it with React Native's XMLHttpRequest, which is what axios uses on React Native too.
 */
@Injectable({ providedIn: 'root' })
export class PokemonApi {
  readonly #http = inject(HttpClient);

  async list(page = 1, limit = PAGE_SIZE): Promise<Pokemon[]> {
    const offset = (page - 1) * limit;
    const response = await firstValueFrom(
      this.#http
        .get<PokemonListResponse>(`${API}/pokemon`, { params: { limit, offset } })
        .pipe(timeout(TIMEOUT_MS)),
    );
    return response.results.map(mapPokemonSummary);
  }

  async detail(id: string): Promise<PokemonDetail> {
    const dto = await firstValueFrom(
      this.#http.get<PokemonDetailDto>(`${API}/pokemon/${id}`).pipe(timeout(TIMEOUT_MS)),
    );
    return mapPokemonDetail(dto);
  }

  /** The reference's usePokemonList: pages of 50, until a page comes back short. */
  listQuery(limit = PAGE_SIZE) {
    return infiniteQueryOptions({
      queryKey: ['pokemon', 'list', limit],
      queryFn: ({ pageParam }) => this.list(pageParam, limit),
      initialPageParam: 1,
      getNextPageParam: (lastPage: Pokemon[], allPages: Pokemon[][]) =>
        lastPage.length < limit ? undefined : allPages.length + 1,
    });
  }

  /**
   * The reference's usePokemon. Every row asks for its own Pokémon, keyed by id, so the rows and
   * the detail sheet share one cached answer per id.
   */
  detailQuery(id: string) {
    return queryOptions({
      queryKey: ['pokemon', 'detail', id],
      queryFn: () => this.detail(id),
      enabled: !!id,
    });
  }
}
