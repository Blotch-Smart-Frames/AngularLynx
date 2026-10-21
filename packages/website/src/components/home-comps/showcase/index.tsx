import type React from 'react';
import { Go } from '../../go/go';
import styles from './index.module.scss';

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
  return (
    <>
      <div className={styles['show-case-frame']}>
        <div className={styles['title']}>Try it right here</div>
        <div className={styles['desc']}>
          A real AngularLynx app, running in your browser on Lynx's web
          renderer, next to its code. Add a todo to try it.
        </div>
        {/* The same live preview the docs use, so the landing page shows the
            product itself rather than a screenshot of it. */}
        <div className={styles['demo']}>
          <Go example="todo-list" defaultFile="src/app/app.ts" />
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
