import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-heavy',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="loaded">
      <text class="loaded-text">Deferred Component Loaded!</text>
    </view>
  `,
  styles: `
    .loaded {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 14px;
      border-radius: 8px;
      margin-top: 8px;
    }
    .loaded-text {
      font-size: 15px;
      font-weight: 600;
      color: #166534;
    }
  `,
})
export class Heavy {}
