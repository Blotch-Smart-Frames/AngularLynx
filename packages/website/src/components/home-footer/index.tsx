import type { FC } from 'react';
import { BlotchLogo } from './blotch-logo';
import styles from './index.module.scss';

/**
 * The home page's footer, in place of Rspress's, which prints one line of
 * text: who sponsors AngularLynx, with their logo, and the platform it
 * draws with. Rspress's home layout imports `HomeFooter` from the theme, so
 * the export of this name in theme/index.tsx is what it renders.
 */
export const HomeFooter: FC = () => (
  <footer className={styles['footer']}>
    <p className={styles['sponsor']}>
      <span className={styles['sponsored-by']}>Sponsored by</span>
      {/* The logo stands in for the word "Blotch", so the link reads
          "Blotch Smart Frames". The label spells it out for a screen reader,
          which would otherwise take the capitals of "Smart Frames" from
          the CSS and read them as initials. */}
      <a
        href="https://blotch.app"
        target="_blank"
        rel="noreferrer"
        aria-label="Blotch Smart Frames"
        className={styles['blotch']}
      >
        <BlotchLogo className={styles['logo']} />
        <span className={styles['smart-frames']}>Smart Frames</span>
      </a>
    </p>
    <span className={styles['divider']} aria-hidden="true" />
    <a
      href="https://lynxjs.org/"
      target="_blank"
      rel="noreferrer"
      className={styles['lynx']}
    >
      Built on Lynx
      <i className="fa-light fa-arrow-up-right" aria-hidden="true" />
    </a>
  </footer>
);
