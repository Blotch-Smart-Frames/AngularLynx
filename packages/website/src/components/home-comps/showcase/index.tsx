import React, { useId, useState } from 'react';
import type { AutoGestureOptions } from '@lynx-js/go-web';
import { PhonePreview } from './phone-preview';
import styles from './index.module.scss';

/**
 * A slow drag across the dial, twice, so the stone turns before anyone
 * touches it: the first thing Facet shows is the one thing a screenshot
 * can't. Positions are fractions of the screen; the dial fills its upper
 * half. Kept at module level so its identity never changes, since a new
 * object would restart the app.
 */
const turnTheStone: AutoGestureOptions = {
  startDelayMs: 900,
  loop: false,
  steps: [
    {
      path: [
        { x: 0.3, y: 0.34 },
        { x: 0.72, y: 0.34 },
      ],
      durationMs: 1400,
      restMs: 600,
      iterations: 2,
    },
  ],
};

/**
 * The red line across Darkroom's photo, dragged to one side, then the other,
 * then back to the middle: before and after, shown before anyone touches it.
 * The photo's band sits at about a third of the screen's height.
 */
const sweepTheLine: AutoGestureOptions = {
  startDelayMs: 1200,
  loop: false,
  steps: [
    {
      path: [
        { x: 0.5, y: 0.31 },
        { x: 0.16, y: 0.31 },
        { x: 0.84, y: 0.31 },
        { x: 0.5, y: 0.31 },
      ],
      durationMs: 2600,
      restMs: 400,
      iterations: 1,
    },
  ],
};

/**
 * The apps the landing page runs live. The showcase comes first: it's the
 * one that makes the case, and Darkroom is its 2D counterpart, image
 * processing on the GPU. The furniture shop is the Lynx tutorials' app,
 * for a reader who knows the ReactLynx original; the other two are there for
 * anyone who wants the simplest app and the widest one. `code` is the docs
 * page with the app's source beside it.
 */
const demos: {
  id: string;
  label: string;
  tagline: string;
  blurb: string;
  hint: string;
  code: string;
  autoGesture?: AutoGestureOptions;
  statusBar?: 'light' | 'dark';
  layout?: 'iphone' | 'fill';
}[] = [
  {
    id: 'showcase',
    label: 'Facet',
    tagline: 'A jeweler’s gem atlas',
    blurb:
      'A stone drawn on the GPU, Liquid Glass, charts, gestures and a virtualized list, in one real app.',
    hint: 'Drag the dial to turn the stone. Tap another stone to recolor the app.',
    code: '/examples/showcase',
    autoGesture: turnTheStone,
    statusBar: 'light',
  },
  {
    id: 'darkroom',
    label: 'Darkroom',
    tagline: 'A film photo editor',
    blurb:
      'A photo developed live by WebGL2 shaders, a test strip of every film stock drawn in one canvas, and a full-size JPEG out to the share sheet.',
    hint: 'Drag the red line across the photo. Tap a stock on the test strip.',
    code: '/examples/darkroom',
    autoGesture: sweepTheLine,
    statusBar: 'dark',
  },
  {
    id: 'chat',
    label: 'Par Avion',
    tagline: 'A chat app',
    blurb:
      'Letters that load as you scroll back, swipe to reply, stamps for reactions, photos and the keyboard: the things a chat app is judged by, in Angular.',
    hint: 'Open a letter and scroll up. Drag a letter left to reply, or hold it.',
    // No demonstration: Lynx for Web takes a tap only from a real click, so
    // a synthesized one can't open a conversation.
    code: '/examples/chat',
  },
  {
    id: 'furniture-shop',
    label: 'Furniture shop',
    tagline: 'The Lynx tutorials, as one app',
    blurb:
      'The gallery and the product page the official Lynx tutorials build, in Angular: a waterfall list that scrolls itself, and a swiper driven by main-thread scripts.',
    hint: 'Tap a picture to open it, then swipe through its photos.',
    // No demonstration: Lynx for Web takes a tap only from a real click, so
    // a synthesized one can't open a product. The gallery scrolls by itself.
    // Laid out at the screen's size: its waterfall list can't be scaled.
    code: '/examples/furniture-shop',
    statusBar: 'light',
    layout: 'fill',
  },
  {
    id: 'todo-list',
    label: 'Todo list',
    tagline: 'The app the tutorial builds',
    blurb:
      'The smallest app: a list, an input and a signal, written with Lynx elements and Tailwind.',
    hint: 'Add a todo to try it.',
    code: '/examples/todo-list',
  },
  {
    id: 'kitchen-sink-app',
    label: 'Kitchen sink',
    tagline: 'Every element and API',
    blurb:
      'Every element, component and platform API, one screen each, behind a navigation drawer.',
    hint: 'Open the drawer to pick a screen.',
    code: '/examples/',
  },
];

