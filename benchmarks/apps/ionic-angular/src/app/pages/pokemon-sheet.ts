import { Component, Injectable, inject, input } from '@angular/core';
import { IonContent, IonSpinner, ModalController } from '@ionic/angular';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { FavouriteButton } from '../components/favourite-button';
import { PokemonImage } from '../components/pokemon-image';
import { capitalize } from '../data/pokemon';
import { PokemonApi } from '../data/pokemon-api';

/**
 * The reference declares `pokemon/[id]` as a form sheet at 75% with 16pt corners. Ionic's nearest
 * is a sheet modal: `<ion-modal>` with a breakpoint at 0.75, drawn in the web view, opened by
 * ModalController.
 */
@Injectable({ providedIn: 'root' })
export class PokemonSheetOpener {
  readonly #modals = inject(ModalController);

  async open(id: string): Promise<void> {
    const modal = await this.#modals.create({
      component: PokemonSheet,
      componentProps: { id },
      breakpoints: [0, 0.75],
      initialBreakpoint: 0.75,
      // The reference draws its own handle, in its header.
      handle: false,
      cssClass: 'pokemon-sheet',
    });
    await modal.present();
  }
}

/**
 * The reference's pokemon/[id] screen: a handle, the heart, the official artwork, the name and the
 * Pokémon's facts.
 */
@Component({
  selector: 'app-pokemon-sheet',
  imports: [FavouriteButton, IonContent, IonSpinner, PokemonImage],
  template: `
    <ion-content>
      <div class="header">
        <div class="handle"></div>
        @if (pokemon.data()) {
          <app-favourite-button class="favourite" [pokemonId]="id()" [size]="30" />
        }
      </div>
      @if (pokemon.isLoading()) {
        <div class="center"><ion-spinner name="lines" /></div>
      } @else if (pokemon.data(); as data) {
        <div class="detail">
          <app-pokemon-image class="artwork" [uri]="data.imageUrl" [size]="200" />
          <div class="name">{{ capitalize(data.name) }}</div>
          <div class="rows">
            <div class="row"><span class="label">Dex №</span><span class="value">#{{ data.id.padStart(3, '0') }}</span></div>
            <div class="separator"></div>
            <div class="row"><span class="label">Type</span><span class="value">{{ list(data.types) }}</span></div>
            <div class="separator"></div>
            <div class="row"><span class="label">Height</span><span class="value">{{ (data.height / 10).toFixed(1) }} m</span></div>
            <div class="separator"></div>
            <div class="row"><span class="label">Weight</span><span class="value">{{ (data.weight / 10).toFixed(1) }} kg</span></div>
            <div class="separator"></div>
            <div class="row"><span class="label">Base XP</span><span class="value">{{ data.baseExperience }}</span></div>
            <div class="separator"></div>
            <div class="row"><span class="label">Abilities</span><span class="value">{{ list(data.abilities) }}</span></div>
          </div>
        </div>
      } @else {
        <div class="center">
          <span>Failed to load the Pokémon</span>
          <button type="button" class="link" (click)="close()">Close</button>
        </div>
      }
    </ion-content>
  `,
  styles: `
    ion-content {
      --background: #ffffff;
    }
    .header {
      position: relative;
      height: 52px;
    }
    .handle {
      width: 64px;
      height: 4px;
      border-radius: 2px;
      margin: 12px auto;
      background-color: #1a1a1a;
    }
    .favourite {
      position: absolute;
      right: 16px;
      top: 11px;
    }
    .center {
      height: 50vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    .detail {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 24px 16px;
    }
    .artwork {
      align-self: center;
    }
    .name {
      font-size: 26px;
      line-height: 30px;
      font-weight: 600;
      text-align: center;
      color: #000000;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: flex;
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
      border: 0;
      background: none;
      font: inherit;
    }
  `,
})
export class PokemonSheet {
  /** Set by ModalController's `componentProps`. */
  readonly id = input.required<string>();

  readonly #api = inject(PokemonApi);
  readonly #modals = inject(ModalController);
  protected readonly pokemon = injectQuery(() => this.#api.detailQuery(this.id()));

  protected readonly capitalize = capitalize;
  protected readonly list = (values: string[]) => values.map(capitalize).join(', ') || '—';

  protected close(): void {
    void this.#modals.dismiss();
  }
}
