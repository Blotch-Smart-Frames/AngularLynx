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
  /**
   * Whether the page fills the screen, under the status bar and the home
   * indicator, with CSS `env(safe-area-inset-*)` carrying the insets, as
   * Safari does for a page with `viewport-fit=cover`. Defaults to true; false
   * lays the page out inside the safe area, with `env()` at 0.
   */
  readonly edgeToEdge?: boolean;
  /** Each permission the app uses, with the reason shown to the user. */
  readonly permissions?: Partial<Record<Permission, string>>;
  /** Custom URL schemes that open the app, e.g. `["myapp"]`. */
  readonly deepLinkSchemes?: readonly string[];
  /**
   * Other apps' URL schemes `LynxLinking.canOpenURL()` can ask about, e.g.
   * `["whatsapp", "instagram"]`. iOS answers only for the schemes in
   * Info.plist's LSApplicationQueriesSchemes, and Android 11 and later only
   * for the apps the manifest's `<queries>` asks about. `http`, `https`,
   * `mailto`, `tel` and `sms` are always there.
   */
  readonly canOpenURLSchemes?: readonly string[];
  /**
   * Things the app does that the phone offers outside it (see
   * {@link AppShortcut}): on iOS through Siri, Spotlight and the Shortcuts
   * app, and on Android in the menu a long press on the app's icon opens.
   * The app hears each one through the runtime's `LynxShortcuts`.
   */
  readonly shortcuts?: readonly AppShortcut[];
  /**
   * A 1024×1024 PNG without transparency, relative to the project root. iOS
   * uses it as it is. Android gets it resized for each screen density, round
   * for the launchers that want a round icon, and as an adaptive icon (see
   * {@link AndroidOptions.adaptiveIcon}).
   */
  readonly icon?: string;
  /**
   * What the phone shows from the tap on the app's icon until the app's
   * first screen is drawn (see {@link SplashOptions}).
   */
  readonly splash?: SplashOptions;
  readonly ios?: IosOptions;
  readonly android?: AndroidOptions;
};

/**
 * The launch screen: an image centered on a color, from the tap on the app's
 * icon until the app hides it (the runtime's `provideSplashScreen()`), or
 * until Angular first draws, without that.
 *
 * iOS shows it as the launch screen (`UILaunchScreen`), and the shell keeps a
 * copy of it over the app until then. Android shows it as the splash screen,
 * through AndroidX's `core-splashscreen`, which gives Android 7 to 11 the
 * same splash as 12 and later.
 */
export type SplashOptions = {
  /**
   * A PNG with transparency, relative to the project root, drawn centered.
   * Without one, iOS shows the color alone, and Android the launcher icon,
   * as Android 12 does by default.
   */
  readonly image?: string;
  /**
   * The image's width on screen, in points and dp; its height follows from
   * its shape. Needed with `image`. Give the PNG at least three times this
   * many pixels across, for the sharpest iPhones.
   *
   * Android shows a splash image inside a circle 192 dp across, so an image
   * whose corners reach past it is drawn smaller there, with a build warning.
   */
  readonly imageWidth?: number;
  /**
   * The color behind the image, which the shells also paint behind the app
   * (`#RRGGBB` or `#RGB`). Defaults to white, and on Android, to black in
   * dark mode.
   */
  readonly backgroundColor?: string;
  /** The image and the color in dark mode. Each defaults to the light one. */
  readonly dark?: {
    readonly image?: string;
    readonly backgroundColor?: string;
  };
};

/** The splash's image and color in one appearance, light or dark. */
export type SplashAppearance = {
  readonly image?: string;
  /** Undefined keeps the shell's own color. */
  readonly backgroundColor?: string;
};

/** {@link SplashOptions} checked, with the dark values filled in. */
export type ResolvedSplash = {
  /** Set when either appearance has an image. */
  readonly imageWidth?: number;
  readonly light: SplashAppearance;
  readonly dark: SplashAppearance;
};

export type Orientation = 'portrait' | 'landscape' | 'all';

/**
 * One thing the app does, which the person can ask for without opening the
 * app first.
 *
 * iOS makes it an App Shortcut (an App Intent the shell declares): Siri runs
 * it when it hears one of its `phrases`, and it's listed in Spotlight and in
 * the Shortcuts app, where it can go on the Action button or in an
 * automation. Android lists it in the menu a long press on the app's icon
 * opens. Either way the app comes to the front, the router goes to `route`
 * when there is one, and `LynxShortcuts` calls the handlers the app
 * registered for `id`.
 */
