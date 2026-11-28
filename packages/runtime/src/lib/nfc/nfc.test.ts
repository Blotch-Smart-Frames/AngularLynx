// @vitest-environment jsdom
import '@angular/compiler';
import {
  ErrorHandler,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxAppState } from '../app-state/app-state';
import { bytesToBase64 } from '../network/base64';
import { LynxNfc, NfcError, type NfcErrorCode } from './nfc';

type Answer = Record<string, unknown>;
type Done = (answer: Answer) => void;

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** A tag as the shells call back with it, holding one URL. */
const rawTag = {
  records: [
    {
      tnf: 1,
      type: bytesToBase64(ascii('U')),
      payload: bytesToBase64(Uint8Array.of(4, ...ascii('example.com'))),
    },
  ],
  writable: true,
  capacity: 137,
  id: '04a1b2',
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

/**
 * Stands in for the shells' AngularLynxNfc module, as the background thread
 * sees it: `next` waits until the spec hands it a tag or an error.
 */
const stubModule = ({
  state = 'ready',
  start = {},
}: { state?: string; start?: Answer } = {}) => {
  const waiting: Done[] = [];
  const module = {
    state: vi.fn((done: Done) => done({ state })),
    start: vi.fn((_options: unknown, done: Done) => done(start)),
    next: vi.fn((done: Done) => waiting.push(done)),
    stop: vi.fn((_options: unknown, done: Done) => {
      // The shells end a waiting `next` as the session stops.
      waiting.splice(0).forEach((next) => next({ error: 'stopped' }));
      done({});
    }),
  };
  vi.stubGlobal('NativeModules', { AngularLynxNfc: module });
  return {
    module,
    answer: async (answer: Answer) => {
      // The runtime asks for the next tag once its start has come back.
      for (let i = 0; i < 10 && waiting.length === 0; i++) await settle();
      waiting.shift()!(answer);
      await settle();
    },
  };
};

const active = signal(true);
const handleError = vi.fn();

const createNfc = () => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: LynxAppState, useValue: { active } },
      { provide: ErrorHandler, useValue: { handleError } },
    ],
  });
  const nfc = TestBed.inject(LynxNfc);
  TestBed.tick();
  return nfc;
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: NfcErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(NfcError);
  const { code, message } = error as NfcError;
  return { code, message };
};

