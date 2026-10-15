/**
 * The app identity and native settings a project declares in angular.json, as
 * options of the `@blotch/angular-lynx-build:application` builder.
 *
 * The options are flat on purpose. Angular merges a `configurations` entry
 * into the base options one key deep, so a nested `app: { id }` override in a
 * "staging" configuration would drop every other `app` field. With flat keys,
 * `"staging": { "appId": "com.example.app.staging" }` changes only the ID.
 * The `ios` and `android` objects are still replaced as a whole when a
 * configuration sets them.
 */
export type NativeAppOptions = {
  /** The name under the icon. Defaults to the project name. */
  readonly appName?: string;
  /** iOS bundle ID and Android applicationId, e.g. `com.example.myapp`. */
  readonly appId?: string;
  /** The user-facing version (CFBundleShortVersionString / versionName). */
  readonly version?: string;
  /** The store build number (CFBundleVersion / versionCode). */
  readonly buildNumber?: number;
  readonly orientation?: Orientation;
  /** Each permission the app uses, with the reason shown to the user. */
  readonly permissions?: Partial<Record<Permission, string>>;
  /** Custom URL schemes that open the app, e.g. `["myapp"]`. */
  readonly deepLinkSchemes?: readonly string[];
  /** A 1024×1024 PNG without transparency, relative to the project root. */
  readonly icon?: string;
  readonly ios?: IosOptions;
  readonly android?: AndroidOptions;
};

export type Orientation = 'portrait' | 'landscape' | 'all';

export type Permission =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'photos'
  | 'contacts'
  | 'notifications';

export type IosOptions = {
  /** The Apple Developer team that signs the app. */
  readonly teamId?: string;
  /**
   * Headless signing with an App Store Connect API key. Each field names the
   * environment variable that holds the value, so no secret is ever written
   * to angular.json.
   */
  readonly signing?: {
    readonly keyIdEnv?: string;
    readonly issuerIdEnv?: string;
    readonly keyPathEnv?: string;
  };
};

export type AndroidOptions = {
  /**
   * The upload key for Google Play. The `*Env` fields name environment
   * variables, so no secret is ever written to angular.json.
   */
  readonly signing?: {
    readonly storeFileEnv?: string;
    readonly storePasswordEnv?: string;
    readonly keyAlias?: string;
    readonly keyPasswordEnv?: string;
  };
};

/** {@link NativeAppOptions} with every default applied and every value checked. */
export type ResolvedApp = {
  readonly name: string;
  readonly id: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly orientation: Orientation;
  readonly permissions: Partial<Record<Permission, string>>;
  readonly deepLinkSchemes: readonly string[];
  readonly icon?: string;
  /** `MyApp`: the iOS product (and so .app/.ipa) name. */
  readonly productName: string;
  /** `my-app`: the base name of Android artifacts. */
  readonly artifactName: string;
  readonly ios: IosOptions;
  readonly android: AndroidOptions;
};

export class NativeConfigError extends Error {}

/**
 * Letters and digits in dot-separated segments that each start with a letter:
 * the intersection of what iOS (no underscores) and Android (no hyphens)
 * accept, so one ID works on both.
 */
const APP_ID = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
/** Up to three period-separated integers, as App Store Connect requires. */
const VERSION = /^\d+(\.\d+){0,2}$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
/** Google Play's maximum versionCode. */
const MAX_BUILD_NUMBER = 2_100_000_000;
const PERMISSIONS: readonly Permission[] = [
  'camera',
  'microphone',
  'location',
  'photos',
  'contacts',
  'notifications',
];

/**
 * Applies defaults and validates the options, so the generators never see a
 * value that would produce a project Xcode or Gradle rejects later with a
 * less helpful message.
 */
export const resolveAppOptions = (
  rawOptions: NativeAppOptions,
  defaults: { readonly projectName: string; readonly packageVersion?: string },
): ResolvedApp => {
  const options = (compact(rawOptions) ?? {}) as NativeAppOptions;
  const name = (options.appName ?? defaults.projectName).trim();
  if (!name) {
    throw new NativeConfigError('appName must not be empty.');
  }

  const id =
    options.appId ?? `com.example.${toIdSegment(defaults.projectName)}`;
  if (!APP_ID.test(id)) {
    throw new NativeConfigError(
      `appId "${id}" is not valid. Use letters and digits in at least two dot-separated parts, each starting with a letter (e.g. com.example.myapp). iOS rejects underscores and Android rejects hyphens.`,
    );
  }

  const packageVersion =
    defaults.packageVersion && VERSION.test(defaults.packageVersion)
      ? defaults.packageVersion
      : undefined;
  // `ng new` sets 0.0.0, which App Store Connect rejects.
  const version =
    options.version ??
    (packageVersion && packageVersion !== '0.0.0' ? packageVersion : '1.0.0');
  if (!VERSION.test(version)) {
    throw new NativeConfigError(
      `version "${version}" is not valid. Use up to three period-separated numbers, e.g. 1.2.0.`,
    );
  }

  const buildNumber = options.buildNumber ?? 1;
  if (
    !Number.isInteger(buildNumber) ||
    buildNumber < 1 ||
    buildNumber > MAX_BUILD_NUMBER
  ) {
    throw new NativeConfigError(
      `buildNumber ${buildNumber} is not valid. Use a whole number from 1 to ${MAX_BUILD_NUMBER}.`,
    );
  }

  const permissions = options.permissions ?? {};
  for (const [permission, reason] of Object.entries(permissions)) {
    if (!PERMISSIONS.includes(permission as Permission)) {
      throw new NativeConfigError(
        `Unknown permission "${permission}". Supported: ${PERMISSIONS.join(', ')}.`,
      );
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new NativeConfigError(
        `permissions.${permission} needs the reason shown to the user, e.g. "Scan receipts".`,
      );
    }
  }

  const deepLinkSchemes = options.deepLinkSchemes ?? [];
  for (const scheme of deepLinkSchemes) {
    if (!SCHEME.test(scheme)) {
      throw new NativeConfigError(
        `deepLinkSchemes entry "${scheme}" is not a valid URL scheme.`,
      );
    }
  }

  const productName = name.replace(/[^A-Za-z0-9]/g, '') || 'App';
  const artifactName =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'app';

  return {
    name,
    id,
    version,
    buildNumber,
    orientation: options.orientation ?? 'portrait',
    permissions,
    deepLinkSchemes,
    icon: options.icon,
    productName,
    artifactName,
    ios: options.ios ?? {},
    android: options.android ?? {},
  };
};

/**
 * `my-app` → `myapp`: a project name as one app ID segment.
 */
const toIdSegment = (projectName: string): string => {
  const segment = projectName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z]/.test(segment) ? segment : `app${segment}`;
};

/**
 * Drops `undefined` values and the objects left empty by that. Angular CLI
 * fills in every property its schema declares for a nested option object,
 * as `undefined` when the user didn't set it, so `ios: {}` arrives as
 * `{ teamId: undefined, signing: { keyIdEnv: undefined, ... } }`, which
 * would read as "signing configured, but incomplete".
 */
export const compact = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(compact);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value)
    .map(([key, entry]) => [key, compact(entry)] as const)
    .filter(([, entry]) => entry !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};
