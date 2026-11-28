import { Component, Injectable, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { ModalDialogParams, ModalDialogService } from '@nativescript/angular';
import { Screen, type ShownModallyData, type View } from '@nativescript/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { FavouriteButton } from '../components/favourite-button';
import { PokemonImage } from '../components/pokemon-image';
import { capitalize } from '../data/pokemon';
import { PokemonApi } from '../data/pokemon-api';

/**
 * The reference declares `pokemon/[id]` as a form sheet at 75% with 16pt corners. NativeScript
 * shows a page modally with ModalDialogService, as a UIKit page sheet; the sheet's detent and
 * corners are set on its UISheetPresentationController before it's presented (`showingModally`).
 */
@Injectable({ providedIn: 'root' })
export class PokemonSheetOpener {
  readonly #modal = inject(ModalDialogService);

  open(id: string): void {
    void this.#modal.showModal(PokemonSheet, {
      context: { id },
      fullscreen: false,
      ios: { presentationStyle: UIModalPresentationStyle.PageSheet },
    });
  }
}

/**
 * The reference's pokemon/[id] screen: a handle, the heart, the official artwork, the name and the
 * Pokémon's facts.
 */
@Component({
  selector: 'app-pokemon-sheet',
  imports: [FavouriteButton, PokemonImage],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <GridLayout rows="auto, *" class="sheet" (showingModally)="onShowing($event)">
      <GridLayout row="0" class="header">
        <StackLayout class="handle"></StackLayout>
        @if (pokemon.data()) {
          <!-- A component's host element isn't a view NativeScript lays out, so the position goes
               on a layout around it. -->
          <StackLayout class="favourite">
            <app-favourite-button [pokemonId]="id" [size]="30" />
          </StackLayout>
        }
      </GridLayout>
      @if (pokemon.isLoading()) {
        <ActivityIndicator row="1" [busy]="true" [height]="halfHeight" verticalAlignment="top"></ActivityIndicator>
      } @else if (pokemon.data(); as data) {
        <ScrollView row="1">
          <StackLayout class="detail">
            <app-pokemon-image [uri]="data.imageUrl" [size]="200" />
            <Label class="name" [text]="capitalize(data.name)"></Label>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Dex №"></Label>
              <Label col="1" class="value" [text]="'#' + data.id.padStart(3, '0')"></Label>
            </GridLayout>
            <StackLayout class="separator"></StackLayout>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Type"></Label>
              <Label col="1" class="value" [text]="list(data.types)"></Label>
            </GridLayout>
            <StackLayout class="separator"></StackLayout>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Height"></Label>
              <Label col="1" class="value" [text]="(data.height / 10).toFixed(1) + ' m'"></Label>
            </GridLayout>
            <StackLayout class="separator"></StackLayout>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Weight"></Label>
              <Label col="1" class="value" [text]="(data.weight / 10).toFixed(1) + ' kg'"></Label>
            </GridLayout>
            <StackLayout class="separator"></StackLayout>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Base XP"></Label>
              <Label col="1" class="value" [text]="data.baseExperience"></Label>
            </GridLayout>
            <StackLayout class="separator"></StackLayout>
            <GridLayout columns="auto, *" class="row">
              <Label col="0" class="label" text="Abilities"></Label>
              <Label col="1" class="value" [text]="list(data.abilities)"></Label>
            </GridLayout>
          </StackLayout>
        </ScrollView>
      } @else {
        <StackLayout row="1" [height]="halfHeight" verticalAlignment="top" class="failed">
          <Label text="Failed to load the Pokémon" horizontalAlignment="center"></Label>
          <Label text="Close" class="link" horizontalAlignment="center" (tap)="params.closeCallback()"></Label>
        </StackLayout>
      }
    </GridLayout>
  `,
  styles: `
    .sheet {
      background-color: #ffffff;
    }
    .header {
      height: 52;
    }
    .handle {
      width: 64;
      height: 4;
      border-radius: 2;
      margin: 12 0;
      background-color: #1a1a1a;
      horizontal-align: center;
      vertical-align: top;
    }
    .favourite {
      horizontal-align: right;
      vertical-align: top;
      margin: 11 16 0 0;
    }
    .detail {
      padding: 24 16;
    }
    .name {
      font-size: 26;
      font-weight: 600;
      text-align: center;
      color: #000000;
      margin: 16 0;
    }
    .row {
      margin: 6 0;
    }
    .label {
      font-size: 14;
      color: #9e9e9e;
    }
    .value {
      font-size: 14;
      color: #1a1a1a;
      font-weight: 500;
      text-align: right;
      margin-left: 16;
      text-wrap: true;
    }
    .separator {
      height: 1;
      background-color: #e3e3e3;
    }
    .failed {
      vertical-align: center;
    }
    .link {
      margin-top: 15;
      padding: 15 0;
    }
  `,
})
export class PokemonSheet {
  protected readonly params = inject(ModalDialogParams);
  protected readonly id: string = this.params.context.id;

  readonly #api = inject(PokemonApi);
  protected readonly pokemon = injectQuery(() => this.#api.detailQuery(this.id));
  // The reference centers its spinner in half the window's height.
  protected readonly halfHeight = Screen.mainScreen.heightDIPs / 2;

  protected readonly capitalize = capitalize;
  protected readonly list = (values: string[]) => values.map(capitalize).join(', ') || '—';

  /** The reference's sheet: one detent at 75% of the screen, 16pt corners. */
  protected onShowing(event: Event): void {
    // NativeScript's events aren't DOM events, whatever the template's type checking says.
    const sheet = ((event as unknown as ShownModallyData).object as View).viewController?.sheetPresentationController as
      | UISheetPresentationController
      | undefined;
    if (!sheet) return;
    // NativeScript marshals a JavaScript array to an NSArray, and the function to a block.
    sheet.detents = [
      UISheetPresentationControllerDetent.customDetentWithIdentifierResolver(
        null,
        (context) => context.maximumDetentValue * 0.75,
      ),
    ] as unknown as NSArray<UISheetPresentationControllerDetent>;
    sheet.preferredCornerRadius = 16;
  }
}
