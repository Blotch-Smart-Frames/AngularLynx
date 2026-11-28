import {
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  type Injector,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxNativeModule } from '../native-module/native-module';
import { base64ToBytes } from '../network/base64';
import { installBlob } from '../network/index';

/**
 * The native module and global event of the apps `ng build --platform`
 * makes with angular.json's `shareTarget` (`ShareTargetModule.swift` and
 * `ShareTargetModule.kt` in `packages/native/templates`).
 */
const SHARE_TARGET_MODULE = 'AngularLynxShareTarget';
const SHARE_EVENT = 'angularLynxShare';

/**
 * A file shared to the app: its bytes, with its name and type, the shape
 * `LynxFilePicker` picks a file as. It's a `ShareFile`, so it can be
 * shared on with `LynxShare` as it is.
 */
export type ReceivedShareFile = {
  readonly blob: Blob;
  /** The name the sharing app gave it, such as `IMG_0042.jpg`. */
  readonly name: string;
  /** Its MIME type, such as `image/jpeg`. */
  readonly type: string;
  /** Its size in bytes. */
  readonly size: number;
};

/**
 * What the person shared to the app from another app's share sheet. It's a
 * `ShareData`, the shape `LynxShare` shares, with what the sharing app
 * gave of it:
 *
 * - `text`, for shared text, such as a selection or a note.
 * - `url`, for a shared link, such as a page from the browser. On Android a
 *   link comes as text: a share whose text is one link has it here instead.
 * - `title`: the share's subject, such as the page's title, where the
 *   sharing app gives one.
 * - `files`, such as photos, each of a type `shareTarget.mimeTypes` lists.
 */
export type ReceivedShare = {
  readonly files: readonly ReceivedShareFile[];
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
};

/** What a handler registered with {@link LynxShareTarget.onShare} is called with. */
export type ShareTargetHandler = (share: ReceivedShare) => void;

/** What the shells' `take` calls back with. */
type TakeResult = {
  readonly shares?: readonly {
    readonly title?: unknown;
    readonly text?: unknown;
    readonly url?: unknown;
    readonly files?: readonly {
      readonly base64?: unknown;
      readonly name?: unknown;
      readonly type?: unknown;
    }[];
  }[];
};

type GlobalEventEmitter = {
  addListener(name: string, listener: () => void): unknown;
};

/**
 * The DestroyRef of whatever is being constructed, or null outside an
 * injection context. Angular has no public check for one, and `inject()`
 * throws outside it.
 */
const currentDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

