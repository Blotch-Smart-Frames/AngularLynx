import { type FC, useEffect, useRef, useState } from 'react';
import type { LynxViewElement } from '@lynx-js/web-core/client';
import {
  type AutoGestureHandle,
  type AutoGestureOptions,
  playAutoGesture,
} from '@lynx-js/go-web';
import {
  DEVICE_WIDTH,
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
  SCREEN_HEIGHT,
} from '../../go/native-parity';
// go.tsx gives every `<lynx-view>` on the site the native-parity rules the
// moment web-core defines the element. Importing it keeps that so on a page
// where this is the only preview.
import '../../go/go';
import { BorderBeam } from '../border-beam';
import styles from './phone-preview.module.scss';

type PhonePreviewProps = {
  /** The example's folder under /examples, as prepare-examples lays it out. */
  example: string;
  /** The app's name, for the messages while it starts or if it can't. */
  label: string;
  /** Where to send the reader if the app can't start here. */
  fallbackHref: string;
  /** A demonstration to play once the app has painted. */
  autoGesture?: AutoGestureOptions;
  /**
   * The status bar's and home indicator's color: `light` (white) over an app
   * that's dark at the top and bottom, `dark` (black) over a light one, as
   * iOS picks for the app. They can't pick it themselves: a blend mode
   * doesn't see through the `<lynx-view>`'s own compositing layer.
   */
  statusBar?: 'light' | 'dark';
};

type Phase = 'starting' | 'running' | 'failed';

type ExampleMetadata = {
  templateFiles?: { webFile?: string }[];
};

/**
 * The global props an app built with `ng build --platform ios` gets from its
 * shell: it draws over the whole screen, and these say how much of the top
 * and bottom the status bar and the home indicator cover, so `env(safe-area-
 * inset-*)` in the app resolves to the same insets as on the phone.
 */
const PHONE_GLOBAL_PROPS = {
  edgeToEdge: true,
  isNotchScreen: true,
  safeAreaTop: SAFE_AREA_TOP,
  safeAreaRight: 0,
  safeAreaBottom: SAFE_AREA_BOTTOM,
  safeAreaLeft: 0,
};

/**
 * The example's web bundle, from the metadata prepare-examples writes beside
 * it, so this and the docs' `<Go>` previews run the same file.
 */
const resolveBundle = async (example: string): Promise<string> => {
  const response = await fetch(`/examples/${example}/example-metadata.json`);
  if (!response.ok) throw new Error(`No metadata for ${example}`);
  const metadata = (await response.json()) as ExampleMetadata;
  const webFile = metadata.templateFiles?.[0]?.webFile;
  if (!webFile) throw new Error(`No web bundle for ${example}`);
  return `/examples/${example}/${webFile}`;
};

/**
 * Calls `painted` once the view has drawn its page. web-core puts the page
 * into the view's shadow root when the bundle has run, and fires no event
 * for it, so this watches for the page element the way `<Go>`'s preview
 * does, with a deadline in case the signal never comes. Returns a cancel.
 */
const whenPainted = (view: HTMLElement, painted: () => void): (() => void) => {
  let done = false;
  let frame = 0;
  let observer: MutationObserver | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
    painted();
  };
  const hasPage = (shadow: ShadowRoot) =>
    shadow.querySelector('[part="page"], [lynx-tag="page"]') !== null;
  const watch = () => {
    const shadow = view.shadowRoot;
    if (!shadow) {
      frame = requestAnimationFrame(watch);
      return;
    }
    if (hasPage(shadow)) {
      finish();
      return;
    }
    observer = new MutationObserver(() => {
      if (hasPage(shadow)) finish();
    });
    observer.observe(shadow, { childList: true, subtree: true });
  };
  const deadline = setTimeout(finish, 8000);
  watch();
  return () => {
    done = true;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
  };
};

/**
 * The parts of the phone that aren't the app: the status bar's time and
 * indicators, the Dynamic Island and the home indicator, drawn over the
 * app at the screen's size, in the color that reads against the app.
 */
