import { Component, InjectionToken, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { capitalize, typeColor, type Pokemon } from '../data/pokemon';
import { PokemonApi } from '../data/pokemon-api';
import { PokemonSheetOpener } from '../pages/pokemon-sheet';
import { FavouriteButton } from './favourite-button';
import { PokemonImage } from './pokemon-image';

/** The list a row is built in, told when it builds one (see PokemonList's `rowsShown`). */
export const ROW_HOST = new InjectionToken<{ rowCreated(): void }>('ROW_HOST');

/**
 * The reference's PokemonItem: a card that fetches its own Pokémon for the type dots.
 *
 * The virtual scroll viewport reuses a row's view for whichever item scrolls into it, so nothing
 * here is per-item state: the query follows the `pokemon` input, as `usePokemon(pokemon.id)`
 * follows its argument in the reference. `ion-activatable` has Ionic's tap handling dim the card
 * while it's pressed, as TouchableOpacity does.
 */
@Component({
  selector: 'app-pokemon-item',
  imports: [FavouriteButton, PokemonImage],
  template: `
    <div class="card ion-activatable" [attr.data-testid]="'pokemon_tile_' + pokemon().id" (click)="open()">
      <div class="image">
        <app-pokemon-image [uri]="pokemon().imageUrl" [size]="56" />
      </div>
      <div class="info">
        <div class="name">{{ index() + 1 }}. {{ name() }}</div>
        <div class="subtitle">#{{ pokemon().id.padStart(3, '0') }}</div>
      </div>
      <div class="trailing">
        @if (detail.data(); as data) {
          <div class="type-dots">
            @for (type of data.types; track type) {
              <div class="dot" [attr.aria-label]="type" [style.background-color]="color(type)"></div>
            }
          </div>
        }
        <app-favourite-button
          [pokemonId]="pokemon().id"
          [size]="20"
          [testID]="'pokemon_tile_heart_' + pokemon().id"
        />
      </div>
    </div>
  `,
  styles: `
    .card {
      box-sizing: border-box;
      height: 98px;
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 16px;
      margin-bottom: 8px;
      border-radius: 4px;
      border: 1px solid #e3e3e3;
      background-color: #ffffff;
      transition: opacity 150ms;
    }
    .card.ion-activated {
      opacity: 0.2;
    }
    .image {
      box-sizing: border-box;
      width: 64px;
      height: 64px;
      display: flex;
      justify-content: center;
      align-items: center;
      margin-right: 12px;
      border-radius: 8px;
      border: 1px solid #e3e3e3;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .name {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subtitle {
      font-size: 12px;
      color: #9e9e9e;
    }
    .trailing {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
    }
    .type-dots {
      display: flex;
      flex-direction: row;
      gap: 4px;
    }
    .dot {
      width: 20px;
      height: 20px;
      border-radius: 10px;
    }
  `,
})
export class PokemonItem {
  readonly pokemon = input.required<Pokemon>();
  readonly index = input.required<number>();

  readonly #api = inject(PokemonApi);
  readonly #sheet = inject(PokemonSheetOpener);

  constructor() {
    inject(ROW_HOST, { optional: true })?.rowCreated();
  }

  protected readonly detail = injectQuery(() => this.#api.detailQuery(this.pokemon().id));
  // A favourite has no name until its detail arrives.
  protected readonly name = computed(() =>
    capitalize(this.pokemon().name || (this.detail.data()?.name ?? '')),
  );
  protected readonly color = typeColor;

  protected open(): void {
    this.#sheet.open(this.pokemon().id);
  }
}
