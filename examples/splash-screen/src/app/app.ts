import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `
    <view class="h-full" style="background-color: var(--sand)">
      <router-outlet />
    </view>
  `,
})
export class App {}
