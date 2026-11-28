import { Injectable, type Signal, signal } from '@angular/core';
import { callOnBackground } from '../background-call';
import { bytesToBase64 } from '../network/base64';
import { download, pageWindow } from '../share/share';

/**
 * The native module of the apps `ng build --platform` makes
 * (`PhotoLibraryModule.swift` and `PhotoLibraryModule.kt` in
 * `packages/native/templates`), which only an app whose angular.json sets
 * `permissions.savePhotos` has.
 */
const PHOTO_LIBRARY_MODULE = 'AngularLynxPhotoLibrary';

/**
 * Whether the app may add to the photo library, as
 * {@link LynxPhotoLibrary.addPermission} reports it:
 * - `granted`: it may. Android 10 and later always let an app add its own
 *   photos and videos.
 * - `limited`: iOS's limited library access. Adding still works, so
 *   {@link LynxPhotoLibrary.save} treats it as `granted`.
 * - `denied`: the person said no, or a restriction such as Screen Time
 *   doesn't allow it. Only Settings can change it now.
 * - `undetermined`: the app hasn't asked yet; the first `save()` asks. It's
 *   also what the signal holds until the native module first answers.
 * - `unsupported`: the host has no photo library module (Lynx Explorer, an
 *   app without `permissions.savePhotos`).
 */
export type PhotoLibraryPermission =
  | 'granted'
  | 'limited'
  | 'denied'
  | 'undetermined'
  | 'unsupported';

const PERMISSIONS: readonly PhotoLibraryPermission[] = [
  'granted',
  'limited',
  'denied',
  'undetermined',
  'unsupported',
];

/**
 * Why {@link LynxPhotoLibrary.save} saved nothing:
 * - `permission-denied`: the person didn't let the app add to the library,
 *   now or before. Only Settings can change it once they've said no.
 * - `unsupported-type`: the file isn't an image or a video, by its Blob's
 *   type or its name's extension, or the library refused its format.
 * - `unavailable`: the host has no photo library. Only the apps
 *   `ng build --platform` makes with `permissions.savePhotos` in
 *   angular.json have one, and the web preview downloads the file instead;
 *   Lynx Explorer doesn't.
 * - `failed`: the file couldn't be written to the library, such as when the
 *   phone is out of space.
 */
export type PhotoLibraryErrorCode =
  | 'permission-denied'
  | 'unsupported-type'
  | 'unavailable'
  | 'failed';

/** The error a {@link LynxPhotoLibrary} rejects with. */
export class PhotoLibraryError extends Error {
  constructor(
    readonly code: PhotoLibraryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoLibraryError';
  }
}

/**
 * An image or a video to save: its bytes, and the file name it's saved
 * under where the library keeps one (Android's, and the web preview's
 * download). The name's extension gives the type when the Blob has none,
 * so a picked photo (`LynxImagePicker`) or a canvas's `toBlob()` saves as it
 * is.
 */
export type PhotoLibraryFile = {
  readonly blob: Blob;
  readonly name?: string;
};

/** The image and video types each library takes, by file extension. */
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
};

/** The extension a file without a name gets, by its type. */
const TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
  'image/x-adobe-dng': 'dng',
};

/** A file's name, its type and whether it's a photo or a video. */
type ResolvedFile = {
  readonly blob: Blob;
  readonly name: string;
  readonly type: string;
};

/**
 * Works out what's saved: a type of `image/…` or `video/…`, from the Blob
 * or, when it has none (a Blob made from bytes alone), from the name. The
 * libraries sort a file into photos or videos by it, so anything else is
 * refused here rather than by the phone.
 */
const resolve = (file: PhotoLibraryFile): ResolvedFile => {
  if (
    typeof file !== 'object' ||
    file === null ||
    typeof file.blob?.arrayBuffer !== 'function'
  ) {
    throw new TypeError(
      "save() needs { blob, name? }, with the image's or the video's Blob.",
    );
  }
  const given = typeof file.name === 'string' ? file.name : '';
  const extension = /\.([^./]+)$/.exec(given)?.[1]?.toLowerCase();
  const type =
    file.blob.type || (extension ? EXTENSION_TYPES[extension] : undefined);
  if (!type || !/^(image|video)\//.test(type)) {
    throw new PhotoLibraryError(
      'unsupported-type',
      `${given || 'The file'} isn't an image or a video${file.blob.type ? ` (${file.blob.type})` : ''}. Only images and videos can be saved to the photo library.`,
    );
  }
  // A name the person would see in Files or Downloads, as a camera names
  // its photos.
  const name =
    given ||
    `${type.startsWith('video/') ? 'Video' : 'Photo'}-${Date.now()}.${
      TYPE_EXTENSIONS[type] ?? type.slice(type.indexOf('/') + 1)
    }`;
  return { blob: file.blob, name, type };
};

/**
 * What the native module calls back with: `{ id, permission }` once the file
 * is in the library, `{ permission }` for a `permission` call, or
 * `{ error, message, permission }`.
 */
type NativeResult = {
  readonly id?: string;
  readonly permission?: string;
  readonly error?: string;
  readonly message?: string;
};

const ERROR_CODES: readonly PhotoLibraryErrorCode[] = [
  'permission-denied',
  'unsupported-type',
  'unavailable',
  'failed',
];

const UNAVAILABLE =
  'This host has no photo library. Only the apps `ng build --platform` makes with `permissions.savePhotos` in angular.json have one.';