export type AppShortcut = {
  /**
   * What the app's code knows the shortcut by: `LynxShortcuts.on(id, …)`.
   * Letters, digits, hyphens and underscores, starting with a letter. Keep
   * it once the app is released: the shortcuts people saved are stored
   * under it.
   */
  readonly id: string;
  /** The name the phone lists it under, such as "Refresh". */
  readonly title: string;
  /**
   * What the person says to Siri. Each one names the app with `{appName}`,
   * which Siri requires: `"Refresh {appName}"`. Defaults to the title and the
   * app's name, `"<title> in {appName}"`. iOS only.
   */
  readonly phrases?: readonly string[];
  /**
   * The path the router navigates to when the shortcut runs, such as
   * `/photos`. Without one, the app stays where it is.
   */
  readonly route?: string;
  /**
   * The SF Symbol iOS draws beside it, such as `arrow.clockwise`. iOS only.
   */
  readonly symbol?: string;
};

/** An {@link AppShortcut} with its default phrase. */
export type ResolvedShortcut = {
  readonly id: string;
  readonly title: string;
  /** Each holds {@link APP_NAME_PLACEHOLDER} once or more. */
  readonly phrases: readonly string[];
  readonly route?: string;
  readonly symbol?: string;
};

/** Where a shortcut's phrase names the app. */
export const APP_NAME_PLACEHOLDER = '{appName}';

export type Permission =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'photos'
  | 'savePhotos'
  | 'contacts'
  | 'notifications';

/**
 * How the `.ipa` is signed, as Xcode's export methods name it:
 * `app-store-connect` for App Store Connect and TestFlight, and
 * `release-testing` (ad hoc) for the iPhones registered to the team, which
 * install it from Finder or Apple Configurator.
 */
export type IosExportMethod = 'app-store-connect' | 'release-testing';

export const IOS_EXPORT_METHODS: readonly IosExportMethod[] = [
  'app-store-connect',
  'release-testing',
];

export type IosOptions = {
  /**
   * The Apple Developer team that signs the app. On its own, it signs the
   * development builds `--run --device <iPhone>` installs, with the Apple ID
   * signed in to Xcode; a free Apple ID's Personal Team works for those.
   */
  readonly teamId?: string;
  /**
   * Builds an `.ipa` signed this way. Defaults to `app-store-connect` once
   * `signing` is set; without `signing`, the Apple ID signed in to Xcode
   * signs it.
   */
  readonly export?: IosExportMethod;
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
  /**
   * The two layers of the adaptive icon Android 8 and later show. The
   * launcher masks it to its own shape and moves the layers apart as the
   * icon is touched. Without it, the adaptive icon is `icon` alone, as the
   * background layer, scaled so the masked shape shows all of it.
   */
  readonly adaptiveIcon?: AdaptiveIcon;
};

export type AdaptiveIcon = {
  /**
   * A 1024×1024 PNG with transparency, relative to the project root. The
   * launcher's mask crops its edges: keep what matters inside the middle 66
   * of its 108 dp, about 626 px of the 1024.
   */
  readonly foreground?: string;
  /** A color (`#RRGGBB` or `#RGB`), or a 1024×1024 PNG like `foreground`. */
  readonly background?: string;
};

/** {@link NativeAppOptions} with every default applied and every value checked. */
export type ResolvedApp = {
  readonly name: string;
  readonly id: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly orientation: Orientation;
  readonly edgeToEdge: boolean;
  readonly permissions: Partial<Record<Permission, string>>;
  readonly deepLinkSchemes: readonly string[];
  /**
   * {@link NativeAppOptions.canOpenURLSchemes} after
   * {@link ALWAYS_QUERIED_SCHEMES}, in lowercase, each once.
   */
  readonly canOpenURLSchemes: readonly string[];
  readonly shortcuts: readonly ResolvedShortcut[];
  readonly icon?: string;
  readonly splash: ResolvedSplash;
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
/**
 * The colors both CSS and Android resources read the same way. Android also
 * takes `#ARGB` and `#AARRGGBB`, but CSS reads 4 and 8 digits with the alpha
 * last, and an adaptive icon's background should be opaque anyway.
 */
export const ICON_BACKGROUND_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
/** Google Play's maximum versionCode. */
const MAX_BUILD_NUMBER = 2_100_000_000;
/**
 * The schemes `LynxLinking.canOpenURL()` can always ask about: the web, mail,
 * the phone and messages, which most apps link to.
 */
export const ALWAYS_QUERIED_SCHEMES: readonly string[] = [
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
];
/** The most schemes iOS reads from LSApplicationQueriesSchemes. */
const MAX_QUERIED_SCHEMES = 50;
const SHORTCUT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** SF Symbols are named in dot-separated words: `arrow.clockwise`. */
const SF_SYMBOL = /^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;
/**
 * The most App Shortcuts iOS takes from one app. Android's launchers show
 * about four, the first ones listed.
 */
const MAX_SHORTCUTS = 10;
/**
 * Whether the text has a line break or another control character, which
 * neither a Swift string literal nor an Android string resource takes as it
 * is. Checked by code point: a regular expression for them would hold the
 * control characters themselves.
 */
const hasControlCharacter = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
  });
