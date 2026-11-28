import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import { base64ToBytes, bytesToBase64 } from '../network/base64';
import { installBlob } from '../network/index';
import type { PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes with
 * angular.json's `filePicker` (`FilePickerModule.swift` and
 * `FilePickerModule.kt` in `packages/native/templates`).
 */
const FILE_PICKER_MODULE = 'AngularLynxFilePicker';

/**
 * The most bytes one {@link LynxFilePicker.pick} hands back, all its files
 * together, or one {@link LynxFilePicker.save} writes: 20 MiB.
 *
 * The bytes travel as base64 through JSON on each hop (the module's callback
 * to the background thread, then the relay to the main thread, where Angular
 * runs), so a file is held several times over on its way: 20 MiB is about
 * 27 MB of base64, which phones with little memory still hold. A larger file
 * is refused before it's read, rather than ending the app.
 */
export const FILE_PICKER_MAX_BYTES = 20 * 1024 * 1024;

/** What {@link LynxFilePicker.pick} sends the native module. */
type NativePickRequest = {
  readonly types: readonly string[];
  readonly multiple: boolean;
  readonly maxBytes: number;
};

/** What {@link LynxFilePicker.save} sends the native module. */
type NativeSaveRequest = {
  readonly base64: string;
  readonly name: string;
  readonly type: string;
};

/**
 * What the native module calls back with: the picked files as base64,
 * `{ canceled }` when the person closed the picker, `{ saved }` for a save,
 * or `{ error, message }`.
 */
type NativeResult = {
  readonly files?: readonly {
    readonly base64?: string;
    readonly name?: string;
    readonly type?: string;
  }[];
  readonly canceled?: boolean;
  readonly saved?: boolean;
  readonly error?: string;
  readonly message?: string;
};

/**
 * Why {@link LynxFilePicker} gave no file (a person closing the picker isn't
 * an error: `pick()` resolves with `[]` and `save()` with `false`):
 * - `unavailable`: the host has no file picker. Only the apps
 *   `ng build --platform` makes with angular.json's `"filePicker": true`,
 *   and the web preview, have one; Lynx Explorer and tests don't.
 * - `too-large`: the files picked, or the file to save, are over
 *   {@link FILE_PICKER_MAX_BYTES}.
 * - `failed`: the picker couldn't open, a picker was already open, or a file
 *   couldn't be read or written.
 */
export type FilePickerErrorCode = 'unavailable' | 'too-large' | 'failed';

/** The error a {@link LynxFilePicker} rejects with. */
export class FilePickerError extends Error {
  constructor(
    readonly code: FilePickerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FilePickerError';
  }
}

/** Which files {@link LynxFilePicker.pick} offers. */
export type FilePickerOptions = {
  /**
   * The kinds of file the person can pick, as an `<input type="file">`'s
   * `accept` lists them: MIME types (`application/pdf`, `text/csv`), a MIME
   * type's family (`image/*`) or extensions (`.docx`). Any file when it's
   * empty or left out.
   */
  readonly types?: readonly string[];
  /** Whether the person can pick more than one file. False by default. */
  readonly multiple?: boolean;
};

/** A file the person picked. */
export type PickedFile = {
  /** The file's bytes, ready to upload or to read. */
  readonly blob: Blob;
  /** Its name, such as `receipt.pdf`. */
  readonly name: string;
  /**
   * Its MIME type, such as `application/pdf`: the same as `blob.type`.
   * `application/octet-stream` when the platform doesn't know it.
   */
  readonly type: string;
  /** Its size in bytes: the same as `blob.size`. */
  readonly size: number;
};

/** What {@link LynxFilePicker.save} saves. */
export type SaveFile = {
  /** The bytes to save. Its `type` tells the platform what kind of file it is. */
  readonly blob: Blob;
  /** The name the file is offered under, such as `invoice-42.pdf`. */
  readonly name: string;
};

/** A MIME type (`text/csv`, `image/*`) or an extension (`.docx`). */
const FILE_TYPE = /^(?:[\w.+-]+\/(?:\*|[\w.+-]+)|\.[\w.+-]+)$/;

const checkTypes = (types: readonly string[]): readonly string[] => {
  if (!Array.isArray(types)) {
    throw new TypeError(
      'types must be an array of MIME types or extensions, such as ["application/pdf", ".docx"].',
    );
  }
  for (const type of types) {
    if (typeof type !== 'string' || !FILE_TYPE.test(type)) {
      throw new TypeError(
        `${JSON.stringify(type)} isn't a file type. Give a MIME type, such as application/pdf or image/*, or an extension, such as .docx.`,
      );
    }
  }
  return types;
};

const tooLarge = (what: string): FilePickerError =>
  new FilePickerError(
    'too-large',
    `${what} over ${FILE_PICKER_MAX_BYTES / 1024 / 1024} MiB, the most a file can carry across to the app.`,
  );

// ─── The web preview ─────────────────────────────────────────────────────────

