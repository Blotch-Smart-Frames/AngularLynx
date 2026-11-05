import React, { useId, useState } from 'react';
import { Go } from '../../go/go';
import styles from './index.module.scss';

/**
 * The apps the landing page runs live. The showcase comes first: it's the
 * one that makes the case; the other two are there for anyone who wants the
 * simplest app and the widest one.
 */
const demos = [
  {
    id: 'showcase',
    label: 'Facet',
    example: 'showcase',
    defaultFile: 'src/app/atlas/atlas.ts',
    blurb:
      'A jeweler’s gem atlas: a stone drawn on the GPU, Liquid Glass, charts, gestures and a virtualized list. Drag the dial to turn the stone; tap another stone to recolor the app.',
  },
  {
    id: 'todo-list',
    label: 'Todo list',
    example: 'todo-list',
    defaultFile: 'src/app/app.ts',
    blurb: 'The app the tutorial builds. Add a todo to try it.',
  },
  {
    id: 'kitchen-sink',
    label: 'Kitchen sink',
    example: 'kitchen-sink-app',
    defaultFile: 'src/app/app.ts',
    blurb:
      'Every element, component and platform API, one screen each, behind a navigation drawer.',
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
   * Left and right arrows move between tabs, as a native tab list does, and
   * focus follows the selection.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
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
          Real AngularLynx apps, running in your browser on Lynx's web renderer,
          next to their code.
        </div>
        <div
          className={styles['tabs']}
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
              className={styles['tab']}
              onClick={() => setSelected(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className={styles['blurb']}>{demo.blurb}</p>
        {/* The same live preview the docs use, so the landing page shows the
            product itself rather than a screenshot of it. Keyed by example so
            switching tabs starts the next app fresh. */}
        <div
          className={styles['demo']}
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${demo.id}`}
        >
          <Go
            key={demo.example}
            example={demo.example}
            defaultFile={demo.defaultFile}
          />
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