const PERMISSIONS: readonly Permission[] = [
  'camera',
  'microphone',
  'location',
  'photos',
  'savePhotos',
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

  const userQueriedSchemes = options.canOpenURLSchemes ?? [];
  for (const scheme of userQueriedSchemes) {
    if (!SCHEME.test(scheme)) {
      throw new NativeConfigError(
        `canOpenURLSchemes entry "${scheme}" is not a valid URL scheme. Give the scheme alone, without "://", e.g. "whatsapp".`,
      );
    }
  }
  // Schemes are case-insensitive, so "WhatsApp" and "whatsapp" are one.
  const canOpenURLSchemes = [
    ...new Set(
      [...ALWAYS_QUERIED_SCHEMES, ...userQueriedSchemes].map((scheme) =>
        scheme.toLowerCase(),
      ),
    ),
  ];
  if (canOpenURLSchemes.length > MAX_QUERIED_SCHEMES) {
    throw new NativeConfigError(
      `canOpenURLSchemes lists ${canOpenURLSchemes.length} schemes with the ${ALWAYS_QUERIED_SCHEMES.length} always there (${ALWAYS_QUERIED_SCHEMES.join(', ')}). iOS reads no more than ${MAX_QUERIED_SCHEMES}.`,
    );
  }

  const shortcuts = resolveShortcuts(options.shortcuts ?? []);
  const splash = resolveSplash(options.splash ?? {});

  const android = options.android ?? {};
  if (android.adaptiveIcon) {
    const { foreground, background } = android.adaptiveIcon;
    if (!foreground || !background) {
      throw new NativeConfigError(
        'android.adaptiveIcon needs both a foreground (a PNG) and a background (a color like "#111111", or a PNG).',
      );
    }
    if (
      !ICON_BACKGROUND_COLOR.test(background) &&
      !background.toLowerCase().endsWith('.png')
    ) {
      throw new NativeConfigError(
        `android.adaptiveIcon.background "${background}" is neither a color (#RRGGBB or #RGB) nor a PNG file.`,
      );
    }
    // Android 7, and launchers that ignore adaptive icons, still show the
    // flat icon made from \`icon\`.
    if (!options.icon) {
      throw new NativeConfigError(
        'android.adaptiveIcon needs icon too: Android 7 shows the flat icon made from it.',
      );
    }
  }

  const exportMethod = options.ios?.export;
  if (
    exportMethod !== undefined &&
    !IOS_EXPORT_METHODS.includes(exportMethod)
  ) {
    throw new NativeConfigError(
      `ios.export "${exportMethod}" is not valid. Use ${IOS_EXPORT_METHODS.join(' or ')}.`,
    );
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
    edgeToEdge: options.edgeToEdge ?? true,
    permissions,
    deepLinkSchemes,
    canOpenURLSchemes,
    shortcuts,
    icon: options.icon,
    splash,
    productName,
    artifactName,
    ios: options.ios ?? {},
    android,
  };
};

/**
 * A shortcut's ID as part of a Swift type name or an Android resource name,
 * neither of which takes a hyphen: `show-photos` → `show_photos`.
 */
export const shortcutIdentifier = (id: string): string => id.replace(/-/g, '_');

/**
 * Checks each shortcut and gives it its default phrase. What's wrong is
 * caught here, where the message can name the option: the Swift and XML the
 * generators write from these would otherwise fail in Xcode's App Intents
 * step or in Gradle, far from angular.json.
 */
