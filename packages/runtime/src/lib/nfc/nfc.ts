import {
  type Signal,
  effect,
  ErrorHandler,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { LynxAppState } from '../app-state/app-state';
import { callOnBackground } from '../background-call';
import {
  encodeRecord,
  type NfcRecord,
  type NfcRecordInit,
  parseRecord,
  type RawNdefRecord,
} from './ndef';

/**
 * The native module of the apps `ng build --platform` makes with angular.json's
 * `permissions.nfc` (`NfcModule.swift` and `NfcModule.kt` in
 * `packages/native/templates`).
 */
const NFC_MODULE = 'AngularLynxNfc';

/**
 * Whether the phone can read a tag now:
 * - `ready`: it can.
 * - `disabled`: the phone has NFC, turned off in Settings (Android only:
 *   iOS can't turn it off). It turns `ready` once the person turns it on and
 *   comes back to the app.
 * - `unsupported`: the phone has no NFC reader (an iPhone before the 7, an
 *   iPad, a simulator or an emulator), or the host has no NFC module: Lynx
 *   Explorer, the web preview, or an app built without `permissions.nfc`.
 * - `unknown`: not known yet, until the module answers.
 */
export type NfcState = 'unknown' | 'ready' | 'disabled' | 'unsupported';

/** A tag {@link LynxNfc} read, or wrote to. */
export type NfcTag = {
  /** The records of its NDEF message, in order: none on an empty tag. */
  readonly records: readonly NfcRecord[];
  /** Whether {@link LynxNfc.write} can write to it. */
  readonly writable: boolean;
  /**
   * The most bytes its NDEF message can take, or 0 when the tag doesn't say
   * (an Android tag that isn't formatted yet).
   */
  readonly capacity: number;
  /**
   * Its serial number, as lowercase hex. Android only: iOS's NDEF reader
   * doesn't give it. Don't trust it for access control: many tags let it be
   * copied.
   */
  readonly id?: string;
};

/**
 * Why a call of {@link LynxNfc} failed:
 * - `unsupported`: the host can't read tags (see {@link NfcState}).
 * - `disabled`: NFC is turned off in Android's settings.
 * - `canceled`: the person closed iOS's scan sheet, or the app stopped the
 *   session.
 * - `timeout`: iOS closed its sheet after a minute with no tag.
 * - `busy`: another read or write is still open.
 * - `tagNotNdef`: the tag doesn't hold NDEF, such as a payment card or a
 *   transit card.
 * - `readOnly`: {@link LynxNfc.write}'s tag is locked.
 * - `tooLarge`: the records don't fit on the tag.
 * - `failed`: the tag moved away mid-read, or the system failed otherwise.
 */
export type NfcErrorCode =
  | 'unsupported'
  | 'disabled'
  | 'canceled'
  | 'timeout'
  | 'busy'
  | 'tagNotNdef'
  | 'readOnly'
  | 'tooLarge'
  | 'failed';

/** The error {@link LynxNfc}'s calls reject with. */
export class NfcError extends Error {
  constructor(
    readonly code: NfcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NfcError';
  }
}

/** What {@link LynxNfc.read}, {@link LynxNfc.scan} and {@link LynxNfc.write} take. */
export type NfcSessionOptions = {
  /**
   * The text iOS's scan sheet shows, such as "Hold your card near the top of
   * the phone". iOS only: Android shows no sheet, so the app shows its own
   * prompt while the call is open.
   */
  readonly alertMessage?: string;
  /**
   * What iOS's sheet says as it closes after a tag: a read or a write that
   * worked. Defaults to iOS's own checkmark with no text.
   */
  readonly successMessage?: string;
};

/** An open {@link LynxNfc.scan}. */
export type NfcScan = {
  /** True until the scan ends: {@link stop}, or an {@link error}. */
  readonly scanning: Signal<boolean>;
  /**
   * Why the scan ended, when it ended by itself: the person closed iOS's
   * sheet (`canceled`), it timed out, or the system failed. Undefined while
   * it runs, and after {@link stop}.
   */
  readonly error: Signal<NfcError | undefined>;
  /** Ends the scan, and closes iOS's sheet. */
  stop(): Promise<void>;
};

/** A tag as the module calls back with it. */
type RawTag = {
  readonly records?: readonly RawNdefRecord[];
  readonly writable?: boolean;
  readonly capacity?: number;
  readonly id?: string;
};

/** How the module answers. */
type Answer = {
  readonly state?: string;
  readonly tag?: RawTag;
  readonly error?: string;
  readonly message?: string;
};

/**
 * What the module says when the session ended because the app stopped it:
 * no error for a scan.
 */
const STOPPED = 'stopped';

const CODES: ReadonlySet<string> = new Set<NfcErrorCode>([
  'unsupported',
  'disabled',
  'canceled',
  'timeout',
  'busy',
  'tagNotNdef',
  'readOnly',
  'tooLarge',
  'failed',
]);

const STATES: ReadonlySet<string> = new Set<NfcState>([
  'ready',
  'disabled',
  'unsupported',
]);

const DEFAULT_MESSAGES: Record<NfcErrorCode, string> = {
  unsupported:
    "This host can't read NFC tags. Only the apps `ng build --platform` makes with angular.json's permissions.nfc have an NFC module, on a phone with an NFC reader.",
  disabled: "NFC is turned off in the phone's settings.",
  canceled: 'The NFC session was canceled.',
  timeout: 'No tag came near the phone in time.',
  busy: 'Another NFC read or write is still open.',
  tagNotNdef: "This tag doesn't hold NDEF records.",
  readOnly: "This tag is locked, so it can't be written to.",
  tooLarge: "The records don't fit on this tag.",
  failed: "The tag couldn't be read.",
};

/**
 * The module's error as an {@link NfcError}, an unknown code as `failed`.
 */
const toError = (answer: Answer): NfcError => {
  const code = (
    CODES.has(answer.error ?? '') ? answer.error : 'failed'
  ) as NfcErrorCode;
  return new NfcError(code, answer.message ?? DEFAULT_MESSAGES[code]);
};

const toTag = (raw: RawTag): NfcTag => ({
  records: (raw.records ?? []).map(parseRecord),
  writable: raw.writable === true,
  capacity: typeof raw.capacity === 'number' ? raw.capacity : 0,
  ...(typeof raw.id === 'string' && { id: raw.id }),
});

/**
 * Calls the module and resolves with its answer. The call rejects where there's no
 * module: Lynx Explorer, the web preview, or an app built without
 * `permissions.nfc`.
 */
const callModule = async (
  method: string,
  args: readonly unknown[],
): Promise<Answer> => {
  try {
    // callNativeModuleAsync keeps the module's callback on the background
    // thread, where NativeModules lives, so nothing stays registered on
    // either thread once it answers.
    return ((await callOnBackground(
      'callNativeModuleAsync',
      NFC_MODULE,
      method,
      [...args],
    )) ?? {}) as Answer;
  } catch {
    throw new NfcError('unsupported', DEFAULT_MESSAGES.unsupported);
  }
};

/**
 * Reads and writes NFC tags: the NDEF records on a membership card, a museum
 * label, a smart-home tag or a device being set up.
 *
 * - **iOS (iPhone 7 and later):** Core NFC's `NFCNDEFReaderSession`, which
 *   shows the system's scan sheet with {@link NfcSessionOptions.alertMessage}
 *   while a call is open, and closes it after a minute with no tag.
 * - **Android:** `NfcAdapter`'s reader mode, while the app is in the
 *   foreground. There's no sheet, so the app shows its own prompt while a
 *   call is open.
 * - **Elsewhere** (the web preview, Lynx Explorer, a simulator, a phone
 *   without NFC): {@link state} is `unsupported`, and every call rejects with
 *   that code.
 *
 * The native module is in an app only when angular.json's build options set
 * `permissions.nfc`, the reason iOS shows (`NFCReaderUsageDescription`). It
 * also adds iOS's NFC Tag Reading entitlement, which a free Personal Team
 * can't sign, and Android's `NFC` permission. The testing library's
 * `tapNfcTag()` brings a tag near a spec's phone.
 *
 * @usageNotes
 * ```jsonc
 * // angular.json, in the build target's options
 * "permissions": { "nfc": "Reads your membership card" }
 * ```
 *
 * ```typescript
 * // Injected in a field: a method has no injection context.
 * readonly #nfc = inject(LynxNfc);
 *
 * async readCard() {
 *   const tag = await this.#nfc.read({
 *     alertMessage: 'Hold your card near the top of the phone',
 *   });
 *   const url = tag.records.find((record) => record.type === 'url');
 *   this.member.set(url?.value);
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxNfc {
  readonly #errorHandler = inject(ErrorHandler);
  readonly #state = signal<NfcState>('unknown');

  /**
   * Whether the phone can read a tag now. It's `unknown` until the module
   * answers, and asked again each time the app comes back to the
   * foreground, since Android's NFC can be turned on or off in Settings
   * meanwhile.
   */
  readonly state: Signal<NfcState> = this.#state.asReadonly();

  /** Whether a read, scan or write is open, which the next would refuse. */
  #open = false;

  constructor() {
    const appState = inject(LynxAppState);
    effect(() => {
      if (appState.active()) untracked(() => void this.#refreshState());
    });
  }

  async #refreshState(): Promise<void> {
    try {
      const { state } = await callModule('state', []);
      this.#state.set(
        STATES.has(state ?? '') ? (state as NfcState) : 'unsupported',
      );
    } catch {
      this.#state.set('unsupported');
    }
  }

  /**
   * Opens a session for one call, and refuses while another is open: the
   * platforms read one tag at a time, for one app.
   */
  async #start(options: object): Promise<void> {
    if (this.#open) {
      throw new NfcError('busy', DEFAULT_MESSAGES.busy);
    }
    this.#open = true;
    try {
      const answer = await callModule('start', [options]);
      if (answer.error !== undefined) throw toError(answer);
    } catch (error) {
      this.#open = false;
      // callModule and toError only throw NfcErrors.
      this.#noteState(error as NfcError);
      throw error;
    }
  }

  /**
   * Ends the session, with what iOS's sheet says as it closes.
   */
  async #stop(message?: { message?: string; errorMessage?: string }) {
    try {
      await callModule('stop', [message ?? {}]);
    } catch {
      // The module is gone only if it never was, which #start caught.
    } finally {
      this.#open = false;
    }
  }

  /**
   * Keeps {@link state} in step with what a call found out.
   */
  #noteState(error: NfcError): void {
    if (error.code === 'disabled') this.#state.set('disabled');
    if (error.code === 'unsupported') this.#state.set('unsupported');
  }

  /**
   * One tag: waits for a tag to come near the phone and resolves with it,
   * then ends the session. On iOS it opens the scan sheet with
   * `alertMessage`. Rejects with an {@link NfcError}.
   */
  async read(options: NfcSessionOptions = {}): Promise<NfcTag> {
    return this.#once(options);
  }

  /**
   * Writes `records` to the next tag that comes near the phone, replacing
   * what it held, and resolves with the tag as written. On iOS it opens the
   * scan sheet with `alertMessage`. Throws a `TypeError` for a record a tag
   * can't hold, and rejects with an {@link NfcError}: `readOnly` for a
   * locked tag, `tooLarge` when the records don't fit.
   */
  async write(
    records: readonly NfcRecordInit[],
    options: NfcSessionOptions = {},
  ): Promise<NfcTag> {
    if (!Array.isArray(records) || records.length === 0) {
      throw new TypeError('write() needs at least one record.');
    }
    return this.#once(options, records.map(encodeRecord));
  }

  async #once(
    { alertMessage, successMessage }: NfcSessionOptions,
    write?: readonly RawNdefRecord[],
  ): Promise<NfcTag> {
    await this.#start({
      multiple: false,
      ...(alertMessage !== undefined && { alertMessage }),
      ...(write && { write }),
    });
    let answer: Answer;
    try {
      answer = await callModule('next', []);
    } catch (error) {
      await this.#stop();
      throw error;
    }
    if (answer.tag) {
      await this.#stop(
        successMessage === undefined ? {} : { message: successMessage },
      );
      return toTag(answer.tag);
    }
    const error =
      answer.error === STOPPED
        ? new NfcError('canceled', DEFAULT_MESSAGES.canceled)
        : toError(answer);
    // iOS's sheet shows the error as it closes.
    await this.#stop({ errorMessage: error.message });
    this.#noteState(error);
    throw error;
  }

  /**
   * Several tags: calls `onTag` with each tag that comes near the phone,
   * until {@link NfcScan.stop} ends the scan, or iOS closes its sheet.
   * Resolves once the phone is listening, and rejects with an
   * {@link NfcError} when it can't start. A tag the phone can't read (one
   * without NDEF, or one taken away too soon) is skipped, and iOS's sheet
   * says so.
   *
   * iOS asks apps to keep a session to one task: its sheet stays up for the
   * whole scan, and closes after a minute without a tag.
   */
  async scan(
    options: NfcSessionOptions,
    onTag: (tag: NfcTag) => void,
  ): Promise<NfcScan> {
    await this.#start({
      multiple: true,
      ...(options.alertMessage !== undefined && {
        alertMessage: options.alertMessage,
      }),
    });
    const scanning = signal(true);
    const error = signal<NfcError | undefined>(undefined);
    let stopped = false;
    /**
     * Called only while the scan runs: stop() and the loop check first.
     */
    const end = (cause?: NfcError) => {
      scanning.set(false);
      if (cause) {
        error.set(cause);
        this.#noteState(cause);
      }
    };
    const listen = async () => {
      while (scanning()) {
        let answer: Answer;
        try {
          answer = await callModule('next', []);
        } catch (cause) {
          end(cause as NfcError);
          break;
        }
        // stop() may have ended the scan while a tag's answer was on its
        // way: the app stopped listening, so it doesn't get the tag.
        if (!scanning()) break;
        if (answer.tag) {
          try {
            onTag(toTag(answer.tag));
          } catch (cause) {
            // An app's handler that throws still sees the next tag.
            this.#errorHandler.handleError(cause);
          }
          continue;
        }
        end(answer.error === STOPPED ? undefined : toError(answer));
      }
      // The session ended by itself: let the next call open one.
      if (!stopped) await this.#stop();
    };
    void listen();
    return {
      scanning: scanning.asReadonly(),
      error: error.asReadonly(),
      stop: async () => {
        if (stopped || !scanning()) return;
        stopped = true;
        end();
        await this.#stop(
          options.successMessage === undefined
            ? {}
            : { message: options.successMessage },
        );
      },
    };
  }
}
