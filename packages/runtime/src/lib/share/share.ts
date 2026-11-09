import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import { bytesToBase64 } from '../network/base64';
import type { PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes
 * (`ShareModule.swift` and `ShareModule.kt` in `packages/native/templates`).
 */
const SHARE_MODULE = 'AngularLynxShare';

/** A file as {@link LynxShare.share} sends it to the native module. */
type NativeFile = {
  readonly base64: string;
  readonly name: string;
  readonly type: string;
};

/** What {@link LynxShare.share} sends the native module. */
type NativeRequest = {
  readonly files: readonly NativeFile[];
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
};

/**
 * What the native module calls back with: `{ shared }`, whether the person
 * shared or closed the sheet, or `{ error, message }`.
 */
type NativeResult = {
  readonly shared?: boolean;
  readonly error?: string;
  readonly message?: string;
};

/**
 * Why {@link LynxShare.share} didn't share (a person closing the share sheet
 * isn't an error: it resolves `false`):
 * - `unavailable`: the host has no share sheet. Only the apps
 *   `ng build --platform` makes, and the web preview, have one; Lynx
 *   Explorer and tests don't. A browser without the Web Share API can share
 *   files, by downloading them, but not text or links on their own.
 * - `failed`: the sheet couldn't open, a share sheet was already open, a
 *   file couldn't be written for it, or the browser refused, such as when
 *   the share didn't follow a tap.
 */
export type ShareErrorCode = 'unavailable' | 'failed';

/** The error a {@link LynxShare} rejects with. */
export class ShareError extends Error {
  constructor(
    readonly code: ShareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

/**
 * A file to share: its bytes and the name the person sees, which also gives
 * the receiving app its type when the Blob has none.
 *
 * The Web Share API takes `File`s, but Lynx has no `File` class: a Blob has
 * no name there. So a file is a Blob with a name beside it, the shape
 * `LynxImagePicker` picks an image as (its `type` is ignored here, as
 * the Blob has it), and so a picked photo can be shared as it is. Where
 * there is a `File`, as in the web preview, a `File` works too.
 */
export type ShareFile =
  | { readonly blob: Blob; readonly name: string }
  | (Blob & { readonly name: string });

/** What {@link LynxShare.share} shares, as the Web Share API's `ShareData`. */
export type ShareData = {
  /** Files, such as a photo the app made. */
  readonly files?: readonly ShareFile[];
  /**
   * A title: the subject of an email, and the heading of the share sheet's
   * preview, where the platform shows one.
   */
  readonly title?: string;
  /** Text, such as a message to go with a link. */
  readonly text?: string;
  /** An absolute URL, such as `https://example.com/post/42`. */
  readonly url?: string;
};

/** `https:`, `mailto:`, `myapp:`: a URL starts with its scheme. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A file's bytes, name and type, read from either shape of {@link ShareFile}. */
type ResolvedFile = { readonly blob: Blob; readonly name: string };

/**
 * Checks what's shared as the Web Share API does: there must be something,
 * each file needs a name, and the URL must be absolute, since a relative one
 * has no page to be relative to on Lynx.
 */
const validate = (data: ShareData): ResolvedFile[] => {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError('share() needs files, a title, text or a URL.');
  }
  const files = (data.files ?? []).map((file, index): ResolvedFile => {
    const resolved =
      typeof file === 'object' && file !== null && 'blob' in file
        ? { blob: file.blob, name: file.name }
        : { blob: file as Blob, name: (file as { name?: string })?.name };
    if (
      typeof resolved.blob?.arrayBuffer !== 'function' ||
      typeof resolved.name !== 'string' ||
      resolved.name === ''
    ) {
      throw new TypeError(
        `files[${index}] isn't a file: give { blob, name }, with a Blob and the file's name, such as photo.jpg.`,
      );
    }
    return resolved as ResolvedFile;
  });
  if (
    files.length === 0 &&
    data.title === undefined &&
    data.text === undefined &&
    data.url === undefined
  ) {
    throw new TypeError('share() needs files, a title, text or a URL.');
  }
  if (data.url !== undefined && !SCHEME.test(data.url)) {
    throw new TypeError(
      `"${data.url}" is not an absolute URL. Give one with its scheme, such as https://example.com.`,
    );
  }
  return files;
};

// ─── The web preview ─────────────────────────────────────────────────────────

/**
 * The parts of the browser this uses. The runtime builds without the DOM's
 * types, since Lynx has no DOM.
 */
type BrowserAnchor = {
  href: string;
  download: string;
  readonly style: { display: string };
  click(): void;
  remove(): void;
};

type BrowserWindow = {
  readonly navigator: {
    share?(data: Record<string, unknown>): Promise<void>;
    canShare?(data: Record<string, unknown>): boolean;
  };
  readonly document: {
    readonly body: { appendChild(node: unknown): void };
    createElement(tag: 'a'): BrowserAnchor;
  };
  readonly File: new (
    parts: unknown[],
    name: string,
    options: { type: string },
  ) => unknown;
  readonly URL: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  setTimeout(handler: () => void, timeout: number): unknown;
};

/**
 * The page's window in Lynx for Web, or undefined elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in a hidden iframe of
 * the page's origin, sandboxed without downloads, and the Web Share API
 * opens only in a frame its permissions policy allows. So the share, or the
 * download, goes through the page that holds the `<lynx-view>`, where the
 * person tapped. Elsewhere it's left alone even where a window exists, such
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
  const own = globalThis as unknown as { parent?: BrowserWindow };
  try {
    // Reading a property of a parent of another origin throws.
    if (own.parent && typeof own.parent.document === 'object') {
      return own.parent;
    }
  } catch {
    // The page is of another origin: share from the iframe itself.
  }
  return own as unknown as BrowserWindow;
};

/**
 * How long a download's object URL is kept: long enough for the browser to
 * start saving the file, which it does after the click returns.
 */
const DOWNLOAD_URL_LIFETIME = 40_000;

/**
 * Saves each file as a download, for a browser that can't share files, such
 * as Firefox on a computer: the next best thing to "Save Image".
 */
const download = (page: BrowserWindow, files: readonly unknown[]): void => {
  for (const file of files) {
    const anchor = page.document.createElement('a');
    const url = page.URL.createObjectURL(file);
    anchor.href = url;
    anchor.download = (file as { name: string }).name;
    anchor.style.display = 'none';
    page.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    page.setTimeout(() => page.URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
  }
};

/**
 * Shares in the web preview, with the page's Web Share API, or, for files a
 * browser can't share, by downloading them.
 *
 * Browsers share only while the tap that asked for it counts as recent, and
 * Safari only before anything waits, so the share starts before this awaits
 * anything: the files are made synchronously, as the page's own `File`s,
 * since the share sheet reads them in the page.
 */
const shareInBrowser = async (
  page: BrowserWindow,
  data: ShareData,
  resolved: readonly ResolvedFile[],
): Promise<boolean> => {
  const files = resolved.map(
    ({ blob, name }) => new page.File([blob], name, { type: blob.type }),
  );
  const shareData: Record<string, unknown> = {};
  if (files.length > 0) shareData['files'] = files;
  if (data.title !== undefined) shareData['title'] = data.title;
  if (data.text !== undefined) shareData['text'] = data.text;
  if (data.url !== undefined) shareData['url'] = data.url;
  const { navigator } = page;
  const canShare =
    typeof navigator.share === 'function' &&
    (navigator.canShare?.(shareData) ?? files.length === 0);
  if (!canShare) {
    if (files.length === 0) {
      throw new ShareError(
        'unavailable',
        "This browser can't share. Without a share sheet, only files can be shared, by downloading them.",
      );
    }
    download(page, files);
    return true;
  }
  try {
    await navigator.share!(shareData);
    return true;
  } catch (error) {
    // The browser's errors come from the page's realm, not this iframe's,
    // so they're read by name rather than with instanceof.
    const { name, message } = (error ?? {}) as {
      name?: unknown;
      message?: unknown;
    };
    // The person closed the share sheet.
    if (name === 'AbortError') return false;
    throw new ShareError(
      'failed',
      typeof message === 'string'
        ? `The browser didn't share: ${message}`
        : "The browser didn't share.",
    );
  }
};

// ─── The shells ──────────────────────────────────────────────────────────────

/**
 * Opens the system share sheet, as the Web Share API's `navigator.share()`
 * does in a browser, which Lynx doesn't have: to send a photo the app made
 * to another app, save it to the photo library, or AirDrop it.
 *
 * - **iOS:** `UIActivityViewController`, with each file written to a
 *   temporary file of its name, so "Save Image", "Save to Files" and AirDrop
 *   get a real file name and type. "Save Image" needs the app's photo
 *   library add permission, whose reason the apps `ng build --platform`
 *   makes have (`savePhotos` in angular.json's `permissions` changes it).
 * - **Android:** an `ACTION_SEND` (or `ACTION_SEND_MULTIPLE`) chooser, with
 *   the files shared through the app's `FileProvider`.
 * - **Web preview:** the page's `navigator.share()`, or, in a browser that
 *   can't share the files, a download of each.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxShare`. Elsewhere, such as in Lynx Explorer and under the
 * testing library, `share()` rejects with `unavailable`. In specs, provide a
 * stand-in (see the usage notes).
 *
 * @usageNotes
 * ```typescript
 * const sharing = inject(LynxShare);
 *
 * canvas.toBlob(async (blob) => {
 *   if (!blob) return;
 *   const shared = await sharing.share({
 *     files: [{ blob, name: 'photo.jpg' }],
 *     title: 'My photo',
 *   });
 * }, 'image/jpeg', 0.9);
 * ```
 *
 * In a spec, provide a stand-in that records what was shared:
 *
 * ```typescript
 * const shared: ShareData[] = [];
 * await render(ExportButton, {
 *   providers: [
 *     {
 *       provide: LynxShare,
 *       useValue: {
 *         share: async (data: ShareData) => {
 *           shared.push(data);
 *           return true;
 *         },
 *       },
 *     },
 *   ],
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxShare {
  /**
   * Opens the share sheet with `data`. Resolves `true` once the person has
   * shared, and `false` when they close the sheet without sharing. Rejects
   * with a `TypeError` when there's nothing to share, a file has no name or
   * the URL isn't absolute, and with a {@link ShareError} when the sheet
   * can't open.
   *
   * Android doesn't say whether the person finished sharing in the app they
   * picked, so there it resolves `true` as soon as they pick an app, and
   * `false` when they close the sheet without picking one. On the web, a
   * browser that can't share the files downloads them and resolves `true`.
   *
   * In the web preview, call it from the tap's handler, with the files
   * ready: browsers share only for something the person just did.
   */
  share(data: ShareData): Promise<boolean> {
    let files: ResolvedFile[];
    try {
      files = validate(data);
      const page = pageWindow();
      if (page) return shareInBrowser(page, data, files);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#shareNatively(data, files);
  }

  async #shareNatively(
    data: ShareData,
    files: readonly ResolvedFile[],
  ): Promise<boolean> {
    // The files cross to the background thread, where NativeModules lives,
    // and on to the module as JSON, so their bytes go as base64.
    const request: NativeRequest = {
      files: await Promise.all(
        files.map(async ({ blob, name }) => ({
          base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
          name,
          type: blob.type,
        })),
      ),
      ...(data.title !== undefined && { title: String(data.title) }),
      ...(data.text !== undefined && { text: String(data.text) }),
      ...(data.url !== undefined && { url: data.url }),
    };
    let result: NativeResult | undefined;
    try {
      // callNativeModuleAsync keeps the module's callback on the background
      // thread, so nothing stays registered on either thread once it
      // answers.
      result = (await callOnBackground(
        'callNativeModuleAsync',
        SHARE_MODULE,
        'share',
        [request],
      )) as NativeResult | undefined;
    } catch {
      throw new ShareError(
        'unavailable',
        'This host has no share sheet. Only the apps `ng build --platform` makes, and the web preview, have one.',
      );
    }
    if (result?.error !== undefined || typeof result?.shared !== 'boolean') {
      throw new ShareError(
        'failed',
        result?.message ?? "The share sheet couldn't open.",
      );
    }
    return result.shared;
  }
}
