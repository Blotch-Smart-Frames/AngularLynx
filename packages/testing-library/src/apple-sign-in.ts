/** What `LynxAppleSignIn` calls, named as the iOS shell names its module. */
const MODULE = 'AngularLynxAppleSignIn';

/**
 * What the person's next sign-ins return, for {@link setAppleSignInResult}.
 * Anything left out takes a test value: `user` is `test-apple-user`, and the
 * tokens are `test-identity-token` and `test-authorization-code`.
 */
export type FakeAppleSignInResult = {
  readonly user?: string;
  readonly identityToken?: string;
  readonly authorizationCode?: string;
  /** Returned only when the sign-in asks for the `email` scope, as Apple does. */
  readonly email?: string;
  /**
   * Returned only when the sign-in asks for the `fullName` scope, as Apple
   * does.
   */
  readonly fullName?: {
    readonly givenName?: string;
    readonly familyName?: string;
    readonly middleName?: string;
    readonly nickname?: string;
    readonly namePrefix?: string;
    readonly nameSuffix?: string;
  };
  /** `likelyReal` when it's left out. */
  readonly realUserStatus?: 'likelyReal' | 'unknown' | 'unsupported';
};

/** A sign-in the app opened, as {@link appleSignInRequests} lists it. */
export type AppleSignInRequest = {
  readonly scopes: readonly string[];
  readonly nonce?: string;
  readonly state?: string;
};

/** A user identifier's state, as `LynxAppleSignIn.getCredentialState()` resolves. */
export type FakeAppleCredentialState =
  | 'authorized'
  | 'revoked'
  | 'notFound'
  | 'transferred';

type Done = (answer: Record<string, unknown>) => void;

type Outcome =
  | { readonly result: FakeAppleSignInResult }
  | { readonly error: 'canceled' | 'failed'; readonly message?: string };

type FakeAppleSignInModule = {
  /**
   * Set by {@link setAppleSignInAvailable}: the methods then fail as a
   * missing module's do, while the requests and users stay for the test.
   */
  unavailable: boolean;
  outcome: Outcome;
  readonly requests: AppleSignInRequest[];
  readonly states: Map<string, FakeAppleCredentialState>;
  available(done: Done): void;
  signIn(request: AppleSignInRequest, done: Done): void;
  credentialState(user: string, done: Done): void;
};

type BackgroundGlobals = { NativeModules?: Record<string, unknown> };

/**
 * Gives the environment's background thread an `AngularLynxAppleSignIn`
 * module, as the iOS apps `ng build --platform` makes with angular.json's
 * `signInWithApple` have. It stands for a person who closes the sheet until
 * a spec says how they sign in ({@link setAppleSignInResult}), and each
 * user it signs in is `authorized` afterwards. `LynxAppleSignIn` reaches it
 * through the background thread, as it reaches the shell's module, so specs
 * see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each
 * test starts with the module there, no sign-ins and no users.
 */
