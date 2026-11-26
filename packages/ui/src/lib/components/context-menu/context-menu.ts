import {
  Component,
  type ElementRef,
  Renderer2,
  ViewEncapsulation,
  booleanAttribute,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxHaptics } from '@blotch/angular-lynx';

import { type MenuElement, UiMenuPopup } from '../menu/menu-popup';
import { MenuPress, MenuRows } from '../menu/menu-rows';
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
 * The items (`ui-menu-item`, `ui-menu-section`, `ui-menu-separator`,
 * `ui-menu-submenu`) are the menu, and everything else is the element it
 * opens from. On iOS the finger that opened it can slide on onto an item
 * and lift to choose it. Taps on the
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
      <view
        #element
        class="flex-col flex"
        (bindlongpress)="onLongPress()"
        (bindtouchstart)="onTouchStart($event)"
        (bindtouchend)="onTouchEnd($event)"
        (bindtouchcancel)="onTouchCancel()"
      >
        <ng-content />
      </view>
    </view>
    <ui-menu-popup
      #popup
      kind="context"
      [open]="open()"
      [anchor]="elementView().nativeElement"
      [anchorHome]="homeView().nativeElement"
      [rows]="rows"
      (dismissed)="close()"
      (closed)="closed.emit()"
    >
      <ng-content
        select="ui-menu-item, ui-menu-section, ui-menu-separator, ui-menu-submenu"
      />
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
  readonly popup = viewChild.required<UiMenuPopup>('popup');

  readonly rows = new MenuRows();

  readonly #haptics = inject(LynxHaptics);
  readonly #renderer = inject(Renderer2);

  /** The finger that long-pressed, sliding on across the menu. */
  readonly #press = new MenuPress(() => this.popup());

  /**
   * Listens for the finger's moves in code rather than in the template, as
   * UiMenuTrigger does: a finger sends one for every frame it moves. Lynx
   * keeps sending a touch's moves to the element it started on, which
   * includes the lifted element in the menu's overlay.
   */
  protected readonly listen = effect((onCleanup) => {
    onCleanup(
      this.#renderer.listen(
        this.elementView().nativeElement,
        'bindtouchmove',
        (event: unknown) => {
          if (this.#press.active) this.#press.move(event);
        },
      ),
    );
  });

  /**
   * Follows a finger on the element, so that once its long press opens an
   * Apple menu it can slide onto an item and lift to choose it, as on iOS.
   * Android's context menus wait for a tap.
   */
  protected onTouchStart(event: unknown): void {
    if (this.disabled() || this.popup().design() === 'material') return;
    this.#press.start(event);
    this.rows.pressStarted();
  }

  protected onTouchEnd(event: unknown): void {
    this.#press.end(event);
    this.rows.pressEnded();
  }

  protected onTouchCancel(): void {
    this.#press.cancel();
    this.rows.pressCanceled();
  }

  /**
   * Opens the menu with a tap, as iOS's context menu and Android's long
   * press give: it tells the finger that the press became something else.
   * Opening from code (`[(open)]`) has no press to answer, so it's silent.
   */
  protected onLongPress(): void {
    if (this.disabled()) return;
    this.#haptics.impact('medium');
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }
}
