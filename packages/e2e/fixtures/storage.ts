import { Component, inject, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AppleSignInError,
  BiometricsError,
  LYNX_ELEMENTS,
  LynxAppleSignIn,
  LynxBiometrics,
  LynxClipboard,
  FilePickerError,
  LynxFilePicker,
  LynxLocalStorage,
  LynxSecureStorage,
  LynxStoreReview,
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
 *
 * "Clipboard", on a row of its own, copies a line with LynxClipboard and
 * shows what the clipboard reads back (issue #303): the shells' native
 * module on a device, the page's Clipboard API on the web. Lynx Explorer has
 * no clipboard module, so it shows the rejection instead.
 *
 * "Biometrics", on the row below, shows what LynxBiometrics reports once the page
 * opens (issue #918): the sensor and whether a face or finger is set up, from
 * the shells' module, which only an app with `permissions.biometrics` has
 * (the E2E app asks for it). A tap asks for it and shows the answer, which on
 * a simulator nobody has enrolled is `notEnrolled`. Lynx Explorer has no
 * module: `none`, and `unavailable`.
 *
 * "Files", beside "Rating", opens LynxFilePicker's document picker (issue
 * #924), from the shells' module, which only an app with angular.json's
 * `filePicker` has (the E2E app sets it). Closing it shows "canceled", and a
 * file picked shows its name and size. Lynx Explorer has no module:
 * `unavailable`. It shares that row because the Android emulator's screen
 * ends at the Biometrics row, and Maestro can't tap what's below it.
 *
 * "Rating", beside "Clipboard", asks for the store's rating prompt with
 * LynxStoreReview (issue #931), which the app has because the harness sets
 * angular.json's `storeReview`. It shows "asked" once request() resolves,
 * which it does whether or not a prompt showed. On the iOS Simulator StoreKit
 * shows the prompt every time, as in any development build, so the flow sees
 * the shell's module answer. Google Play shows nothing to an app it didn't
 * install, so on Android it only resolves.
 *
 * "Apple", beside "Biometrics", shows whether LynxAppleSignIn has the native
 * sheet once the page opens (issue #932): `native` in the iOS app, which has
 * the module and its entitlement because the harness sets angular.json's
 * `signInWithApple`, and `none` on Android and in Lynx Explorer. A tap opens
 * the sheet and shows how it ended: the error's code, with "(held)" when the
 * request stayed open for 2 seconds or more. On a Simulator signed in to no
 * Apple Account that's `failed (held)` once iOS's alert closes, and
 * `unsupported` without the module.
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
    <view style="display: flex; flex-direction: row; margin-top: 8px;">
      <text flatten="false" (bindtap)="copy()"
        >Clipboard: {{ clipboard() }}</text
      >
      <text flatten="false" style="margin-left: 16px;" (bindtap)="rate()"
        >Rating: {{ rating() }}</text
      >
      <text flatten="false" style="margin-left: 16px;" (bindtap)="pickFile()"
        >Files: {{ files() }}</text
      >
    </view>
    <view style="display: flex; flex-direction: row; margin-top: 8px;">
      <text flatten="false" (bindtap)="authenticate()"
        >Biometrics: {{ biometrics() }}</text
      >
      <text
        flatten="false"
        style="margin-left: 16px;"
        (bindtap)="signInWithApple()"
        >Apple: {{ apple() }}</text
      >
    </view>
  `,
})
export class StorageRoute implements OnInit {
  readonly #local = inject(LynxLocalStorage);
  readonly #secure = inject(LynxSecureStorage);
  readonly #clipboard = inject(LynxClipboard);
  readonly #biometrics = inject(LynxBiometrics);
  readonly #files = inject(LynxFilePicker);
  readonly files = signal('tap');
  readonly biometrics = signal('…');
  readonly #storeReview = inject(LynxStoreReview);
  readonly stored = signal('…');
  readonly arraySlots = signal('tap');
  readonly clipboard = signal('tap');
  readonly rating = signal('tap');
  readonly #appleSignIn = inject(LynxAppleSignIn);
  readonly apple = signal('…');

  ngOnInit(): void {
    void this.#appleSignIn
      .isAvailable()
      .then((available) => this.apple.set(available ? 'native' : 'none'));
    void this.#biometrics
      .availability()
      .then(({ type, enrolled }) =>
        this.biometrics.set(
          `${type} ${enrolled ? 'enrolled' : 'not enrolled'}`,
        ),
      );
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

  copy(): void {
    this.clipboard.set('…');
    // Copied from the tap's handler, before anything waits, as the web
    // preview's browser asks.
    this.#clipboard
      .setString('copied by e2e')
      .then(() => this.#clipboard.getString())
      .then(
        (text) => this.clipboard.set(text),
        (error: Error) => this.clipboard.set(error.message),
      );
  }

  authenticate(): void {
    this.biometrics.set('…');
    this.#biometrics.authenticate({ reason: 'Check the E2E app' }).then(
      () => this.biometrics.set('confirmed'),
      (error: unknown) =>
        this.biometrics.set(
          error instanceof BiometricsError ? error.code : String(error),
        ),
    );
  }

  pickFile(): void {
    this.files.set('…');
    this.#files.pick().then(
      (picked) =>
        this.files.set(
          picked.length === 0
            ? 'canceled'
            : picked.map((file) => `${file.name} ${file.size}`).join(', '),
        ),
      (error: unknown) =>
        this.files.set(
          error instanceof FilePickerError ? error.code : String(error),
        ),
    );
  }

  signInWithApple(): void {
    this.apple.set('…');
    const start = Date.now();
    this.#appleSignIn.signIn({ scopes: ['email'] }).then(
      () => this.apple.set('signed in'),
      (error: unknown) => {
        const code =
          error instanceof AppleSignInError ? error.code : String(error);
        // "held" when the request stayed open for a while, as it does
        // behind iOS's alert until the flow closes it. One iOS refused at
        // once, as it refuses an app without the entitlement, shows the
        // code alone.
        this.apple.set(Date.now() - start >= 2000 ? `${code} (held)` : code);
      },
    );
  }

  rate(): void {
    this.rating.set('…');
    void this.#storeReview.request().then(() => this.rating.set('asked'));
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
