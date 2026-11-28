import {
  type NfcErrorCode,
  type NfcRecord,
  type NfcRecordInit,
  type NfcState,
  ɵencodeNfcRecord,
  ɵparseNfcRecord,
} from '@blotch/angular-lynx';

/** What `LynxNfc` calls, named as the shells name their module. */
const MODULE = 'AngularLynxNfc';

/** A tag {@link tapNfcTag} brings near the phone. */
export type FakeNfcTag = {
  /** What it holds, which a read resolves with. None when left out. */
  readonly records?: readonly NfcRecordInit[];
  /** Whether a write can write to it. True when left out. */
  readonly writable?: boolean;
  /**
   * The most bytes its NDEF message takes: a write of more rejects with
   * `tooLarge`. 888 when left out, an NTAG216's.
   */
  readonly capacity?: number;
  /** Its serial number, as hex, as Android reports it. */
  readonly id?: string;
  /**
   * False for a tag that holds no NDEF (a payment card): a read or write
   * rejects with `tagNotNdef`, and a scan skips it. True when left out.
   */
  readonly ndef?: boolean;
};

/** A session the app has open, as {@link nfcSession} reports it. */
export type NfcSessionInfo = {
  /** The text iOS's sheet shows. */
  readonly alertMessage?: string;
  /** True for `LynxNfc.scan()`, false for a read or a write. */
  readonly multiple: boolean;
  /** True for `LynxNfc.write()`. */
  readonly writing: boolean;
};

/** Why a session ends, as {@link failNfcSession} ends it. */
export type NfcSessionFailure = Extract<
  NfcErrorCode,
  'canceled' | 'timeout' | 'busy' | 'failed'
>;

type Answer = Record<string, unknown>;
type Done = (answer: Answer) => void;
type RawRecord = ReturnType<typeof ɵencodeNfcRecord>;

/** What a spec did before the app's session opened, for when it does. */
type Pending = { readonly tap: FakeNfcTag } | { readonly fail: Answer };

type StartOptions = {
  readonly alertMessage?: string;
  readonly multiple?: boolean;
  readonly write?: readonly RawRecord[];
};

