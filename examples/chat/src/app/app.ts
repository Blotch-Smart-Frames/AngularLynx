import { Component } from '@angular/core';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';
import { UiToaster } from '../components/ui/toast';

/**
 * The app: one `<lynx-stack-outlet>` in place of `<router-outlet>`. Opening
 * a letter slides its conversation in over the inbox, as iOS and Android
 * do, and Back, the Android back button or a drag from the left edge slides
 * it away again, with the inbox still where it was.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxStackOutlet, UiToaster],
  template: `
    <view class="flex h-full w-full flex-col bg-paper">
      <lynx-stack-outlet />
      <ui-toaster />
    </view>
  `,
})
export class App {}
