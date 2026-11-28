/** What `LynxFilePicker` calls, as the shells name their module. */
const MODULE = 'AngularLynxFilePicker';

/** A file {@link setPickedFiles} has the person pick. */
export type FakePickedFile = {
  /** Its name, such as `receipt.pdf`. */
  readonly name: string;
  /**
   * Its MIME type, such as `application/pdf`. `application/octet-stream`
   * when it's left out, as a phone answers for a type it doesn't know.
   */
  readonly type?: string;
  /** Its bytes, or text, which is stored as UTF-8. */
  readonly content: string | Uint8Array;
};

/** A file the app saved, as {@link savedFiles} lists it. */
export type SavedFile = {
  /** The name it was offered under. */
  readonly name: string;
  /** Its MIME type: the Blob's `type`, or `application/octet-stream`. */
  readonly type: string;
  /** Its bytes. */
  readonly bytes: Uint8Array;
  /** Its bytes read as UTF-8, for a text file such as a CSV. */
  readonly text: string;
};

type Done = (result: Record<string, unknown>) => void;

type FakeFilePickerModule = {
  /** What the person picks next, or undefined when they close the picker. */
  picks: readonly FakePickedFile[] | undefined;
  canceled: boolean;
  readonly saved: SavedFile[];
  pick(request: { maxBytes?: number }, done: Done): void;
  save(file: { base64: string; name: string; type: string }, done: Done): void;
};

const toBytes = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/**
 * Gives the environment's background thread an `AngularLynxFilePicker`
 * module, as the apps `ng build --platform` makes with angular.json's
 * `filePicker` have. It stands for a person who closes the picker until a
 * spec says what they pick ({@link setPickedFiles}), and who saves every
 * file the app offers ({@link savedFiles}) unless a spec has them close the
 * screen ({@link setFilePickerCanceled}). The runtime reaches it through the
 * background thread, as it reaches the shells' module, so specs see the
 * runtime's own behavior, its size limit included.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with nothing to pick and nothing saved.
 */
export const installFilePickerModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeFilePickerModule = {
    picks: undefined,
    canceled: false,
    saved: [],
    pick(request, done) {
      if (this.canceled || this.picks === undefined) {
        return done({ canceled: true });
      }
      const files = this.picks.map((file) => ({
        bytes: toBytes(file.content),
        name: file.name,
        type: file.type ?? 'application/octet-stream',
      }));
      const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
      if (total > (request.maxBytes ?? Infinity)) {
        return done({ error: 'too-large' });
      }
      done({
        files: files.map(({ bytes, name, type }) => ({
          base64: toBase64(bytes),
          name,
          type,
        })),
      });
    },
    save(file, done) {
      if (this.canceled) return done({ saved: false });
      const bytes = fromBase64(file.base64);
      this.saved.push({
        name: file.name,
        type: file.type,
        bytes,
        text: new TextDecoder().decode(bytes),
      });
      done({ saved: true });
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
 * this module.
 */
const fakeModule = (helper: string): FakeFilePickerModule => {
  const module = (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
    .NativeModules?.[MODULE] as FakeFilePickerModule | undefined;
  if (!module) {
    throw new Error(
      `${helper}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return module;
};

/**
 * Has the person pick `files` each time the app opens `LynxFilePicker`'s
 * picker in this test, so `pick()` resolves with them. Until a spec calls
 * it, the person closes the picker, and `pick()` resolves with `[]`. Files
 * over the runtime's 20 MiB limit, together, reject with `too-large`, as on
 * a phone.
 *
 * @example
 * ```ts
 * setPickedFiles([{ name: 'receipt.pdf', type: 'application/pdf', content: pdfBytes }]);
 * fireEvent.tap(screen.getByText('Attach receipt'));
 * await waitForUpdate();
 * expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
 * ```
 */
export const setPickedFiles = (files: readonly FakePickedFile[]): void => {
  const module = fakeModule('setPickedFiles');
  module.picks = [...files];
  module.canceled = false;
};

/**
 * Has the person close `LynxFilePicker`'s picker and save screen for the
 * rest of this test: `pick()` resolves with `[]`, and `save()` with false.
 * {@link setPickedFiles} undoes it.
 */
export const setFilePickerCanceled = (): void => {
  fakeModule('setFilePickerCanceled').canceled = true;
};

/**
 * The files the app saved with `LynxFilePicker.save()` in this test, oldest
 * first. Each test starts with none.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Export'));
 * await waitForUpdate();
 * expect(savedFiles()).toMatchObject([{ name: 'report.csv', type: 'text/csv' }]);
 * expect(savedFiles()[0]!.text).toContain('Total,42');
 * ```
 */
export const savedFiles = (): readonly SavedFile[] => [
  ...fakeModule('savedFiles').saved,
];
