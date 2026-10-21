import type React from 'react';
import { ToolCompare } from '../../tool-compare';
import styles from './index.module.scss';

export const Compare: React.FC = () => {
  return (
    <div className={styles['compare-frame']}>
      <div className={styles['title']}>How it compares</div>
      <div className={styles['desc']}>
        Tools for building mobile apps with web skills differ mostly in what
        ends up on screen.
      </div>
      {/* The same comparison as the introduction page's. */}
      <ToolCompare />
      <a href="/guide/introduction#how-it-compares" className={styles['link']}>
        When to choose which{' '}
        <i className="fa-light fa-arrow-right" aria-hidden="true" />
      </a>
    </div>
  );
};
