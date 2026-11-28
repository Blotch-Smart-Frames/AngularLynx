import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppleSignInError,
  type AppleSignInErrorCode,
  LynxAppleSignIn,
} from './apple-sign-in';

type Done = (result: unknown) => void;

const createSignIn = () =>
  Injector.create({ providers: [LynxAppleSignIn] }).get(LynxAppleSignIn);

/**
 * Stands in for the iOS shell's AngularLynxAppleSignIn module, as the
 * background thread sees it. Each method answers with what it's given.
 */
const stubModule = (answers: {
  signIn?: unknown;
  credentialState?: unknown;
  available?: unknown;
}) => {
  const module = {
    available: vi.fn((done: Done) => done(answers.available)),
    signIn: vi.fn((_request: unknown, done: Done) => done(answers.signIn)),
    credentialState: vi.fn((_user: string, done: Done) =>
      done(answers.credentialState),
    ),
  };
  vi.stubGlobal('NativeModules', { AngularLynxAppleSignIn: module });
  return module;
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: AppleSignInErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppleSignInError);
  const { code, message } = error as AppleSignInError;
  return { code, message };
};

const CREDENTIAL = {
  user: '001234.abcd',
  identityToken: 'eyJ.token',
  authorizationCode: 'c0de',
  realUserStatus: 'likelyReal',
};

describe('LynxAppleSignIn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('signIn', () => {
    it('asks for the scopes, nonce and state, and resolves with the credential', async () => {
      const module = stubModule({
        signIn: {
          ...CREDENTIAL,
          email: 'a@privaterelay.appleid.com',
          fullName: { givenName: 'Ada', familyName: 'Lovelace' },
          state: 's1',
        },
      });

      await expect(
        createSignIn().signIn({
          scopes: ['email', 'fullName'],
          nonce: 'hashed',
          state: 's1',
        }),
      ).resolves.toEqual({
        ...CREDENTIAL,
        email: 'a@privaterelay.appleid.com',
        fullName: { givenName: 'Ada', familyName: 'Lovelace' },
        state: 's1',
      });
      expect(module.signIn).toHaveBeenCalledWith(
        { scopes: ['email', 'fullName'], nonce: 'hashed', state: 's1' },
        expect.any(Function),
      );
    });

    // Apple gives the email and name on the first sign-in only.
    it('leaves out what a later sign-in has no value for', async () => {
      const module = stubModule({
        signIn: {
          user: 'u',
          identityToken: 't',
          authorizationCode: 'c',
        },
      });

      await expect(createSignIn().signIn()).resolves.toEqual({
        user: 'u',
        identityToken: 't',
        authorizationCode: 'c',
        realUserStatus: 'unknown',
      });
      expect(module.signIn).toHaveBeenCalledWith(
        { scopes: [] },
        expect.any(Function),
      );
    });

    it.each<[unknown, AppleSignInErrorCode, string]>([
      [
        { error: 'canceled', message: 'The sign-in was canceled.' },
        'canceled',
        'The sign-in was canceled.',
      ],
      [{ error: 'canceled' }, 'canceled', 'The sign-in was canceled.'],
      [
        { error: 'failed', message: 'A sign-in is already open.' },
        'failed',
        'A sign-in is already open.',
      ],
      [{ error: 'something new' }, 'failed', 'Sign in with Apple failed.'],
      [
        { user: 'u', authorizationCode: 'c' },
        'failed',
        'Apple returned no user, identity token or authorization code.',
      ],
      [
        undefined,
        'failed',
        'Apple returned no user, identity token or authorization code.',
      ],
    ])('rejects %j as %s', async (answer, code, message) => {
      stubModule({ signIn: answer });

      await expect(rejection(createSignIn().signIn())).resolves.toEqual({
        code,
        message,
      });
    });

    // Android, the web preview, Lynx Explorer and an iOS app without
    // signInWithApple have no module.
    it('rejects with unsupported where the host has no module', async () => {
      vi.stubGlobal('NativeModules', {});

      const { code, message } = await rejection(createSignIn().signIn());
      expect(code).toBe('unsupported');
      expect(message).toContain('LynxWebAuthSession');
    });
  });

  describe('isAvailable', () => {
    it('is true where the module is', async () => {
      stubModule({ available: { available: true } });
      await expect(createSignIn().isAvailable()).resolves.toBe(true);
    });

    it.each([undefined, {}, { available: false }])(
      'is false when the module answers %j',
      async (answer) => {
        stubModule({ available: answer });
        await expect(createSignIn().isAvailable()).resolves.toBe(false);
      },
    );

    it('is false where the host has no module', async () => {
      vi.stubGlobal('NativeModules', {});
      await expect(createSignIn().isAvailable()).resolves.toBe(false);
    });
  });

  describe('getCredentialState', () => {
    it("resolves with Apple's state for the user", async () => {
      const module = stubModule({ credentialState: { state: 'revoked' } });

      await expect(createSignIn().getCredentialState('u')).resolves.toBe(
        'revoked',
      );
      expect(module.credentialState).toHaveBeenCalledWith(
        'u',
        expect.any(Function),
      );
    });

    it.each<[unknown, string]>([
      [{ error: 'failed', message: 'No network' }, 'No network'],
      [undefined, "Apple couldn't say whether the user is signed in."],
    ])('rejects %j as failed', async (answer, message) => {
      stubModule({ credentialState: answer });

      await expect(
        rejection(createSignIn().getCredentialState('u')),
      ).resolves.toEqual({ code: 'failed', message });
    });

    it('rejects with unsupported where the host has no module', async () => {
      vi.stubGlobal('NativeModules', {});

      await expect(
        rejection(createSignIn().getCredentialState('u')),
      ).resolves.toMatchObject({ code: 'unsupported' });
    });
  });
});
