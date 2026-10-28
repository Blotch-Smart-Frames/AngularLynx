import {
  Component,
  type ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type MenuElement, UiMenuPopup } from '../menu/menu-popup';
import { UI_MENU, type UiMenuHost } from '../menu/menu';

/**
 * The `ui-context-menu` an item is in, for `UI_MENU`. A named function rather
 * than an inline factory: the component's metadata keeps its own copy of an
 * inline one, which nothing calls, so an app's coverage report would show it
 * as uncovered.
 */
const contextMenu = (): UiMenuHost => inject(UiContextMenu);

/**
 * A context menu: a long press on an element lifts it and opens a menu of
 * actions beside it, while the rest of the screen dims.
 *
 * ```html
 * <ui-context-menu>
 *   <view class="rounded-xl bg-card p-4">
 *     <text class="text-foreground">Trip to Kyoto</text>
 *   </view>
 *   <ui-menu-item label="Share" icon="upload" (pressed)="share()" />
 *   <ui-menu-item label="Favorite" icon="heart" (pressed)="favorite()" />
 *   <ui-menu-separator />
 *   <ui-menu-item label="Delete" icon="trash" variant="destructive" (pressed)="remove()" />
 * </ui-context-menu>
 * ```
 *
 * The items (`ui-menu-item`, `ui-menu-section`, `ui-menu-separator`) are the
 * menu, and everything else is the element it opens from. Taps on the
 * element still reach it: Lynx tells a tap from a long press. A tap outside
 * the menu, choosing an item, or Android's back button closes it, and
 * `[(open)]` opens and closes it from code.
 *
 * On iOS the element lifts above a dimming layer (a blur before iOS 26) and
 * the menu, Liquid Glass from iOS 26, opens below it, or above it near the
 * bottom of the screen; when it fits on neither side, the element moves up
 * to make room. The element itself moves into the menu's overlay, so it
 * stays live and looks exactly as it did. On Android it's a Material 3 menu
 * beside the element, without the lift or the dimming, unless the app opts
 * into glass with `provideGlass({ android: 'glass' })`.
 *
 * Apple asks for a context menu's first actions to match the swipe actions
 * of the row it's on, when there are any, so the two ways to reach an
 * action agree.
 */
@Component({
  selector: 'ui-context-menu',
  imports: [LYNX_ELEMENTS, UiMenuPopup],
  encapsulation: ViewEncapsulation.None,
  providers: [{ provide: UI_MENU, useFactory: contextMenu }],
  template: `
    <!-- Keeps the element's size while it's lifted into the overlay, so the
         page doesn't move under the menu. -->
    <view
      #home
      class="flex-col flex"
      [style.width.px]="popup.placeholder()?.width"
      [style.height.px]="popup.placeholder()?.height"
    >
      <view #element class="flex-col flex" (bindlongpress)="onLongPress()">
        <ng-content />
      </view>
    </view>
    <ui-menu-popup
      #popup
      kind="context"
      [open]="open()"
      [anchor]="elementView().nativeElement"
      [anchorHome]="homeView().nativeElement"
      (dismissed)="close()"
      (closed)="closed.emit()"
    >
      <ng-content select="ui-menu-item, ui-menu-section, ui-menu-separator" />
    </ui-menu-popup>
  `,
})
export class UiContextMenu implements UiMenuHost {
  /** Whether the menu is open. */
  readonly open = model(false);
  /** Turns the long press off. */
  readonly disabled = input(false, { transform: booleanAttribute });

  /** The menu has closed and its close animation has finished. */
  readonly closed = output<void>();

  // Required: both are always in the template.
  readonly elementView = viewChild.required<ElementRef<MenuElement>>('element');
  readonly homeView = viewChild.required<ElementRef<MenuElement>>('home');

  protected onLongPress(): void {
    if (!this.disabled()) this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }
}
