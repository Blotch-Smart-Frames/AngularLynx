import { inject, Injectable, Injector } from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxSystemInfo, type PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes
 * (`ClipboardModule.swift` and `ClipboardModule.kt` in
 * `packages/native/templates`).
 */
const CLIPBOARD_MODULE = 'AngularLynxClipboard';

/**
 * What the shells' clipboard module calls back with: `{ value }` for the
 * text read, `{}` once it has copied, or `{ error }`.
 */
type NativeResult = { readonly value?: string; readonly error?: string };

/**
 * The part of the browser's Clipboard API this uses. The runtime builds
 * without the DOM's types, since Lynx has no DOM.
 */
type BrowserClipboard = {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
};

/** The parts of a browser window the web preview's copy uses. */
type BrowserWindow = {
  readonly navigator: { readonly clipboard?: BrowserClipboard };
  readonly document: BrowserDocument;
};

type BrowserElement = {
  value: string;
  readonly style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  select(): void;
  focus?(): void;
  remove(): void;
};

type BrowserDocument = {
  readonly body: { appendChild(element: BrowserElement): void };
  readonly activeElement: { focus?(): void } | null;
  createElement(tag: 'textarea'): BrowserElement;
  execCommand(command: 'copy'): boolean;
};

/**
 * Why the clipboard couldn't be used:
 * - `unavailable`: the host has no clipboard to reach. Only the apps that
 *   `ng build --platform` makes, the web preview and the testing library
 *   have one; Lynx Explorer doesn't.
 * - `failed`: the platform refused, such as a browser that blocked the copy.
 */
export type ClipboardErrorCode = 'unavailable' | 'failed';

/** The error a {@link LynxClipboard} rejects with. */
export class ClipboardError extends Error {
  constructor(
    readonly code: ClipboardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClipboardError';
  }
}

/**
 * The page's window in Lynx for Web, or undefined elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in a hidden iframe of
 * the page's origin. That iframe's document never has focus, and Chrome
 * refuses the Clipboard API to a document without it ("Document is not
 * focused"), so the copy goes through the page that holds the `<lynx-view>`,
 * which has focus while someone taps in it. Elsewhere it's left alone, such
 * as in unit tests under jsdom, which stand in for a native host.
 */
const pageWindow = (): BrowserWindow | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  const self = globalThis as unknown as { parent?: BrowserWindow };
  return self.parent ?? (self as unknown as BrowserWindow);
};

/**
 * Copies with `document.execCommand('copy')`, the way pages copied before
 * the Clipboard API: from a hidden textarea's selection. Browsers keep it for
 * pages the Clipboard API isn't open to, such as one served over plain HTTP
 * from another machine, as `ng serve --host` is when a phone opens it.
 *
 * @returns Whether the browser copied.
 */
const copyWithSelection = (page: BrowserWindow, text: string): boolean => {
  const { document } = page;
  const focused = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  // Kept out of sight and out of the layout, and read-only so a phone
  // doesn't raise its keyboard for it.
  field.setAttribute('readonly', '');
  field.style['position'] = 'fixed';
  field.style['opacity'] = '0';
  field.style['pointerEvents'] = 'none';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    // Some browsers throw rather than returning false.
  }
  field.remove();
  focused?.focus?.();
  return copied;
};

/**
 * Copies `text` in the web preview: with the Clipboard API, or where the
 * page has none, from a selection.
 *
 * Safari copies only while the tap that asked for it is being handled, so
 * this calls the browser before anything waits.
 */
const copyInBrowser = async (
  page: BrowserWindow,
  text: string,
): Promise<void> => {
  /**
   * The browser's errors come from the page's realm, not this iframe's, so
   * they aren't instances of this realm's Error: their message is read as
   * is.
   */
  const refused = (reason?: { message?: unknown }) =>
    new ClipboardError(
      'failed',
      typeof reason?.message === 'string'
        ? `The browser didn't let the page copy: ${reason.message}`
        : "The browser didn't let the page copy.",
    );
  const clipboard = page.navigator.clipboard;
  if (!clipboard) {
    if (!copyWithSelection(page, text)) throw refused();
    return;
  }
  try {
    await clipboard.writeText(text);
  } catch (error) {
    // Refused, such as by a browser that wants a tap the call no longer
    // follows. The older way still works in some of those.
    if (!copyWithSelection(page, text)) {
      throw refused(error as { message?: unknown });
    }
  }
};

