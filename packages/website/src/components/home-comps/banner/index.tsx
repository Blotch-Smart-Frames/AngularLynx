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
      <a href="/guide/quick-start" className={styles['banner-btn']}>
        Quick Start
      </a>
      <DotPattern />
    </div>
  );
};