/**
 * Receives what the person shares to the app from another app's share
 * sheet: text, a link or files, such as photos. `LynxShare` is the other
 * direction, sending from the app.
 *
 * angular.json's `shareTarget` puts the app in the share sheets, for the
 * MIME types it lists:
 *
 * - **iOS:** a Share Extension, which iOS runs when the person picks the
 *   app. It can't run the Angular app, so it copies the share to an App
 *   Group the app shares with it, opens the app, and closes; the share then
 *   arrives here. App Groups need a team in the paid Apple Developer
 *   Program.
 * - **Android:** `ACTION_SEND` and `ACTION_SEND_MULTIPLE` intent filters,
 *   which open the app with the share.
 *
 * Either way a share may start the app: it waits for the first handler, so
 * register one from a service or component that's created as the app
 * starts. All of a share's files together are at most 20 MiB: one that
 * doesn't fit is left out.
 *
 * Only the apps `ng build --platform` and `ng serve --platform` make with
 * `shareTarget` receive shares. In Lynx Explorer, on the web and in an app
 * without it, none ever arrives. Under the testing library, `receiveShare()`
 * shares to the app.
 *
 * @usageNotes
 * ```json
 * "shareTarget": { "mimeTypes": ["text/plain", "text/uri-list", "image/*"] }
 * ```
 *
 * ```typescript
 * export class Inbox {
 *   readonly #notes = inject(Notes);
 *
 *   constructor() {
 *     inject(LynxShareTarget).onShare(({ text, url, files }) => {
 *       this.#notes.add({ text: [text, url].filter(Boolean).join('\n'), files });
 *     });
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxShareTarget {
  readonly #handlers = new Set<ShareTargetHandler>();
  /** The shares that arrived before any handler was registered. */
  #unhandled: ReceivedShare[] = [];
  readonly #errorHandler = inject(ErrorHandler);

  constructor() {
    // The shell keeps each share until it's taken, and sends the event when
    // one arrives. Listening before the first take means none is missed:
    // one that arrives in between is taken by whichever call comes next, and
    // one from before the app started, such as the share that launched it,
    // by the first.
    //
    // On the main thread, where Angular runs, the emitter is a proxy whose
    // calls go through the background thread and return promises.
    const emitter =
      inject(LynxNativeModule).getJSModule<GlobalEventEmitter>(
        'GlobalEventEmitter',
      );
    void Promise.resolve()
      .then(() => emitter?.addListener(SHARE_EVENT, () => void this.#take()))
      .catch(() => {
        // Without a background thread there are no global events to hear.
      })
      .then(() => this.#take());
  }

  /**
   * Calls `handler` with each share the person sends the app.
   *
   * A share that arrived before any handler was registered, such as the one
   * that started the app, goes to the first handler registered, once the
   * code registering it has finished.
   *
   * Called from an injection context, such as a constructor, the handler is
   * removed when the component or service is destroyed; pass an `injector`
   * to tie it to another one. The function it returns removes it sooner.
   *
   * @param handler - Called with each share.
   * @returns A function that removes the handler.
   */
  onShare(
    handler: ShareTargetHandler,
    options?: { readonly injector?: Injector },
  ): () => void {
    const handlers = this.#handlers;
    handlers.add(handler);
    const drop = () => {
      handlers.delete(handler);
    };
    const unregister = (
      options?.injector?.get(DestroyRef) ?? currentDestroyRef()
    )?.onDestroy(drop);
    /**
     * Removed by hand, the handler also leaves the DestroyRef, which would
     * otherwise keep it, and what it holds, until a long-lived injector
     * goes. Angular's unregister ignores a callback that's already gone, so
     * removing twice is harmless.
     */
    const remove = () => {
      unregister?.();
      drop();
    };

    const unhandled = this.#unhandled;
    if (unhandled.length > 0) {
      this.#unhandled = [];
      // After the caller has finished: a constructor that registers its
      // handler first hasn't yet set the fields the handler reads.
      queueMicrotask(() => {
        for (const share of unhandled) {
          if (handlers.has(handler)) this.#call(handler, share);
        }
      });
    }
    return remove;
  }

  /**
   * Asks the shell for the shares that arrived since the last time.
   */
  async #take(): Promise<void> {
    let result: TakeResult | undefined;
    try {
      // The module answers through a callback on the background thread,
      // where `NativeModules` lives (see callNativeModuleAsync in
      // background-call.ts).
      result = (await callOnBackground(
        'callNativeModuleAsync',
        SHARE_TARGET_MODULE,
        'take',
        [],
      )) as TakeResult | undefined;
    } catch {
      // A host without the module, such as Lynx Explorer, the web, or an
      // app without `shareTarget`, receives no shares.
      return;
    }
    const shares = Array.isArray(result?.shares) ? result.shares : [];
    if (shares.length === 0) return;
    // Not every app's main thread has a Blob (network/enable.ts), and an app
    // that receives files needn't name it, so this brings it. It's only
    // installed where it's missing.
    installBlob(globalThis as unknown as Record<string, unknown>);
    for (const share of shares) {
      this.#deliver(toShare(share));
    }
  }

  #deliver(share: ReceivedShare): void {
    if (this.#handlers.size === 0) {
      this.#unhandled.push(share);
      return;
    }
    // A handler may remove itself as it's called: a Set skips what was
    // removed and carries on.
    for (const handler of this.#handlers) {
      this.#call(handler, share);
    }
  }

  /**
   * One handler's error mustn't keep the share from the others.
   */
  #call(handler: ShareTargetHandler, share: ReceivedShare): void {
    try {
      handler(share);
    } catch (error) {
      this.#errorHandler.handleError(error);
    }
  }
}

/**
 * A share as the shells send it, with its files' base64 turned into Blobs.
 * Anything of the wrong type is left out rather than handed to the app.
 */
const toShare = (
  share: NonNullable<TakeResult['shares']>[number],
): ReceivedShare => {
  const files = (Array.isArray(share?.files) ? share.files : []).flatMap(
    (file): ReceivedShareFile[] => {
      if (typeof file?.base64 !== 'string' || typeof file.name !== 'string') {
        return [];
      }
      const type =
        typeof file.type === 'string' && file.type !== ''
          ? file.type
          : 'application/octet-stream';
      const blob = new Blob([base64ToBytes(file.base64)], { type });
      return [{ blob, name: file.name, type, size: blob.size }];
    },
  );
  return {
    files,
    ...(typeof share?.title === 'string' && { title: share.title }),
    ...(typeof share?.text === 'string' && { text: share.text }),
    ...(typeof share?.url === 'string' && { url: share.url }),
  };
};
