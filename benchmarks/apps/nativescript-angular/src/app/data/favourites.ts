import { Injectable, computed, signal } from '@angular/core';
import { ApplicationSettings } from '@nativescript/core';

const KEY = 'favourites';

/**
 * The reference app's zustand store, persisted as it is there, in NativeScript's own key-value
 * store, `ApplicationSettings` (NSUserDefaults on iOS, SharedPreferences on Android), where the
 * reference uses AsyncStorage. It reads back once at start-up and writes through on every change,
 * which is all zustand's `persist` middleware did.
 */
@Injectable({ providedIn: 'root' })
export class Favourites {
  readonly #favourites = signal<Record<string, true>>(read());

  /** In the order they were added, as `Object.keys` of the reference's record gives them. */
  readonly ids = computed(() => Object.keys(this.#favourites()));

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
    ApplicationSettings.setString(KEY, JSON.stringify(next));
  }
}

function read(): Record<string, true> {
  try {
    return JSON.parse(ApplicationSettings.getString(KEY, '{}'));
  } catch {
    return {};
  }
}
