import { Component, inject } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { BODIES, type Body } from '../sky/bodies';
import { OrreryState } from '../state/orrery-state';
import { BRUSHED_BRASS } from './materials';

/**
 * A brass plate for every body, engraved with its name and its number from
 * the Sun, in two whole rows: the Sun and the four rocky planets, then the
 * four giants. Pressing one flies to it; the last one visited stays pressed.
 */
@Component({
  selector: 'app-name-plates',
  imports: [LYNX_ELEMENTS],
  host: { class: 'flex flex-col px-3' },
  template: `
    @for (row of rows; track $index; let first = $first) {
      <view class="flex flex-row" [class.mt-1.5]="!first">
        @for (body of row; track body.id; let last = $last) {
          <view
            class="flex flex-1 flex-col items-center justify-center"
            [class]="body.id === state.focus() ? 'brass-pressed' : 'brass'"
            [style.background-image]="body.id === state.focus() ? null : brass"
            [class.mr-1.5]="!last"
            style="height: 42px"
            (bindtap)="state.focus.set(body.id)"
            accessibility-element="true"
            accessibility-traits="button"
            [accessibility-label]="'Fly to ' + body.name"
          >
            <text
              class="engraved font-engraved text-[8px] tracking-[1px] text-wax-soft"
              >{{ body.numeral || 'STAR' }}</text
            >
            <text
              class="engraved font-engraved text-[10px] tracking-[1.2px] text-wax"
              >{{ upper(body.name) }}</text
            >
          </view>
        }
      </view>
    }
  `,
})
export class NamePlates {
  protected readonly state = inject(OrreryState);
  protected readonly brass = BRUSHED_BRASS;
  protected readonly rows: readonly (readonly Body[])[] = [
    BODIES.slice(0, 5),
    BODIES.slice(5),
  ];

  protected upper(text: string): string {
    return text.toUpperCase();
  }
}
