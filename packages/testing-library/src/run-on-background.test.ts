/**
 * runOnBackground() under the testing library (issue #467): a spec's
 * background functions run on the environment's background thread and their
 * results come back, as on a device, instead of the call waiting forever.
 */

import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS, backgroundFn } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the call's answer has come back and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

const double = backgroundFn((n: number) => n * 2);

const threadName = backgroundFn(() =>
  __MAIN_THREAD__ ? 'main' : 'background',
);

const later = backgroundFn(
  (word: string) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(word))),
);

const fails = backgroundFn((): number => {
  throw new Error('No network');
});

const missing = { ...double, _wkltId: 'not-registered' };

@Component({
  selector: 'background-caller',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="call()"><text>Call</text></view>
    <text>Result: {{ result() }}</text>
  `,
})
class BackgroundCaller {
  readonly result = signal('none');

  call(): void {
    runOnBackground(double, 21).then(
      (value) => this.result.set(String(value)),
      (error: Error) => this.result.set(`error: ${error.message}`),
    );
  }
}

describe('runOnBackground', () => {
  it("resolves with the background function's result", async () => {
    await render(BackgroundCaller);

    fireEvent.tap(screen.getByText('Call'));
    await settle();

    expect(screen.getByText('Result: 42')).toBeInTheDocument();
  });

  // Runs after the earlier test's reset(), which gives both threads new
  // contexts, so the listeners have to be found again.
  it('answers in every test', async () => {
    await render(BackgroundCaller);

    fireEvent.tap(screen.getByText('Call'));
    await settle();

    expect(screen.getByText('Result: 42')).toBeInTheDocument();
  });

  it('runs the function on the background thread', async () => {
    await expect(runOnBackground(threadName)).resolves.toBe('background');
    // The spec carries on where it was.
    expect(__MAIN_THREAD__).toBe(true);
  });

  it('waits for a function that returns a promise', async () => {
    await expect(runOnBackground(later, 'done')).resolves.toBe('done');
  });

  it('rejects with what the function throws', async () => {
    await expect(runOnBackground(fails)).rejects.toThrow('No network');
  });

  it('rejects a handle no function was registered for', async () => {
    await expect(runOnBackground(missing)).rejects.toThrow(
      'Background function not found: not-registered',
    );
  });
});
