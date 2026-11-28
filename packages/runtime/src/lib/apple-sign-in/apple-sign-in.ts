import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';

/**
 * The native module of the iOS apps `ng build --platform` makes with
 * angular.json's `signInWithApple` (`AppleSignInModule.swift` in
 * `packages/native/templates`). Android has none.
 */
const APPLE_SIGN_IN_MODULE = 'AngularLynxAppleSignIn';

/** What Sign in with Apple can share besides the user identifier. */
export type AppleSignInScope = 'email' | 'fullName';

/** What {@link LynxAppleSignIn.signIn} asks for. */
export type AppleSignInOptions = {
  /**
   * What to ask the person to share. Apple shares it on the first sign-in
   * only, so keep it then: later sign-ins return the user and the tokens
   * alone. None by default.
   */
  readonly scopes?: readonly AppleSignInScope[];
  /**
   * Put in the identity token's `nonce` claim as given, so the server can
   * tie the token to this sign-in. Services such as Firebase and Supabase
   * take the SHA-256 of a random string here and the string itself.
   */
  readonly nonce?: string;
  /** Returned as {@link AppleSignInResult.state}, unchanged. */
  readonly state?: string;
};

/** The parts of the person's name they chose to share. */
export type AppleSignInFullName = {
  readonly givenName?: string;
  readonly familyName?: string;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly namePrefix?: string;
  readonly nameSuffix?: string;
};

/**
 * Whether Apple thinks a real person signed in: `likelyReal`, `unknown`
 * (treat it as an ordinary sign-in), or `unsupported` (on a device that
 * can't tell).
 */
export type AppleRealUserStatus = 'likelyReal' | 'unknown' | 'unsupported';

/** What a sign-in returns. */
export type AppleSignInResult = {
  /**
   * The person's identifier for the app's team, the same on every sign-in
   * and every device, and the identity token's `sub`. Key the account on
   * it, not on the email, and have the server read it from the verified
   * token rather than trust this copy.
   */
  readonly user: string;
  /**
   * A JSON Web Token signed by Apple, for the app's server to verify
   * against Apple's public keys. It holds `sub` (the user), and `nonce` when
   * the sign-in had one.
   */
  readonly identityToken: string;
  /**
   * A short-lived code the server exchanges at Apple's token endpoint for a
   * refresh token, which it needs to revoke the account when the person
   * deletes it (guideline 5.1.1(v)).
   */
  readonly authorizationCode: string;
  /**
   * The email, on the first sign-in with the `email` scope. It may be a
   * private relay address (`…@privaterelay.appleid.com`) that forwards to
   * the person.
   */
  readonly email?: string;
  /** The name, on the first sign-in with the `fullName` scope. */
  readonly fullName?: AppleSignInFullName;
  /** {@link AppleSignInOptions.state}, when the sign-in had one. */
  readonly state?: string;
  readonly realUserStatus: AppleRealUserStatus;
};

/**
 * Whether a user identifier is still signed in with Apple:
 * - `authorized`: it is.
 * - `revoked`: the person stopped using their Apple ID with the app, in
 *   Settings. Sign them out.
 * - `notFound`: Apple has no sign-in for it on this device.
 * - `transferred`: the app moved to another developer team; the server
 *   migrates the user.
 */
export type AppleCredentialState =
  | 'authorized'
  | 'revoked'
  | 'notFound'
  | 'transferred';

/**
 * Why Sign in with Apple gave no credential:
 * - `canceled`: the person closed the sheet.
 * - `unsupported`: the host has no native sheet: Android, the web preview,
 *   Lynx Explorer, an iOS app built without angular.json's
 *   `signInWithApple`, and tests without the testing library's fake. In
 *   the Android app, use Apple's web flow through `LynxWebAuthSession`; the
 *   web preview and Lynx Explorer have no web sign-in either.
 * - `failed`: Apple couldn't sign the person in, a sign-in was already
 *   open, or Apple returned no token.
 */
export type AppleSignInErrorCode = 'canceled' | 'unsupported' | 'failed';

/** The error {@link LynxAppleSignIn} rejects with. */
export class AppleSignInError extends Error {
  constructor(
    readonly code: AppleSignInErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppleSignInError';
  }
}

/** How the native module answers a sign-in. */
type SignInAnswer = Partial<AppleSignInResult> & {
  readonly error?: string;
  readonly message?: string;
};

const unsupported = () =>
  new AppleSignInError(
    'unsupported',
    'This host has no Sign in with Apple sheet. Only iOS apps built with angular.json\'s "signInWithApple": true have one. In the Android app, use Apple\'s web flow with LynxWebAuthSession.',
  );

