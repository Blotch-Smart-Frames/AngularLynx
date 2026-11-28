import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BiometricsError,
  type BiometricsErrorCode,
  LynxBiometrics,
} from './biometrics';

type NativeResult = Record<string, unknown>;
type Done = (result: NativeResult) => void;

const create = () =>
  Injector.create({ providers: [LynxBiometrics] }).get(LynxBiometrics);

/**
 * Stands in for the shells' AngularLynxBiometrics module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly.
 */
const stubModule = (
  answers: {
    availability?: NativeResult | undefined;
    authenticate?: NativeResult | undefined;
  } = {},
) => {
  // `in`, not defaults, so a spec can have the module answer undefined.
  const availability =
    'availability' in answers
      ? answers.availability
      : { type: 'faceID', enrolled: true, deviceCredential: true };
  const authenticate = 'authenticate' in answers ? answers.authenticate : {};
  const module = {
    availability: vi.fn((done: Done) => done(availability!)),
    authenticate: vi.fn((_options: unknown, done: Done) => done(authenticate!)),
  };
  vi.stubGlobal('NativeModules', { AngularLynxBiometrics: module });
  return module;
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: BiometricsErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BiometricsError);
  const { code, message, name } = error as BiometricsError;
  expect(name).toBe('BiometricsError');
  return { code, message };
};

describe('LynxBiometrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('availability()', () => {
    it.each(['faceID', 'touchID', 'opticID', 'fingerprint', 'face', 'iris'])(
      'reports a %s sensor as the module does',
      async (type) => {
        stubModule({
          availability: { type, enrolled: true, deviceCredential: true },
        });
        await expect(create().availability()).resolves.toEqual({
          type,
          enrolled: true,
          deviceCredential: true,
        });
      },
    );

    it('reports a sensor nobody has set up', async () => {
      stubModule({
        availability: { type: 'touchID', enrolled: false },
      });
      await expect(create().availability()).resolves.toEqual({
        type: 'touchID',
        enrolled: false,
        deviceCredential: false,
      });
    });

    it('reports none, never enrolled, for a type it doesn’t know or no answer', async () => {
      stubModule({ availability: { type: 'tongue', enrolled: true } });
      await expect(create().availability()).resolves.toEqual({
        type: 'none',
        enrolled: false,
        deviceCredential: false,
      });
      stubModule({ availability: undefined });
      await expect(create().availability()).resolves.toEqual({
        type: 'none',
        enrolled: false,
        deviceCredential: false,
      });
    });

    it('reports none where the host has no module, as in Lynx Explorer', async () => {
      vi.stubGlobal('NativeModules', {});
      await expect(create().availability()).resolves.toEqual({
        type: 'none',
        enrolled: false,
        deviceCredential: false,
      });
    });
  });

  describe('authenticate()', () => {
    it('resolves once the module confirms the person', async () => {
      const module = stubModule();
      await expect(
        create().authenticate({ reason: 'Unlock your notes' }),
      ).resolves.toBeUndefined();
      expect(module.authenticate).toHaveBeenCalledWith(
        { reason: 'Unlock your notes', allowDeviceCredential: false },
        expect.any(Function),
      );
    });

    it('passes the device credential, the title and the cancel label on', async () => {
      const module = stubModule();
      await create().authenticate({
        reason: 'Pay',
        allowDeviceCredential: true,
        title: 'Shop',
        cancelLabel: 'Not now',
      });
      expect(module.authenticate).toHaveBeenCalledWith(
        {
          reason: 'Pay',
          allowDeviceCredential: true,
          title: 'Shop',
          cancelLabel: 'Not now',
        },
        expect.any(Function),
      );
    });

    it.each([
      ['canceled', 'The biometric prompt was canceled.'],
      ['lockout', 'Biometrics are locked after too many failed tries.'],
      ['notEnrolled', 'No face or fingerprint is set up on this phone.'],
      ['unavailable', expect.stringMatching(/permissions\.biometrics/)],
      ['failed', "The person couldn't be confirmed."],
    ])('rejects with %s', async (error, message) => {
      stubModule({ authenticate: { error } });
      expect(await rejection(create().authenticate({ reason: 'x' }))).toEqual({
        code: error,
        message,
      });
    });

    it('rejects with the module’s message, and failed for a code it doesn’t know', async () => {
      stubModule({
        authenticate: { error: 'sensorOnFire', message: 'Hot.' },
      });
      expect(await rejection(create().authenticate({ reason: 'x' }))).toEqual({
        code: 'failed',
        message: 'Hot.',
      });
    });

    it('resolves when the module answers nothing', async () => {
      stubModule({ authenticate: undefined });
      await expect(
        create().authenticate({ reason: 'x' }),
      ).resolves.toBeUndefined();
    });

    it('rejects with unavailable where the host has no module', async () => {
      vi.stubGlobal('NativeModules', {});
      const { code, message } = await rejection(
        create().authenticate({ reason: 'x' }),
      );
      expect(code).toBe('unavailable');
      expect(message).toMatch(/ng build --platform/);
    });

    it.each(['', '   ', undefined])('refuses the reason %o', async (reason) => {
      const module = stubModule();
      await expect(
        create().authenticate({ reason: reason as string }),
      ).rejects.toThrow(TypeError);
      expect(module.authenticate).not.toHaveBeenCalled();
    });
  });
});
