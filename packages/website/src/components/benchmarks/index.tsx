import {
  APPS,
  APP_ORDER,
  deviceName,
  LAUNCHES,
  MOUNTS,
  percentile,
  SESSIONS,
  SIZES,
} from './data';
import { type Metric, MetricChart } from './metric-chart';
import styles from './index.module.scss';

/**
 * "17 Nov 2026", or a range when the runs span days.
 */
const dateRange = (timestamps: readonly string[]): string => {
  const days = [...new Set(timestamps.map((t) => t.slice(0, 10)))].sort();
  const format = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return days.length > 1
    ? `${format(days[0])} to ${format(days.at(-1)!)}`
    : format(days[0]);
};

/**
 * Where and when the runs were made, said under every chart.
 */
const Caption = () => {
  const devices = [
    ...new Set(LAUNCHES.map((launch) => deviceName(launch.device))),
  ];
  const builds = [...new Set(LAUNCHES.map((launch) => launch.osBuild))];
  const runs = APP_ORDER.map(
    (app) =>
      `${APPS[app].label} ${LAUNCHES.filter((launch) => launch.app === app).length}`,
  );
  return (
    <p className={styles['caption']}>
      {devices.join(', ')}, iOS {builds.join(', ')},{' '}
      {dateRange(LAUNCHES.map((l) => l.timestamp))}. Launches per app:{' '}
      {runs.join(', ')}. Each panel is one session, the two apps launched in
      turn. "Again" is a launch right after the app's own last one, when iOS
      still has its files in memory; "after the other" follows the other app's
      launch. Release builds, recorded with Instruments' App Launch template.{' '}
      <a href="/guide/benchmarks#method">How we measured</a>
    </p>
  );
};

/**
 * One panel per session, each the other app beside AngularLynx from the same
 * session, all on one axis so the panels compare too.
 */
const SessionCharts = ({
  metric,
  unit,
  axisLabel,
}: {
  readonly metric: Metric;
  readonly unit: string;
  readonly axisLabel: string;
}) => {
  const values = LAUNCHES.flatMap((launch) =>
    launch[metric] === undefined ? [] : [launch[metric]],
  );
  // Round the axis up to a whole step: 50 ms, or 10 MB.
  const step = unit === 'ms' ? 50 : 10;
  const xMax = Math.ceil(Math.max(...values, step) / step) * step;
  return (
    <div className={styles['sessions']}>
      {SESSIONS.map((session) => (
        <div key={session.id}>
          <p className={styles['session']}>
            With {APPS[session.rival]?.label ?? session.rival}
          </p>
          <MetricChart
            launches={session.launches}
            metric={metric}
            unit={unit}
            axisLabel={axisLabel}
            order={['angular-lynx', session.rival]}
            xMax={xMax}
          />
        </div>
      ))}
    </div>
  );
};

/** The launch charts: fully drawn, first frame and memory. */
export const LaunchCharts = () => (
  <div className={styles['charts']}>
    <figure className={styles['figure']}>
      <figcaption className={styles['title']}>Time to fully drawn</figcaption>
      <p className={styles['summary']}>
        From the tap to the first page of the list on screen, its data loaded
        from a server on the local network. Lower is better.
      </p>
      <SessionCharts
        metric="fullyDrawnMs"
        unit="ms"
        axisLabel="Milliseconds from launch"
      />
    </figure>
    <figure className={styles['figure']}>
      <figcaption className={styles['title']}>Time to first frame</figcaption>
      <p className={styles['summary']}>
        From the tap to the app's first frame, which is its launch screen. Lower
        is better.
      </p>
      <SessionCharts
        metric="firstFrameMs"
        unit="ms"
        axisLabel="Milliseconds from launch"
      />
    </figure>
    <figure className={styles['figure']}>
      <figcaption className={styles['title']}>Memory</figcaption>
      <p className={styles['summary']}>
        The app's footprint, what iOS counts against its memory limit, about
        seven seconds after launch, with the first page and its images loaded.
        Lower is better.
      </p>
      <SessionCharts metric="memoryMb" unit="MB" axisLabel="Megabytes" />
    </figure>
    <Caption />
  </div>
);

/** Each app's release build, as a table: two numbers per app need no chart. */
export const SizeTable = () => (
  <table>
    <thead>
      <tr>
        <th>App</th>
        <th>Installed</th>
        <th>Download (zipped)</th>
      </tr>
    </thead>
    <tbody>
      {SIZES.map((size) => (
        <tr key={size.app}>
          <td>{APPS[size.app]?.label ?? size.app}</td>
          <td>{size.installedMb.toFixed(1)} MB</td>
          <td>{size.downloadMb.toFixed(1)} MB</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** The versions each app ran, for the methodology page. */
export const VersionTable = () => (
  <table>
    <thead>
      <tr>
        <th>App</th>
        <th>What it is</th>
        <th>Versions</th>
      </tr>
    </thead>
    <tbody>
      {Object.entries(APPS).map(([app, info]) => (
        <tr key={app}>
          <td>{info.label}</td>
          <td>{info.notes}</td>
          <td>{info.versions}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const KIND_NAMES = { view: 'views', text: 'texts', image: 'images' } as const;

/**
 * The mount benchmark: a screen of N views, texts or images, from the
 * process starting to the app reporting it drawn. Each row is one session, so
 * AngularLynx and the other app sit side by side.
 */
export const MountTable = () => {
  if (MOUNTS.length === 0) return null;
  const median = (
    session: (typeof MOUNTS)[number],
    app: string,
    condition: 'again' | 'afterOther',
  ) => {
    const values = session.launches
      .filter(
        (launch) =>
          launch.app === app &&
          launch.condition === condition &&
          launch.fullyDrawnMs !== undefined,
      )
      .map((launch) => launch.fullyDrawnMs!);
    return values.length > 0
      ? `${Math.round(percentile(values, 0.5)).toLocaleString('en-US')} ms`
      : '–';
  };
  return (
    <table>
      <thead>
        <tr>
          <th rowSpan={2}>Screen</th>
          <th rowSpan={2}>Other app</th>
          <th colSpan={2}>Launched again</th>
          <th colSpan={2}>After the other app</th>
        </tr>
        <tr>
          <th>AngularLynx</th>
          <th>Other app</th>
          <th>AngularLynx</th>
          <th>Other app</th>
        </tr>
      </thead>
      <tbody>
        {MOUNTS.map((session) => (
          <tr key={`${session.kind}-${session.count}-${session.rival}`}>
            <td>
              {session.count.toLocaleString('en-US')} {KIND_NAMES[session.kind]}
            </td>
            <td>{APPS[session.rival]?.label ?? session.rival}</td>
            <td>{median(session, 'angular-lynx', 'again')}</td>
            <td>{median(session, session.rival, 'again')}</td>
            <td>{median(session, 'angular-lynx', 'afterOther')}</td>
            <td>{median(session, session.rival, 'afterOther')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
