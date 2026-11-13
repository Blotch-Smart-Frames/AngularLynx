import { Component, inject } from '@angular/core';
import { LYNX_ELEMENTS, LynxTabOutlet } from '@blotch/angular-lynx';
import {
  UiDock,
  UiDockAccessory,
  UiDockAction,
  UiDockItem,
} from '../components/ui/dock';
import { UiIcon } from '../components/ui/icon';
import { Player } from './player';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    LynxTabOutlet,
    UiDock,
    UiDockAccessory,
    UiDockAction,
    UiDockItem,
    UiIcon,
  ],
  template: `
    <!-- The screens fill the whole screen, and the dock floats over them at
         the bottom: their content scrolls beneath it. The outlet keeps each
         tab once it's been shown, as a native tab bar does: the Library
         comes back with the album you left open. -->
    <view class="h-full flex-col bg-background flex">
      <lynx-tab-outlet />

      <ui-dock #dock>
        <!-- The accessory: what's playing, above the bar. When the dock
             minimizes, it moves into the row beside the bar, so it drops
             the artist there. dock.minimized() says whether it has: the
             dock doesn't minimize in every design. -->
        @if (player.album(); as album) {
          <view
            ui-dock-accessory
            class="flex-row items-center gap-3 pl-2 pr-4 flex"
          >
            <view
              class="h-8 w-8 rounded-full"
              [style.background-image]="album.cover"
            ></view>
            <view class="flex-1 flex-col flex">
              <text class="text-sm font-semibold text-glass-foreground">{{
                album.title
              }}</text>
              @if (!dock.minimized()) {
                <text class="text-xs text-glass-muted-foreground">{{
                  album.artist
                }}</text>
              }
            </view>
            <view
              class="h-8 w-8 items-center flex justify-center"
              [accessibility-element]="true"
              accessibility-traits="button"
              [accessibility-label]="player.playing() ? 'Pause' : 'Play'"
              (bindtap)="player.toggle()"
            >
              <ui-icon [name]="player.playing() ? 'pause' : 'play'" />
            </view>
          </view>
        }

        <ui-dock-item route="/home" icon="home" label="Home" />
        <ui-dock-item route="/browse" icon="layout-grid" label="Browse" />
        <ui-dock-item route="/library" icon="music" label="Library" badge="3" />

        <!-- A separate button beside the bar, in the same glass. -->
        <ui-dock-action route="/search" icon="search" label="Search" />
      </ui-dock>
    </view>
  `,
})
export class App {
  protected readonly player = inject(Player);
}
