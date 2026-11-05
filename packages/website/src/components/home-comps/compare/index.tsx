import type React from 'react';
import { ToolCompare } from '../../tool-compare';
import styles from './index.module.scss';

export const Compare: React.FC = () => {
  return (
    <div className={styles['compare-frame']}>
      <div className={styles['title']}>Why AngularLynx</div>
      <div className={styles['desc']}>
        Other ways to build mobile apps with web skills each make you give
        something up. AngularLynx keeps all of it.
      </div>
      {/* The same comparison as the introduction page's. */}
      <ToolCompare />
      <a href="/guide/introduction" className={styles['link']}>
        Learn more about AngularLynx{' '}
        <i className="fa-light fa-arrow-right" aria-hidden="true" />
      </a>
    </div>
  );
};
