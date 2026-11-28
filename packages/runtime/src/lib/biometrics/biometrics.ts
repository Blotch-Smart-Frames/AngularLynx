import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';

/**
 * The native module of the apps `ng build --platform` makes
 * (`BiometricsModule.swift` and `BiometricsModule.kt` in
 * `packages/native/templates`). Only an app with `permissions.biometrics` in
 * angular.json has it.
 */
export const BIOMETRICS_MODULE = 'AngularLynxBiometrics';

/**
 * The kind of biometric sensor the phone has:
 * - `faceID`, `touchID` and `opticID`: iOS's Face ID, Touch ID and the
 *   Vision Pro's Optic ID.
 * - `fingerprint`, `face` and `iris`: Android's sensors. Android counts only
 *   the strong ones (Class 3), which can unlock a Keystore key, so a phone
 *   whose face unlock is weak reports its fingerprint sensor, or `none`.
 * - `none`: no sensor, or a host without the module, such as Lynx Explorer,
 *   the web preview and an app without `permissions.biometrics`.
 */
export type BiometryType =
  | 'faceID'
  | 'touchID'
  | 'opticID'
  | 'fingerprint'
  | 'face'
  | 'iris'
  | 'none';

/** What {@link LynxBiometrics.availability} resolves with. */
export type BiometricsAvailability = {
  /** The phone's biometric sensor, or `none`. */
  readonly type: BiometryType;
  /**
   * Whether the person has set the sensor up (a face or a finger is
   * enrolled), so {@link LynxBiometrics.authenticate} can ask for it. Still
   * true while it's locked out after too many tries.
   */
  readonly enrolled: boolean;
  /**
   * Whether the phone has a passcode, PIN or pattern, which
   * `allowDeviceCredential` lets the person use instead.
   */
  readonly deviceCredential: boolean;
};

/**
 * Why {@link LynxBiometrics.authenticate}, or reading a value
 * {@link LynxSecureStorage} keeps behind biometrics, didn't confirm the
 * person:
 * - `canceled`: the person closed the prompt, or the system did, as when
 *   the app went to the background.
 * - `lockout`: too many tries failed. iOS asks for the passcode before
 *   biometrics work again; Android waits 30 seconds, or for the device
 *   credential after several lockouts.
 * - `notEnrolled`: the phone has a sensor, but no face or finger is set up.
 * - `unavailable`: the phone has no sensor, no passcode for
 *   `allowDeviceCredential`, or the host has no biometrics module: only the
 *   apps `ng build --platform` makes with `permissions.biometrics` in
 *   angular.json do. Lynx Explorer and the web preview don't.
 * - `failed`: anything else, such as a prompt already open.
 */
export type BiometricsErrorCode =
  | 'canceled'
  | 'lockout'
  | 'notEnrolled'
  | 'unavailable'
  | 'failed';

/** The error {@link LynxBiometrics.authenticate} rejects with. */
export class BiometricsError extends Error {
  constructor(
    readonly code: BiometricsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BiometricsError';
  }
}

/** What {@link LynxBiometrics.authenticate} asks with. */
export type BiometricsAuthenticateOptions = {
  /**
   * Why the app asks, such as `'Unlock your notes'`. Touch ID and Android's
   * prompt show it. Face ID shows only its own animation: iOS shows
   * angular.json's `permissions.biometrics` the first time, instead.
   */
  readonly reason: string;
  /**
   * Lets the person use the phone's passcode, PIN or pattern instead: iOS
   * offers it after Face ID or Touch ID fails, and Android on the prompt.
   * Off by default, so only a face or a finger confirms them.
   */
  readonly allowDeviceCredential?: boolean;
  /**
   * The title of Android's prompt. Defaults to the app's name. iOS draws
   * its own.
   */
  readonly title?: string;
  /**
   * The label of the button that closes the prompt, `Cancel` by default.
   * Android has no such button with `allowDeviceCredential`, which offers
   * the passcode there instead.
   */
  readonly cancelLabel?: string;
};

/**
 * What the native module calls back with: `{}` once it's done, the
 * availability, or why it couldn't.
 */
type NativeResult = {
  readonly type?: string;
  readonly enrolled?: boolean;
  readonly deviceCredential?: boolean;
  readonly error?: string;
  readonly message?: string;
};

const TYPES: readonly BiometryType[] = [
  'faceID',
  'touchID',
  'opticID',
  'fingerprint',
  'face',
  'iris',
];

