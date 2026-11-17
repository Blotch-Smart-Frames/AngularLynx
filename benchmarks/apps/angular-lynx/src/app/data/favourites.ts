import { Injectable, computed, inject, signal } from '@angular/core';
import { LynxLocalStorage } from '@blotch/angular-lynx';

const STORAGE_KEY = 'favourites';

/**
 * The favourited Pokémon ids, kept across launches in `LynxLocalStorage`, as
 * the original keeps its zustand store in AsyncStorage.
 *
 * They're a record keyed by id, as the original's are, so the Favourites tab
 * lists them in the same order: `Object.keys` puts integer keys in numeric
 * order, whatever order they were added in.
 */
@Injectable({ providedIn: 'root' })
export class Favourites {
  readonly #storage = inject(LynxLocalStorage);
  readonly #favourites = signal<Readonly<Record<string, true>>>({});

  readonly ids = computed(() => Object.keys(this.#favourites()));

  constructor() {
    // Read once, when something first asks about favourites. Storage is
    // asynchronous, as AsyncStorage is, so they show a moment after the
    // screen does, as zustand's persist middleware rehydrates them.
    void this.#storage.getItem<Record<string, true>>(STORAGE_KEY).then((stored) => {
      // Merged over what's there, as zustand's persist middleware merges
      // what it rehydrates over the store's state.
      if (stored) this.#favourites.update((current) => ({ ...current, ...stored }));
    });
  }

  isFavourite(id: string): boolean {
    return this.#favourites()[id] === true;
  }

  toggle(id: string): void {
    const next = { ...this.#favourites() };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
    }
    this.#favourites.set(next);
    void this.#storage.setItem(STORAGE_KEY, next);
  }
}
