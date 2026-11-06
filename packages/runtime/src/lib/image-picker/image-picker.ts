import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import { base64ToBytes } from '../network/base64';
import type { PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes
 * (`ImagePickerModule.swift` and `ImagePickerModule.kt` in
 * `packages/native/templates`).
 */
const IMAGE_PICKER_MODULE = 'AngularLynxImagePicker';

/**
 * The JPEG quality a re-encoded image gets when the caller doesn't choose one.
 * A browser's canvas uses 0.92; this is close, and a little smaller.
 */
const DEFAULT_QUALITY = 0.9;

/** What {@link LynxImagePicker.pick} sends the native module. */
type NativeRequest = {
  readonly maxDimension?: number;
  readonly quality?: number;
};

/**
 * What the native module calls back with: the image as base64, `{ canceled }`
 * when the person closed the picker, or `{ error, message }`.
 *
 * The bytes travel as base64 because each hop carries only what JSON can:
 * Lynx's module callback to the background thread, then the relay to the main
 * thread, where Angular runs (background-call.ts).
 */
type NativeResult = {
  readonly base64?: string;
  readonly name?: string;
  readonly type?: string;
  readonly canceled?: boolean;
  readonly error?: string;
  readonly message?: string;
};

/**
 * Why {@link LynxImagePicker.pick} gave no image (a person closing the picker
 * isn't an error: it resolves with `null`):
 * - `unavailable`: the host has no picker. Only the apps
 *   `ng build --platform` makes, and the web preview, have one; Lynx Explorer
 *   and tests don't.
 * - `failed`: the picker couldn't open, a picker was already open, or the
 *   picked image couldn't be read.
 */
export type ImagePickerErrorCode = 'unavailable' | 'failed';

/** The error a {@link LynxImagePicker} rejects with. */
export class ImagePickerError extends Error {
  constructor(
    readonly code: ImagePickerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImagePickerError';
  }
}

/** How {@link LynxImagePicker.pick} prepares the image. */
export type ImagePickerOptions = {
  /**
   * Scales the image down, if it's larger, so its longest side has at most
   * this many pixels. The image is re-encoded as a JPEG.
   */
  readonly maxDimension?: number;
  /**
   * The JPEG quality of the re-encoded image, from 0 to 1. Setting it
   * re-encodes the image as a JPEG. Defaults to 0.9 when only `maxDimension`
   * is set, or when the image has to be re-encoded anyway.
   */
  readonly quality?: number;
};

/** The image the person picked. */
export type PickedImage = {
  /** The image's bytes, ready to upload or to read. */
  readonly blob: Blob;
  /**
   * A file name for it, such as `IMG_0042.jpg`, with the extension of
   * {@link type}. Android's Photo Picker doesn't share the file's own name,
   * so there it's the photo's number in the library, such as
   * `1000000020.jpg`.
   */
  readonly name: string;
  /** Its MIME type, such as `image/jpeg`: the same as `blob.type`. */
  readonly type: string;
};

// ─── The web preview ─────────────────────────────────────────────────────────

/**
 * The parts of the DOM the web preview's picker uses. The runtime builds
 * without the DOM's types, since Lynx has no DOM.
 */
type WebFile = Blob & { readonly name: string };

type WebInput = {
  type: string;
  accept: string;
  readonly style: { display: string };
  readonly files: ArrayLike<WebFile> | null;
  click(): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
};

type WebCanvas = {
  width: number;
  height: number;
  getContext(type: '2d'): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawImage(
      image: unknown,
      x: number,
      y: number,
      width: number,
      height: number,
    ): void;
  } | null;
  toBlob(
    callback: (blob: Blob | null) => void,
    type: string,
    quality: number,
  ): void;
};

type WebDocument = {
  readonly body: { appendChild(node: unknown): void };
  createElement(tag: 'input'): WebInput;
  createElement(tag: 'canvas'): WebCanvas;
};

type WebImageBitmap = {
  readonly width: number;
  readonly height: number;
  close(): void;
};

type WebGlobal = {
  readonly document?: WebDocument;
  readonly frameElement?: { readonly ownerDocument: WebDocument } | null;
  readonly createImageBitmap?: (image: Blob) => Promise<WebImageBitmap>;
};

