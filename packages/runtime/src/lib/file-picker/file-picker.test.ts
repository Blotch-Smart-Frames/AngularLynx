import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../network/base64';
import { LynxBlob } from '../network/blob';
import {
  FILE_PICKER_MAX_BYTES,
  FilePickerError,
  type FilePickerErrorCode,
  LynxFilePicker,
  type PickedFile,
} from './file-picker';

type NativeResult = Record<string, unknown>;
type Done = (result: NativeResult) => void;

const createPicker = () =>
  Injector.create({ providers: [LynxFilePicker] }).get(LynxFilePicker);

/**
 * Stands in for the shells' AngularLynxFilePicker module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly. `finish` closes the open picker the way the platform
 * would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const call = vi.fn((_request: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', {
    AngularLynxFilePicker: { pick: call, save: call },
  });
  return { call, finish: (result: NativeResult) => done?.(result) };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: FilePickerErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FilePickerError);
  const { code, message } = error as FilePickerError;
  return { code, message };
};

const bytesOf = async (file: PickedFile) => [
  ...new Uint8Array(await file.blob.arrayBuffer()),
];

/**
 * A Blob that says it's `size` bytes, without holding them.
 */
const blobOfSize = (size: number) =>
  ({ size, type: 'application/pdf', arrayBuffer: vi.fn() }) as unknown as Blob;

describe('LynxFilePicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('pick() in the apps ng build --platform makes', () => {
    it('resolves with each picked file as a Blob of its type', async () => {
      const { call, finish } = stubModule();

      const picked = createPicker().pick({
        types: ['application/pdf', '.docx', 'image/*'],
        multiple: true,
      });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({
        files: [
          {
            base64: bytesToBase64(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
            name: 'receipt.pdf',
            type: 'application/pdf',
          },
          { base64: 'AQI=', name: 'notes', type: '' },
        ],
      });

      const [pdf, notes] = await picked;
      expect(pdf).toMatchObject({
        name: 'receipt.pdf',
        type: 'application/pdf',
        size: 4,
      });
      expect(pdf!.blob).toBeInstanceOf(Blob);
      expect(pdf!.blob.type).toBe('application/pdf');
      expect(await bytesOf(pdf!)).toEqual([0x25, 0x50, 0x44, 0x46]);
      // A type the platform doesn't know is the web's default for bytes.
      expect(notes).toMatchObject({
        name: 'notes',
        type: 'application/octet-stream',
        size: 2,
      });
      expect(call).toHaveBeenCalledWith(
        {
          types: ['application/pdf', '.docx', 'image/*'],
          multiple: true,
          maxBytes: FILE_PICKER_MAX_BYTES,
        },
        expect.any(Function),
      );
    });

    it('asks for one file of any type by default', async () => {
      const { call, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({ files: [] });

      await expect(picked).resolves.toEqual([]);
      expect(call).toHaveBeenCalledWith(
        { types: [], multiple: false, maxBytes: FILE_PICKER_MAX_BYTES },
        expect.any(Function),
      );
    });

    it('brings the main thread’s Blob, which an app that picks files needn’t name', async () => {
      // An app's main thread has a Blob only where a module names it
      // (network/enable.ts).
      vi.stubGlobal('Blob', undefined);
      const { call, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({ files: [{ base64: 'AQI=', name: 'a.csv', type: 'text/csv' }] });

      const [file] = await picked;
      expect(globalThis.Blob).toBe(LynxBlob);
      expect(file!.blob).toBeInstanceOf(LynxBlob);
      expect(await bytesOf(file!)).toEqual([1, 2]);
    });

    it('resolves with [] when the person closes the picker', async () => {
      const { call, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({ canceled: true });

      await expect(picked).resolves.toEqual([]);
    });

    it('rejects with too-large when the module refuses the files’ size', async () => {
      const { call, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({ error: 'too-large', message: 'big' });

      const { code, message } = await rejection(picked);
      expect(code).toBe('too-large');
      expect(message).toMatch(/20 MiB/);
    });

    it('rejects with failed and the module’s message', async () => {
      const { call, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      finish({ error: 'failed', message: 'A picker is already open.' });

      expect(await rejection(picked)).toEqual({
        code: 'failed',
        message: 'A picker is already open.',
      });
    });

    it.each([
      [{ files: [{ name: 'a.pdf', type: 'application/pdf' }] }],
      [{ files: [{ base64: 'AQI=', type: 'application/pdf' }] }],
      [{ files: [null] }],
      [{}],
      [undefined],
    ])(
      'rejects with failed when the answer %j has no files',
      async (answer) => {
        const { call, finish } = stubModule();

        const picked = createPicker().pick();
        await vi.waitFor(() => expect(call).toHaveBeenCalled());
        finish(answer as unknown as NativeResult);

        expect(await rejection(picked)).toEqual({
          code: 'failed',
          message: "The picked files couldn't be read.",
        });
      },
    );

    it.each([
      [['pdf']],
      [['application/']],
      [['*/*/*']],
      [[42]],
      ['application/pdf'],
    ])('refuses the types %j', async (types) => {
      const { call } = stubModule();

      await expect(
        createPicker().pick({ types: types as unknown as string[] }),
      ).rejects.toThrow(TypeError);
      expect(call).not.toHaveBeenCalled();
    });
  });

  describe('save() in the apps ng build --platform makes', () => {
    it('sends the file as base64 with its name and type, and resolves true once saved', async () => {
      const { call, finish } = stubModule();

      const saved = createPicker().save({
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'text/csv' }),
        name: 'report.csv',
      });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      const [request] = call.mock.calls[0]!;
      expect(request).toMatchObject({ name: 'report.csv', type: 'text/csv' });
      expect([
        ...base64ToBytes((request as { base64: string }).base64),
      ]).toEqual([1, 2, 3]);
      finish({ saved: true });

      await expect(saved).resolves.toBe(true);
    });

    it('sends a Blob without a type as bytes', async () => {
      const { call, finish } = stubModule();

      const saved = createPicker().save({ blob: new Blob(['x']), name: 'x' });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      expect(call.mock.calls[0]![0]).toMatchObject({
        type: 'application/octet-stream',
      });
      finish({ saved: true });
      await saved;
    });

    it.each([[{ saved: false }], [{ canceled: true }]])(
      'resolves false when the person closes the screen (%j)',
      async (answer) => {
        const { call, finish } = stubModule();

        const saved = createPicker().save({
          blob: new Blob(['x']),
          name: 'x.txt',
        });
        await vi.waitFor(() => expect(call).toHaveBeenCalled());
        finish(answer);

        await expect(saved).resolves.toBe(false);
      },
    );

    it('rejects with failed and the module’s message, or its own', async () => {
      const { call, finish } = stubModule();
      const picker = createPicker();

      const first = picker.save({ blob: new Blob(['x']), name: 'x.txt' });
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      finish({ error: 'failed', message: 'The disk is full.' });
      expect(await rejection(first)).toEqual({
        code: 'failed',
        message: 'The disk is full.',
      });

      const second = picker.save({ blob: new Blob(['x']), name: 'x.txt' });
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      finish(undefined as unknown as NativeResult);
      expect(await rejection(second)).toEqual({
        code: 'failed',
        message: "The file couldn't be saved.",
      });
    });

    it('rejects with too-large before reading a file over the limit', async () => {
      const { call } = stubModule();
      const blob = blobOfSize(FILE_PICKER_MAX_BYTES + 1);

      expect(
        (await rejection(createPicker().save({ blob, name: 'big.pdf' }))).code,
      ).toBe('too-large');
      expect(blob.arrayBuffer).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    });

    it.each([
      [null],
      [{ name: 'a.pdf' }],
      [{ blob: {}, name: 'a.pdf' }],
      [{ blob: new Blob(['x']) }],
      [{ blob: new Blob(['x']), name: '' }],
    ])('refuses %o', async (file) => {
      const { call } = stubModule();

      await expect(createPicker().save(file as never)).rejects.toThrow(
        TypeError,
      );
      expect(call).not.toHaveBeenCalled();
    });
  });

  it.each(['pick', 'save'] as const)(
    '%s() rejects with unavailable where the host has no module, as in Lynx Explorer',
    async (method) => {
      vi.stubGlobal('NativeModules', {});
      const picker = createPicker();

      const { code, message } = await rejection(
        method === 'pick'
          ? picker.pick()
          : picker.save({ blob: new Blob(['x']), name: 'x.txt' }),
      );

      expect(code).toBe('unavailable');
      expect(message).toMatch(/"filePicker": true/);
    },
  );
});

// ─── The web preview ─────────────────────────────────────────────────────────

type Listener = () => void;

/**
 * A file the person picks, as the browser's `<input>` hands it over.
 */
const fileOf = (bytes: number[], type: string, name: string) =>
  Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });

