/**
 * LynxBiometrics and LynxSecureStorage's requireBiometrics in rendered specs
 * (issue #918). There's no face to show a spec, so the testing library's
 * module stands for a phone with Face ID set up, which setBiometrics() and
 * queueBiometricResult() change.
 */

import { Component, inject, signal } from '@angular/core';
import {
  BiometricsError,
  LYNX_ELEMENTS,
  LynxBiometrics,
  LynxSecureStorage,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  biometricPrompts,
  fireEvent,
  queueBiometricResult,
  render,
  screen,
  setBiometrics,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'notes-lock',
  imports: [LYNX_ELEMENTS],
  template: `
    <text>{{ sensor() }}</text>
    <view (bindtap)="unlock()"><text>Unlock</text></view>
    <text>{{ status() }}</text>
  `,
})
class NotesLock {
  readonly #biometrics = inject(LynxBiometrics);
  readonly sensor = signal('…');
  readonly status = signal('Locked');

  constructor() {
    void this.#biometrics
      .availability()
      .then(({ type, enrolled }) =>
        this.sensor.set(`${type}${enrolled ? '' : ', not set up'}`),
      );
  }

  async unlock(): Promise<void> {
    try {
      await this.#biometrics.authenticate({ reason: 'Unlock your notes' });
      this.status.set('Unlocked');
    } catch (error) {
      this.status.set(
        error instanceof BiometricsError ? `Error: ${error.code}` : 'Error',
      );
    }
  }
}

@Component({
  selector: 'token-store',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="save()"><text>Save</text></view>
    <view (bindtap)="read()"><text>Read</text></view>
    <text>{{ status() }}</text>
  `,
})
class TokenStore {
  readonly #storage = inject(LynxSecureStorage);
  readonly status = signal('Nothing yet');

  async save(): Promise<void> {
    try {
      await this.#storage.setItem('refreshToken', 'r1', {
        requireBiometrics: true,
      });
      this.status.set('Saved');
    } catch (error) {
      this.status.set(`Error: ${(error as BiometricsError).code}`);
    }
  }

  async read(): Promise<void> {
    try {
      const token = await this.#storage.getItem<string>('refreshToken', {
        reason: 'Sign in',
      });
      this.status.set(`Token: ${token}`);
    } catch (error) {
      this.status.set(`Error: ${(error as BiometricsError).code}`);
    }
  }
}

describe('LynxBiometrics under the testing library', () => {
  it('sees Face ID set up, and a prompt the person confirms', async () => {
    await render(NotesLock);
    await settle();
    expect(screen.getByText('faceID')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([
      { reason: 'Unlock your notes', allowDeviceCredential: false },
    ]);
  });

  it('ends the next prompt as queued, then confirms again', async () => {
    await render(NotesLock);
    queueBiometricResult('canceled');
    queueBiometricResult('lockout');

    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Error: canceled')).toBeInTheDocument();
    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Error: lockout')).toBeInTheDocument();
    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('starts each test with the default phone and nothing queued', async () => {
    expect(biometricPrompts()).toEqual([]);
    await render(NotesLock);
    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('rejects with notEnrolled on a phone nobody has set up', async () => {
    setBiometrics({ type: 'fingerprint', enrolled: false });
    await render(NotesLock);
    await settle();
    expect(screen.getByText('fingerprint, not set up')).toBeInTheDocument();
    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Error: notEnrolled')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([]);
  });

  it('rejects with unavailable on a phone without a sensor', async () => {
    setBiometrics({ type: 'none' });
    await render(NotesLock);
    fireEvent.tap(screen.getByText('Unlock'));
    await settle();
    expect(screen.getByText('Error: unavailable')).toBeInTheDocument();
  });

  it('lets the passcode stand in where the app allows it', async () => {
    setBiometrics({ type: 'none' });
    await expect(
      new LynxBiometrics().authenticate({
        reason: 'Pay',
        allowDeviceCredential: true,
      }),
    ).resolves.toBeUndefined();
    expect(biometricPrompts()).toEqual([
      { reason: 'Pay', allowDeviceCredential: true },
    ]);
  });
});

describe('LynxSecureStorage’s requireBiometrics under the testing library', () => {
  it('keeps the value, and asks before reading it back', async () => {
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([]);

    fireEvent.tap(screen.getByText('Read'));
    await settle();
    expect(screen.getByText('Token: r1')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([
      { reason: 'Sign in', allowDeviceCredential: false },
    ]);
  });

  it('rejects the read the person cancels', async () => {
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Save'));
    await settle();
    queueBiometricResult('canceled');
    fireEvent.tap(screen.getByText('Read'));
    await settle();
    expect(screen.getByText('Error: canceled')).toBeInTheDocument();
  });

  it('reads a key nobody stored as null, without a prompt', async () => {
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Read'));
    await settle();
    expect(screen.getByText('Token: null')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([]);
  });

  it('can’t read a stored value once the phone can’t prompt, and asks nothing', async () => {
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Save'));
    await settle();
    setBiometrics({ enrolled: false });
    queueBiometricResult('canceled');
    fireEvent.tap(screen.getByText('Read'));
    await settle();
    expect(screen.getByText('Error: notEnrolled')).toBeInTheDocument();
    expect(biometricPrompts()).toEqual([]);
    // The queued result is still waiting for a prompt.
    setBiometrics({ enrolled: true });
    fireEvent.tap(screen.getByText('Read'));
    await settle();
    expect(screen.getByText('Error: canceled')).toBeInTheDocument();
  });

  it('refuses to store behind biometrics on a phone without them', async () => {
    setBiometrics({ type: 'none' });
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Error: unavailable')).toBeInTheDocument();
  });

  it('refuses to store behind biometrics before a face or finger is set up', async () => {
    setBiometrics({ enrolled: false });
    await render(TokenStore);
    fireEvent.tap(screen.getByText('Save'));
    await settle();
    expect(screen.getByText('Error: notEnrolled')).toBeInTheDocument();
  });

  it('removes and clears what it keeps', async () => {
    const storage = new LynxSecureStorage();
    await storage.setItem('a', 1, { requireBiometrics: true });
    await storage.setItem('b', 2, { requireBiometrics: true });
    await storage.removeItem('a');
    await expect(storage.getItem('a')).resolves.toBeNull();
    await storage.clear();
    await expect(storage.getItem('b')).resolves.toBeNull();
  });
});

describe('the helpers outside the environment', () => {
  it('say what they need', () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(() => setBiometrics({})).toThrow(/setup file/);
      expect(() => queueBiometricResult('success')).toThrow(
        /queueBiometricResult\(\)/,
      );
      expect(() => biometricPrompts()).toThrow(/biometricPrompts\(\)/);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