/**
 * The document of the page showing the app in Lynx for Web, or undefined
 * elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in a hidden iframe of
 * the page's origin, and the app's elements live in the page itself. The
 * browser opens a file dialog only for the document the person just tapped
 * in, so the input goes into the page's document, which the iframe can reach
 * as its `frameElement`'s. Elsewhere it's left alone even where a document
 * exists, such as in unit tests under jsdom, which stand in for a native host.
 */
const webDocument = (): WebDocument | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  const web = globalThis as unknown as WebGlobal;
  try {
    return web.frameElement?.ownerDocument ?? web.document;
  } catch {
    // A page of another origin, which the iframe can't reach.
    return web.document;
  }
};

/** The formats every platform's browser and image views can show. */
const PORTABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * `photo.heic` → `photo.jpg`.
 */
const withExtension = (name: string, extension: string): string => {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
};

/**
 * Re-encodes a picked file as a JPEG, scaled down to `maxDimension`, as the
 * shells do. Browsers turn a photo the way its camera recorded when they
 * decode it, so the pixels come out upright. Transparent pixels become white, as a
 * JPEG has no transparency and would otherwise show them black.
 *
 * Resolves with null when the browser can't decode the file, such as a HEIC
 * photo in a browser other than Safari: the caller keeps the original then.
 */
const toJpeg = async (
  web: WebGlobal,
  document: WebDocument,
  file: Blob,
  maxDimension: number | undefined,
  quality: number,
): Promise<Blob | null> => {
  if (typeof web.createImageBitmap !== 'function') return null;
  let bitmap: WebImageBitmap;
  try {
    bitmap = await web.createImageBitmap(file);
  } catch {
    return null;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale =
    maxDimension !== undefined && longest > maxDimension
      ? maxDimension / longest
      : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
};

/**
 * The web preview's picker: an `<input type="file" accept="image/*">`, as a
 * web app would use, opened from the person's tap.
 */
/**
 * Ends the web preview's open picker, if any, with no image. A browser that
 * doesn't fire `cancel` never says the person closed its dialog, so the next
 * pick ends the last one instead of waiting behind it.
 */
let endOpenWebPick: (() => void) | undefined;

const pickOnWeb = (
  document: WebDocument,
  maxDimension: number | undefined,
  quality: number | undefined,
): Promise<PickedImage | null> =>
  new Promise((resolve, reject) => {
    const web = globalThis as unknown as WebGlobal;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const settle = (
      outcome: () => Promise<PickedImage | null>,
    ): Promise<void> | undefined => {
      if (settled) return undefined;
      settled = true;
      // A pick that started since has already ended this one, so the open
      // pick is this one.
      endOpenWebPick = undefined;
      input.remove();
      return outcome().then(resolve, (error: unknown) =>
        reject(
          new ImagePickerError(
            'failed',
            `The picked image couldn't be read: ${(error as Error).message}`,
          ),
        ),
      );
    };
    const cancel = (): void => {
      void settle(async () => null);
    };
    endOpenWebPick?.();
    endOpenWebPick = cancel;
    // Browsers fire `cancel` when the person closes the dialog without
    // choosing, and `change` once they've chosen.
    input.addEventListener('cancel', cancel);
    input.addEventListener('change', () => {
      void settle(async () => {
        const file = input.files?.[0];
        if (!file) return null;
        const converting =
          maxDimension !== undefined ||
          quality !== undefined ||
          !PORTABLE_TYPES.has(file.type);
        const jpeg = converting
          ? await toJpeg(
              web,
              document,
              file,
              maxDimension,
              quality ?? DEFAULT_QUALITY,
            )
          : null;
        const picked = jpeg ?? file;
        const type = jpeg ? 'image/jpeg' : file.type;
        // The input lives in the page's document, so its File belongs to the
        // page's realm, and Angular's realm, the iframe, wouldn't see it as
        // a Blob: `instanceof Blob`, which upload libraries such as Firebase
        // Storage check, would be false. A Blob of this realm holds the same
        // bytes.
        return {
          blob: new Blob([picked], { type }),
          name: jpeg ? withExtension(file.name, 'jpg') : file.name,
          type,
        };
      });
    });
    document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      void settle(() => Promise.reject(error));
    }
  });

