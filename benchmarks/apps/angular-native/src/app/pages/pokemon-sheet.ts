import { Component, computed, inject, input } from '@angular/core';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from '@ng-native/components';
import { Screen } from '@ng-native/device';
import { NativeNavigation } from '@ng-native/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { FavouriteButton } from '../components/favourite-button.ts';
import { PokemonImage } from '../components/pokemon-image.ts';
import { capitalize } from '../data/pokemon.ts';
import { PokemonApi } from '../data/pokemon-api.ts';

/**
 * The reference's pokemon/[id] screen, presented as a form sheet (see open-pokemon.ts): a handle,
 * the heart, the official artwork, the name and the Pokémon's facts.
 */
@Component({
  selector: 'app-pokemon-sheet',
  imports: [ActivityIndicator, FavouriteButton, PokemonImage, Pressable, ScrollView, Text, View],
  host: { style: 'flex: 1' },
  template: `
    @if (pokemon.isLoading()) {
      <view class="handle"></view>
      <view class="center" [style.height.px]="halfHeight()">
        <activity-indicator size="large" />
      </view>
    } @else if (pokemon.data(); as data) {
      <view class="header" [collapsable]="false">
        <view class="handle"></view>
        <app-favourite-button class="favourite" [pokemonId]="id()" [size]="30" />
      </view>
      <scroll-view class="scroll" [contentContainerStyle]="dataContainer">
        <view class="detail">
          <view class="image-wrapper">
            <app-pokemon-image [uri]="data.imageUrl" [size]="200" />
          </view>
          <text class="name">{{ capitalize(data.name) }}</text>
          <view class="rows">
            <view class="row">
              <text class="label">Dex №</text>
              <text class="value">#{{ data.id.padStart(3, '0') }}</text>
            </view>
            <view class="separator"></view>
            <view class="row">
              <text class="label">Type</text>
              <text class="value">{{ list(data.types) }}</text>
            </view>
            <view class="separator"></view>
            <view class="row">
              <text class="label">Height</text>
              <text class="value">{{ (data.height / 10).toFixed(1) }} m</text>
            </view>
            <view class="separator"></view>
            <view class="row">
              <text class="label">Weight</text>
              <text class="value">{{ (data.weight / 10).toFixed(1) }} kg</text>
            </view>
            <view class="separator"></view>
            <view class="row">
              <text class="label">Base XP</text>
              <text class="value">{{ data.baseExperience }}</text>
            </view>
            <view class="separator"></view>
            <view class="row">
              <text class="label">Abilities</text>
              <text class="value">{{ list(data.abilities) }}</text>
            </view>
          </view>
        </view>
      </scroll-view>
    } @else {
      <view class="handle"></view>
      <view class="center" [style.height.px]="halfHeight()">
        <text>Failed to load the Pokémon</text>
        <pressable class="link" (press)="nav.back()"><text>Close</text></pressable>
      </view>
    }
  `,
  styles: `
    :host {
      background-color: #fff;
    }
    .center {
      justify-content: center;
      align-items: center;
    }
    .handle {
      width: 64px;
      height: 4px;
      border-radius: 2px;
      margin: 12px 0;
      background-color: #1a1a1a;
      align-self: center;
    }
    .header {
      height: 52px;
      justify-content: center;
    }
    .favourite {
      position: absolute;
      right: 16px;
      top: 11px;
    }
    .scroll {
      flex: 1;
    }
    .detail {
      gap: 16px;
    }
    .image-wrapper {
      align-self: center;
    }
    .name {
      font-size: 26px;
      line-height: 30px;
      font-weight: 600;
      text-align: center;
    }
    .rows {
      gap: 12px;
    }
    .row {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }
    .label {
      font-size: 14px;
      line-height: 20px;
      color: #9e9e9e;
    }
    .value {
      font-size: 14px;
      line-height: 20px;
      color: #1a1a1a;
      font-weight: 500;
      flex-shrink: 1;
      text-align: right;
      margin-left: 16px;
    }
    .separator {
      height: 1px;
      background-color: #e3e3e3;
    }
    .link {
      margin-top: 15px;
      padding: 15px 0;
    }
  `,
})
export class PokemonSheet {
  /** The route's `:id`, bound by withComponentInputBinding. */
  readonly id = input.required<string>();

  readonly #api = inject(PokemonApi);
  protected readonly nav = inject(NativeNavigation);
  protected readonly pokemon = injectQuery(() => this.#api.detailQuery(this.id()));
  // The reference centers its spinner in half the window's height.
  readonly #screen = inject(Screen);
  protected readonly halfHeight = computed(() => this.#screen.window().height / 2);

  protected readonly dataContainer = { paddingHorizontal: 16, paddingVertical: 24 };
  protected readonly capitalize = capitalize;
  protected readonly list = (values: string[]) => values.map(capitalize).join(', ') || '—';
}