const CODES: readonly BiometricsErrorCode[] = [
  'canceled',
  'lockout',
  'notEnrolled',
  'unavailable',
  'failed',
];

const UNAVAILABLE_MESSAGE =
  'This host has no biometrics. Only the apps `ng build --platform` makes with `permissions.biometrics` in angular.json have them.';

const MESSAGES: Record<BiometricsErrorCode, string> = {
  canceled: 'The biometric prompt was canceled.',
  lockout: 'Biometrics are locked after too many failed tries.',
  notEnrolled: 'No face or fingerprint is set up on this phone.',
  unavailable: UNAVAILABLE_MESSAGE,
  failed: "The person couldn't be confirmed.",
};

/**
 * Whether `result` reports a failure, and as which error. A code the runtime
 * doesn't know, from a newer shell, is `failed`.
 */
export const biometricsFailure = (
  result: NativeResult | undefined,
): BiometricsError | undefined => {
  if (result?.error === undefined) return undefined;
  const code = CODES.includes(result.error as BiometricsErrorCode)
    ? (result.error as BiometricsErrorCode)
    : 'failed';
  return new BiometricsError(code, result.message ?? MESSAGES[code]);
};

/** The error for a host without the module. */
export const biometricsUnavailable = (): BiometricsError =>
  new BiometricsError('unavailable', UNAVAILABLE_MESSAGE);

/**
 * Calls the shells' module on the background thread, where `NativeModules`
 * lives. Rejects with `unavailable` where the host has none.
 */
export const callBiometrics = async (
  method: string,
  args: unknown[],
): Promise<NativeResult | undefined> => {
  try {
    return (await callOnBackground(
      'callNativeModuleAsync',
      BIOMETRICS_MODULE,
      method,
      args,
    )) as NativeResult | undefined;
  } catch {
    throw biometricsUnavailable();
  }
};

/**
 * Asks the person to confirm who they are with Face ID, Touch ID or a
 * fingerprint, as banking, password and note apps do when they open:
 * `LAContext` on iOS and AndroidX's `BiometricPrompt` on Android. Lynx has
 * no WebAuthn either. This is a local check that the person is there; it
 * signs no server challenge, so it's no passkey sign-in.
 *
 * To keep a secret, such as a refresh token, readable only after the person
 * confirms, store it with {@link LynxSecureStorage}'s `requireBiometrics`:
 * the platform then won't hand it over without a face or a finger, which an
 * `authenticate()` in the app's own code can't promise.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, and only with `permissions.biometrics` in angular.json, which gives iOS
 * the reason it shows the first time the app uses Face ID:
 *
 * ```jsonc
 * "permissions": { "biometrics": "Unlock your notes" }
 * ```
 *
 * Elsewhere, such as Lynx Explorer and the web preview, `availability()`
 * reports `none` and `authenticate()` rejects with `unavailable`.
 *
 * @usageNotes
 * ```typescript
 * const biometrics = inject(LynxBiometrics);
 *
 * const { type, enrolled } = await biometrics.availability();
 * if (type !== 'none' && enrolled) {
 *   await biometrics.authenticate({ reason: 'Unlock your notes' });
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxBiometrics {
  /**
   * Resolves with the phone's biometric sensor, whether the person has set
   * it up, and whether the phone has a passcode. Never prompts or rejects:
   * a host without the module reports `none`.
   */
  async availability(): Promise<BiometricsAvailability> {
    let result: NativeResult | undefined;
    try {
      result = await callBiometrics('availability', []);
    } catch {
      return { type: 'none', enrolled: false, deviceCredential: false };
    }
    const type = TYPES.includes(result?.type as BiometryType)
      ? (result!.type as BiometryType)
      : 'none';
    return {
      type,
      enrolled: type !== 'none' && result?.enrolled === true,
      deviceCredential: result?.deviceCredential === true,
    };
  }

  /**
   * Shows the platform's biometric prompt and resolves once the person
   * confirms who they are. Rejects with a {@link BiometricsError}.
   */
  async authenticate({
    reason,
    allowDeviceCredential = false,
    title,
    cancelLabel,
  }: BiometricsAuthenticateOptions): Promise<void> {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new TypeError(
        'authenticate() needs the reason shown to the person, e.g. "Unlock your notes".',
      );
    }
    const result = await callBiometrics('authenticate', [
      {
        reason,
        allowDeviceCredential,
        ...(title !== undefined && { title }),
        ...(cancelLabel !== undefined && { cancelLabel }),
      },
    ]);
    const failure = biometricsFailure(result);
    if (failure) throw failure;
  }
}
