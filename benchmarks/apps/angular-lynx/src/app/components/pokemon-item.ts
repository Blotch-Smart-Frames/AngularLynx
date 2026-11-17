import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import placeholder from '../../assets/pokemon-logo.png';
import { typeColor } from '../data/colors';
import { type Pokemon, capitalize, dexNumber } from '../data/pokemon';
import { PokemonDetails } from '../data/pokemon-details';
import { FavouriteButton } from './favourite-button';

/**
 * A row of the list (PokemonItem in the original): the sprite, the number and
 * name, a dot for each of the Pokémon's types, and the heart. Each row
 * fetches its own Pokémon's detail for the types, as the original does.
 *
 * `*lynxListFor` reuses a row scrolled away for the one scrolled to, so
 * everything it shows is derived from its inputs.
 */
@Component({
  selector: 'app-pokemon-item',
  imports: [LYNX_ELEMENTS, FavouriteButton],
  template: `
    <!-- The original's TouchableOpacity: dims to 0.2 while pressed. Lynx has
         no :active, so the press comes from touch events. -->
    <view
      class="card"
      [style.opacity]="pressing() ? 0.2 : 1"
      (bindtap)="open()"
      (bindtouchstart)="pressing.set(true)"
      (bindtouchend)="pressing.set(false)"
      (bindtouchcancel)="pressing.set(false)"
    >
      <view class="image">
        <image
          class="sprite"
          mode="aspectFit"
          [src]="pokemon().imageUrl ?? undefined"
          [placeholder]="placeholder"
        />
      </view>
      <view class="info">
        <text class="name" [text-maxline]="1">{{ index() + 1 }}. {{ name() }}</text>
        <text class="subtitle" [text-maxline]="1">{{ number() }}</text>
      </view>
      <view class="trailing">
        @if (types(); as types) {
          <view class="dots">
            @for (type of types; track type) {
              <view
                class="dot"
                [attr.accessibility-label]="type"
                [style.background-color]="color(type)"
              ></view>
            }
          </view>
        }
        <app-favourite-button [pokemonId]="pokemon().id" [size]="20" />
      </view>
    </view>
  `,
  styles: `
    .card {
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 16px;
      border-radius: 4px;
      background-color: #fff;
      border: 1px solid #e3e3e3;
    }
    .image {
      display: flex;
      width: 64px;
      height: 64px;
      justify-content: center;
      align-items: center;
      margin-right: 12px;
      border-radius: 8px;
      border: 1px solid #e3e3e3;
    }
    .sprite {
      width: 56px;
      height: 56px;
    }
    .info {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 4px;
    }
    .name {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      text-overflow: ellipsis;
    }
    .subtitle {
      font-size: 12px;
      color: #9e9e9e;
      text-overflow: ellipsis;
    }
    .trailing {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
    }
    .dots {
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

  readonly #router = inject(Router);
  readonly #details = inject(PokemonDetails);

  protected readonly placeholder = placeholder;
  protected readonly pressing = signal(false);
  protected readonly color = typeColor;

  /** This row's Pokémon's detail, fetched once per id (see PokemonDetails). */
  readonly #detail = computed(() => this.#details.get(this.pokemon().id)());

  protected readonly types = computed(() => {
    const detail = this.#detail();
    return detail.status === 'success' ? detail.data.types : null;
  });

  // A favourite's row has no name until its detail arrives.
  protected readonly name = computed(() => {
    const detail = this.#detail();
    return capitalize(this.pokemon().name || (detail.status === 'success' ? detail.data.name : ''));
  });

  protected readonly number = computed(() => dexNumber(this.pokemon().id));

  /** Opens the detail sheet over the tabs (the `sheet` outlet). */
  protected open(): void {
    void this.#router.navigate([{ outlets: { sheet: ['pokemon', this.pokemon().id] } }]);
  }
}