export const installAppleSignInModule = (
  threadGlobals: BackgroundGlobals,
): void => {
  /**
   * Fails a call as the runtime's relay does for a host without the module,
   * which `LynxAppleSignIn` reads as no native sheet.
   */
  const refuse = (method: string): never => {
    throw new Error(`NativeModules: ${MODULE}.${method} is not available`);
  };
  const module: FakeAppleSignInModule = {
    unavailable: false,
    outcome: { error: 'canceled' },
    requests: [],
    states: new Map(),
    available(done) {
      if (this.unavailable) refuse('available');
      done({ available: true });
    },
    signIn(request, done) {
      if (this.unavailable) refuse('signIn');
      this.requests.push(request);
      const outcome = this.outcome;
      if ('error' in outcome) {
        done({
          error: outcome.error,
          ...(outcome.message !== undefined && { message: outcome.message }),
        });
        return;
      }
      const { result } = outcome;
      const user = result.user ?? 'test-apple-user';
      this.states.set(user, 'authorized');
      // Apple shares the email and name only when the sign-in asks for them.
      done({
        user,
        identityToken: result.identityToken ?? 'test-identity-token',
        authorizationCode:
          result.authorizationCode ?? 'test-authorization-code',
        realUserStatus: result.realUserStatus ?? 'likelyReal',
        ...(request.scopes.includes('email') &&
          result.email !== undefined && { email: result.email }),
        ...(request.scopes.includes('fullName') &&
          result.fullName !== undefined && { fullName: result.fullName }),
        ...(request.state !== undefined && { state: request.state }),
      });
    },
    credentialState(user, done) {
      if (this.unavailable) refuse('credentialState');
      done({ state: this.states.get(user) ?? 'notFound' });
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

const backgroundGlobals = (name: string): BackgroundGlobals => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const globals = (globalThis as any).lynxTestingEnv?.backgroundThread
    .globalThis as BackgroundGlobals | undefined;
  if (!globals) {
    throw new Error(
      `${name}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return globals;
};

/**
 * The fake module. The setup installs it on every reset, and nothing takes
 * it away.
 */
const fakeModule = (name: string): FakeAppleSignInModule =>
  (backgroundGlobals(name).NativeModules as Record<string, unknown>)[
    MODULE
  ] as FakeAppleSignInModule;

/**
 * Has the person sign in with `result` from now on in this test: each
 * `LynxAppleSignIn.signIn()` resolves with it, the email and name only when
 * the sign-in asks for their scopes, and the user is `authorized` for
 * `getCredentialState()` afterwards. Until a spec calls this or
 * {@link setAppleSignInError}, the person closes the sheet, and `signIn()`
 * rejects with `canceled`. The answer reaches the app through the
 * background thread, as on a phone: wait for it with `waitForUpdate()`.
 *
 * @example
 * ```ts
 * setAppleSignInResult({ user: 'u1', email: 'ada@example.com' });
 * await render(SignInScreen);
 * fireEvent.tap(screen.getByText('Sign in with Apple'));
 * await waitForUpdate();
 * expect(screen.getByText('Signed in as ada@example.com')).toBeInTheDocument();
 * ```
 */
export const setAppleSignInResult = (
  result: FakeAppleSignInResult = {},
): void => {
  fakeModule('setAppleSignInResult').outcome = { result };
};

/**
 * Has the next sign-ins in this test end without a credential:
 * `LynxAppleSignIn.signIn()` rejects with an `AppleSignInError` of `code`,
 * `canceled` for a person who closes the sheet (the default) or `failed`.
 */
export const setAppleSignInError = (
  code: 'canceled' | 'failed',
  message?: string,
): void => {
  fakeModule('setAppleSignInError').outcome = {
    error: code,
    ...(message !== undefined && { message }),
  };
};

/**
 * Takes the native sheet away for the rest of this test, or puts it back, so
 * a spec can check what the app offers where there's none (Android, the
 * web): `isAvailable()` is false, and `signIn()` and `getCredentialState()`
 * reject with `unsupported`. The sign-ins {@link appleSignInRequests} lists
 * and the users' states stay as they were.
 */
export const setAppleSignInAvailable = (available: boolean): void => {
  fakeModule('setAppleSignInAvailable').unavailable = !available;
};

/**
 * Sets what `LynxAppleSignIn.getCredentialState(user)` resolves with, such
 * as `revoked` for a person who stopped using their Apple ID with the app.
 * A user nobody signed in is `notFound`.
 */
export const setAppleCredentialState = (
  user: string,
  state: FakeAppleCredentialState,
): void => {
  fakeModule('setAppleCredentialState').states.set(user, state);
};

/**
 * The sign-ins the app opened in this test, with the scopes, nonce and
 * state each asked for, oldest first.
 */
export const appleSignInRequests = (): readonly AppleSignInRequest[] => {
  const module = (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
    .NativeModules?.[MODULE] as FakeAppleSignInModule | undefined;
  return module ? [...module.requests] : [];
};
