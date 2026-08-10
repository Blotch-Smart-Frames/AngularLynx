import { computed, Injectable, signal } from '@angular/core';
import type {
  LynxFontEntry,
  LynxFontFaceConfig,
  LynxFontStatus,
} from './font.types';

/**
 * Wraps `lynx.addFont()` with a Promise-based API and reactive signal state.
 *
 * Use CSS `@font-face` in stylesheets for fonts known at build time (the
 * standard Angular approach). Use this service only for fonts that must be
 * loaded dynamically at runtime.
 *
 * @usageNotes
 * ```typescript
 * const fontService = inject(LynxFont);
 *
 * await fontService.addFont({
 *   fontFamily: 'CustomFont',
 *   src: 'https://example.com/custom-font.ttf',
 * });
 *
 * // Reactive state
 * const loaded = fontService.loadedFamilies(); // ReadonlySet<string>
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxFont {
  readonly #fonts = signal<ReadonlyMap<string, LynxFontEntry>>(new Map());
  readonly #pending = new Map<string, Promise<void>>();

  readonly fonts = this.#fonts.asReadonly();

  readonly loadedFamilies = computed(() => {
    const loaded = new Set<string>();
    for (const [, entry] of this.#fonts()) {
      if (entry.status === 'loaded') {
        loaded.add(entry.fontFamily);
      }
    }
    return loaded as ReadonlySet<string>;
  });

  addFont(config: LynxFontFaceConfig): Promise<void> {
    if (typeof lynx === 'undefined') {
      return Promise.reject(
        new Error('lynx.addFont is not available in this environment'),
      );
    }

    const { fontFamily, src } = config;

    const existing = this.#fonts().get(fontFamily);
    if (existing?.status === 'loaded') {
      return Promise.resolve();
    }
    // Return the already-in-flight promise to deduplicate concurrent callers.
    // Without this guard, two simultaneous addFont() calls would both invoke
    // lynx.addFont() and race to settle the same font.
    if (existing?.status === 'loading') {
      return this.#pending.get(fontFamily)!;
    }

    this.#updateEntry(fontFamily, { fontFamily, src, status: 'loading' });

    const promise = new Promise<void>((resolve, reject) => {
      (lynx as any).addFont(
        { 'font-family': fontFamily, src },
        (err?: Error) => {
          if (err) {
            this.#updateEntry(fontFamily, {
              fontFamily,
              src,
              status: 'error',
              error: err,
            });
            this.#pending.delete(fontFamily);
            reject(err);
          } else {
            this.#updateEntry(fontFamily, {
              fontFamily,
              src,
              status: 'loaded',
            });
            this.#pending.delete(fontFamily);
            resolve();
          }
        },
      );
    });

    this.#pending.set(fontFamily, promise);
    return promise;
  }

  isLoaded(fontFamily: string): boolean {
    return this.#fonts().get(fontFamily)?.status === 'loaded';
  }

  getStatus(fontFamily: string): LynxFontStatus {
    return this.#fonts().get(fontFamily)?.status ?? 'idle';
  }

  #updateEntry(fontFamily: string, entry: LynxFontEntry): void {
    // Clone the Map before mutating — signals use reference equality, so
    // mutating the existing Map in-place wouldn't trigger reactivity.
    const next = new Map(this.#fonts());
    next.set(fontFamily, entry);
    this.#fonts.set(next);
  }
}
