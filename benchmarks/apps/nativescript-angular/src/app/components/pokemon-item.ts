import { Component, NO_ERRORS_SCHEMA, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { capitalize, typeColor, type Pokemon } from '../data/pokemon';
import { PokemonApi } from '../data/pokemon-api';
import { PokemonSheetOpener } from '../pages/pokemon-sheet';
import { FavouriteButton, heartTappedRecently } from './favourite-button';
import { PokemonImage } from './pokemon-image';

/**
 * The reference's PokemonItem: a card that fetches its own Pokémon for the type dots.
 *
 * ListView reuses a row's view for whichever item scrolls into it, so nothing here is per-item
 * state: the query follows the `pokemon` input, as `usePokemon(pokemon.id)` follows its argument
 * in the reference.
 */
@Component({
  selector: 'app-pokemon-item',
  imports: [FavouriteButton, PokemonImage],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <GridLayout class="cell">
    <GridLayout
      class="card"
      columns="auto, *, auto"
      [automationText]="'pokemon_tile_' + pokemon().id"
      (tap)="open()"
    >
      <GridLayout col="0" class="image">
        <app-pokemon-image [uri]="pokemon().imageUrl" [size]="56" />
      </GridLayout>
      <StackLayout col="1" class="info">
        <Label class="name" [text]="index() + 1 + '. ' + name()"></Label>
        <Label class="subtitle" [text]="'#' + pokemon().id.padStart(3, '0')"></Label>
      </StackLayout>
      <StackLayout col="2" class="trailing" orientation="horizontal">
        @if (detail.data(); as data) {
          @for (type of data.types; track type) {
            <StackLayout class="dot" [accessibilityLabel]="type" [backgroundColor]="color(type)"></StackLayout>
          }
        }
        <!-- A component's host element isn't a view NativeScript lays out, so the margin goes
             on a layout around it. -->
        <StackLayout class="heart">
          <app-favourite-button
            [pokemonId]="pokemon().id"
            [size]="20"
            [testID]="'pokemon_tile_heart_' + pokemon().id"
          />
        </StackLayout>
      </StackLayout>
    </GridLayout>
    </GridLayout>
  `,
  styles: `
    /* A table row fills the list's width; the reference's list pads its content by 16pt. */
    .cell {
      padding: 0 16;
    }
    .card {
      padding: 16;
      margin-bottom: 8;
      border-radius: 4;
      border-width: 1;
      border-color: #e3e3e3;
      background-color: #ffffff;
    }
    .image {
      width: 64;
      height: 64;
      margin-right: 12;
      border-radius: 8;
      border-width: 1;
      border-color: #e3e3e3;
    }
    .info {
      vertical-align: center;
    }
    .name {
      font-size: 16;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4;
    }
    .subtitle {
      font-size: 12;
      color: #9e9e9e;
    }
    .trailing {
      vertical-align: center;
      margin-left: 8;
    }
    .dot {
      width: 20;
      height: 20;
      border-radius: 10;
      margin-right: 4;
    }
    .heart {
      margin-left: 4;
    }
  `,
})
export class PokemonItem {
  readonly pokemon = input.required<Pokemon>();
  readonly index = input.required<number>();

  readonly #api = inject(PokemonApi);
  readonly #sheet = inject(PokemonSheetOpener);

  protected readonly detail = injectQuery(() => this.#api.detailQuery(this.pokemon().id));
  // A favourite has no name until its detail arrives.
  protected readonly name = computed(() =>
    capitalize(this.pokemon().name || (this.detail.data()?.name ?? '')),
  );
  protected readonly color = typeColor;

  protected open(): void {
    // The heart's tap reaches the card too, in either order, so the card opens the sheet a turn
    // later unless the heart took the tap.
    setTimeout(() => {
      if (!heartTappedRecently()) this.#sheet.open(this.pokemon().id);
    });
  }
}