/**
 * Reads the clipboard in the web preview. A browser asks the person first,
 * and a refusal reads as an empty clipboard, as it does on iOS.
 */
const readInBrowser = async (page: BrowserWindow): Promise<string> => {
  try {
    return (await page.navigator.clipboard?.readText()) ?? '';
  } catch {
    return '';
  }
};

/**
 * Calls the shells' clipboard module, which answers through a callback on
 * the background thread, where `NativeModules` lives (see
 * callNativeModuleAsync in background-call.ts).
 */
const callModule = async (method: string, args: string[]): Promise<string> => {
  let result: NativeResult | undefined;
  try {
    result = (await callOnBackground(
      'callNativeModuleAsync',
      CLIPBOARD_MODULE,
      method,
      args,
    )) as NativeResult | undefined;
  } catch {
    throw new ClipboardError(
      'unavailable',
      'This host has no clipboard. Only the apps `ng build --platform` makes, the web preview and the testing library have one.',
    );
  }
  if (result?.error !== undefined) {
    throw new ClipboardError('failed', result.error);
  }
  return result?.value ?? '';
};

/**
 * Whether this runs under the testing library, whose environment keeps
 * itself in the `lynxTestingEnv` global (see background-call.ts).
 */
const inTestingEnvironment = (): boolean =>
  (globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv !== undefined;

/**
 * Copies text to the system clipboard and reads it back, as
 * `navigator.clipboard.writeText()` and `readText()` do in a browser, which
 * Lynx doesn't have.
 *
 * - **iOS:** `UIPasteboard.general`. Reading text another app copied makes
 *   iOS 16 and later ask the person whether to allow the paste, so read it
 *   only when they ask to paste, never on launch.
 * - **Android:** `ClipboardManager`. Android 13 and later show that text was
 *   copied themselves (see {@link confirmsCopies}), and Android 12 and later
 *   tell the person when the app reads the clipboard.
 * - **Web:** the page's Clipboard API, which the browser may ask about
 *   before a read, or where the page has none, `execCommand('copy')`.
 * - **Testing library:** a clipboard in memory, so a spec can read back what
 *   was copied. Each app the spec renders has its own.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxClipboard`. Elsewhere, such as Lynx Explorer, both methods
 * reject with a {@link ClipboardError} whose code is `unavailable`.
 *
 * @usageNotes
 * ```typescript
 * const clipboard = inject(LynxClipboard);
 *
 * await clipboard.setString(inviteLink);
 * const pasted = await clipboard.getString();
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxClipboard {
  readonly #injector = inject(Injector);
  /** The clipboard under the testing library. */
  #memory = '';

  /**
   * Puts `text` on the clipboard, in place of what it held. Resolves once
   * it's there, and rejects with a {@link ClipboardError}.
   *
   * In the web preview, call it from the tap's handler, before anything
   * waits: browsers copy only for something the person did.
   */
  setString(text: string): Promise<void> {
    const page = pageWindow();
    if (page) return copyInBrowser(page, String(text));
    if (inTestingEnvironment()) {
      this.#memory = String(text);
      return Promise.resolve();
    }
    return callModule('setString', [String(text)]).then(() => undefined);
  }

  /**
   * Resolves with the clipboard's text, or `''` when it holds none, or holds
   * something other than text, such as an image. Rejects with a
   * {@link ClipboardError} where there's no clipboard.
   *
   * iOS 16 and later ask the person before the app reads text another app
   * copied, and a refusal reads as `''`, as it does where a browser asks.
   */
  getString(): Promise<string> {
    const page = pageWindow();
    if (page) return readInBrowser(page);
    if (inTestingEnvironment()) return Promise.resolve(this.#memory);
    return callModule('getString', []);
  }

  /**
   * Whether the platform shows that text was copied, so the app needn't:
   * Android 13 and later show the text in a panel at the bottom of the
   * screen and have TalkBack say "Text copied" themselves. Android asks apps
   * not to confirm the copy again, which doubles the message.
   *
   * It's false elsewhere, and where the OS version isn't known yet: the
   * apps `ng build --platform` makes send it, so they know it from the
   * start.
   */
  get confirmsCopies(): boolean {
    let info: LynxSystemInfo;
    try {
      info = this.#injector.get(LynxSystemInfo);
    } catch {
      // No SystemInfo to read, as in a unit test without Lynx's globals.
      return false;
    }
    return (
      info.platform === 'Android' && Number.parseInt(info.osVersion, 10) >= 13
    );
  }
}
