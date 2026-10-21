import type React from 'react';
import styles from './index.module.scss';

// Kept short and factual: what each tool puts on screen is the difference a
// web developer choosing between them cares about first. The introduction
// page carries the longer version of this table.
const rows = [
  {
    tool: 'Ionic + Capacitor',
    write: 'Angular, React or Vue',
    screen: 'HTML and CSS in a WebView inside the app',
  },
  {
    tool: 'NativeScript',
    write: 'Angular, Vue, React and others',
    screen: 'Native controls, styled with a subset of CSS',
  },
  {
    tool: 'React Native',
    write: 'React',
    screen: 'Native controls, styled with JavaScript objects',
  },
  {
    tool: 'AngularLynx',
    write: 'Angular',
    screen: 'Native controls drawn by Lynx, styled with CSS',
    highlight: true,
  },
];

export const Compare: React.FC = () => {
  return (
    <div className={styles['compare-frame']}>
      <div className={styles['title']}>How it compares</div>
      <div className={styles['desc']}>
        Tools for building mobile apps with web skills differ mostly in what
        ends up on screen.
      </div>
      <div className={styles['table-wrap']}>
        <table className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">You write</th>
              <th scope="col">On screen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tool}
                className={row.highlight ? styles['highlight'] : undefined}
              >
                <th scope="row">{row.tool}</th>
                <td>{row.write}</td>
                <td>{row.screen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a href="/guide/introduction#how-it-compares" className={styles['link']}>
        When to choose which{' '}
        <i className="fa-light fa-arrow-right" aria-hidden="true" />
      </a>
    </div>
  );
};
