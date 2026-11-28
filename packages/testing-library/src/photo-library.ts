/** What `LynxPhotoLibrary` calls, named as the shells name their module. */
const MODULE = 'AngularLynxPhotoLibrary';

/**
 * Whether the fake phone lets the app add to its photo library, as
 * `@blotch/angular-lynx`'s `PhotoLibraryPermission` names it.
 */
export type FakePhotoLibraryPermission =
  | 'granted'
  | 'limited'
  | 'denied'
  | 'undetermined'
  | 'unsupported';

/** A photo or a video `LynxPhotoLibrary.save()` added to the fake library. */
export type SavedPhoto = {
  /** The ID `save()` resolved with. */
  readonly id: string;
  /** The file's name, given or made up by `save()`. */
  readonly name: string;
  /** Its type, such as `image/jpeg` or `video/mp4`. */
  readonly type: string;
  /** Its bytes. */
  readonly bytes: Uint8Array;
};

type Answer = Record<string, unknown>;
type Done = (answer: Answer) => void;

type FakePhotoLibraryModule = {
  permissionState: FakePhotoLibraryPermission;
  readonly saved: SavedPhoto[];
  permission(done: Done): void;
  // LynxPhotoLibrary always sends all three.
  save(
    request: { base64: string; name: string; type: string },
    done: Done,
  ): void;
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: {
    readonly globalThis: { NativeModules?: Record<string, unknown> };
  };
};

const decode = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/**
 * Gives the environment's background thread an `AngularLynxPhotoLibrary`
 * module, as the apps `ng build --platform` makes with
 * `permissions.savePhotos` have. Its library starts empty, and its person
 * hasn't been asked yet: the first save asks, and they allow it, unless
 * {@link setPhotoLibraryPermission} says otherwise. `LynxPhotoLibrary`
 * reaches it through the background thread, as it reaches the shells'
 * module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so each test starts
 * with an empty library. Only `NativeModules.AngularLynxPhotoLibrary` is
 * added: every other module stays as it was.
 */
export const installPhotoLibraryModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakePhotoLibraryModule = {
    permissionState: 'undetermined',
    saved: [],
    permission(done) {
      done({ permission: this.permissionState });
    },
    save(request, done) {
      // The person allows it when asked, as most do.
      if (this.permissionState === 'undetermined') {
        this.permissionState = 'granted';
      }
      const permission = this.permissionState;
      if (permission === 'unsupported') {
        done({ error: 'unavailable', permission });
        return;
      }
      if (permission === 'denied') {
        done({ error: 'permission-denied', permission });
        return;
      }
      const id = `fake-photo-${this.saved.length + 1}`;
      this.saved.push({
        id,
        name: request.name,
        type: request.type,
        bytes: decode(request.base64),
      });
      done({ id, permission });
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

const fakeModule = (name: string): FakePhotoLibraryModule => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const module = env?.backgroundThread.globalThis.NativeModules?.[MODULE] as
    | FakePhotoLibraryModule
    | undefined;
  if (!module) {
    throw new Error(
      `${name}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return module;
};

/**
 * What `LynxPhotoLibrary.save()` has added to the fake photo library in
 * this test, oldest first.
 *
 * @example
 * ```ts
 * await render(Editor);
 * fireEvent.tap(screen.getByText('Save to Photos'));
 * await waitForUpdate();
 * expect(savedPhotos()).toMatchObject([{ name: 'edit.jpg', type: 'image/jpeg' }]);
 * ```
 */
export const savedPhotos = (): readonly SavedPhoto[] => [
  ...fakeModule('savedPhotos').saved,
];

/**
 * Sets whether the fake phone lets the app add to its photo library: what
 * `LynxPhotoLibrary.addPermission` reads, and what `save()` finds. `denied`
 * has `save()` reject with `permission-denied`, and `unsupported` with
 * `unavailable`, as on a phone without the module. `undetermined`, where
 * each test starts, has the next save ask and the person allow it.
 *
 * Set it before the component that injects `LynxPhotoLibrary` renders: the
 * service reads the permission when it's created, and again after each save.
 */
export const setPhotoLibraryPermission = (
  permission: FakePhotoLibraryPermission,
): void => {
  fakeModule('setPhotoLibraryPermission').permissionState = permission;
};
