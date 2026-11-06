import { Component, inject, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxLocalStorage,
  LynxSecureStorage,
} from '@blotch/angular-lynx';

const KEY = 'e2e';

/**
 * Arrays the check takes objects out of. They stay alive for as long as the
 * app does, as a library's stacks and lists do.
 */
const arrays: object[][] = [[], [], []];

/**
 * Takes an object out of each array, by pop(), splice() and assignment, and
 * returns a `WeakRef` to each. A function of its own, so no variable of the
 * caller's still holds them.
 */
const takeOut = (): Record<
  'popped' | 'spliced' | 'assigned',
  WeakRef<object>
> => {
  const [popped, spliced, assigned] = [{}, {}, {}];
  arrays[0].push(popped);
  arrays[0].pop();
  arrays[1].push(spliced);
  arrays[1].splice(0);
  arrays[2].push(assigned);
  arrays[2][0] = {};
  return {
    popped: new WeakRef(popped),
    spliced: new WeakRef(spliced),
    assigned: new WeakRef(assigned),
  };
};

/**
 * Makes garbage that points at itself, which PrimJS collects only when it
 * runs a collection, not as soon as nothing refers to it.
 */
const allocate = (): void => {
  for (let pass = 0; pass < 10; pass++) {
    const junk: unknown[] = [];
    for (let index = 0; index < 50_000; index++) {
      const a: Record<string, unknown> = { index };
      a['self'] = a;
      junk[index] = a;
    }
  }
};

/**
 * Whether what pop() and splice() took out was collected, once a collection
 * has let the assigned-over object go.
 */
const collectedFromArrays = async (): Promise<string> => {
  const taken = takeOut();
  for (let round = 0; round < 30; round++) {
    allocate();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (taken.assigned.deref()) continue;
    const kept = (['popped', 'spliced'] as const).filter((name) =>
      taken[name].deref(),
    );
    return kept.length ? `kept ${kept.join(' ')}` : 'freed';
  }
  return 'no collection';
};

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
 *
 * "Array slots", beside it, checks that an object taken out of an array that
 * stays alive is collected (issue #299). PrimJS kept what an array held past
 * its length until the build made pop(), shift() and splice() clear those
 * slots; V8 never did, so only a device can catch it. A tap takes one object
 * out with pop() and one with splice(), and replaces a third by assignment,
 * which PrimJS always lets go: that one shows a collection has run. Until it
 * goes, the check allocates more garbage and looks again. "freed" means both
 * others went too.
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
      style="display: flex; flex-direction: row; align-items: center; margin-top: 8px;"
    >
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open canvas"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0;"
        routerLink="/canvas"
      >
        <text>Open canvas</text>
      </view>
      <text
        flatten="false"
        style="margin-left: 16px;"
        (bindtap)="checkArraySlots()"
        >Array slots: {{ arraySlots() }}</text
      >
    </view>
  `,
})
export class StorageRoute implements OnInit {
  readonly #local = inject(LynxLocalStorage);
  readonly #secure = inject(LynxSecureStorage);
  readonly stored = signal('…');
  readonly arraySlots = signal('tap');

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

  checkArraySlots(): void {
    this.arraySlots.set('…');
    void collectedFromArrays().then((result) => this.arraySlots.set(result));
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
