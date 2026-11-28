import { Component, computed, input, signal } from '@angular/core';

/**
 * The reference's PokemonImage: the sprite, with the Pokéball logo shown until it loads. The web
 * view's image cache keeps each sprite (the fixture server sends them with max-age=300, as
 * raw.githubusercontent.com does).
 */
@Component({
  selector: 'app-pokemon-image',
  template: `
    @if (!loaded()) {
      <img class="placeholder" src="assets/images/pokemon-logo.png" alt="" />
    }
    @if (uri(); as src) {
      <img [class.hidden]="!loaded()" [src]="src" alt="" (load)="loadedUri.set(src)" />
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: var(--size);
      height: var(--size);
    }
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .hidden {
      visibility: hidden;
    }
  `,
  host: { '[style.--size.px]': 'size()' },
})
export class PokemonImage {
  readonly uri = input.required<string | null>();
  readonly size = input.required<number>();

  /** The source that last finished loading: a reused row shows the logo until its new one does. */
  protected readonly loadedUri = signal<string | null>(null);
  protected readonly loaded = computed(() => !!this.uri() && this.loadedUri() === this.uri());
}
