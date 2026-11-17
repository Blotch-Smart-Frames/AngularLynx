import { Component } from '@angular/core';
import { SafeAreaView, View } from '@ng-native/components';

/**
 * The reference's TabScreenFrame: white under the status bar, the light grey screen below it.
 * The reference pads by the top inset itself; `<safe-area-view>` applies the same inset natively.
 */
@Component({
  selector: 'app-tab-screen-frame',
  imports: [SafeAreaView, View],
  host: { style: 'flex: 1' },
  template: `
    <safe-area-view class="frame" [edges]="['top']">
      <view class="content"><ng-content /></view>
    </safe-area-view>
  `,
  styles: `
    .frame {
      flex: 1;
      background-color: #fff;
    }
    .content {
      flex: 1;
      background-color: #f7f7f7;
    }
  `,
})
export class TabScreenFrame {}
