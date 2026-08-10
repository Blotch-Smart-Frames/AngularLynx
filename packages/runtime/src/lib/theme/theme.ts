import { computed, inject, Injectable } from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';

/**
 * Provides reactive access to the current Lynx theme ('Dark' or 'Light').
 *
 * The theme is driven by `lynx.__globalProps.theme`, which the native host
 * sets based on the OS appearance setting. It updates reactively when the
 * host calls `updateGlobalProps`.
 *
 * @usageNotes
 * ```typescript
 * const theme = inject(LynxTheme);
 *
 * // Reactive in templates
 * template: `<text [style.color]="theme.isDarkMode() ? '#fff' : '#000'">Hello</text>`
 *
 * // Or use CSS variables (preferred for styling — see docs/guide/dark-mode.mdx)
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxTheme {
  readonly #globalData = inject(LynxGlobalData);

  /**
   * The current theme: `'Dark'` or `'Light'`. Reactive — updates when global props change.
   */
  readonly theme = computed(() => {
    const value = (this.#globalData.globalData() as Record<string, unknown>)[
      'theme'
    ];
    return (value as 'Dark' | 'Light') ?? 'Light';
  });

  /**
   * Whether the current theme is dark mode. Reactive.
   */
  readonly isDarkMode = computed(() => this.theme() === 'Dark');
}
