import type React from 'react';
import styles from './index.module.scss';
import { PixelBlast } from './pixel-blast';

export const Banner: React.FC = () => {
  return (
    <div className={styles['banner-frame']}>
      <p className={styles['banner-title']}>
        Start building with{' '}
        <span className={styles['angular-lynx-text']}>AngularLynx</span>
      </p>
      {/* State the project's maturity where people decide to try it. */}
      <p className={styles['banner-desc']}>
        Built for Angular 22, and most of it already works. Find a missing
        piece? Tell us on{' '}
        <a
          href="https://github.com/Blotch-Smart-Frames/AngularLynx/issues"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        .
      </p>
      <a href="/guide/quick-start" className={styles['banner-btn']}>
        Get started
      </a>
      <PixelBlast />
    </div>
  );
};
