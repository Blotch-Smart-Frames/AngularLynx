import type { NativeNavigation } from '@ng-native/router';

/**
 * The reference declares `pokemon/[id]` as a form sheet at 75% with 16pt corners, so every
 * navigation to it is a sheet. Angular's route config has no place for a presentation, so the
 * one place that opens the screen says it instead.
 */
export function openPokemon(nav: NativeNavigation, id: string): void {
  void nav.present(['/pokemon', id], {
    as: 'formSheet',
    presentation: { sheetAllowedDetents: [0.75], sheetCornerRadius: 16 },
  });
}
