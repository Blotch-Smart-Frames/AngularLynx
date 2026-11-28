/**
 * LynxAppleSignIn under the testing library: the setup gives the
 * environment's background thread an AngularLynxAppleSignIn module, which
 * signs the person in as a spec says, so a spec can drive the app's sign-in
 * screen without Apple's sheet.
 */

import { Component, Injector, inject, signal } from '@angular/core';
import {
  type AppleSignInError,
  LYNX_ELEMENTS,
  LynxAppleSignIn,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { installAppleSignInModule } from './apple-sign-in.js';
import {
  appleSignInRequests,
  fireEvent,
  render,
  screen,
  setAppleCredentialState,
  setAppleSignInAvailable,
  setAppleSignInError,
  setAppleSignInResult,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'apple-sign-in-screen',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="signIn()"><text>Sign in with Apple</text></view>
    <text>{{ status() }}</text>
  `,
})
class SignInScreen {
  readonly #appleSignIn = inject(LynxAppleSignIn);
  readonly status = signal('signed out');

  async signIn() {
    try {
      const result = await this.#appleSignIn.signIn({
        scopes: ['email'],
        nonce: 'n1',
      });
      this.status.set(`signed in as ${result.email ?? result.user}`);
    } catch (error) {
      this.status.set(`error: ${(error as AppleSignInError).code}`);
    }
  }
}

/**
 * The service outside a component, for checks that need no screen.
 */
const service = () =>
  Injector.create({ providers: [LynxAppleSignIn] }).get(LynxAppleSignIn);

const tapSignIn = async () => {
  fireEvent.tap(screen.getByText('Sign in with Apple').parentElement!);
  await settle();
};

describe('the fake Sign in with Apple module', () => {
  it('signs the person in with what setAppleSignInResult() gives', async () => {
    setAppleSignInResult({ user: 'u1', email: 'ada@example.com' });
    await render(SignInScreen);

    await tapSignIn();

    expect(
      screen.getByText('signed in as ada@example.com'),
    ).toBeInTheDocument();
    expect(appleSignInRequests()).toEqual([{ scopes: ['email'], nonce: 'n1' }]);
  });

  // Until a spec says otherwise, the person closes the sheet.
  it('cancels a sign-in nobody set a result for', async () => {
    await render(SignInScreen);

    await tapSignIn();

    expect(screen.getByText('error: canceled')).toBeInTheDocument();
  });

  it('fails the sign-ins setAppleSignInError() says to', async () => {
    setAppleSignInError('failed', 'No network');
    await expect(service().signIn()).rejects.toMatchObject({
      code: 'failed',
      message: 'No network',
    });

    setAppleSignInError('canceled');
    await expect(service().signIn()).rejects.toMatchObject({
      code: 'canceled',
      message: 'The sign-in was canceled.',
    });
  });

  it('fills in test values, and shares the email and name only for their scopes', async () => {
    setAppleSignInResult({
      email: 'ada@example.com',
      fullName: { givenName: 'Ada' },
    });
    const appleSignIn = service();

    await expect(appleSignIn.signIn()).resolves.toEqual({
      user: 'test-apple-user',
      identityToken: 'test-identity-token',
      authorizationCode: 'test-authorization-code',
      realUserStatus: 'likelyReal',
    });
    await expect(
      appleSignIn.signIn({ scopes: ['email', 'fullName'], state: 's' }),
    ).resolves.toEqual({
      user: 'test-apple-user',
      identityToken: 'test-identity-token',
      authorizationCode: 'test-authorization-code',
      realUserStatus: 'likelyReal',
      email: 'ada@example.com',
      fullName: { givenName: 'Ada' },
      state: 's',
    });

    setAppleSignInResult({
      user: 'u2',
      identityToken: 'jwt',
      authorizationCode: 'code',
      realUserStatus: 'unknown',
    });
    await expect(appleSignIn.signIn()).resolves.toEqual({
      user: 'u2',
      identityToken: 'jwt',
      authorizationCode: 'code',
      realUserStatus: 'unknown',
    });

    setAppleSignInResult();
    await expect(appleSignIn.signIn()).resolves.toMatchObject({
      user: 'test-apple-user',
    });
  });

  it('has each user it signs in authorized, and others as setAppleCredentialState() says', async () => {
    const appleSignIn = service();
    await expect(appleSignIn.getCredentialState('u1')).resolves.toBe(
      'notFound',
    );

    setAppleSignInResult({ user: 'u1' });
    await appleSignIn.signIn();
    await expect(appleSignIn.getCredentialState('u1')).resolves.toBe(
      'authorized',
    );

    setAppleCredentialState('u1', 'revoked');
    await expect(appleSignIn.getCredentialState('u1')).resolves.toBe('revoked');
  });

  it('is available, until setAppleSignInAvailable(false) takes it away', async () => {
    const appleSignIn = service();
    await expect(appleSignIn.isAvailable()).resolves.toBe(true);

    setAppleSignInAvailable(false);
    await expect(appleSignIn.isAvailable()).resolves.toBe(false);
    await expect(appleSignIn.signIn()).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(appleSignIn.getCredentialState('u1')).rejects.toMatchObject({
      code: 'unsupported',
    });

    setAppleSignInAvailable(true);
    await expect(appleSignIn.isAvailable()).resolves.toBe(true);
  });

  // A spec can switch the sheet off after a sign-in and still check it.
  it('keeps the sign-ins and users while the sheet is away', async () => {
    setAppleSignInResult({ user: 'u1' });
    const appleSignIn = service();
    await appleSignIn.signIn({ scopes: ['email'] });

    setAppleSignInAvailable(false);
    // Nothing opens without the sheet, so nothing more is listed.
    await expect(appleSignIn.signIn()).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(appleSignInRequests()).toEqual([{ scopes: ['email'] }]);

    setAppleSignInAvailable(true);
    expect(appleSignInRequests()).toEqual([{ scopes: ['email'] }]);
    await expect(appleSignIn.getCredentialState('u1')).resolves.toBe(
      'authorized',
    );
  });

  // The reset after the previous test installed a new module.
  it('starts each test with the module, no sign-ins and no users', async () => {
    expect(appleSignInRequests()).toEqual([]);
    const appleSignIn = service();
    await expect(appleSignIn.isAvailable()).resolves.toBe(true);
    await expect(appleSignIn.getCredentialState('u1')).resolves.toBe(
      'notFound',
    );
  });

  it('needs the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    try {
      (globalThis as any).lynxTestingEnv = undefined;
      expect(appleSignInRequests()).toEqual([]);
      expect(() => setAppleSignInResult()).toThrow(
        /needs the testing library's environment/,
      );
      expect(() => setAppleSignInAvailable(false)).toThrow(
        /needs the testing library's environment/,
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });

  it('keeps the modules the thread already has', () => {
    const other = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { Other: other },
    };
    installAppleSignInModule(globals);
    expect(globals.NativeModules?.['Other']).toBe(other);
    expect(globals.NativeModules?.['AngularLynxAppleSignIn']).toBeDefined();

    const empty: { NativeModules?: Record<string, unknown> } = {};
    installAppleSignInModule(empty);
    expect(Object.keys(empty.NativeModules ?? {})).toEqual([
      'AngularLynxAppleSignIn',
    ]);
  });
});
