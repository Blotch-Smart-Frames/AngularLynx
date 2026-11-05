import {
  type CSSProperties,
  type FC,
  Fragment,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BorderBeam } from '../home-comps/border-beam';
import styles from './index.module.scss';

type ToolId =
  | 'angularLynx'
  | 'ionic'
  | 'nativeScript'
  | 'angularNative'
  | 'reactNative';

type Mark = 'yes' | 'partly' | 'no';

type Cell = {
  mark: Mark;
  // Says what a "partly" or "no" means, or, for AngularLynx, how it does it.
  // Without one, a cross reads as a verdict rather than a fact. Backticks
  // mark code.
  note?: string;
};

type Claim = {
  label: string;
  cells: Record<ToolId, Cell>;
};

const tools: { id: ToolId; name: string }[] = [
  // AngularLynx leads, so its column of ticks is the first thing read.
  { id: 'angularLynx', name: 'AngularLynx' },
  { id: 'ionic', name: 'Ionic + Capacitor' },
  { id: 'nativeScript', name: 'NativeScript' },
  // Beside React Native, whose renderer it runs on.
  { id: 'angularNative', name: 'Angular Native' },
  { id: 'reactNative', name: 'React Native' },
];

// The single source for both the home page and the introduction, so the two
// can't drift apart. Each row is something an Angular developer gives up with
// at least one of the others. Every competitor cell comes from that tool's own
// docs, checked in November 2026; recheck them there before changing one:
// - Ionic + Capacitor:
//   - https://capacitorjs.com/docs/getting-started/ui: "Capacitor apps are web
//     apps at the core"
//   - https://capacitorjs.com/docs/ios and https://capacitorjs.com/docs/android:
//     a WKWebView or Android WebView; the iOS and Android projects are
//     "configured and managed" in Xcode and Android Studio
//   - https://capacitorjs.com/docs/basics/workflow: `npx cap` builds and runs
//     the phone app
// - NativeScript:
//   - https://docs.nativescript.org/guide/running: `ns run`, with no part for
//     `ng`
//   - https://docs.nativescript.org/ui/: layout through containers such as
//     GridLayout, whose `rows` and `columns` are attributes; CSS flex only
//     inside FlexboxLayout
//   - https://docs.nativescript.org/configuration/vite: Android, iOS and
//     visionOS, no web
//   - https://docs.nativescript.org/project-structure/app-resources:
//     Info.plist, AndroidManifest.xml and Gradle files kept in App_Resources
// - Angular Native (alpha; v0.22.0 was the latest):
//   - https://ng-native.com/guide/architecture: "Angular's Renderer2 drawing
//     UIView and android.view.View through Expo", on React Native's Fabric
//     renderer
//   - https://ng-native.com/packages/fabric/supported-css: flexbox through
//     Yoga, grid laid out by its own engine; https://ng-native.com/packages/
//     tailwind: Tailwind
//   - https://ng-native.com/guide/getting-started: `npx expo run:ios` builds
//     the app; https://ng-native.com/packages/schematics: `ng add
//     @ng-native/schematics` optionally wraps Expo in `ng serve native` and
//     `ng run native:run-ios`, and "`@angular/build` has no native target";
//     the `ios/` and `android/` that `expo prebuild` writes are git-ignored
//   - https://ng-native.com/packages/web and https://ng-native.com/guide/
//     native-and-web: a separate Vite web build, "not intended as a
//     deployment target", whose router "has no web build"
// - React Native:
//   - https://reactnative.dev/docs/style: styles are JavaScript objects
//   - https://reactnative.dev/docs/environment-setup: Expo recommended
//   - https://docs.expo.dev/workflow/web: React Native Web
//   - https://docs.expo.dev/workflow/continuous-native-generation: prebuild
//     generates and git-ignores ios/ and android/
const claims: Claim[] = [
  {
    label: 'Write Angular',
    cells: {
      angularLynx: { mark: 'yes', note: 'Angular 22' },
      ionic: { mark: 'yes' },
      nativeScript: { mark: 'yes' },
      angularNative: { mark: 'yes' },
      reactNative: { mark: 'no', note: 'React only' },
    },
  },
  {
    label: 'Real native UI',
    cells: {
      angularLynx: { mark: 'yes', note: 'iOS and Android views' },
      ionic: { mark: 'no', note: 'Runs in a WebView' },
      nativeScript: { mark: 'yes' },
      angularNative: { mark: 'yes', note: 'On React Native’s renderer' },
      reactNative: { mark: 'yes' },
    },
  },
  {
    label: 'Lay out and style with CSS',
    cells: {
      angularLynx: { mark: 'yes', note: 'Flexbox, grid, Tailwind' },
      ionic: { mark: 'yes' },
      nativeScript: { mark: 'partly', note: 'Its own layout containers' },
      angularNative: { mark: 'yes' },
      reactNative: { mark: 'no', note: 'JS style objects' },
    },
  },
  {
    label: 'The Angular CLI builds the phone app',
    cells: {
      angularLynx: { mark: 'yes', note: '`ng build --platform ios`' },
      ionic: { mark: 'partly', note: 'Plus `npx cap`' },
      nativeScript: { mark: 'no', note: 'Its own `ns` CLI' },
      angularNative: { mark: 'partly', note: 'Optional, wraps Expo' },
      reactNative: { mark: 'no', note: 'Expo’s CLI' },
    },
  },
  {
    label: 'Preview in a desktop browser',
    cells: {
      angularLynx: { mark: 'yes', note: '`ng serve` prints the link' },
      ionic: { mark: 'yes' },
      nativeScript: { mark: 'no', note: 'No web target' },
      angularNative: { mark: 'partly', note: 'Separate web build' },
      reactNative: { mark: 'partly', note: 'With React Native Web' },
    },
  },
  {
    label: 'No Xcode or Android Studio project to keep',
    cells: {
      angularLynx: { mark: 'yes', note: 'Generated for you' },
      ionic: { mark: 'no', note: '`ios/` and `android/` folders' },
      nativeScript: { mark: 'partly', note: 'Native config files' },
      angularNative: { mark: 'yes', note: 'With Expo prebuild' },
      reactNative: { mark: 'yes', note: 'With Expo prebuild' },
    },
  },
];

