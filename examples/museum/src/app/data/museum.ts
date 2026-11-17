import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  API,
  type Artwork,
  listParams,
  type RawPage,
  toArtwork,
} from './artwork';

/** Filters a list sends the API, such as `{ q: 'wave' }`. */
export type Filters = Record<string, string | number>;

/** What's on view: the museum's highlights hanging in its galleries now. */
export const ON_VIEW: Filters = { currently_on_view: 1, highlight: 1 };

/**
 * The app's one way to the museum. It also remembers every work a list has
 * loaded, so a work's screen draws its picture and title at once, from the
 * list that opened it, while its whole record loads.
 */
@Injectable({ providedIn: 'root' })
export class Museum {
  readonly #http = inject(HttpClient);
  readonly #known = new Map<number, Artwork>();

  /**
   * A page of works: `PAGE_SIZE` from `skip`, and how many match in all.
   */
  async page(
    filters: Filters,
    skip: number,
  ): Promise<{ total: number; works: Artwork[] }> {
    const page = await firstValueFrom(
      this.#http.get<RawPage>(API, { params: listParams(filters, skip) }),
    );
    return { total: page.info.total, works: this.remember(page) };
  }

  /**
   * Keeps a page's works for their screens, and returns them.
   */
  remember(page: RawPage): Artwork[] {
    const works = page.data.flatMap((raw) => toArtwork(raw) ?? []);
    for (const work of works) this.#known.set(work.id, work);
    return works;
  }

  /**
   * A work a list loaded, or that Saved keeps.
   */
  known(id: number): Artwork | undefined {
    return this.#known.get(id);
  }
}

export type PageStatus = 'loading' | 'ready' | 'error' | 'done';

/**
 * A list that loads a page at a time as it's scrolled: the works so far,
 * how many there are in all, and whether the next page is loading, failed,
 * or there's none. Starting again (a new search) drops the pages of the last
 * one, and an answer to a search that's been replaced is ignored, so a slow
 * request for "wav" can't land after "wave".
 */
export class PagedWorks {
  readonly works = signal<readonly Artwork[]>([]);
  readonly total = signal<number | null>(null);
  readonly status = signal<PageStatus>('ready');

  readonly #museum: Museum;
  #filters: Filters | null = null;
  #generation = 0;
  /** The page loading now, which another caller of `more()` waits for. */
  #loading: Promise<void> | null = null;

  constructor(museum: Museum) {
    this.#museum = museum;
  }

  /**
   * Starts over with `filters`, or empties the list with `null`.
   */
  start(filters: Filters | null): void {
    this.#generation++;
    this.#filters = filters;
    this.works.set([]);
    this.total.set(null);
    this.status.set('ready');
    if (filters) void this.more();
  }

  /**
   * Loads the next page, unless there's none left. While one is loading,
   * it waits for that one rather than asking for it twice.
   */
  more(): Promise<void> {
    if (this.status() === 'loading' && this.#loading) return this.#loading;
    if (!this.#filters || this.status() === 'done') return Promise.resolve();
    this.#loading = this.#load(this.#filters);
    return this.#loading;
  }

  async #load(filters: Filters): Promise<void> {
    const generation = this.#generation;
    this.status.set('loading');
    try {
      const { total, works } = await this.#museum.page(
        filters,
        this.works().length,
      );
      if (generation !== this.#generation) return;
      // The API's pages can repeat a work at a boundary; the list keys items
      // by id, which must be unique.
      const seen = new Set(this.works().map((work) => work.id));
      this.works.update((all) => [
        ...all,
        ...works.filter((work) => !seen.has(work.id)),
      ]);
      this.total.set(total);
      this.status.set(
        works.length === 0 || this.works().length >= total ? 'done' : 'ready',
      );
    } catch {
      if (generation === this.#generation) this.status.set('error');
    }
  }
}
