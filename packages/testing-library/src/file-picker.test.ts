/**
 * LynxFilePicker in rendered specs (issue #924). There's no person to pick a
 * document in a spec, so the testing library's module stands for one who
 * closes the picker, until setPickedFiles() says what they pick, and saves
 * whatever the app offers, which savedFiles() lists.
 */

import { Component, inject, signal } from '@angular/core';
import {
  FILE_PICKER_MAX_BYTES,
  FilePickerError,
  LYNX_ELEMENTS,
  LynxFilePicker,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { installFilePickerModule } from './file-picker.js';
import {
  fireEvent,
  render,
  savedFiles,
  screen,
  setFilePickerCanceled,
  setPickedFiles,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'expense-form',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="attach()"><text>Attach</text></view>
    <view (bindtap)="export()"><text>Export</text></view>
    <text>{{ status() }}</text>
  `,
})
class ExpenseForm {
  readonly #files = inject(LynxFilePicker);
  readonly status = signal('Nothing yet');

  async attach(): Promise<void> {
    try {
      const files = await this.#files.pick({
        types: ['application/pdf'],
        multiple: true,
      });
      const texts = await Promise.all(files.map((file) => file.blob.text()));
      this.status.set(
        files.length === 0
          ? 'Nothing attached'
          : files
              .map((file, i) => `${file.name} ${file.type} ${texts[i]}`)
              .join(', '),
      );
    } catch (error) {
      this.status.set(
        error instanceof FilePickerError ? `Error: ${error.code}` : 'Error',
      );
    }
  }

  async export(): Promise<void> {
    const saved = await this.#files.save({
      blob: new Blob(['Total,42'], { type: 'text/csv' }),
      name: 'report.csv',
    });
    this.status.set(saved ? 'Exported' : 'Not exported');
  }
}

const tap = async (label: string) => {
  fireEvent.tap(screen.getByText(label).parentElement!);
  await settle();
};

describe('LynxFilePicker under the testing library', () => {
  it('closes the picker until a spec says what the person picks', async () => {
    await render(ExpenseForm);
    await tap('Attach');
    expect(screen.getByText('Nothing attached')).toBeInTheDocument();
  });

  it('hands over the files setPickedFiles() gives, as text or bytes', async () => {
    setPickedFiles([
      { name: 'a.pdf', type: 'application/pdf', content: 'one' },
      { name: 'b.bin', content: new Uint8Array([0x74, 0x77, 0x6f]) },
    ]);
    await render(ExpenseForm);
    await tap('Attach');
    expect(
      screen.getByText(
        'a.pdf application/pdf one, b.bin application/octet-stream two',
      ),
    ).toBeInTheDocument();
  });

  it('rejects files over the limit with too-large, as a phone does', async () => {
    setPickedFiles([
      {
        name: 'big.pdf',
        type: 'application/pdf',
        content: new Uint8Array(FILE_PICKER_MAX_BYTES + 1),
      },
    ]);
    await render(ExpenseForm);
    await tap('Attach');
    expect(screen.getByText('Error: too-large')).toBeInTheDocument();
  });

  it('records each file the app saves', async () => {
    await render(ExpenseForm);
    expect(savedFiles()).toEqual([]);
    await tap('Export');
    expect(screen.getByText('Exported')).toBeInTheDocument();
    expect(savedFiles()).toMatchObject([
      { name: 'report.csv', type: 'text/csv', text: 'Total,42' },
    ]);
    expect([...savedFiles()[0]!.bytes]).toEqual([
      ...new TextEncoder().encode('Total,42'),
    ]);
  });

  it('closes both screens after setFilePickerCanceled(), until setPickedFiles()', async () => {
    setPickedFiles([{ name: 'a.pdf', content: 'x' }]);
    setFilePickerCanceled();
    await render(ExpenseForm);
    await tap('Export');
    expect(screen.getByText('Not exported')).toBeInTheDocument();
    expect(savedFiles()).toEqual([]);
    await tap('Attach');
    expect(screen.getByText('Nothing attached')).toBeInTheDocument();

    setPickedFiles([{ name: 'a.pdf', type: 'application/pdf', content: 'x' }]);
    await tap('Attach');
    expect(screen.getByText('a.pdf application/pdf x')).toBeInTheDocument();
  });

  // The reset after the previous test installed a new module.
  it('starts each test with nothing saved', () => {
    expect(savedFiles()).toEqual([]);
  });

  it('needs the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    try {
      (globalThis as any).lynxTestingEnv = undefined;
      expect(() => savedFiles()).toThrow(/savedFiles\(\) needs/);
      expect(() => setPickedFiles([])).toThrow(/setPickedFiles\(\) needs/);
      expect(() => setFilePickerCanceled()).toThrow(
        /setFilePickerCanceled\(\) needs/,
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });

  it('keeps the modules the thread already has, and checks no limit it isn’t given', () => {
    const other = {};
    const globals: { NativeModules?: Record<string, any> } = {
      NativeModules: { Other: other },
    };
    installFilePickerModule(globals);
    expect(globals.NativeModules?.['Other']).toBe(other);
    const module = globals.NativeModules!['AngularLynxFilePicker'];
    module.picks = [{ name: 'a', content: 'x' }];
    let answer: unknown;
    module.pick({}, (result: unknown) => (answer = result));
    expect(answer).toEqual({
      files: [{ base64: 'eA==', name: 'a', type: 'application/octet-stream' }],
    });

    const empty: { NativeModules?: Record<string, unknown> } = {};
    installFilePickerModule(empty);
    expect(Object.keys(empty.NativeModules ?? {})).toEqual([
      'AngularLynxFilePicker',
    ]);
  });
});
