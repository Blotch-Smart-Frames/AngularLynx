import { Component, signal } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

/**
 * The reference's (tabs)/_layout, on the template's `<ion-tabs>`: Ionic's own tab bar, drawn in
 * the web view, in its iOS look. The icons are the reference's SVGs (src/assets/icons), black when
 * selected and #424242 otherwise, solid while selected, with 12px labels.
 */
@Component({
  selector: 'app-tabs',
  imports: [IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs],
  template: `
    <ion-tabs (ionTabsDidChange)="selected.set($event.tab)">
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="pokedex" href="/tabs/pokedex" data-testid="tab_home">
          <ion-icon
            aria-hidden="true"
            [src]="selected() === 'pokedex' ? 'assets/icons/home-solid.svg' : 'assets/icons/home.svg'"
          />
          <ion-label>Pokédex</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="favourites" href="/tabs/favourites" data-testid="tab_favorites">
          <ion-icon
            aria-hidden="true"
            [src]="selected() === 'favourites' ? 'assets/icons/heart-solid.svg' : 'assets/icons/heart.svg'"
          />
          <ion-label>Favourites</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: `
    ion-tab-bar {
      --background: #ffffff;
    }
    ion-tab-button {
      --color: #424242;
      --color-selected: #000000;
    }
    ion-label {
      font-size: 12px;
    }
  `,
})
export class Tabs {
  protected readonly selected = signal('pokedex');
}
