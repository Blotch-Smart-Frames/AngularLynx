import type { ElementRef } from '../../types/lynx';

/**
 * The iOS shell's Sign in with Apple module (`AppleSignInModule.swift`), the
 * same one `LynxAppleSignIn` calls from the background thread. The generator
 * keeps it, and the `<apple-sign-in-button>` element beside it, only in an
 * app whose angular.json sets `signInWithApple`.
 */
const APPLE_SIGN_IN_MODULE = 'AngularLynxAppleSignIn';

/** The button's titles, as `type` picks them. */
export type AppleSignInButtonType = 'signIn' | 'continue' | 'signUp';

/** The button's colors, as `button-style` picks them. */
export type AppleSignInButtonStyle = 'black' | 'white' | 'whiteOutline';

/**
 * The titles Apple's guidelines allow, by `type`, in English: the drawn
 * button has no copy of the system's translations (see
 * createAppleSignInButtonElement).
 */
const TITLES: Readonly<Record<AppleSignInButtonType, string>> = {
  signIn: 'Sign in with Apple',
  continue: 'Continue with Apple',
  signUp: 'Sign up with Apple',
};

/**
 * The colors of each style, as Apple's guidelines give them: a black button
 * with a white logo and title, a white one with a black logo and title, and
 * a white one outlined in black.
 */
const STYLES: Readonly<
  Record<
    AppleSignInButtonStyle,
    { readonly background: string; readonly foreground: string }
  >
> = {
  black: { background: '#000000', foreground: '#ffffff' },
  white: { background: '#ffffff', foreground: '#000000' },
  whiteOutline: { background: '#ffffff', foreground: '#000000' },
};

/**
 * ASAuthorizationAppleIDButton's corner radius until `corner-radius` sets
 * one, so the drawn button has the same corners as the native one.
 */
const DEFAULT_CORNER_RADIUS = 6;

/**
 * The Apple logo, in a 24 × 24 box, as Apple's guidelines put it beside the
 * title. Its path is Simple Icons' `apple` (CC0).
 */
const LOGO_PATH =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