/**
 * The parts of the browser the web preview uses. The runtime builds without
 * the DOM's types, since Lynx has no DOM.
 */
type WebFile = Blob & { readonly name: string };

type WebInput = {
  type: string;
  accept: string;
  multiple: boolean;
  readonly style: { display: string };
  readonly files: ArrayLike<WebFile> | null;
  click(): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
};

type WebAnchor = {
  href: string;
  download: string;
  readonly style: { display: string };
  click(): void;
  remove(): void;
};

type WebDocument = {
  readonly body: { appendChild(node: unknown): void };
  createElement(tag: 'input'): WebInput;
  createElement(tag: 'a'): WebAnchor;
};

type WebWindow = {
  readonly document: WebDocument;
  readonly URL: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  setTimeout(handler: () => void, timeout: number): unknown;
};

/**
 * The window of the page showing the app in Lynx for Web, or undefined
 * elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in a hidden iframe of
 * the page's origin, sandboxed without downloads, and the browser opens a
 * file dialog only for the document the person just tapped in. So the input
 * and the download go through the page that holds the `<lynx-view>`.
 * Elsewhere it's left alone even where a window exists, such as in unit
 * tests under jsdom, which stand in for a native host.
 */
const pageWindow = (): WebWindow | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  const own = globalThis as unknown as { parent?: WebWindow };
  try {
    // Reading a property of a parent of another origin throws.
    if (own.parent && typeof own.parent.document === 'object') {
      return own.parent;
    }
  } catch {
    // The page is of another origin: use the iframe itself.
  }
  return own as unknown as WebWindow;
};

/**
 * Ends the web preview's open picker, if any, with no files. A browser that
 * doesn't fire `cancel` never says the person closed its dialog, so the next
 * pick ends the last one instead of waiting behind it.
 */
let endOpenWebPick: (() => void) | undefined;

/**
 * The web preview's picker: an `<input type="file">` with the types as its
 * `accept`, opened from the person's tap.
 */
const pickOnWeb = (
  page: WebWindow,
  types: readonly string[],
  multiple: boolean,
): Promise<readonly PickedFile[]> =>
  new Promise((resolve, reject) => {
    const input = page.document.createElement('input');
    input.type = 'file';
    input.accept = types.join(',');
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const settle = (outcome: () => readonly PickedFile[]): void => {
      if (settled) return;
      settled = true;
      // A pick that started since has already ended this one, so the open
      // pick is this one.
      endOpenWebPick = undefined;
      input.remove();
      try {
        resolve(outcome());
      } catch (error) {
        reject(error);
      }
    };
    const cancel = (): void => settle(() => []);
    endOpenWebPick?.();
    endOpenWebPick = cancel;
    // Browsers fire `cancel` when the person closes the dialog without
    // choosing, and `change` once they've chosen.
    input.addEventListener('cancel', cancel);
    input.addEventListener('change', () =>
      settle(() => {
        const files = Array.from(input.files ?? []);
        const total = files.reduce((sum, file) => sum + file.size, 0);
        if (total > FILE_PICKER_MAX_BYTES) {
          throw tooLarge('The files picked are');
        }
        // The input lives in the page's document, so its Files belong to the
        // page's realm, and Angular's realm, the iframe, wouldn't see them
        // as Blobs: `instanceof Blob`, which upload libraries check, would
        // be false. A Blob of this realm holds the same bytes.
        return files.map((file) => {
          const type = file.type || 'application/octet-stream';
          return {
            blob: new Blob([file], { type }),
            name: file.name,
            type,
            size: file.size,
          };
        });
      }),
    );
    page.document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      settle(() => {
        throw new FilePickerError(
          'failed',
          `The file dialog couldn't open: ${(error as Error).message}`,
        );
      });
    }
  });

/**
 * How long a download's object URL is kept: long enough for the browser to
 * start saving the file, which it does after the click returns.
 */
const DOWNLOAD_URL_LIFETIME = 40_000;

/**
 * Saves in the web preview as a download, which is where a web app's export
 * goes. The browser doesn't say whether the person kept it, so it's true.
 */