// The docs the rivals' cells come from, linked under the table.
const sources = [
  { name: 'Capacitor', url: 'https://capacitorjs.com/docs' },
  { name: 'NativeScript', url: 'https://docs.nativescript.org/' },
  { name: 'Angular Native', url: 'https://ng-native.com/' },
  { name: 'React Native', url: 'https://reactnative.dev/docs/getting-started' },
  { name: 'Expo', url: 'https://docs.expo.dev/' },
];

// Screen readers hear the word; the icon is only drawn.
const markText: Record<Mark, string> = {
  yes: 'Yes',
  partly: 'Partly',
  no: 'No',
};

const markIcon: Record<Mark, string> = {
  yes: 'fa-circle-check',
  partly: 'fa-circle-half-stroke',
  no: 'fa-circle-xmark',
};

/**
 * Sets the parts of a note in backticks as code: every other piece of the
 * split. A command may wrap between its words but never inside one, where a
 * browser would break `--platform` at its hyphens.
 */
const renderNote = (note: string) =>
  note.split('`').map((part, index) =>
    index % 2 ? (
      <code key={index}>
        {/* The spaces stay outside the no-wrap spans: they're where it
            may wrap. */}
        {part.split(' ').map((word, i) => [
          i > 0 && ' ',
          <span key={i} className={styles['word']}>
            {word}
          </span>,
        ])}
      </code>
    ) : (
      part
    ),
  );

/**
 * Lets a one-word name such as AngularLynx or NativeScript break between its
 * capitalized parts. On a phone a column is thinner than the name, which
 * would otherwise run into the next one.
 */
