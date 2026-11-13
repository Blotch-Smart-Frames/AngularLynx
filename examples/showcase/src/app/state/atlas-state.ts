import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { LynxLocalStorage, LynxTheme } from '@blotch/angular-lynx';
import { GEMS, type Cut, gemById, rgbChannels } from '../data/gems';
import { type Lot, lotsAt } from '../data/lots';

/** Which light the stone is seen under: the system's, or the visitor's pick. */
export type Scheme = 'system' | 'day' | 'night';

type Saved = {
  readonly gemId: string;
  readonly cut: Cut | null;
  readonly scheme: Scheme;
  readonly kept: readonly string[];
};

const KEY = 'facet.atlas';

/**
 * What the visitor has chosen, shared by every screen and kept on the device:
 * the stone on the plate, its cut, the light, and the lots in the collection.
 */
@Injectable({ providedIn: 'root' })
export class AtlasState {
  readonly #storage = inject(LynxLocalStorage);
  readonly #theme = inject(LynxTheme);

  readonly gems = GEMS;
  readonly gemId = signal(GEMS[0]!.id);
  readonly gem = computed(() => gemById(this.gemId()));

  /** A recut the visitor chose; `null` shows each stone in its own cut. */
  readonly cutOverride = signal<Cut | null>(null);
  readonly cut = computed(() => this.cutOverride() ?? this.gem().cut);

  readonly scheme = signal<Scheme>('system');
  readonly dark = computed(() => {
    const scheme = this.scheme();
    return scheme === 'system' ? this.#theme.isDarkMode() : scheme === 'night';
  });

  /** The stone's color under the current light, which the whole app takes. */
  readonly color = computed(() => {
    const gem = this.gem();
    return (this.dark() && gem.nightColor) || gem.color;
  });
  readonly rgb = computed(() => rgbChannels(this.color()));

  /** How many times the lots have been re-appraised (pull to refresh). */
  readonly appraisal = signal(0);
  readonly lots = computed(() => lotsAt(this.appraisal()));

  /** Lot ids the visitor kept. */
  readonly kept = signal<readonly string[]>([]);
  readonly query = signal('');

  readonly #restored = signal(false);

  constructor() {
    this.#restore();
    // AngularLynx gives the page the theme's dark class with the phone, and
    // the stock dark theme's values with it. Tell it the visitor's pick, so
    // the page is dark exactly when the root view is: without this, Day on a
    // dark phone would be drawn in the stock dark colors.
    effect(() => {
      const scheme = this.scheme();
      this.#theme.setColorScheme(
        scheme === 'system' ? 'system' : scheme === 'night' ? 'dark' : 'light',
      );
    });
    // Persist each change, once the saved state has been read: writing before
    // that would overwrite the last session with the defaults.
    effect(() => {
      const saved: Saved = {
        gemId: this.gemId(),
        cut: this.cutOverride(),
        scheme: this.scheme(),
        kept: this.kept(),
      };
      if (!this.#restored()) return;
      this.#storage.setItem(KEY, saved).catch(() => {});
    });
  }

  isKept(lot: Lot): boolean {
    return this.kept().includes(lot.id);
  }

  /**
   * Keeps a lot, or releases it. Returns whether it's kept now.
   */
  toggleKept(lot: Lot): boolean {
    const kept = this.isKept(lot);
    this.kept.update((ids) =>
      kept ? ids.filter((id) => id !== lot.id) : [...ids, lot.id],
    );
    return !kept;
  }

  #restore(): void {
    this.#storage
      .getItem<Saved>(KEY)
      .then((saved) => {
        if (saved) {
          if (GEMS.some((gem) => gem.id === saved.gemId)) {
            this.gemId.set(saved.gemId);
          }
          this.cutOverride.set(saved.cut ?? null);
          this.scheme.set(saved.scheme ?? 'system');
          this.kept.set(saved.kept ?? []);
        }
      })
      .catch(() => {})
      .finally(() => this.#restored.set(true));
  }
}
