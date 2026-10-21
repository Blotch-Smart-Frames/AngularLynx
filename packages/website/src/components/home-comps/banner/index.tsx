import type React from 'react';
import styles from './index.module.scss';
import { DotPattern } from './dot-pattern';

export const Banner: React.FC = () => {
  return (
    <div className={styles['banner-frame']}>
      <p className={styles['banner-title']}>
        Start building with{' '}
        <span className={styles['angular-lynx-text']}>AngularLynx</span>
      </p>
      {/* State the project's maturity where people decide to try it. */}
      <p className={styles['banner-desc']}>
        An early, work-in-progress project for Angular 22. Expect missing
        pieces, and tell us about them on GitHub.
      </p>
      <a href="/guide/quick-start" className={styles['banner-btn']}>
        Get started
      </a>
      <DotPattern />
    </div>
  );
};
