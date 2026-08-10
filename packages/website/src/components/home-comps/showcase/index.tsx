import type React from 'react';
import styles from './index.module.scss';

const showCaseList = [
  {
    title: 'Renderer Architecture',
    desc: 'Understand how Angular renders to native Lynx elements instead of the browser DOM.',
    link: '/guide/renderer-architecture',
    code: `@Component({
  template: \`
    <view>
      <text>{{ title() }}</text>
    </view>
  \`
})`,
  },
  {
    title: 'Routing with Angular Router',
    desc: 'Use the familiar Angular Router for navigation — lazy loading and guards included.',
    link: '/guide/routing',
    code: `const routes: Routes = [
  {
    path: 'home',
    loadComponent: () =>
      import('./home.component'),
  },
];`,
  },
];

export const ShowCase: React.FC = () => {
  return (
    <div className={styles['show-case-frame']}>
      <div className={styles['title']}>Try it for yourself</div>
      <div className={styles['desc']}>
        Build native experiences with familiar Angular patterns.
      </div>
      <ul className={styles['show-case-list']}>
        {showCaseList.map((item, index) => (
          <li className={styles['show-case-list-item']} key={index}>
            <div className={styles['code-preview-frame']}>
              <div className={styles['code-preview-header']}>
                <span className={styles['dot']} />
                <span className={styles['dot']} />
                <span className={styles['dot']} />
              </div>
              <pre className={styles['code-preview']}>
                <code>{item.code}</code>
              </pre>
            </div>
            <div className={styles['item-title']}>{item.title}</div>
            <div className={styles['item-desc']}>{item.desc}</div>
            <a href={item.link} className={styles['item-link']}>
              Learn more &rarr;
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