type FakeNfcModule = {
  /** Whether the phone reads tags, which {@link setNfcState} sets. */
  phone: Exclude<NfcState, 'unknown'>;
  session: StartOptions | undefined;
  waiting: Done | undefined;
  readonly answers: Answer[];
  readonly pending: Pending[];
  ended: Answer;
  readonly writes: (readonly NfcRecord[])[];
  state(done: Done): void;
  start(options: StartOptions, done: Done): void;
  next(done: Done): void;
  stop(options: unknown, done: Done): void;
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: {
    readonly globalThis: { NativeModules?: Record<string, unknown> };
  };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

const STOPPED = { error: 'stopped' };

/**
 * The bytes of a record's base64 field, which records cross the module as.
 */
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/**
 * The bytes an NDEF message of `records` takes on a tag: each record's
 * header, lengths, type and payload (NFC Forum NDEF 1.0, 3.2), with a
 * short record's one-byte length for a payload under 256 bytes.
 */
const messageLength = (records: readonly RawRecord[]): number =>
  records.reduce((sum, record) => {
    // The runtime writes no record IDs.
    const payload = fromBase64(record.payload).length;
    return (
      sum +
      1 +
      1 +
      (payload < 256 ? 1 : 4) +
      fromBase64(record.type).length +
      payload
    );
  }, 0);

const tagAnswer = (records: readonly RawRecord[], tag: FakeNfcTag): Answer => ({
  tag: {
    records,
    writable: tag.writable ?? true,
    capacity: tag.capacity ?? 888,
    ...(tag.id !== undefined && { id: tag.id }),
  },
});

/**
 * The module's answer to a tap, as the shells work it out.
 */
const answerTap = (module: FakeNfcModule, tag: FakeNfcTag): Answer => {
  if (tag.ndef === false) {
    return {
      error: 'tagNotNdef',
      message: "This tag doesn't hold NDEF records.",
    };
  }
  const write = module.session?.write;
  if (!write) {
    return tagAnswer((tag.records ?? []).map(ɵencodeNfcRecord), tag);
  }
  if (tag.writable === false) {
    return {
      error: 'readOnly',
      message: "This tag is locked, so it can't be written to.",
    };
  }
  const length = messageLength(write);
  const capacity = tag.capacity ?? 888;
  if (length > capacity) {
    return {
      error: 'tooLarge',
      message: `The records take ${length} bytes, and this tag holds ${capacity}.`,
    };
  }
  module.writes.push(write.map((record) => ɵparseNfcRecord(record)));
  return tagAnswer(write, tag);
};

const deliver = (module: FakeNfcModule, answer: Answer): void => {
  // A scan skips a tag it couldn't read, as the shells do.
  if (module.session?.multiple && answer['error'] !== undefined) return;
  const waiting = module.waiting;
  if (waiting) {
    module.waiting = undefined;
    waiting(answer);
  } else {
    module.answers.push(answer);
  }
};

const end = (module: FakeNfcModule, answer: Answer): void => {
  module.session = undefined;
  module.ended = answer;
  const waiting = module.waiting;
  module.waiting = undefined;
  waiting?.(answer);
};

const handle = (module: FakeNfcModule, pending: Pending): void => {
  if ('tap' in pending) {
    deliver(module, answerTap(module, pending.tap));
  } else {
    end(module, pending.fail);
  }
};

/**
 * Gives the environment's background thread an `AngularLynxNfc` module, as
 * the apps `ng build --platform` makes with angular.json's `permissions.nfc`
 * have. Its phone reads tags (`ready`) until {@link setNfcState} says
 * otherwise, and a tag comes near it only when {@link tapNfcTag} brings one.
 * `LynxNfc` reaches it through the background thread, as it reaches the
 * shells' module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with a phone that reads tags, no session and no writes.
 */
export const installNfcModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeNfcModule = {
    phone: 'ready',
    session: undefined,
    waiting: undefined,
    answers: [],
    pending: [],
    ended: STOPPED,
    writes: [],
    state(done) {
      done({ state: this.phone });
    },
    start(options, done) {
      if (this.phone !== 'ready') {
        done({ error: this.phone });
        return;
      }
      // LynxNfc opens one session at a time itself.
      this.session = options;
      this.answers.length = 0;
      done({});
      // What the spec did before the app asked.
      // One at a time: a failure ends the session, and what came after it
      // waits for the next one.
      while (this.session && this.pending.length > 0) {
        handle(this, this.pending.shift()!);
      }
    },
    next(done) {
      if (this.answers.length > 0) {
        done(this.answers.shift()!);
      } else if (!this.session) {
        done(this.ended);
      } else {
        this.waiting = done;
      }
    },
    stop(_options, done) {
      if (this.session) end(this, STOPPED);
      done({});
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * The fake module, read through the environment rather than kept here:
 * under `ng test`, the setup file and the specs can load different copies of
 * this file.
 */
const fakeModule = (
  name: string,
): { env: TestingEnvironment; module: FakeNfcModule } => {
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const module = env?.backgroundThread.globalThis.NativeModules?.[MODULE] as
    | FakeNfcModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      `${name}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return { env, module };
};

/**
 * Runs `action` on the background thread, where the shells answer.
 */
const onBackground = (env: TestingEnvironment, action: () => void): void => {
  env.switchToBackgroundThread();
  try {
    action();
  } finally {
    env.switchToMainThread();
  }
};

/**
 * Brings a tag near the phone, as the person would: the open
 * `LynxNfc.read()` resolves with its records, the open `write()` writes to
 * it, and an open `scan()` calls back with it. When no session is open yet,
 * the next one that opens takes it. The answer reaches the app through the
 * background thread, as on a phone: wait for it with `waitForUpdate()`.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Scan your card'));
 * tapNfcTag({ records: [{ type: 'url', value: 'https://example.com/m/42' }] });
 * await waitForUpdate();
 * expect(screen.getByText('Member 42')).toBeInTheDocument();
 * ```
 */
export const tapNfcTag = (tag: FakeNfcTag = {}): void => {
  const { env, module } = fakeModule('tapNfcTag');
  if (!module.session) {
    module.pending.push({ tap: tag });
    return;
  }
  onBackground(env, () => handle(module, { tap: tag }));
};

/**
 * Ends the open session, or the next one as soon as it opens, as iOS ends
 * one: `canceled` when the person closes the scan sheet, `timeout` after a
 * minute without a tag, `failed` otherwise. The open `read()` or `write()`
 * rejects with an `NfcError` of `code`, and an open `scan()` ends with it.
 */
export const failNfcSession = (
  code: NfcSessionFailure,
  message?: string,
): void => {
  const { env, module } = fakeModule('failNfcSession');
  const fail = { error: code, ...(message !== undefined && { message }) };
  if (!module.session) {
    module.pending.push({ fail });
    return;
  }
  onBackground(env, () => handle(module, { fail }));
};

/**
 * Whether the phone reads tags: `ready` (the default each test starts
 * with), `disabled` (NFC turned off in Android's settings) or
 * `unsupported` (no reader). `LynxNfc.state()` reads it when the app starts
 * and each time it comes back to the foreground; send it there with
 * `setAppState()`.
 */
export const setNfcState = (state: Exclude<NfcState, 'unknown'>): void => {
  fakeModule('setNfcState').module.phone = state;
};

/** The session the app has open, or undefined while none is. */
export const nfcSession = (): NfcSessionInfo | undefined => {
  const session = fakeModule('nfcSession').module.session;
  if (!session) return undefined;
  return {
    ...(session.alertMessage !== undefined && {
      alertMessage: session.alertMessage,
    }),
    multiple: session.multiple === true,
    writing: session.write !== undefined,
  };
};

/**
 * The records each `LynxNfc.write()` wrote to a tag in this test, oldest
 * first, as a read would give them back.
 */
export const nfcWrites = (): readonly (readonly NfcRecord[])[] => [
  ...fakeModule('nfcWrites').module.writes,
];