const resolveShortcuts = (
  shortcuts: readonly AppShortcut[],
): readonly ResolvedShortcut[] => {
  if (shortcuts.length > MAX_SHORTCUTS) {
    throw new NativeConfigError(
      `shortcuts lists ${shortcuts.length}. iOS takes no more than ${MAX_SHORTCUTS} from an app.`,
    );
  }
  const identifiers = new Set<string>();
  const heard = new Set<string>();
  return shortcuts.map((entry, index) => {
    // compact() leaves undefined where angular.json has an empty object.
    const shortcut = (entry ?? {}) as Partial<AppShortcut>;
    const { id, route, symbol } = shortcut;
    if (typeof id !== 'string' || !SHORTCUT_ID.test(id)) {
      throw new NativeConfigError(
        `shortcuts[${index}].id "${id}" is not valid. Use letters, digits, hyphens and underscores, starting with a letter, e.g. "show-photos".`,
      );
    }
    // The Swift type and the Android resources are named after the ID with
    // its hyphens as underscores, so two IDs a hyphen apart would share them.
    const identifier = shortcutIdentifier(id).toLowerCase();
    if (identifiers.has(identifier)) {
      throw new NativeConfigError(
        `shortcuts has two entries with the id "${id}". Each needs its own (a hyphen and an underscore count as the same, and so do capitals).`,
      );
    }
    identifiers.add(identifier);

    const title =
      typeof shortcut.title === 'string' ? shortcut.title.trim() : '';
    if (!title || hasControlCharacter(title)) {
      throw new NativeConfigError(
        `shortcuts "${id}" needs a title on one line, the name the phone lists it under, e.g. "Show photos".`,
      );
    }

    const phrases = (
      shortcut.phrases ?? [`${title} in ${APP_NAME_PLACEHOLDER}`]
    ).map((phrase) => (typeof phrase === 'string' ? phrase.trim() : ''));
    if (phrases.length === 0) {
      throw new NativeConfigError(
        `shortcuts "${id}" has no phrases. Give Siri at least one, e.g. "${title} in ${APP_NAME_PLACEHOLDER}", or leave phrases out for that one.`,
      );
    }
    for (const phrase of phrases) {
      if (
        !phrase.includes(APP_NAME_PLACEHOLDER) ||
        hasControlCharacter(phrase)
      ) {
        throw new NativeConfigError(
          `shortcuts "${id}" has the phrase "${phrase}", which doesn't name the app. Siri only listens for phrases that do: put ${APP_NAME_PLACEHOLDER} where the app's name is said, e.g. "${title} in ${APP_NAME_PLACEHOLDER}".`,
        );
      }
      // Siri couldn't tell which of two shortcuts a phrase they share means.
      const spoken = phrase.toLowerCase();
      if (heard.has(spoken)) {
        throw new NativeConfigError(
          `shortcuts has the phrase "${phrase}" twice. Siri needs each phrase to mean one shortcut.`,
        );
      }
      heard.add(spoken);
    }

    if (
      route !== undefined &&
      (typeof route !== 'string' ||
        !route.startsWith('/') ||
        hasControlCharacter(route))
    ) {
      throw new NativeConfigError(
        `shortcuts "${id}" has the route "${route}". Give the path the router navigates to, starting with "/", e.g. "/photos".`,
      );
    }
    if (
      symbol !== undefined &&
      (typeof symbol !== 'string' || !SF_SYMBOL.test(symbol))
    ) {
      throw new NativeConfigError(
        `shortcuts "${id}" has the symbol "${symbol}", which is not an SF Symbol's name, e.g. "arrow.clockwise".`,
      );
    }
    return {
      id,
      title,
      phrases,
      ...(route !== undefined && { route }),
      ...(symbol !== undefined && { symbol }),
    };
  });
};

/**
 * Checks the splash options, and gives dark mode the light values it doesn't
 * set. The images themselves are read when the project is generated.
 */
const resolveSplash = (splash: SplashOptions): ResolvedSplash => {
  const { image, imageWidth, backgroundColor } = splash;
  const dark = splash.dark ?? {};
  for (const [option, file] of [
    ['splash.image', image],
    ['splash.dark.image', dark.image],
  ] as const) {
    if (
      file !== undefined &&
      (typeof file !== 'string' || !file.toLowerCase().endsWith('.png'))
    ) {
      throw new NativeConfigError(
        `${option} "${file}" is not a PNG file. Give the path of a PNG with transparency, relative to the project root.`,
      );
    }
  }
  for (const [option, color] of [
    ['splash.backgroundColor', backgroundColor],
    ['splash.dark.backgroundColor', dark.backgroundColor],
  ] as const) {
    if (
      color !== undefined &&
      (typeof color !== 'string' || !ICON_BACKGROUND_COLOR.test(color))
    ) {
      throw new NativeConfigError(
        `${option} "${color}" is not a color. Use #RRGGBB or #RGB, e.g. "#09090B".`,
      );
    }
  }
  // The dark image takes its size from imageWidth too, and a light mode
  // without an image while dark mode has one would be a mistake.
  if (dark.image !== undefined && image === undefined) {
    throw new NativeConfigError(
      'splash.dark.image needs splash.image too: dark mode has an image of its own only where light mode has one.',
    );
  }
  if (image !== undefined) {
    if (
      typeof imageWidth !== 'number' ||
      !Number.isFinite(imageWidth) ||
      imageWidth <= 0
    ) {
      throw new NativeConfigError(
        `splash.imageWidth ${imageWidth === undefined ? 'is missing' : `${imageWidth} is not valid`}. Give the image's width on screen in points and dp, e.g. 200: a phone's screen is about 400 across.`,
      );
    }
  } else if (imageWidth !== undefined) {
    throw new NativeConfigError(
      'splash.imageWidth needs splash.image: it sets how wide the image is drawn.',
    );
  }
  return {
    ...(image !== undefined && { imageWidth }),
    light: { image, backgroundColor },
    dark: {
      image: dark.image ?? image,
      backgroundColor: dark.backgroundColor ?? backgroundColor,
    },
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
