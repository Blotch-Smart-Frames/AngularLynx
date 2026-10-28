import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <!-- Each screen fills the whole screen, with its own navigation bar
         floating over its content. -->
    <view class="h-full flex-col bg-background flex">
      <router-outlet />
    </view>
  `,
})
export class App {}
