import { APPS, APP_ORDER, deviceName, LAUNCHES, SIZES } from './data';
import { MetricChart } from './metric-chart';
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
      {runs.join(', ')}. Release builds; each launch is a new process with warm
      file caches, recorded with Instruments' App Launch template.{' '}
      <a href="/guide/benchmarks#method">How we measured</a>
    </p>
  );
};

/** The launch charts: fully drawn, first frame and memory. */
export const LaunchCharts = ({
  metrics = ['fullyDrawnMs', 'firstFrameMs', 'memoryMb'],
}: {
  readonly metrics?: readonly ('fullyDrawnMs' | 'firstFrameMs' | 'memoryMb')[];
}) => (
  <div className={styles['charts']}>
    {metrics.includes('fullyDrawnMs') && (
      <figure className={styles['figure']}>
        <figcaption className={styles['title']}>Time to fully drawn</figcaption>
        <p className={styles['summary']}>
          From the tap to the first page of the list on screen, its data loaded
          from a server on the local network. Lower is better.
        </p>
        <MetricChart
          launches={LAUNCHES}
          metric="fullyDrawnMs"
          unit="ms"
          axisLabel="Milliseconds from launch"
          order={APP_ORDER}
        />
      </figure>
    )}
    {metrics.includes('firstFrameMs') && (
      <figure className={styles['figure']}>
        <figcaption className={styles['title']}>Time to first frame</figcaption>
        <p className={styles['summary']}>
          From the tap to the app's first frame, which is its launch screen.
          Lower is better.
        </p>
        <MetricChart
          launches={LAUNCHES}
          metric="firstFrameMs"
          unit="ms"
          axisLabel="Milliseconds from launch"
          order={APP_ORDER}
        />
      </figure>
    )}
    {metrics.includes('memoryMb') && (
      <figure className={styles['figure']}>
        <figcaption className={styles['title']}>Memory</figcaption>
        <p className={styles['summary']}>
          The app's footprint, what iOS counts against its memory limit, about
          seven seconds after launch, with the first page and its images loaded.
          Lower is better.
        </p>
        <MetricChart
          launches={LAUNCHES}
          metric="memoryMb"
          unit="MB"
          axisLabel="Megabytes"
          order={APP_ORDER}
        />
      </figure>
    )}
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