const steps = [
  {
    title: 'Create',
    command: 'npm create angular-lynx my-app',
    desc: 'A standard Angular CLI project, set up for Lynx.',
    link: '/guide/quick-start',
  },
  {
    title: 'Develop',
    command: 'ng serve',
    desc: 'Preview in your browser, or scan the QR code with Lynx Explorer to run it on your phone.',
    link: '/guide/concepts/how-it-runs',
  },
  {
    title: 'Ship',
    command: 'ng build --platform ios',
    desc: 'Get an iOS app, or an Android one with the android platform, ready to upload to the stores.',
    link: '/guide/native-apps',
  },
];

export const ShowCase: React.FC = () => {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const demo = demos[selected]!;

  /**
   * The arrow keys move between the apps, as in a native tab list, and
   * focus follows the selection. Up and down for the stacked list on a
   * desktop, left and right for the row of pills on a phone.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (selected + step + demos.length) % demos.length;
    setSelected(next);
    const tab =
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[
        next
      ];
    tab?.focus();
  };

  return (
    <>
      <div className={styles['show-case-frame']}>
        <div className={styles['title']}>Try it right here</div>
        <div className={styles['desc']}>
          Real AngularLynx apps, running in your browser on Lynx's web renderer.
        </div>
        {/* The phone with the apps beside it on a desktop; on a phone the
            apps go above it as a row of pills, and the notes below. */}
        <div className={styles['stage']}>
          <div
            className={styles['apps']}
            role="tablist"
            aria-label="Example apps"
            onKeyDown={onKeyDown}
          >
            {demos.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={index === selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={index === selected ? 0 : -1}
                className={styles['app']}
                onClick={() => setSelected(index)}
              >
                <span className={styles['app-label']}>{item.label}</span>
                <span className={styles['app-tagline']}>{item.tagline}</span>
              </button>
            ))}
          </div>
          {/* Keyed by app, so switching starts the next one fresh. */}
          <div
            className={styles['phone-column']}
            role="tabpanel"
            id={`${baseId}-panel`}
            aria-labelledby={`${baseId}-tab-${demo.id}`}
          >
            <PhonePreview
              key={demo.id}
              example={demo.id}
              label={demo.label}
              fallbackHref={demo.code}
              autoGesture={demo.autoGesture}
              statusBar={demo.statusBar}
              layout={demo.layout}
            />
          </div>
          <div className={styles['notes']}>
            <p className={styles['blurb']}>{demo.blurb}</p>
            <p className={styles['hint']}>
              <i className="fa-light fa-hand-pointer" aria-hidden="true" />
              {demo.hint}
            </p>
            <a href={demo.code} className={styles['code-link']}>
              See the code{' '}
              <i className="fa-light fa-arrow-right" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <div className={styles['show-case-frame']}>
        <div className={styles['title']}>From your editor to the App Store</div>
        <div className={styles['desc']}>
          Three Angular CLI commands. You never write Swift or Kotlin.
        </div>
        <ol className={styles['show-case-list']}>
          {steps.map((step, index) => (
            <li className={styles['show-case-list-item']} key={step.title}>
              <div className={styles['code-preview-frame']}>
                <div className={styles['code-preview-header']}>
                  <span className={styles['dot']} />
                  <span className={styles['dot']} />
                  <span className={styles['dot']} />
                </div>
                <pre className={styles['code-preview']}>
                  <code>$ {step.command}</code>
                </pre>
              </div>
              <div className={styles['item-title']}>
                {index + 1}. {step.title}
              </div>
              <div className={styles['item-desc']}>{step.desc}</div>
              <a href={step.link} className={styles['item-link']}>
                Learn more{' '}
                <i className="fa-light fa-arrow-right" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
};