/**
 * A page window with just what the web picker uses: `<input>`, `<a>` and
 * object URLs. `choose()` and `cancel()` stand in for the person.
 */
const stubPage = ({ parent = true } = {}) => {
  type Input = {
    type: string;
    accept: string;
    multiple: boolean;
    style: { display: string };
    files: ReturnType<typeof fileOf>[] | null;
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    listeners: Map<string, Listener>;
    addEventListener(type: string, listener: Listener): void;
  };
  const inputs: Input[] = [];
  const anchors: {
    href: string;
    download: string;
    style: { display: string };
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }[] = [];
  const document = {
    body: { appendChild: vi.fn() },
    createElement: (tag: string) => {
      if (tag === 'a') {
        const anchor = {
          href: '',
          download: '',
          style: { display: '' },
          click: vi.fn(),
          remove: vi.fn(),
        };
        anchors.push(anchor);
        return anchor;
      }
      const input: Input = {
        type: '',
        accept: '',
        multiple: false,
        style: { display: '' },
        files: null,
        click: vi.fn(),
        remove: vi.fn(),
        listeners: new Map(),
        addEventListener(type, listener) {
          this.listeners.set(type, listener);
        },
      };
      inputs.push(input);
      return input;
    },
  };
  const timers: (() => void)[] = [];
  const window = {
    document,
    URL: {
      createObjectURL: vi.fn(() => 'blob:page/1'),
      revokeObjectURL: vi.fn(),
    },
    setTimeout: vi.fn((handler: () => void) => timers.push(handler)),
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  // Angular's realm is web-core's hidden iframe; the page holds the input.
  if (parent) {
    vi.stubGlobal('parent', window);
  } else {
    vi.stubGlobal('parent', undefined);
    vi.stubGlobal('document', document);
    vi.stubGlobal('URL', window.URL);
    vi.stubGlobal('setTimeout', window.setTimeout);
  }
  const last = () => inputs[inputs.length - 1]!;
  return {
    window,
    document,
    inputs,
    anchors,
    timers,
    choose: (...files: ReturnType<typeof fileOf>[]) => {
      last().files = files;
      last().listeners.get('change')!();
    },
    cancel: () => last().listeners.get('cancel')!(),
  };
};

describe('LynxFilePicker in the web preview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a file input with the types in the page and resolves with the files', async () => {
    const page = stubPage();

    const picked = createPicker().pick({
      types: ['application/pdf', '.csv'],
      multiple: true,
    });
    const input = page.inputs[0]!;
    expect(input).toMatchObject({
      type: 'file',
      accept: 'application/pdf,.csv',
      multiple: true,
      style: { display: 'none' },
    });
    expect(page.document.body.appendChild).toHaveBeenCalledWith(input);
    expect(input.click).toHaveBeenCalled();
    page.choose(
      fileOf([1, 2, 3], 'application/pdf', 'a.pdf'),
      fileOf([4], '', 'b.csv'),
    );

    const [pdf, csv] = await picked;
    expect(pdf).toMatchObject({
      name: 'a.pdf',
      type: 'application/pdf',
      size: 3,
    });
    expect(await bytesOf(pdf!)).toEqual([1, 2, 3]);
    expect(csv).toMatchObject({
      name: 'b.csv',
      type: 'application/octet-stream',
      size: 1,
    });
    expect(input.remove).toHaveBeenCalled();
  });

  it('accepts any one file by default', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    expect(page.inputs[0]).toMatchObject({ accept: '', multiple: false });
    page.choose();

    await expect(picked).resolves.toEqual([]);
  });

  it('resolves with [] when a change brings no file list', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    page.inputs[0]!.listeners.get('change')!();

    await expect(picked).resolves.toEqual([]);
  });

  it('resolves with [] when the person closes the dialog, and only once', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    page.cancel();
    page.choose(fileOf([1], 'text/plain', 'late.txt'));

    await expect(picked).resolves.toEqual([]);
  });

  it('ends an open pick with [] when another starts', async () => {
    const page = stubPage();
    const picker = createPicker();

    const first = picker.pick();
    const second = picker.pick();
    page.choose(fileOf([7], 'text/plain', 'b.txt'));

    await expect(first).resolves.toEqual([]);
    expect((await second).map((file) => file.name)).toEqual(['b.txt']);
  });

  it('rejects with too-large when the files picked are over the limit', async () => {
    const page = stubPage();

    const picked = createPicker().pick({ multiple: true });
    page.choose(
      Object.defineProperty(fileOf([1], 'application/pdf', 'a.pdf'), 'size', {
        value: FILE_PICKER_MAX_BYTES,
      }),
      fileOf([1], 'application/pdf', 'b.pdf'),
    );

    expect((await rejection(picked)).code).toBe('too-large');
  });

  it('rejects with failed when the input can’t open', async () => {
    const page = stubPage();
    const create = page.document.createElement;
    page.document.createElement = (tag: string) => {
      const element = create(tag) as { click: () => void };
      element.click = () => {
        throw new Error('blocked');
      };
      return element;
    };

    const { code, message } = await rejection(createPicker().pick());

    expect(code).toBe('failed');
    expect(message).toMatch(/blocked/);
  });

  it('saves a file as a download from the page, and resolves true', async () => {
    const page = stubPage();
    const blob = new Blob(['a,b'], { type: 'text/csv' });

    await expect(
      createPicker().save({ blob, name: 'report.csv' }),
    ).resolves.toBe(true);

    expect(page.window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    const anchor = page.anchors[0]!;
    expect(anchor).toMatchObject({
      href: 'blob:page/1',
      download: 'report.csv',
      style: { display: 'none' },
    });
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
    // The URL is let go once the browser has started saving.
    expect(page.window.URL.revokeObjectURL).not.toHaveBeenCalled();
    page.timers[0]!();
    expect(page.window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:page/1');
  });

  it('uses the frame itself where it has no parent', async () => {
    const page = stubPage({ parent: false });

    const picked = createPicker().pick();
    expect(page.inputs).toHaveLength(1);
    page.cancel();
    await expect(picked).resolves.toEqual([]);
  });

  it('uses the frame itself where the page is of another origin', async () => {
    const page = stubPage({ parent: false });
    Object.defineProperty(globalThis, 'parent', {
      configurable: true,
      get() {
        throw new Error('cross-origin');
      },
    });

    try {
      await createPicker().save({ blob: new Blob(['x']), name: 'x.txt' });
      expect(page.anchors).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(globalThis, 'parent');
    }
  });
});
