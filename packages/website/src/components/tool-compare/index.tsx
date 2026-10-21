import {
  type CSSProperties,
  type FC,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BorderBeam } from '../home-comps/border-beam';
import styles from './index.module.scss';

type Language = { name: string; icon?: string };

type Tool = {
  name: string;
  write: Language[];
  renderer: string;
  // Whether a browser draws the screen or the phone's own controls do: the
  // difference the comparison exists to show, so the phone sketch changes.
  screen: 'web' | 'native';
  screenTitle: string;
  screenDetail: string;
  hero?: boolean;
};

const angular: Language = { name: 'Angular', icon: 'fa-brands fa-angular' };
const react: Language = { name: 'React', icon: 'fa-brands fa-react' };
const vue: Language = { name: 'Vue', icon: 'fa-brands fa-vuejs' };

// The single source for both the home page and the introduction, so the two
// can't drift apart. Kept to what each tool puts on screen: the difference a
// web developer choosing between them cares about first.
const tools: Tool[] = [
  {
    name: 'Ionic + Capacitor',
    write: [angular, react, vue],
    renderer: 'A WebView',
    screen: 'web',
    screenTitle: 'HTML and CSS',
    screenDetail: 'in a browser view inside the app',
  },
  {
    name: 'NativeScript',
    write: [angular, vue, react, { name: 'and others' }],
    renderer: 'NativeScript',
    screen: 'native',
    screenTitle: 'Native controls',
    screenDetail: 'styled with a subset of CSS',
  },
  {
    name: 'React Native',
    write: [react],
    renderer: 'React Native',
    screen: 'native',
    screenTitle: 'Native controls',
    screenDetail: 'styled with JavaScript objects',
  },
  {
    name: 'AngularLynx',
    write: [angular],
    renderer: 'Lynx',
    screen: 'native',
    screenTitle: 'Native controls',
    screenDetail: 'styled with CSS',
    hero: true,
  },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A thumbnail of what ends up on screen. A WebView shows a page inside a
 * browser frame; native controls show a nav bar, a switch and list rows.
 */
const PhoneSketch: FC<{ kind: Tool['screen'] }> = ({ kind }) => (
  <span className={`${styles['phone']} ${styles[`phone-${kind}`]}`}>
    {kind === 'web' ? (
      <>
        <span className={styles['phone-address']} />
        <span className={styles['phone-page']}>
          <span />
          <span />
          <span />
        </span>
      </>
    ) : (
      <>
        <span className={styles['phone-nav']} />
        <span className={styles['phone-switch']} />
        <span className={styles['phone-row']} />
        <span className={styles['phone-row']} />
      </>
    )}
  </span>
);

export const ToolCompare: FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLLIElement>(null);
  // `armed` hides the rows until they scroll in. It's only set from an effect,
  // so server-rendered HTML, and readers without JavaScript, get them shown.
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  // The beam is a canvas animation, so it only runs while the row is visible.
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = prefersReducedMotion();
    setReducedMotion(reduced);

    // Rows already on screen when the page loads stay put: hiding them only
    // to fade them back in would read as a flicker.
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

  // A cursor spotlight, after React Bits' SpotlightCard. It writes CSS
  // variables directly so following the pointer never re-renders React.
  const moveSpotlight = useCallback((event: PointerEvent<HTMLLIElement>) => {
    const hero = heroRef.current;
    if (!hero) return;
    const rect = hero.getBoundingClientRect();
    hero.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    hero.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }, []);

  const rootClass = [
    styles['compare'],
    armed ? styles['armed'] : '',
    shown ? styles['shown'] : '',
  ].join(' ');

  return (
    <div ref={rootRef} className={rootClass}>
      {/* Column labels for the wide layout. Each row's <dt>s carry the same
          labels for screen readers, and show them in the narrow layout. */}
      <div className={styles['labels']} aria-hidden="true">
        <span />
        <span>You write</span>
        <span>Rendered by</span>
        <span>On screen</span>
      </div>
      <ul className={styles['rows']}>
        {tools.map((tool, index) => (
          <li
            key={tool.name}
            ref={tool.hero ? heroRef : undefined}
            className={`${styles['row']} ${tool.hero ? styles['hero'] : ''}`}
            style={{ '--i': index } as CSSProperties}
            onPointerMove={tool.hero ? moveSpotlight : undefined}
          >
            <div className={styles['name']}>
              {tool.hero && (
                <img className={styles['logo']} src="/logo.png" alt="" />
              )}
              {tool.name}
            </div>
            <dl className={styles['pipeline']}>
              <div className={styles['stage']}>
                <dt>You write</dt>
                <dd className={styles['languages']}>
                  {tool.write.map((language) => (
                    <span
                      key={language.name}
                      className={`${styles['chip']} ${language.icon ? '' : styles['chip-more']}`}
                    >
                      {language.icon && (
                        <i className={language.icon} aria-hidden="true" />
                      )}
                      {language.name}
                    </span>
                  ))}
                </dd>
              </div>
              <div className={styles['stage']}>
                <dt>Rendered by</dt>
                <dd>
                  <span className={styles['renderer']}>{tool.renderer}</span>
                </dd>
              </div>
              <div className={styles['stage']}>
                <dt>On screen</dt>
                <dd className={styles['screen']}>
                  <PhoneSketch kind={tool.screen} />
                  <span>
                    <span className={styles['screen-title']}>
                      {tool.screenTitle}
                    </span>
                    <span className={styles['screen-detail']}>
                      {tool.screenDetail}
                    </span>
                  </span>
                </dd>
              </div>
            </dl>
            {tool.hero && inView && !reducedMotion && (
              <BorderBeam size={3} duration={6} radius={20} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
