import { Component, NO_ERRORS_SCHEMA, input, signal } from '@angular/core';
import type { PropertyChangeData } from '@nativescript/core';

/**
 * The reference's PokemonImage: the sprite, with the Pokéball logo shown until it loads. A
 * NativeScript Image loads a URL off the main thread (`loadMode="async"`) through NSURLSession,
 * whose cache keeps each sprite (the fixture server sends them with max-age=300, as
 * raw.githubusercontent.com does), and says when it's done through `isLoading`.
 */
@Component({
  selector: 'app-pokemon-image',
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <GridLayout [width]="size()" [height]="size()">
      <Image
        src="~/assets/pokemon-logo.png"
        stretch="aspectFit"
        [visibility]="loading() ? 'visible' : 'hidden'"></Image>
      <Image
        stretch="aspectFit"
        loadMode="async"
        [src]="uri()"
        (isLoadingChange)="onLoading($event)"></Image>
    </GridLayout>
  `,
})
export class PokemonImage {
  readonly uri = input.required<string | null>();
  readonly size = input.required<number>();

  protected readonly loading = signal(true);

  protected onLoading(event: Event): void {
    // NativeScript's events aren't DOM events, whatever the template's type checking says.
    this.loading.set(!!(event as unknown as PropertyChangeData).value);
  }
}
