import { Injectable, computed, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';

/**
 * The reference app's zustand store, persisted to AsyncStorage as it is there. Angular Native's
 * `Storage` is a signal bound to an AsyncStorage key: it reads back once at start-up and writes
 * through on every set, which is all zustand's `persist` middleware did.
 */
@Injectable({ providedIn: 'root' })
export class Favourites {
  readonly #favourites = inject(Storage).signal<Record<string, true>>('favourites', {});

  /** In the order they were added, as `Object.keys` of the reference's record gives them. */
  readonly ids = computed(() => Object.keys(this.#favourites()));

  has(id: string): boolean {
    return !!this.#favourites()[id];
  }

  toggle(id: string): void {
    this.#favourites.update((favourites) => {
      const next = { ...favourites };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }
}
