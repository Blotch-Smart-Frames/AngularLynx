import { Injectable, computed, effect, inject } from '@angular/core';
import { LynxSplashScreen } from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';
import { Museum, ON_VIEW, PagedWorks } from '../data/museum';
import { SNAPSHOT } from '../data/snapshot';

/**
 * What's on view, a page at a time, for the On View tab and for the "Show me
 * a work" shortcut, which can run before the tab is shown.
 *
 * If the museum can't be reached for the first page, the wall hangs the
 * snapshot bundled with the app instead, and says so: an empty wall would
 * tell a visitor nothing, and the landing page shows this app live.
 */
@Injectable({ providedIn: 'root' })
export class OnViewWall {
  readonly #museum = inject(Museum);
  readonly #pages = new PagedWorks(this.#museum);
  readonly #snapshot = this.#museum.remember(SNAPSHOT);

  /** Whether the museum couldn't be reached and the snapshot hangs instead. */
  readonly offline = computed(
    () => this.#pages.status() === 'error' && this.#pages.works().length === 0,
  );
  readonly works = computed<readonly Artwork[]>(() =>
    this.offline() ? this.#snapshot : this.#pages.works(),
  );
  readonly total = computed(() =>
    this.offline() ? SNAPSHOT.info.total : this.#pages.total(),
  );
  readonly status = this.#pages.status;

  constructor() {
    this.#pages.start(ON_VIEW);
    // The app keeps its splash screen up (provideSplashScreen, 'manual')
    // until the wall has something to hang: the works, or the snapshot.
    const splash = inject(LynxSplashScreen);
    const settled = effect(() => {
      if (this.works().length > 0 || this.status() === 'error') {
        splash.hide();
        settled.destroy();
      }
    });
  }

  more(): void {
    if (!this.offline()) void this.#pages.more();
  }

  /**
   * Asks the museum again, after a failure.
   */
  retry(): void {
    void this.#pages.more();
  }

  /**
   * A work from the wall, at random, once there's a wall to pick from.
   */
  async pick(): Promise<Artwork> {
    if (this.works().length === 0) await this.#pages.more();
    const works = this.works();
    return works[Math.floor(Math.random() * works.length)]!;
  }
}
