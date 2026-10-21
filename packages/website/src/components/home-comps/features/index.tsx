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
    title: 'Powered by Angular',
    desc: 'Full support for signals, standalone components, and modern control flow — the same Angular APIs you already know and love.',
    actions: [
      { text: 'angular.dev', link: 'https://angular.dev/' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@angular/cli' },
    ],
    isRowSet: 508,
  },
  {
    icon: 'fa-light fa-bolt',
    title: 'Made for Lynx',
    desc: "Dual-threaded Angular tailor-made for Lynx, carrying over Lynx's native UI responsiveness and main thread scripting.",
    illustration: true,
  },
  {
    icon: 'fa-light fa-circle-nodes',
    title: 'Compatible with Angular Ecosystem',
    desc: 'Bring your favorite Angular libraries and enjoy the rich Angular ecosystem on Lynx.',
    actions: [
      { text: 'Angular Router', link: '/guide/routing' },
      { text: 'Signals', link: '/guide/change-detection/signals' },
      { text: 'Tailwind CSS', link: '/guide/tailwindcss' },
    ],
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