// ─── The shells ──────────────────────────────────────────────────────────────

/**
 * Lets the person pick a photo, and hands it back as a `Blob`, ready for the
 * upload libraries apps already use, such as Firebase Storage's
 * `uploadBytes`, which sends it through `XMLHttpRequest`.
 *
 * Lynx has no `<input type="file">`, so the picker is the platform's own:
 * - **iOS:** `PHPickerViewController`, which runs outside the app, so the app
 *   needs no photo library permission and sees only the photo picked.
 * - **Android:** the Photo Picker (`PickVisualMedia`), which needs no
 *   permission either. Where a phone doesn't have it, Android opens its
 *   document picker instead.
 * - **Web preview:** an `<input type="file" accept="image/*">`.
 *
 * The image comes back as it was picked when it's a JPEG, PNG, GIF or WebP.
 * With `maxDimension` or `quality`, or when it's a format other platforms
 * can't show, such as an iPhone's HEIC photos, it's re-encoded as a JPEG:
 * upright, whichever way the camera stored it, scaled down to `maxDimension`,
 * and without the original's metadata, such as where it was taken.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxImagePicker`. Elsewhere, such as in Lynx Explorer, `pick()`
 * rejects with `unavailable`. In specs, provide a stand-in that resolves with
 * the image the test needs (see the usage notes).
 *
 * @usageNotes
 * ```typescript
 * const picker = inject(LynxImagePicker);
 *
 * const picked = await picker.pick({ maxDimension: 1024, quality: 0.85 });
 * if (picked) {
 *   await uploadBytes(storageRef, picked.blob, { contentType: picked.type });
 * }
 * ```
 *
 * In a spec, provide a stand-in that resolves with the image the test needs:
 *
 * ```typescript
 * await render(ProfilePicture, {
 *   providers: [
 *     {
 *       provide: LynxImagePicker,
 *       useValue: {
 *         pick: async () => ({
 *           blob: new Blob([bytes], { type: 'image/jpeg' }),
 *           name: 'me.jpg',
 *           type: 'image/jpeg',
 *         }),
 *       },
 *     },
 *   ],
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxImagePicker {
  /**
   * Lets the person pick one image. Resolves with it, or with `null` when
   * they close the picker without choosing. Rejects with an
   * {@link ImagePickerError}.
   */
  async pick(options: ImagePickerOptions = {}): Promise<PickedImage | null> {
    const { maxDimension, quality } = options;
    if (
      maxDimension !== undefined &&
      !(Number.isFinite(maxDimension) && maxDimension >= 1)
    ) {
      throw new RangeError(
        `maxDimension must be a number of pixels, at least 1, not ${maxDimension}.`,
      );
    }
    if (quality !== undefined && !(quality >= 0 && quality <= 1)) {
      throw new RangeError(`quality must be between 0 and 1, not ${quality}.`);
    }
    const document = webDocument();
    if (document) return pickOnWeb(document, maxDimension, quality);
    // The shells answer a second pick while one is open with an error.
    return this.#pickNatively({
      ...(maxDimension !== undefined && {
        maxDimension: Math.floor(maxDimension),
      }),
      ...(quality !== undefined && { quality }),
    });
  }

  async #pickNatively(request: NativeRequest): Promise<PickedImage | null> {
    let result: NativeResult | undefined;
    try {
      // The module calls back on the background thread, where NativeModules
      // lives; callNativeModuleAsync keeps the callback there, so nothing
      // stays registered on either thread once it answers.
      result = (await callOnBackground(
        'callNativeModuleAsync',
        IMAGE_PICKER_MODULE,
        'pick',
        [request],
      )) as NativeResult | undefined;
    } catch {
      throw new ImagePickerError(
        'unavailable',
        'This host has no image picker. Only the apps `ng build --platform` makes, and the web preview, have one.',
      );
    }
    if (result?.canceled) return null;
    if (
      result?.base64 === undefined ||
      result.type === undefined ||
      result.name === undefined
    ) {
      throw new ImagePickerError(
        'failed',
        result?.message ?? "The picked image couldn't be read.",
      );
    }
    const type = result.type;
    return {
      blob: new Blob([base64ToBytes(result.base64)], { type }),
      name: result.name,
      type,
    };
  }
}
