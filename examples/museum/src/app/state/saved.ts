import { Injectable, computed, inject, signal } from '@angular/core';
import { LynxLocalStorage } from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';

const KEY = 'vitrine.saved';

/**
 * The works the person saved, newest first, kept with `LynxLocalStorage` so
 * they're there after the app closes. Each is stored whole (the fields a
 * list shows), so Saved lists them with no network.
 */
@Injectable({ providedIn: 'root' })
export class SavedWorks {
  readonly #storage = inject(LynxLocalStorage);

  readonly works = signal<readonly Artwork[]>([]);
  readonly count = computed(() => this.works().length);
  readonly #ids = computed(() => new Set(this.works().map((work) => work.id)));

  constructor() {
    void this.#storage.getItem<Artwork[]>(KEY).then((works) => {
      // A work saved before this read finished goes on top of the stored ones.
      if (works?.length) {
        const ids = this.#ids();
        this.works.update((now) => [
          ...now,
          ...works.filter((work) => !ids.has(work.id)),
        ]);
      }
    });
  }

  has(id: number): boolean {
    return this.#ids().has(id);
  }

  /**
   * Saves the work, or takes it out of Saved if it's there.
   */
  toggle(work: Artwork): void {
    this.works.update((works) =>
      this.has(work.id)
        ? works.filter((saved) => saved.id !== work.id)
        : [work, ...works],
    );
    void this.#storage.setItem(KEY, this.works());
  }
}