const logoSvg = (color: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="${LOGO_PATH}"/></svg>`;

/** The native elements a drawn button is made of. */
type DrawnButton = {
  /** Fills the element, with the button's color, corners and outline. */
  readonly face: ElementRef;
  readonly logo: ElementRef;
  readonly title: ElementRef;
  readonly titleText: ElementRef;
};

/**
 * A drawn button's parts, read from the native tree: the element holds the
 * face, which holds the logo and then the title, which holds its raw text.
 * Read rather than kept in a map, since native refs must not be map or set
 * keys (hashing one crashes the Lepus engine, see LynxDocument.createComment),
 * and an id-keyed map would outlive the element. `null` for iOS's button,
 * which is its own tag and has no children.
 */
const drawnButtonOf = (element: ElementRef): DrawnButton | null => {
  if (__GetTag(element) === 'apple-sign-in-button') return null;
  const face = __FirstElement(element);
  const logo = face && __FirstElement(face);
  const title = logo && __NextElement(logo);
  const titleText = title && __FirstElement(title);
  return face && logo && title && titleText
    ? { face, logo, title, titleText }
    : null;
};

/**
 * Whether this host has the native button: the iOS shell registers it with
 * its Sign in with Apple module, so the module answering for it on the main
 * thread, where Angular runs, means the element is there. Lynx gives a host
 * without the module (Android, Lynx Explorer, an iOS app built without
 * `signInWithApple`) no module, or one whose calls answer nothing. Asked for
 * each button rather than once: buttons are few, and the testing library
 * takes the module away and back between tests.
 */
const shellHasButton = (): boolean => {
  const lynxGlobal = (globalThis as { lynx?: { module?: unknown } }).lynx;
  if (typeof lynxGlobal?.module !== 'function') return false;
  try {
    const module = (
      lynxGlobal.module as (
        name: string,
      ) => { invoke?: (method: string) => unknown } | undefined
    )(APPLE_SIGN_IN_MODULE);
    if (typeof module?.invoke !== 'function') return false;
    const answer = module.invoke('button') as { available?: unknown } | null;
    return answer?.available === true;
  } catch {
    return false;
  }
};

/**
 * `<apple-sign-in-button>`, the button that starts Sign in with Apple, drawn
 * to Apple's guidelines. In an iOS app built with angular.json's
 * `signInWithApple` it's iOS's own `ASAuthorizationAppleIDButton`
 * (`AppleSignInButton.swift`), which follows the system's language.
 *
 * Elsewhere (Android, the web preview, Lynx Explorer, an iOS app without the
 * option) nothing is registered for the tag, and on Android an element
 * nothing is registered for stops the elements after it rendering. So there
 * the runtime draws the button itself, with the same titles, colors, logo
 * and corners: a view holding a face that fills it, the logo and the title.
 * Android's sign-in goes through Apple's web flow, where Apple's guidelines
 * ask for the same button. Its title is English, since the runtime has no
 * copy of Apple's translations.
 *
 * Like the native button, it has no size of its own: the app gives it one,
 * and it takes no children.
 */
export const createAppleSignInButtonElement = (pageId: number): ElementRef => {
  if (!__WEB__ && shellHasButton()) {
    return __CreateElement('apple-sign-in-button', pageId);
  }
  const element = __CreateView(pageId);
  const face = __CreateView(pageId);
  const logo = __CreateElement('svg', pageId);
  const title = __CreateText(pageId);
  const titleText = __CreateRawText('');
  __AppendElement(title, titleText);
  __AppendElement(face, logo);
  __AppendElement(face, title);
  __AppendElement(element, face);
  // A screen reader reads the face as one button, as it does iOS's.
  __SetAttribute(face, 'accessibility-element', true);
  __SetAttribute(face, 'accessibility-traits', 'button');
  updateAppleSignInButton(element, null);
  return element;
};

const pick = <T extends string>(
  value: unknown,
  choices: Readonly<Record<T, unknown>>,
  fallback: T,
): T =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(choices, value)
    ? (value as T)
    : fallback;

/**
 * Draws a drawn button as its attributes ask: `type`, `button-style` and
 * `corner-radius`. LynxElement calls it whenever one of them changes, and
 * when it rebuilds the element, whose new parts start as a plain black
 * "Sign in with Apple". A native button reads the attributes itself, so
 * this leaves it alone.
 */
export const updateAppleSignInButton = (
  element: ElementRef,
  attributes: ReadonlyMap<string, unknown> | null,
): void => {
  const drawn = drawnButtonOf(element);
  if (!drawn) return;
  const type = pick<AppleSignInButtonType>(
    attributes?.get('type'),
    TITLES,
    'signIn',
  );
  const style = pick<AppleSignInButtonStyle>(
    attributes?.get('button-style'),
    STYLES,
    'black',
  );
  const radius = Number(attributes?.get('corner-radius'));
  const cornerRadius =
    Number.isFinite(radius) && radius >= 0 ? radius : DEFAULT_CORNER_RADIUS;
  const { background, foreground } = STYLES[style];
  const outline =
    style === 'whiteOutline'
      ? `border-width:1px;border-style:solid;border-color:${foreground};`
      : '';
  // The face fills the element rather than being it, so the app's own style
  // on the element (its size, margins, position) and the button's look never
  // overwrite each other.
  __SetInlineStyles(
    drawn.face,
    'position:absolute;left:0px;top:0px;right:0px;bottom:0px;' +
      'display:flex;flex-direction:row;align-items:center;justify-content:center;' +
      `background-color:${background};border-radius:${cornerRadius}px;${outline}`,
  );
  // The logo is about as tall as the title, nudged up as Apple's is, since
  // its leaf rises above the letters.
  __SetInlineStyles(
    drawn.logo,
    'width:17px;height:17px;margin-right:5px;margin-bottom:3px;',
  );
  __SetAttribute(drawn.logo, 'content', logoSvg(foreground));
  __SetInlineStyles(
    drawn.title,
    `color:${foreground};font-size:17px;font-weight:600;`,
  );
  __SetAttribute(drawn.titleText, 'text', TITLES[type]);
  __SetAttribute(drawn.face, 'accessibility-label', TITLES[type]);
};
