import { Component, computed, input } from '@angular/core';
import { ExpoImage, type ExpoImageSource } from '@ng-native/expo';
import { Image } from 'react-native';

/**
 * The Pokéball logo shown until a sprite loads. expo-image's React component resolves a
 * `require()`d placeholder into a source list before native sees it; `<expo-image>` hands its
 * props straight to the view, so that is done here, once.
 */
const PLACEHOLDER: ExpoImageSource[] = [
  Image.resolveAssetSource(require('../../../assets/images/pokemon-logo.png'))!,
];

/**
 * The reference's PokemonImage: expo-image, as there, registered as `<expo-image>` in main.ts.
 */
@Component({
  selector: 'app-pokemon-image',
  imports: [ExpoImage],
  template: `
    <expo-image
      [source]="source()"
      [placeholder]="placeholder"
      placeholderContentFit="contain"
      contentFit="contain"
      [style.width.px]="size()"
      [style.height.px]="size()"
    />
  `,
})
export class PokemonImage {
  readonly uri = input.required<string | null>();
  readonly size = input.required<number>();

  protected readonly placeholder = PLACEHOLDER;
  // expo-image takes its sources as a list; its React component wraps a single uri the same way.
  protected readonly source = computed(() => {
    const uri = this.uri();
    return uri ? [{ uri }] : undefined;
  });
}
