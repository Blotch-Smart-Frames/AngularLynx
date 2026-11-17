import type React from 'react';
import {
  APPS,
  deviceName,
  type Launch,
  percentile,
  SESSIONS,
  SIZES,
} from '../../benchmarks/data';
import styles from './index.module.scss';

/**
 * The other ways to build the app that the home page sets AngularLynx
 * against. ReactLynx isn't here: it runs on the same engine, so it measures
 * our renderer rather than the choice a visitor is making, and the
 * Benchmarks page has it with everything else.
 */
const RIVALS = ['react-native-0.88', 'react-native', 'angular-native'];

/**
 * The times to fully drawn of an app's launches right after its own
 * last one, the condition the Benchmarks page leads with. AngularLynx is ahead
 * of these three after the other app too.
 */
const fullyDrawnTimes = (launches: readonly Launch[], app: string): number[] =>
  launches.flatMap((launch) =>
    launch.app === app &&
    launch.condition === 'again' &&
    launch.fullyDrawnMs !== undefined
      ? [launch.fullyDrawnMs]
      : [],
  );

type Pair = {
  readonly rival: string;
  readonly ours: number;
  readonly theirs: number;
  /** How many launches each median is of, for the footnote. */
  readonly runs: readonly number[];
  readonly launches: readonly Launch[];
};

/**
 * One pair per rival, each from its own session: sessions drift by tens of
 * milliseconds, so AngularLynx's own number differs a little between pairs.
 */
const PAIRS: readonly Pair[] = RIVALS.flatMap((rival) => {
  const session = SESSIONS.find((s) => s.rival === rival);
  if (!session) return [];
  const ours = fullyDrawnTimes(session.launches, 'angular-lynx');
  const theirs = fullyDrawnTimes(session.launches, rival);
  return ours.length === 0 || theirs.length === 0
    ? []
    : [
        {
          rival,
          ours: percentile(ours, 0.5),
          theirs: percentile(theirs, 0.5),
          runs: [ours.length, theirs.length],
          launches: session.launches,
        },
      ];
});

/** Every bar on one scale, so the pairs compare with each other too. */
const SCALE_MAX = Math.max(
  ...PAIRS.flatMap((pair) => [pair.ours, pair.theirs]),
);

const label = (app: string) => APPS[app]?.label ?? app;

/**
 * "17% faster", or "slower" if a new run ever turns a pair around.
 */
const verdict = ({ ours, theirs }: Pair) => {
  const change = Math.round((Math.abs(theirs - ours) / theirs) * 100);
  return `${change}% ${ours <= theirs ? 'faster' : 'slower'}`;
};

const download = (app: string) =>
  SIZES.find((size) => size.app === app)?.downloadMb;

/**
 * The download line, said only while AngularLynx's is the smallest of them.
 */
const DownloadNote = () => {
  const ours = download('angular-lynx');
  const theirs = RIVALS.flatMap((rival) => download(rival) ?? []);
  if (ours === undefined || theirs.length === 0) return null;
  if (theirs.some((size) => size <= ours)) return null;
  return (
    <p className={styles['note']}>
      And a smaller download:{' '}
      <strong className={styles['figure']}>{ours.toFixed(1)} MB</strong>,
      against {Math.min(...theirs).toFixed(1)} to{' '}
      {Math.max(...theirs).toFixed(1)} MB.
    </p>
  );
};

const Bar = ({ app, value }: { app: string; value: number }) => (
  <div className={styles['row']}>
    <div className={styles['row-label']}>
      <span>{label(app)}</span>
      <span className={styles['figure']}>{Math.round(value)} ms</span>
    </div>
    <div className={styles['track']}>
      <div
        className={
          app === 'angular-lynx' ? styles['bar-ours'] : styles['bar-theirs']
        }
        style={{ width: `${(value / SCALE_MAX) * 100}%` }}
      />
    </div>
  </div>
);

/**
 * Where, when and how often, in one line: a figure on the home page still
 * names its phone, OS, date and run count.
 */
const Footnote = () => {
  const launches = PAIRS.flatMap((pair) => pair.launches);
  // "27.0.1 (24A446)" without the build: the Benchmarks page has it.
  const builds = [
    ...new Set(
      launches.map((launch) => launch.osBuild.replace(/ \(.*\)$/, '')),
    ),
  ];
  const days = [...new Set(launches.map((l) => l.timestamp.slice(0, 10)))]
    .sort()
    .map((day) =>
      new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    );
  const runs = PAIRS.flatMap((pair) => pair.runs);
  const [fewest, most] = [Math.min(...runs), Math.max(...runs)];
  return (
    <p className={styles['footnote']}>
      Median of {fewest === most ? fewest : `${fewest} to ${most}`} launches per
      app, release builds, iOS {builds.join(', ')},{' '}
      {days.length > 1 ? `${days[0]} to ${days.at(-1)}` : days[0]}.
    </p>
  );
};

/**
 * The home page's measured numbers, made to be read at a glance: how much
 * sooner the same app is on screen in AngularLynx than in the other ways to
 * build it. Every metric, every run and the method are on the Benchmarks page.
 */
export const Performance: React.FC = () => {
  if (PAIRS.length === 0) return null;
  const device = deviceName(SESSIONS[0].launches[0].device);
  return (
    <section className={styles['frame']} aria-labelledby="performance-title">
      <h2 id="performance-title" className={styles['title']}>
        On screen sooner
      </h2>
      <p className={styles['desc']}>
        The same app in each framework, launched on an {device}: the time from
        the tap to its first page of data on screen.
      </p>
      <div className={styles['pairs']}>
        {PAIRS.map((pair) => (
          <figure key={pair.rival} className={styles['pair']}>
            <figcaption className={styles['verdict']}>
              <strong>{verdict(pair)}</strong> than {label(pair.rival)}
            </figcaption>
            <Bar app="angular-lynx" value={pair.ours} />
            <Bar app={pair.rival} value={pair.theirs} />
          </figure>
        ))}
      </div>
      <DownloadNote />
      <a href="/guide/benchmarks" className={styles['link']}>
        All five apps, every metric, and how we measured{' '}
        <i className="fa-light fa-arrow-right" aria-hidden="true" />
      </a>
      <Footnote />
    </section>
  );
};
