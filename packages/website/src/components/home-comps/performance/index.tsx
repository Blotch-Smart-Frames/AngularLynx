import type React from 'react';
import { LaunchCharts } from '../../benchmarks';
import styles from '../compare/index.module.scss';

/**
 * The home page's measured numbers: the same app in each framework, launched
 * on a real phone. The full set, and how they were measured, is on the
 * Benchmarks page.
 */
export const Performance: React.FC = () => (
  <div className={styles['compare-frame']}>
    <div className={styles['title']}>How it performs</div>
    <div className={styles['desc']}>
      The same app in each framework, launched over and over on a real iPhone.
      Every run is a dot. Memory, first frame and app size are on the Benchmarks
      page.
    </div>
    <LaunchCharts metrics={['fullyDrawnMs']} />
    <a href="/guide/benchmarks" className={styles['link']}>
      Every metric, and how we measured{' '}
      <i className="fa-light fa-arrow-right" aria-hidden="true" />
    </a>
  </div>
);
