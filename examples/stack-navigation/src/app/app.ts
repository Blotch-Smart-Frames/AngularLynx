import { Component, inject } from '@angular/core';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';
import { Motion } from './motion';

/**
 * The app: one `<lynx-stack-outlet>` in place of `<router-outlet>`. It slides
 * a screen you open in over the last one, as iOS and Android do, and Back,
 * the Android back button or a drag to the right slides it away again. The
 * screens under the top one stay alive.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `
    <view class="h-full flex-col bg-zinc-100 flex">
      <lynx-stack-outlet [animation]="motion.animation()" />
    </view>
  `,
})
export class App {
  protected readonly motion = inject(Motion);
}