const saveOnWeb = (page: WebWindow, { blob, name }: SaveFile): boolean => {
  const anchor = page.document.createElement('a');
  const url = page.URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  page.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  page.setTimeout(() => page.URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
  return true;
};

// ─── The shells ──────────────────────────────────────────────────────────────

/**
 * Lets the person pick documents from the phone (a PDF, a spreadsheet, a
 * CSV), and save a file the app made (an exported invoice, a report) where
 * they choose, as a web app does with `<input type="file">` and a download.
 * Lynx has neither, and `LynxImagePicker` offers only photos.
 *
 * - **iOS:** `UIDocumentPickerViewController`, which shows the Files app's
 *   places (iCloud Drive, On My iPhone, and other apps' file providers),
 *   opening a copy of each file picked, and exporting a copy of the one
 *   saved.
 * - **Android:** the system's document picker (`ACTION_OPEN_DOCUMENT`) and
 *   its save screen (`ACTION_CREATE_DOCUMENT`): Downloads, Drive and other
 *   apps' document providers.
 * - **Web preview:** an `<input type="file">`, and a download.
 *
 * Neither platform asks for a permission: the person picks each file or
 * place, and the app reads or writes only that. A pick or a save carries at
 * most {@link FILE_PICKER_MAX_BYTES} (20 MiB); more rejects with
 * `too-large`.
 *
 * The native module is in an app only when angular.json's build options set
 * `"filePicker": true`. Without it, and in Lynx Explorer, `pick()` and
 * `save()` reject with `unavailable`. On iOS, `"fileSharing": true` also
 * gives the app its own folder in the Files app's On My iPhone, which the
 * pickers show too. In specs, the testing library's `setPickedFiles()`,
 * `setFilePickerCanceled()` and `savedFiles()` stand in for the person.
 *
 * @usageNotes
 * ```typescript
 * const files = inject(LynxFilePicker);
 *
 * const [receipt] = await files.pick({ types: ['application/pdf', 'image/*'] });
 * if (receipt) {
 *   await uploadBytes(storageRef, receipt.blob, { contentType: receipt.type });
 * }
 *
 * const csv = new Blob([rows.join('\n')], { type: 'text/csv' });
 * const saved = await files.save({ blob: csv, name: 'report.csv' });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxFilePicker {
  /**
   * Lets the person pick a file, or several with `multiple`. Resolves with
   * the files picked, or with `[]` when they close the picker without
   * choosing. Rejects with a {@link FilePickerError}.
   */
  async pick(options: FilePickerOptions = {}): Promise<readonly PickedFile[]> {
    const types = checkTypes(options.types ?? []);
    const multiple = options.multiple === true;
    const page = pageWindow();
    if (page) return pickOnWeb(page, types, multiple);
    // The shells answer a second pick while one is open with an error.
    const result = await this.#call('pick', {
      types,
      multiple,
      maxBytes: FILE_PICKER_MAX_BYTES,
    } satisfies NativePickRequest);
    if (result?.canceled) return [];
    if (result?.error === 'too-large') {
      throw tooLarge('The files picked are');
    }
    const files = result?.files;
    if (
      !Array.isArray(files) ||
      files.some(
        (file) =>
          typeof file?.base64 !== 'string' || typeof file.name !== 'string',
      )
    ) {
      throw new FilePickerError(
        'failed',
        result?.message ?? "The picked files couldn't be read.",
      );
    }
    // Not every app's main thread has a Blob (network/enable.ts), and an app
    // that picks files needn't name it, so the picker brings it. It's only
    // installed where it's missing.
    installBlob(globalThis as unknown as Record<string, unknown>);
    return files.map(({ base64, name, type }) => {
      const mime = type || 'application/octet-stream';
      const blob = new Blob([base64ToBytes(base64!)], { type: mime });
      return { blob, name: name!, type: mime, size: blob.size };
    });
  }

  /**
   * Lets the person choose where to save `file`, under its name (which they
   * can change). Resolves with true once it's written, or false when they
   * close the screen without saving. Rejects with a {@link FilePickerError}.
   */
  async save(file: SaveFile): Promise<boolean> {
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.blob?.arrayBuffer !== 'function' ||
      typeof file.name !== 'string' ||
      file.name === ''
    ) {
      throw new TypeError(
        "save() needs { blob, name }, with a Blob and the file's name, such as invoice.pdf.",
      );
    }
    if (file.blob.size > FILE_PICKER_MAX_BYTES) {
      throw tooLarge('The file to save is');
    }
    const page = pageWindow();
    if (page) return saveOnWeb(page, file);
    const result = await this.#call('save', {
      // The file crosses to the background thread and on to the module as
      // JSON, so its bytes go as base64.
      base64: bytesToBase64(new Uint8Array(await file.blob.arrayBuffer())),
      name: file.name,
      type: file.blob.type || 'application/octet-stream',
    } satisfies NativeSaveRequest);
    if (result?.saved === true) return true;
    if (result?.canceled || result?.saved === false) return false;
    throw new FilePickerError(
      'failed',
      result?.message ?? "The file couldn't be saved.",
    );
  }

  async #call(
    method: 'pick' | 'save',
    request: NativePickRequest | NativeSaveRequest,
  ): Promise<NativeResult | undefined> {
    try {
      // The module calls back on the background thread, where NativeModules
      // lives; callNativeModuleAsync keeps the callback there, so nothing
      // stays registered on either thread once it answers.
      return (await callOnBackground(
        'callNativeModuleAsync',
        FILE_PICKER_MODULE,
        method,
        [request],
      )) as NativeResult | undefined;
    } catch {
      throw new FilePickerError(
        'unavailable',
        'This host has no file picker. Only the apps `ng build --platform` makes with "filePicker": true in angular.json, and the web preview, have one.',
      );
    }
  }
}
