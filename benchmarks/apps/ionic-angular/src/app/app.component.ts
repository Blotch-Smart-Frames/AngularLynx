import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

/** The reference's root _layout: Ionic's stack of pages, the tabs its first. */
@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      <ion-router-outlet />
    </ion-app>
  `,
})
export class AppComponent {}