const breakableName = (name: string) =>
  name
    .split(/(?<=[a-z])(?=[A-Z])/)
    .flatMap((part, index) => (index ? [<wbr key={index} />, part] : [part]));

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ToolCompare: FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pillarRef = useRef<HTMLDivElement>(null);
  // `armed` hides the marks until they scroll in. It's only set from an
  // effect, so server-rendered HTML, and readers without JavaScript, get them
  // shown.
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  // The beam is a canvas animation, so it only runs while the table is visible.
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = prefersReducedMotion();
    setReducedMotion(reduced);

    // A table already on screen when the page loads stays put: hiding it only
    // to fade it back in would read as a flicker.
    const rect = root.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    if (!reduced && !onScreen) setArmed(true);

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setShown(true);
      },
      { threshold: 0.2 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // A cursor spotlight on the AngularLynx column, after React Bits'
  // SpotlightCard. The column sits behind the rows, which take the pointer,
  // so the whole table tracks it. It writes CSS variables directly so
  // following the pointer never re-renders React.
  const moveSpotlight = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pillar = pillarRef.current;
    if (!pillar) return;
    const rect = pillar.getBoundingClientRect();
    pillar.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    pillar.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }, []);

  const rootClass = [
    styles['compare'],
    armed ? styles['armed'] : '',
    shown ? styles['shown'] : '',
  ].join(' ');

  return (
    <div ref={rootRef} className={rootClass}>
      {/* ARIA roles rather than <table>: the narrow layout moves each row's
          label above its cells, and a CSS display change strips a real
          table's semantics in some browsers. The roles keep them. */}
      <div
        role="table"
        aria-label="AngularLynx compared with Ionic and Capacitor, NativeScript, Angular Native and React Native"
        className={styles['table']}
        style={{ '--rows': claims.length + 1 } as CSSProperties}
        onPointerMove={moveSpotlight}
      >
        {/* The AngularLynx column's card, drawn once behind every row so it
            reads as one column standing out of the table. */}
        <div ref={pillarRef} className={styles['pillar']} aria-hidden="true">
          {inView && !reducedMotion && (
            <BorderBeam size={3} duration={6} radius={20} />
          )}
        </div>
        {/* Each row names its grid line. Auto-placed, a row spanning every
            column would find the pillar in its way and drop below it. */}
        <div
          role="row"
          className={`${styles['row']} ${styles['head']}`}
          style={{ gridRow: 1 }}
        >
          <span role="columnheader" className={styles['corner']}>
            <span className={styles['sr-only']}>Feature</span>
          </span>
          {tools.map((tool) => (
            <span
              key={tool.id}
              role="columnheader"
              className={`${styles['tool']} ${tool.id === 'angularLynx' ? styles['hero'] : ''}`}
            >
              {tool.id === 'angularLynx' && (
                <img className={styles['logo']} src="/logo.png" alt="" />
              )}
              {breakableName(tool.name)}
            </span>
          ))}
        </div>
        {claims.map((claim, index) => (
          <div
            key={claim.label}
            role="row"
            className={styles['row']}
            style={{ '--i': index, gridRow: index + 2 } as CSSProperties}
          >
            <span role="rowheader" className={styles['label']}>
              {claim.label}
            </span>
            {tools.map((tool) => {
              const cell = claim.cells[tool.id];
              const hero = tool.id === 'angularLynx';
              return (
                <span
                  key={tool.id}
                  role="cell"
                  className={`${styles['cell']} ${styles[cell.mark]} ${hero ? styles['hero'] : ''}`}
                >
                  <i
                    className={`${hero ? 'fa-solid' : 'fa-light'} ${markIcon[cell.mark]} ${styles['mark']}`}
                    aria-hidden="true"
                  />
                  <span className={styles['sr-only']}>
                    {markText[cell.mark]}
                    {cell.note ? ': ' : ''}
                  </span>
                  {cell.note && (
                    <span className={styles['note']}>
                      {renderNote(cell.note)}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className={styles['footer']}>
        {/* Says once what the marks mean: the half circle is otherwise read
            as a theme toggle. Screen readers already hear each mark's word. */}
        <ul className={styles['legend']} aria-hidden="true">
          {(['yes', 'partly', 'no'] as const).map((mark) => (
            <li key={mark} className={styles[mark]}>
              <i className={`fa-light ${markIcon[mark]} ${styles['mark']}`} />
              {markText[mark]}
            </li>
          ))}
        </ul>
        {/* Points at where the rivals' cells come from, so the table can be
            checked rather than taken on trust. */}
        <p className={styles['source']}>
          From the docs of{' '}
          {sources.map((source, index) => (
            <Fragment key={source.name}>
              {index === 0 ? '' : index === sources.length - 1 ? ' and ' : ', '}
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.name}
              </a>
            </Fragment>
          ))}
          , November 2026.
        </p>
      </div>
    </div>
  );
};
