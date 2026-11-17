import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiBottomSheet } from '../../components/ui/bottom-sheet';
import { UiSpinner } from '../../components/ui/spinner';
import placeholder from '../../assets/pokemon-logo.png';
import { FavouriteButton } from '../components/favourite-button';
import { capitalize, dexNumber } from '../data/pokemon';
import { PokemonDetails } from '../data/pokemon-details';

/**
 * A Pokémon's detail (`/pokemon/:id` in the original), in a sheet over the
 * tabs: the route is in the `sheet` outlet, so the tab under it stays as it
 * is. The original presents it as an iOS form sheet at 75% of the screen's
 * height; this is @blotch/ui's bottom sheet, whose content is that tall.
 * Dragging it down or tapping the backdrop closes it, and leaves the route.
 */
@Component({
  selector: 'app-pokemon-sheet',
  imports: [LYNX_ELEMENTS, UiBottomSheet, UiSpinner, FavouriteButton],
  template: `
    <ui-bottom-sheet class="rounded-t-[16px] bg-white" [(open)]="open" (closed)="close()">
      <view class="body">
        <!-- The sheet draws its own grabber above this; the original's 52px
             header holds its handle and the heart, 11px from the top. -->
        <view class="header">
          <app-favourite-button class="favourite" [pokemonId]="id()" [size]="30" />
        </view>
        @switch (detail().status) {
          @case ('loading') {
            <view class="center">
              <ui-spinner size="lg" color="#999999" />
            </view>
          }
          @case ('error') {
            <view class="center">
              <text class="message">Failed to load the Pokémon</text>
              <text class="link" (bindtap)="open.set(false)">Close</text>
            </view>
          }
          @case ('success') {
            @if (data(); as pokemon) {
              <scroll-view class="scroll" scroll-orientation="vertical">
                <view class="detail">
                  <image
                    class="artwork"
                    mode="aspectFit"
                    [src]="pokemon.imageUrl ?? undefined"
                    [placeholder]="placeholder"
                  />
                  <text class="name">{{ name() }}</text>
                  <view class="rows">
                    @for (row of rows(); track row.label; let last = $last) {
                      <view class="row">
                        <text class="label">{{ row.label }}</text>
                        <text class="value">{{ row.value }}</text>
                      </view>
                      @if (!last) {
                        <view class="separator"></view>
                      }
                    }
                  </view>
                </view>
              </scroll-view>
            }
          }
        }
      </view>
    </ui-bottom-sheet>
  `,
  styles: `
    /* The sheet is 75% of the screen, as the original's detent: less the
       sheet's 25px grabber strip, and the bottom safe area it pads by. */
    .body {
      display: flex;
      flex-direction: column;
      height: calc(75vh - 25px - env(safe-area-inset-bottom));
      background-color: #fff;
    }
    .header {
      height: 27px;
    }
    .favourite {
      position: absolute;
      right: 16px;
      top: -14px;
    }
    .center {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 50vh;
    }
    .message {
      font-size: 14px;
      color: #000;
    }
    .link {
      margin-top: 15px;
      padding: 15px 0;
      font-size: 14px;
      color: #000;
    }
    .scroll {
      flex: 1;
    }
    .detail {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 24px 16px;
    }
    .artwork {
      width: 200px;
      height: 200px;
      align-self: center;
    }
    .name {
      font-size: 26px;
      line-height: 30px;
      font-weight: 600;
      text-align: center;
      color: #000;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: flex;
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
      font-weight: 500;
      color: #1a1a1a;
      flex-shrink: 1;
      text-align: right;
      margin-left: 16px;
    }
    .separator {
      height: 1px;
      background-color: #e3e3e3;
    }
  `,
})
export class PokemonSheet {
  /** The route's `:id` (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly #router = inject(Router);
  readonly #details = inject(PokemonDetails);

  protected readonly placeholder = placeholder;
  protected readonly open = signal(true);

  /** The same cache entry the row read, so it's usually there already. */
  protected readonly detail = computed(() => this.#details.get(this.id())());
  protected readonly data = computed(() => {
    const detail = this.detail();
    return detail.status === 'success' ? detail.data : null;
  });

  protected readonly name = computed(() => capitalize(this.data()?.name ?? ''));
  protected readonly rows = computed(() => {
    const pokemon = this.data();
    if (!pokemon) return [];
    return [
      { label: 'Dex №', value: dexNumber(pokemon.id) },
      { label: 'Type', value: pokemon.types.map(capitalize).join(', ') || '—' },
      { label: 'Height', value: `${(pokemon.height / 10).toFixed(1)} m` },
      { label: 'Weight', value: `${(pokemon.weight / 10).toFixed(1)} kg` },
      { label: 'Base XP', value: `${pokemon.baseExperience}` },
      { label: 'Abilities', value: pokemon.abilities.map(capitalize).join(', ') || '—' },
    ];
  });

  /** The sheet has gone: leave its route, which keeps the tab under it. */
  protected close(): void {
    void this.#router.navigate([{ outlets: { sheet: null } }]);
  }
}
