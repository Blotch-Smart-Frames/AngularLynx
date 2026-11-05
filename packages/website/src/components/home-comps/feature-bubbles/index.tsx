import {
  type CSSProperties,
  type FC,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import styles from './index.module.scss';

/**
 * One bubble per feature, each linking to the page that teaches it. Angular's
 * own features come first, then what Lynx adds, then the tooling; the labels'
 * lengths are interleaved so no row of the cloud is all long or all short.
 */
const features = [
  { label: 'Signals', link: '/guide/concepts/signals' },
  { label: 'Routing', link: '/guide/routing' },
  { label: 'Forms', link: '/guide/forms' },
  { label: '@defer', link: '/guide/defer' },
  { label: 'HTTP', link: '/guide/http' },
  { label: 'UI components', link: '/dolan/' },
  { label: 'Liquid Glass', link: '/dolan/glass' },
  { label: 'Charts', link: '/dolan/chart' },
  { label: 'Gestures', link: '/guide/gestures/' },
  { label: 'Animations', link: '/guide/animations/' },
  { label: 'Tailwind CSS', link: '/guide/tailwindcss' },
  { label: 'CSS Modules', link: '/guide/css-modules' },
  { label: 'Dark mode', link: '/guide/dark-mode' },
  { label: 'Custom fonts', link: '/guide/custom-fonts/' },
  { label: 'Overlays', link: '/guide/overlays' },
  { label: 'Accessibility', link: '/guide/accessibility' },
  { label: 'Storage', link: '/guide/persistent-storage' },
  { label: 'i18n', link: '/guide/i18n' },
  { label: 'Canvas & WebGL', link: '/api/elements/canvas' },
  { label: 'Main-thread scripts', link: '/guide/main-thread/' },
  { label: 'Native modules', link: '/api/angular-lynx/native-module' },
  { label: 'Testing', link: '/guide/testing/' },
  { label: 'Debugging', link: '/guide/debugging' },
  { label: 'iOS & Android', link: '/guide/native-apps' },
  { label: 'App Store', link: '/guide/publishing' },
  { label: 'Embed in a native app', link: '/guide/embedding/' },
];

/**
 * Each bubble leans a few degrees, alternating sides, as if dropped into
 * place. Fixed tables rather than random values so the server and the client
 * render the same markup, and so the cloud looks the same on every visit.
 */
const tilts = [-6, 4, -3, 7, -5, 2, 6, -4, 3, -7, 5, -2];

/**
 * A little unevenness in the stagger (in milliseconds) keeps the pop-in from
 * reading as a metronome.
 */
const jitters = [0, 40, -30, 20, -10, 50, -40, 10, 30, -20, 0, 25];

/**
 * 'still': drawn in place, as the server renders it and as readers who prefer
 * reduced motion see it. 'armed': scaled to nothing, waiting below the fold.
 * 'in': popping up one after another, as the reader scrolls to it.
 */
type Phase = 'still' | 'armed' | 'in';

export const FeatureBubbles: FC = () => {
  const frame = useRef<HTMLElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>('still');

  useEffect(() => {
    const el = frame.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // A section already on screen when the page loads stays as it is: a pop
    // the reader didn't scroll to would only be a delay.
    const rect = el.getBoundingClientRect();
    if (rect.top < innerHeight && rect.bottom > 0) return;

    setPhase('armed');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setPhase('in');
        observer.disconnect();
      },
      // Wait until the section's top is well inside the viewport, so the
      // first bubbles pop where the reader is looking rather than at the
      // bottom edge.
      { rootMargin: '0px 0px -15% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={frame}
      // 'still' has no rule of its own: it's what the stylesheet draws by
      // default.
      className={[styles['bubbles-frame'], styles[phase]]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className={styles['title']}>
        What's in the box
      </h2>
      <p className={styles['desc']}>
        Angular's own features, plus the native ones Lynx adds. Pick one to read
        how it works.
      </p>
      <ul className={styles['cloud']}>
        {features.map((feature, index) => (
          <li
            key={feature.link}
            className={styles['bubble']}
            style={
              {
                '--i': index,
                '--tilt': `${tilts[index % tilts.length]}deg`,
                '--jitter': `${jitters[index % jitters.length]}ms`,
              } as CSSProperties
            }
          >
            <a href={feature.link} className={styles['link']}>
              <span className={styles['label']}>{feature.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};