const PhoneChrome: FC<{ statusBar: 'light' | 'dark' }> = ({ statusBar }) => (
  <div
    className={`${styles['chrome']} ${styles[statusBar]}`}
    aria-hidden="true"
  >
    <div className={styles['status-bar']}>
      <span className={styles['time']}>9:41</span>
      <span className={styles['indicators']}>
        <i className="fa-light fa-signal-bars" />
        <i className="fa-light fa-wifi" />
        <i className="fa-light fa-battery-full" />
      </span>
    </div>
    <div className={styles['island']} />
    <div className={styles['home-indicator']} />
  </div>
);

/**
 * An example app running live in a phone-shaped frame: the same Lynx for
 * Web runtime the docs' previews use, laid out at the size of an iPhone's
 * screen and scaled to the frame, with none of the preview's chrome around
 * it. The app gets the whole screen and the phone's safe-area insets, as it
 * would from the app `ng build --platform ios` makes, so it lays itself out
 * around the status bar and the home indicator the way it does on the
 * phone. A beam travels the frame's edge while it runs, the home page's
 * sign that something is live.
 */
const LivePhone: FC<PhonePreviewProps> = ({
  example,
  label,
  fallbackHref,
  autoGesture,
  statusBar = 'dark',
}) => {
  const screen = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [scale, setScale] = useState(0);

  // The app is laid out at the phone's size and scaled to the screen's
  // width, so it wraps and scrolls as on the phone, whatever the frame's
  // size on this page.
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setScale(el.clientWidth / DEVICE_WIDTH),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let disposed = false;
    let cancelPaint = () => {};
    let gesture: AutoGestureHandle | undefined;
    setPhase('starting');

    Promise.all([import('@lynx-js/web-core/client'), resolveBundle(example)])
      .then(([, src]) => {
        if (disposed) return;
        const view = document.createElement('lynx-view') as LynxViewElement;
        // The props must be in place before the URL starts the app.
        view.globalProps = PHONE_GLOBAL_PROPS;
        view.setAttribute('url', src);
        view.style.width = `${DEVICE_WIDTH}px`;
        view.style.height = `${SCREEN_HEIGHT}px`;
        view.addEventListener('error', () => {
          if (!disposed) setPhase('failed');
        });
        host.replaceChildren(view);
        cancelPaint = whenPainted(view, () => {
          setPhase('running');
          // The demonstration is for a reader who hasn't touched the app;
          // the first real touch stops it. Not for a reader who asked for
          // less motion.
          if (
            autoGesture &&
            !matchMedia('(prefers-reduced-motion: reduce)').matches
          ) {
            gesture = playAutoGesture(view, autoGesture);
          }
        });
      })
      .catch(() => {
        if (!disposed) setPhase('failed');
      });

    return () => {
      disposed = true;
      cancelPaint();
      gesture?.stop();
      // Disconnecting the view is how web-core tears the app down.
      host.replaceChildren();
    };
  }, [example, autoGesture]);

  const scaled = { transform: `scale(${scale})` };

  return (
    <div className={styles['phone']}>
      <BorderBeam size={2} duration={7} radius={56} />
      <div ref={screen} className={styles['screen']}>
        <div
          ref={stage}
          className={styles['stage']}
          style={scaled}
          aria-hidden={phase !== 'running'}
        />
        {phase !== 'running' && (
          <div className={styles['curtain']} role="status">
            {phase === 'starting' ? (
              <>
                <i
                  className="fa-light fa-spinner-third fa-spin"
                  aria-hidden="true"
                />
                Starting {label}
              </>
            ) : (
              <>
                {label} couldn't start here.
                <a href={fallbackHref}>Open the example</a>
              </>
            )}
          </div>
        )}
        <div className={styles['overlay']} style={scaled}>
          <PhoneChrome statusBar={statusBar} />
        </div>
      </div>
    </div>
  );
};

/**
 * Rspress also renders the page to Markdown at build time, for AI tools,
 * with no DOM for the app to run in. A live app has nothing to put in
 * Markdown, so it's left out there, as the docs' `<Go>` preview is.
 */
export const PhonePreview: FC<PhonePreviewProps> = (props) =>
  import.meta.env.SSG_MD ? null : <LivePhone {...props} />;
