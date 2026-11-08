import { Component } from '@angular/core';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `
    <!-- Each screen fills the whole screen, with its own navigation bar
         floating over its content. lynx-stack-outlet slides a note in over
         the list as iOS and Android do, and Back, the Android back button or
         a swipe from the left (or anywhere on the note) slides it away. -->
    <view class="h-full flex-col bg-background flex">
      <lynx-stack-outlet />
    </view>
  `,
})
export class App {}
