import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';
import styles from './demo.module.css';

@Component({
  selector: 'app-css-modules-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [LYNX_ELEMENTS, DemoScreen],
  template: `
    <app-demo-screen
      heading="CSS Modules"
      category="Components"
      description="Scoped styles via CSS Modules."
    >
      <!-- Styled via CSS Modules hashed class names -->
      <view [class]="styles['card']">
        <text [class]="styles['title']">Card Title (CSS Module)</text>
        <text>
          This card is styled with a hashed class from demo.module.css
        </text>
      </view>

      <view [class]="styles['highlight']">
        <text>Highlighted section via CSS Modules</text>
      </view>

      <view [class]="styles['card']">
        <view [class]="styles['badge']">
          <text class="text-xs text-white">Badge</text>
        </view>
        <text>Card with a badge element</text>
      </view>

      <!-- Debug: show the raw hashed class names -->
      <view class="mt-6 rounded-lg bg-gray-100 p-3">
        <text class="mb-2 text-sm font-bold text-gray-500">
          Debug: Hashed Class Names
        </text>
        <text class="mb-1 font-[monospace] text-xs text-gray-400">
          card → {{ styles['card'] }}
        </text>
        <text class="mb-1 font-[monospace] text-xs text-gray-400">
          title → {{ styles['title'] }}
        </text>
        <text class="mb-1 font-[monospace] text-xs text-gray-400">
          highlight → {{ styles['highlight'] }}
        </text>
        <text class="mb-1 font-[monospace] text-xs text-gray-400">
          badge → {{ styles['badge'] }}
        </text>
      </view>
    </app-demo-screen>
  `,
})
export class CssModulesDemo {
  // Expose the CSS Modules map as a class field so the template can access
  // hashed class names via binding: [class]="styles['card']". The bundler
  // generates the hashed names at build time; at runtime `styles` is a plain
  // object mapping local names to their hashed counterparts.
  readonly styles = styles;
}
