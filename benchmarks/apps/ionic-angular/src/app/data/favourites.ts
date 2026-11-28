import { Injectable, computed, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

const KEY = 'favourites';

/**
 * The reference app's zustand store, persisted as it is there, in Capacitor's own key-value store,
 * `Preferences` (UserDefaults on iOS), where the reference uses AsyncStorage. It reads back once at
 * start-up and writes through on every change, which is all zustand's `persist` middleware did.
 */
@Injectable({ providedIn: 'root' })
export class Favourites {
  readonly #favourites = signal<Record<string, true>>({});

  /** In the order they were added, as `Object.keys` of the reference's record gives them. */
  readonly ids = computed(() => Object.keys(this.#favourites()));

  constructor() {
    // Asynchronous, as AsyncStorage's rehydration is in the reference.
    void Preferences.get({ key: KEY }).then(({ value }) => {
      try {
        if (value) this.#favourites.set(JSON.parse(value));
      } catch {
        // A value this app didn't write: start empty, as the reference does.
      }
    });
  }

  has(id: string): boolean {
    return !!this.#favourites()[id];
  }

  toggle(id: string): void {
    const next = { ...this.#favourites() };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
    }
    this.#favourites.set(next);
    void Preferences.set({ key: KEY, value: JSON.stringify(next) });
  }
}
