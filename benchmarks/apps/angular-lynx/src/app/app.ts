import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * The app's root (the original's root Stack): the screen the router shows,
 * and the outlet the detail sheet opens in, over it.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <view class="root">
      <router-outlet />
      <router-outlet name="sheet" />
    </view>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .root {
      display: flex;
      flex-direction: column;
      flex: 1;
      background-color: #fff;
    }
  `,
})
export class App {}