/**
 * Signs in with Apple's own sheet on iOS (`ASAuthorizationAppleIDProvider`),
 * the usual way to meet guideline 4.8, which asks an app with a third-party
 * login to also offer one that keeps the person's data private. It resolves with the user identifier, an identity token
 * and an authorization code for the app's server to check with Apple, and,
 * on the first sign-in only, the email and name the person chose to share.
 *
 * The sheet is iOS's. Elsewhere {@link signIn} rejects with `unsupported`.
 * In the Android app, sign in through Apple's web flow instead, with
 * `LynxWebAuthSession` and a Services ID. The web preview and Lynx Explorer
 * have no web sign-in either. {@link isAvailable} says which to offer.
 *
 * The native module and the `com.apple.developer.applesignin` entitlement
 * are in an iOS app only when angular.json's build options set
 * `"signInWithApple": true`. Signing that entitlement needs a team in the
 * paid Apple Developer Program, with Sign in with Apple turned on for the
 * App ID: a free Personal Team can't. The testing library's
 * `setAppleSignInResult()` decides what a spec's sign-in returns.
 *
 * @usageNotes
 * ```typescript
 * // Injected in a field: a method has no injection context, even after
 * // an await.
 * readonly #appleSignIn = inject(LynxAppleSignIn);
 *
 * async signInWithApple() {
 *   const { identityToken, authorizationCode, email, fullName } =
 *     await this.#appleSignIn.signIn({ scopes: ['email', 'fullName'] });
 *   await this.auth.exchange({ identityToken, authorizationCode, email, fullName });
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxAppleSignIn {
  /**
   * Whether {@link signIn} can open the native sheet: true in an iOS app
   * built with `signInWithApple`, false elsewhere. Never rejects.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const answer = (await callOnBackground(
        'callNativeModuleAsync',
        APPLE_SIGN_IN_MODULE,
        'available',
        [],
      )) as { available?: boolean } | undefined;
      return answer?.available === true;
    } catch {
      return false;
    }
  }

  /**
   * Opens Sign in with Apple's sheet and resolves with the credential once
   * the person signs in. Rejects with an {@link AppleSignInError}.
   */
  async signIn({
    scopes = [],
    nonce,
    state,
  }: AppleSignInOptions = {}): Promise<AppleSignInResult> {
    let answer: SignInAnswer | undefined;
    try {
      // callNativeModuleAsync keeps the module's callback on the background
      // thread, where NativeModules lives, so nothing stays registered on
      // either thread once it answers (#959).
      answer = (await callOnBackground(
        'callNativeModuleAsync',
        APPLE_SIGN_IN_MODULE,
        'signIn',
        [
          {
            scopes: [...scopes],
            ...(nonce !== undefined && { nonce }),
            ...(state !== undefined && { state }),
          },
        ],
      )) as SignInAnswer | undefined;
    } catch {
      throw unsupported();
    }
    if (answer?.error !== undefined) {
      const code = answer.error === 'canceled' ? 'canceled' : 'failed';
      throw new AppleSignInError(
        code,
        answer.message ??
          (code === 'canceled'
            ? 'The sign-in was canceled.'
            : 'Sign in with Apple failed.'),
      );
    }
    const { user, identityToken, authorizationCode } = answer ?? {};
    // A credential without them can't be checked by the server, so it's no
    // sign-in to the app.
    if (!user || !identityToken || !authorizationCode) {
      throw new AppleSignInError(
        'failed',
        'Apple returned no user, identity token or authorization code.',
      );
    }
    return {
      user,
      identityToken,
      authorizationCode,
      realUserStatus: answer?.realUserStatus ?? 'unknown',
      ...(answer?.email !== undefined && { email: answer.email }),
      ...(answer?.fullName !== undefined && { fullName: answer.fullName }),
      ...(answer?.state !== undefined && { state: answer.state }),
    };
  }

  /**
   * Asks Apple whether `user`, an identifier a sign-in returned, is still
   * signed in. Apple asks apps to check at launch and sign the person out
   * when it's `revoked`. Rejects with an {@link AppleSignInError}:
   * `unsupported` where {@link signIn} would.
   */
  async getCredentialState(user: string): Promise<AppleCredentialState> {
    let answer:
      | { state?: AppleCredentialState; error?: string; message?: string }
      | undefined;
    try {
      answer = (await callOnBackground(
        'callNativeModuleAsync',
        APPLE_SIGN_IN_MODULE,
        'credentialState',
        [user],
      )) as typeof answer;
    } catch {
      throw unsupported();
    }
    if (answer?.state === undefined) {
      throw new AppleSignInError(
        'failed',
        answer?.message ?? "Apple couldn't say whether the user is signed in.",
      );
    }
    return answer.state;
  }
}
