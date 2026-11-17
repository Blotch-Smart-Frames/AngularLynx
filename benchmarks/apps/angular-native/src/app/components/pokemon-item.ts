import { Component, computed, inject, input } from '@angular/core';
import { Text, TouchableOpacity, View } from '@ng-native/components';
import { NativeNavigation } from '@ng-native/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { capitalize, typeColor, type Pokemon } from '../data/pokemon.ts';
import { PokemonApi } from '../data/pokemon-api.ts';
import { openPokemon } from '../pages/open-pokemon.ts';
import { FavouriteButton } from './favourite-button.ts';
import { PokemonImage } from './pokemon-image.ts';

/**
 * The reference's PokemonItem: a card that fetches its own Pokémon for the type dots.
 *
 * The list recycles a row's component for whichever item scrolls into its slot, so nothing here
 * is per-item state: the query follows the `pokemon` input, as `usePokemon(pokemon.id)` follows
 * its argument in the reference.
 */
@Component({
  selector: 'app-pokemon-item',
  imports: [FavouriteButton, PokemonImage, Text, TouchableOpacity, View],
  template: `
    <touchable-opacity
      class="card"
      [testID]="'pokemon_tile_' + pokemon().id"
      (press)="open()"
    >
      <view class="image">
        <app-pokemon-image [uri]="pokemon().imageUrl" [size]="56" />
      </view>
      <view class="info">
        <text class="name" [numberOfLines]="1">{{ index() + 1 }}. {{ name() }}</text>
        <text class="subtitle" [numberOfLines]="1">#{{ pokemon().id.padStart(3, '0') }}</text>
      </view>
      <view class="trailing">
        @if (detail.data(); as data) {
          <view class="type-dots">
            @for (type of data.types; track type) {
              <view class="dot" [accessibilityLabel]="type" [style.backgroundColor]="color(type)"></view>
            }
          </view>
        }
        <app-favourite-button
          [pokemonId]="pokemon().id"
          [size]="20"
          [testID]="'pokemon_tile_heart_' + pokemon().id"
        />
      </view>
    </touchable-opacity>
  `,
  styles: `
    /*
     * The reference's card has flex: 1 to fill FlatList's cell. Here the row's height is the
     * list's, and flex: 1 (a zero basis) under this component's unsized host collapses the card
     * to its padding, so the card takes its content's height instead: the same 98pt.
     */
    .card {
      flex-direction: row;
      align-items: center;
      padding: 16px;
      margin-bottom: 8px;
      border-radius: 4px;
      border-width: 1px;
      border-color: #e3e3e3;
      background-color: #fff;
    }
    .image {
      width: 64px;
      height: 64px;
      justify-content: center;
      align-items: center;
      margin-right: 12px;
      border-radius: 8px;
      border-width: 1px;
      border-color: #e3e3e3;
    }
    .info {
      flex: 1;
      gap: 4px;
    }
    .name {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
    }
    .subtitle {
      font-size: 12px;
      color: #9e9e9e;
    }
    .trailing {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
    }
    .type-dots {
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
  readonly #nav = inject(NativeNavigation);

  protected readonly detail = injectQuery(() => this.#api.detailQuery(this.pokemon().id));
  // A favourite has no name until its detail arrives.
  protected readonly name = computed(() =>
    capitalize(this.pokemon().name || (this.detail.data()?.name ?? '')),
  );
  protected readonly color = typeColor;

  protected open(): void {
    openPokemon(this.#nav, this.pokemon().id);
  }
}
