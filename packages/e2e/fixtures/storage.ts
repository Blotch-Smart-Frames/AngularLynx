import { Component, inject, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxLocalStorage,
  LynxSecureStorage,
} from '@blotch/angular-lynx';

const KEY = 'e2e';

/**
 * E2E fixture for LynxLocalStorage and LynxSecureStorage (issue #178), loaded
 * through `loadComponent` like lazy-route.ts. Each time it opens, it shows
 * what the two stores held, local first, then stores "kept" in both, so
 * "Stored: kept/kept" after the app restarts means both kept their value. The
 * line fills in only once the writes are done, so a check can restart the app
 * as soon as it appears.
 *
 * "Clear storage" empties both stores and shows what they hold then, which
 * also leaves them empty for the next run: iOS keeps Keychain items after the
 * app is deleted.
 *
 * One row, like the other lazy pages, so the page fits on CI's 320x640
 * Android emulator (see counter.ts). "Open canvas", below it, opens
 * canvas.ts: the counter page has no room left for another link.
 */
@Component({
  selector: 'app-storage',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <view
      style="display: flex; flex-direction: row; align-items: center; margin-top: 16px;"
    >
      <text flatten="false">Stored: {{ stored() }}</text>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Clear storage"
        style="margin-left: 16px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="clear()"
      >
        <text>Clear storage</text>
      </view>
    </view>
    <view
      [flatten]="false"
      [accessibility-element]="true"
      accessibility-label="Open canvas"
      accessibility-traits="button"
      style="margin-top: 8px; padding: 12px; background-color: #e0e0e0; align-self: flex-start;"
      routerLink="/canvas"
    >
      <text>Open canvas</text>
    </view>
  `,
})
export class StorageRoute implements OnInit {
  readonly #local = inject(LynxLocalStorage);
  readonly #secure = inject(LynxSecureStorage);
  readonly stored = signal('…');

  ngOnInit(): void {
    this.#show(async () => {
      const held = await this.#read();
      await Promise.all([
        this.#local.setItem(KEY, 'kept'),
        this.#secure.setItem(KEY, 'kept'),
      ]);
      return held;
    });
  }

  clear(): void {
    this.#show(async () => {
      await Promise.all([this.#local.clear(), this.#secure.clear()]);
      return this.#read();
    });
  }

  async #read(): Promise<string> {
    const [local, secure] = await Promise.all([
      this.#local.getItem<string>(KEY),
      this.#secure.getItem<string>(KEY),
    ]);
    return `${local ?? 'none'}/${secure ?? 'none'}`;
  }

  /**
   * Shows what `task` returns, or why it failed.
   */
  #show(task: () => Promise<string>): void {
    task().then(
      (text) => this.stored.set(text),
      (error: Error) => this.stored.set(error.message),
    );
  }
}