/**
 * Saves an image or a video to the phone's photo library, without the share
 * sheet: a "Save to Photos" button in a photo editor, a ticket or a QR code
 * app, or anything that downloads media. Use `LynxShare` instead to let the
 * person choose where it goes.
 *
 * - **iOS:** `PHPhotoLibrary`, with add-only access
 *   (`requestAuthorization(for: .addOnly)`), which the first save asks for
 *   with angular.json's `permissions.savePhotos` as the reason. The app
 *   can't read the library with it.
 * - **Android:** MediaStore, into `Pictures/<app name>` or
 *   `Movies/<app name>`. Android 10 and later need no permission for it.
 * - **Web preview:** downloads the file, as the browser has no photo
 *   library.
 *
 * It's opt-in: the native code behind it is only in an app whose angular.json
 * sets `permissions.savePhotos`. Elsewhere, such as Lynx Explorer, `save()`
 * rejects with `unavailable` and {@link addPermission} is `unsupported`.
 * Under the testing library, `savedPhotos()` lists what was saved and
 * `setPhotoLibraryPermission()` sets what the person answers.
 *
 * @usageNotes
 * ```jsonc
 * // angular.json, in the build target's options
 * "permissions": { "savePhotos": "Save your edits to Photos" }
 * ```
 *
 * ```typescript
 * const photos = inject(LynxPhotoLibrary);
 *
 * canvas.toBlob(async (blob) => {
 *   if (!blob) return;
 *   try {
 *     await photos.save({ blob, name: 'edit.jpg' });
 *     this.saved.set(true);
 *   } catch (error) {
 *     if (error instanceof PhotoLibraryError && error.code === 'permission-denied') {
 *       this.askForSettings.set(true);
 *       return;
 *     }
 *     throw error;
 *   }
 * }, 'image/jpeg', 0.9);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxPhotoLibrary {
  readonly #permission = signal<PhotoLibraryPermission>('undetermined');

  /**
   * Whether the app may add to the photo library, read from the phone when
   * the service is first injected and again after each {@link save}. Use it
   * to show a "Turn on in Settings" hint once the person has said no, rather
   * than a button that can only fail. Saving never needs it checked first:
   * `save()` asks when the answer is `undetermined`.
   */
  readonly addPermission: Signal<PhotoLibraryPermission> =
    this.#permission.asReadonly();

  constructor() {
    if (pageWindow()) {
      // The web preview saves by downloading, which needs no permission.
      this.#permission.set('granted');
      return;
    }
    // A failed read leaves the signal as it was; save() reports it.
    void this.#call('permission', []).then(
      (result) => this.#update(result),
      () => this.#permission.set('unsupported'),
    );
  }

  /**
   * Adds the image or the video to the photo library, asking the person
   * first if the app hasn't yet, and resolves with the new item's ID: iOS's
   * `PHAsset` local identifier, Android's `content://` URI, and in the web
   * preview the name the file downloaded as.
   *
   * Rejects with a `TypeError` when `file` has no Blob, and with a
   * {@link PhotoLibraryError} otherwise.
   */
  save(file: PhotoLibraryFile): Promise<string> {
    let resolved: ResolvedFile;
    try {
      resolved = resolve(file);
      const page = pageWindow();
      if (page) {
        // A download, as LynxShare makes in a browser that can't share
        // files: the page's own File, made before anything waits, so the
        // browser still counts it as following the tap.
        download(page, [
          new page.File([resolved.blob], resolved.name, {
            type: resolved.type,
          }),
        ]);
        return Promise.resolve(resolved.name);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#saveNatively(resolved);
  }

  async #saveNatively({ blob, name, type }: ResolvedFile): Promise<string> {
    // The bytes cross to the background thread, where NativeModules lives,
    // and on to the module as JSON, so they go as base64, as LynxShare's do.
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    let result: NativeResult | undefined;
    try {
      result = await this.#call('save', [{ base64, name, type }]);
    } catch {
      this.#permission.set('unsupported');
      throw new PhotoLibraryError('unavailable', UNAVAILABLE);
    }
    this.#update(result);
    if (typeof result?.id === 'string' && result.error === undefined) {
      return result.id;
    }
    const code = ERROR_CODES.includes(result?.error as PhotoLibraryErrorCode)
      ? (result?.error as PhotoLibraryErrorCode)
      : 'failed';
    throw new PhotoLibraryError(
      code,
      result?.message ??
        (code === 'permission-denied'
          ? "The app isn't allowed to add to the photo library."
          : code === 'unavailable'
            ? UNAVAILABLE
            : "The file couldn't be saved to the photo library."),
    );
  }

  /**
   * Calls the module. callNativeModuleAsync keeps the module's callback on
   * the background thread, so nothing stays registered on either thread once
   * it answers, however many photos the app saves. It rejects when the host
   * has no such module.
   */
  #call(method: string, args: unknown[]): Promise<NativeResult | undefined> {
    return callOnBackground(
      'callNativeModuleAsync',
      PHOTO_LIBRARY_MODULE,
      method,
      args,
    ) as Promise<NativeResult | undefined>;
  }

  #update(result: NativeResult | undefined): void {
    const permission = result?.permission as PhotoLibraryPermission;
    if (PERMISSIONS.includes(permission)) this.#permission.set(permission);
  }
}
