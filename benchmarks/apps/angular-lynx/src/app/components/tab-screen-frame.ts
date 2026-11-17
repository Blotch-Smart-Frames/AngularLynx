import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * A tab's screen (TabScreenFrame in the original): white under the status
 * bar, and the screen's gray from there down. The apps `ng build --platform`
 * makes draw edge to edge, so the inset is CSS's safe-area inset.
 */
@Component({
  selector: 'app-tab-screen-frame',
  imports: [LYNX_ELEMENTS],
  template: `<view class="content"><ng-content /></view>`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      background-color: #fff;
      padding-top: env(safe-area-inset-top);
    }
    .content {
      display: flex;
      flex-direction: column;
      flex: 1;
      background-color: #f7f7f7;
    }
  `,
})
export class TabScreenFrame {}
