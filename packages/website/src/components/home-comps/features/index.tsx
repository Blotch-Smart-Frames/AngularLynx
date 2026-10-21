import { type FC, useState, useEffect } from 'react';
import styles from './index.module.scss';
import { BorderBeam } from '../border-beam';

const FeatureIllustration: FC = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () =>
      setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles['feature-illustration']}>
      <img
        src={
          isDark
            ? '/assets/home/home-f-3-dark.svg'
            : '/assets/home/home-f-3.svg'
        }
        alt=""
      />
    </div>
  );
};

const featuresConfig = [
  {
    // Angular's logo exists only among Font Awesome's brand icons.
    icon: 'fa-brands fa-angular',
    title: 'The Angular you already know',
    desc: 'Standalone components, signals, dependency injection, the router, forms and @defer. Generate components with ng generate, test with ng test, and build with ng build.',
    actions: [
      { text: 'Coming from web Angular', link: '/guide/coming-from-web' },
      {
        text: 'What works',
        link: '/guide/coming-from-web#angular-feature-compatibility',
      },
    ],
    isRowSet: 360,
  },
  {
    icon: 'fa-light fa-mobile',
    title: 'Real native UI, drawn by Lynx',
    desc: "Lynx is ByteDance's open-source engine, used in TikTok. It turns your templates into the phone's own UI controls, styled with CSS, so your app scrolls and feels like any other app.",
    illustration: true,
  },
  {
    icon: 'fa-light fa-rocket-launch',
    title: 'From ng serve to the App Store',
    desc: 'Preview in the browser and on your phone as you code. ng build --platform ios or android builds apps ready for the stores, with no Xcode or Gradle project to maintain.',
    actions: [
      { text: 'Quick Start', link: '/guide/quick-start' },
      { text: 'Run on iOS and Android', link: '/guide/native-apps' },
    ],
  },
  {
    icon: 'fa-light fa-toolbox',
    title: 'Everything an app needs',
    desc: 'UI components you copy into your project, Tailwind CSS, gestures, animations, a testing library and internationalization.',
    actions: [
      { text: 'UI Components', link: '/dolan/' },
      { text: 'Tailwind CSS', link: '/guide/tailwindcss' },
      { text: 'Testing', link: '/guide/testing/' },
      { text: 'Examples', link: '/examples/' },
    ],
    isRowSet: 360,
  },
];

export const Features: FC = () => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  return (
    <div className={styles['features-frame']}>
      <div className={styles['list-frame']}>
        {featuresConfig.map((item, index) => (
          <div
            className={`${styles['list-item']} ${item.isRowSet ? styles['row-set'] : ''}`}
            key={index}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
            style={item.isRowSet ? { paddingRight: `${item.isRowSet}px` } : {}}
          >
            <i
              className={`${styles['title-icon']} ${item.icon}`}
              aria-hidden="true"
            />
            <div className={styles['title']}>{item.title}</div>
            <div className={styles['desc']}>{item.desc}</div>
            {item.actions && item.actions.length > 0 && (
              <div className={styles['action-frame']}>
                {item.actions.map((action, i) => (
                  <a
                    key={i}
                    className={styles['action-btn']}
                    href={action.link}
                    target={action.link.startsWith('/') ? undefined : '_blank'}
                    rel={
                      action.link.startsWith('/')
                        ? undefined
                        : 'noopener noreferrer'
                    }
                  >
                    {action.text}
                  </a>
                ))}
              </div>
            )}
            {item.illustration && <FeatureIllustration />}
            {hoverIndex === index && <BorderBeam size={2} duration={3} />}
          </div>
        ))}
      </div>
    </div>
  );
};