describe('LynxNfc', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    active.set(true);
    handleError.mockReset();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  describe('state', () => {
    it("is the module's state, asked again each time the app comes back", async () => {
      const { module } = stubModule({ state: 'disabled' });
      const nfc = createNfc();
      expect(nfc.state()).toBe('unknown');
      await settle();
      expect(nfc.state()).toBe('disabled');

      module.state.mockImplementation((done: Done) => done({ state: 'ready' }));
      active.set(false);
      TestBed.tick();
      active.set(true);
      TestBed.tick();
      await settle();
      expect(nfc.state()).toBe('ready');
      expect(module.state).toHaveBeenCalledTimes(2);
    });

    it('is unsupported when the module answers nothing', async () => {
      const { module } = stubModule();
      module.state.mockImplementation((done: Done) =>
        (done as (answer?: Answer) => void)(),
      );
      const nfc = createNfc();
      await settle();
      expect(nfc.state()).toBe('unsupported');
    });

    it('is unsupported without a module, or with a state it does not know', async () => {
      const nfc = createNfc();
      await settle();
      expect(nfc.state()).toBe('unsupported');

      TestBed.resetTestingModule();
      stubModule({ state: 'sleepy' });
      const other = createNfc();
      await settle();
      expect(other.state()).toBe('unsupported');
    });
  });

  describe('read', () => {
    it('opens a session for one tag, resolves with its records and closes the sheet', async () => {
      const { module, answer } = stubModule();
      const nfc = createNfc();
      const read = nfc.read({
        alertMessage: 'Hold your card near the phone',
        successMessage: 'Welcome back',
      });
      await answer({ tag: rawTag });

      await expect(read).resolves.toEqual({
        records: [{ type: 'url', value: 'https://example.com' }],
        writable: true,
        capacity: 137,
        id: '04a1b2',
      });
      expect(module.start).toHaveBeenCalledWith(
        { multiple: false, alertMessage: 'Hold your card near the phone' },
        expect.any(Function),
      );
      expect(module.stop).toHaveBeenCalledWith(
        { message: 'Welcome back' },
        expect.any(Function),
      );
    });

    it("fills in what a tag leaves out: no records, not writable, and a capacity it doesn't say", async () => {
      const { answer } = stubModule();
      const read = createNfc().read();
      await answer({ tag: {} });
      await expect(read).resolves.toEqual({
        records: [],
        writable: false,
        capacity: 0,
      });
    });

    it("rejects with the module's error, and shows it on iOS's sheet as it closes", async () => {
      const { module, answer } = stubModule();
      const read = rejection(createNfc().read());
      await answer({ error: 'tagNotNdef' });
      expect(await read).toEqual({
        code: 'tagNotNdef',
        message: "This tag doesn't hold NDEF records.",
      });
      expect(module.stop).toHaveBeenCalledWith(
        { errorMessage: "This tag doesn't hold NDEF records." },
        expect.any(Function),
      );
    });

    it('reads an unknown error as failed, and a stopped session as canceled', async () => {
      const { answer } = stubModule();
      const nfc = createNfc();
      const first = rejection(nfc.read());
      await answer({ error: 'melted', message: 'It melted.' });
      expect(await first).toEqual({
        code: 'failed',
        message: 'It melted.',
      });

      const second = rejection(nfc.read());
      await answer({ error: 'stopped' });
      expect((await second).code).toBe('canceled');
    });

    it('rejects with unsupported without a module', async () => {
      const nfc = createNfc();
      await settle();
      expect((await rejection(nfc.read())).code).toBe('unsupported');
      expect(nfc.state()).toBe('unsupported');
    });

    it("rejects when the session can't start, and keeps the state in step", async () => {
      stubModule({ start: { error: 'disabled' } });
      const nfc = createNfc();
      const { code, message } = await rejection(nfc.read());
      expect({ code, message }).toEqual({
        code: 'disabled',
        message: "NFC is turned off in the phone's settings.",
      });
      expect(nfc.state()).toBe('disabled');
    });

    it('sets the state when a tag answers that the phone has no NFC', async () => {
      const { answer } = stubModule();
      const nfc = createNfc();
      await settle();
      const read = rejection(nfc.read());
      await answer({ error: 'unsupported' });
      await read;
      expect(nfc.state()).toBe('unsupported');
    });

    it('refuses a second call while one is open, and takes one once it ends', async () => {
      const { answer } = stubModule();
      const nfc = createNfc();
      const first = nfc.read();
      expect((await rejection(nfc.read())).code).toBe('busy');
      expect(
        (await rejection(nfc.write([{ type: 'text', value: 'a' }]))).code,
      ).toBe('busy');
      await answer({ tag: rawTag });
      await first;

      const second = nfc.read();
      await answer({ tag: rawTag });
      await expect(second).resolves.toMatchObject({ writable: true });
    });

    it('stops the session when the module goes away mid-read', async () => {
      const { module } = stubModule();
      const nfc = createNfc();
      module.next.mockImplementation(() => {
        throw new Error('gone');
      });
      expect((await rejection(nfc.read())).code).toBe('unsupported');
      expect(module.stop).toHaveBeenCalled();
    });

    it('lets the next call start when stopping fails', async () => {
      const { module, answer } = stubModule();
      const nfc = createNfc();
      module.stop.mockImplementationOnce(() => {
        throw new Error('gone');
      });
      const first = nfc.read();
      await answer({ tag: rawTag });
      await first;
      const second = nfc.read();
      await answer({ tag: rawTag });
      await expect(second).resolves.toBeDefined();
    });
  });

  describe('write', () => {
    it('sends the records to write with the session, and resolves with the tag as written', async () => {
      const { module, answer } = stubModule();
      const write = createNfc().write(
        [{ type: 'url', value: 'https://example.com' }],
        { alertMessage: 'Hold the tag near the phone' },
      );
      await answer({ tag: rawTag });
      await expect(write).resolves.toMatchObject({
        records: [{ type: 'url', value: 'https://example.com' }],
      });
      expect(module.start).toHaveBeenCalledWith(
        {
          multiple: false,
          alertMessage: 'Hold the tag near the phone',
          write: [rawTag.records[0]],
        },
        expect.any(Function),
      );
      expect(module.stop).toHaveBeenCalledWith({}, expect.any(Function));
    });

    it("throws for no records, or one a tag can't hold, before anything opens", async () => {
      const { module } = stubModule();
      const nfc = createNfc();
      await expect(nfc.write([])).rejects.toThrow(TypeError);
      await expect(nfc.write([{ type: 'url', value: '' }])).rejects.toThrow(
        TypeError,
      );
      expect(module.start).not.toHaveBeenCalled();
    });

    it('rejects with readOnly and tooLarge', async () => {
      const { answer } = stubModule();
      const nfc = createNfc();
      const locked = rejection(nfc.write([{ type: 'text', value: 'a' }]));
      await answer({ error: 'readOnly' });
      expect((await locked).code).toBe('readOnly');

      const big = rejection(nfc.write([{ type: 'text', value: 'a' }]));
      await answer({ error: 'tooLarge', message: 'Needs 900 bytes, has 137.' });
      expect(await big).toEqual({
        code: 'tooLarge',
        message: 'Needs 900 bytes, has 137.',
      });
    });
  });

  describe('scan', () => {
    it('calls back with each tag until stopped, then closes the sheet', async () => {
      const { module, answer } = stubModule();
      const nfc = createNfc();
      const onTag = vi.fn();
      const scan = await nfc.scan(
        { alertMessage: 'Tap each tag', successMessage: 'All done' },
        onTag,
      );
      expect(scan.scanning()).toBe(true);
      expect(module.start).toHaveBeenCalledWith(
        { multiple: true, alertMessage: 'Tap each tag' },
        expect.any(Function),
      );

      await answer({ tag: rawTag });
      await answer({ tag: { ...rawTag, id: 'ff' } });
      expect(onTag.mock.calls.map(([tag]) => tag.id)).toEqual(['04a1b2', 'ff']);

      await scan.stop();
      await settle();
      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toBeUndefined();
      expect(module.stop).toHaveBeenCalledTimes(1);
      expect(module.stop).toHaveBeenCalledWith(
        { message: 'All done' },
        expect.any(Function),
      );
      // A second stop does nothing.
      await scan.stop();
      expect(module.stop).toHaveBeenCalledTimes(1);
    });

    it('drops a tag whose answer comes after stop()', async () => {
      const { module, answer } = stubModule();
      // The shells answered with a tag before they heard the stop.
      module.stop.mockImplementation((_options: unknown, done: Done) =>
        done({}),
      );
      const onTag = vi.fn();
      const scan = await createNfc().scan({}, onTag);
      await settle();
      await scan.stop();
      await answer({ tag: rawTag });
      expect(onTag).not.toHaveBeenCalled();
      expect(scan.scanning()).toBe(false);
    });

    it("hands an app's throwing handler to the ErrorHandler, and keeps scanning", async () => {
      const { answer } = stubModule();
      const failure = new Error('bad handler');
      const scan = await createNfc().scan({}, () => {
        throw failure;
      });
      await answer({ tag: rawTag });
      expect(handleError).toHaveBeenCalledWith(failure);
      expect(scan.scanning()).toBe(true);
      await scan.stop();
    });

    it('ends with an error when iOS closes its sheet, and lets the next call start', async () => {
      const { module, answer } = stubModule();
      const nfc = createNfc();
      const scan = await nfc.scan({}, vi.fn());
      await answer({ error: 'canceled' });
      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toEqual(
        new NfcError('canceled', 'The NFC session was canceled.'),
      );
      expect(module.stop).toHaveBeenCalledWith({}, expect.any(Function));
      await scan.stop();

      const read = nfc.read();
      await answer({ tag: rawTag });
      await expect(read).resolves.toBeDefined();
    });

    it('ends without an error when the session stopped by itself', async () => {
      const { answer } = stubModule();
      const scan = await createNfc().scan({}, vi.fn());
      await answer({ error: 'stopped' });
      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toBeUndefined();
    });

    it('ends as failed when the module answers with neither a tag nor an error', async () => {
      const { answer } = stubModule();
      const scan = await createNfc().scan({}, vi.fn());
      await answer({});
      expect(scan.error()?.code).toBe('failed');
    });

    it('ends with unsupported when the module goes away', async () => {
      const { module } = stubModule();
      const nfc = createNfc();
      module.next.mockImplementation(() => {
        throw new Error('gone');
      });
      const scan = await nfc.scan({}, vi.fn());
      await settle();
      await settle();
      expect(scan.error()?.code).toBe('unsupported');
    });

    it("rejects when it can't start", async () => {
      stubModule({ start: { error: 'busy' } });
      expect((await rejection(createNfc().scan({}, vi.fn()))).code).toBe(
        'busy',
      );
    });
  });
});
