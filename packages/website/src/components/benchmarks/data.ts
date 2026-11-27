/**
 * The benchmark results, read from the CSVs the harness commits
 * (`benchmarks/results/ios`), with nothing computed ahead of time: each chart
 * shows every run, and the medians and p90s come from the same rows.
 */

import appsJson from '../../../../../benchmarks/results/ios/apps.json';
import sizeCsv from '../../../../../benchmarks/results/ios/size.csv';

/** Every CSV of launches, as text (rspress.config.ts loads `.csv` as source). */
const launchFiles = import.meta.webpackContext(
  '../../../../../benchmarks/results/ios',
  { recursive: false, regExp: /^\.\/launch-.*\.csv$/ },
);

export type AppInfo = {
  /** Its name on the charts. */
  readonly label: string;
  /** The framework and the versions that matter, for the captions. */
  readonly versions: string;
  /** How it's made, in a few words. */
  readonly notes: string;
};

export const APPS = appsJson as Record<string, AppInfo>;

/** One launch, one CSV row. */
export type Launch = {
  readonly app: string;
  readonly session: string;
  readonly timestamp: string;
  readonly device: string;
  readonly osBuild: string;
  readonly run: number;
  readonly firstFrameMs?: number;
  readonly fullyDrawnMs?: number;
  readonly memoryMb?: number;
  readonly peakMemoryMb?: number;
  readonly thermalState: string;
  readonly batteryPercent?: number;
  /**
   * What ran before it. `again`: this app was the last one launched, so
   * iOS still has its files in memory (a warm launch), the faster case by
   * about 80 ms. `afterOther`: the session's other app ran in between and
   * pushed some of them out. `first`: the session's first launch, which
   * neither describes, left off the charts.
   */
  readonly condition: 'again' | 'afterOther' | 'first';
};

/**
 * Splits one CSV line into its cells. The harness writes Python's csv module's
 * output, which quotes a cell holding a comma: the phone's model identifier,
 * such as "iPhone15,2", has one.
 */
const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
};

const parseCsv = <Column extends string>(
  text: string,
): Record<Column, string>[] => {
  // No cell holds a newline, so each line is a row.
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = splitCsvLine(header);
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(
      columns.map((column, i) => [column, cells[i] ?? '']),
    ) as Record<Column, string>;
  });
};

const number = (value: string): number | undefined =>
  value === '' ? undefined : Number(value);

/**
 * Sets each launch's condition from the launch before it. Rows are written
 * as each trace is read, which isn't always the order they ran in, so they're
 * put back in order by when each launch started.
 */
const withConditions = (launches: Launch[]): Launch[] => {
  const ordered = [...launches].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  return ordered.map((launch, i) => ({
    ...launch,
    condition:
      i === 0
        ? 'first'
        : ordered[i - 1].app === launch.app
          ? 'again'
          : 'afterOther',
  }));
};

/**
 * One CSV's rows, as launches of the given session.
 */
const readLaunches = (text: string, session: string): Launch[] =>
  withConditions(
    parseCsv<
      | 'app'
      | 'timestamp'
      | 'device'
      | 'os_build'
      | 'run'
      | 'first_frame_ms'
      | 'fully_drawn_ms'
      | 'memory_mb'
      | 'peak_memory_mb'
      | 'thermal_state'
      | 'battery_percent'
    >(text).map((row) => ({
      app: row.app,
      session,
      timestamp: row.timestamp,
      device: row.device,
      osBuild: row.os_build,
      run: Number(row.run),
      firstFrameMs: number(row.first_frame_ms),
      fullyDrawnMs: number(row.fully_drawn_ms),
      memoryMb: number(row.memory_mb),
      peakMemoryMb: number(row.peak_memory_mb),
      thermalState: row.thermal_state,
      batteryPercent: number(row.battery_percent),
      condition: 'first' as const,
    })),
  );

export const LAUNCHES: readonly Launch[] = launchFiles
  .keys()
  .flatMap((file) =>
    readLaunches(
      launchFiles(file) as string,
      file.replace(/^\.\/launch-|\.csv$/g, ''),
    ),
  );

/** Every CSV of the mount benchmark (`harness/ios_mount.py`). */
const mountFiles = import.meta.webpackContext(
  '../../../../../benchmarks/results/ios',
  { recursive: false, regExp: /^\.\/mount-.*\.csv$/ },
);

/** One mount session: a screen of `count` elements, AngularLynx and one other app. */
export type MountSession = {
  readonly kind: 'view' | 'text' | 'image';
  readonly count: number;
  readonly rival: string;
  readonly launches: readonly Launch[];
};

export const MOUNTS: readonly MountSession[] = mountFiles
  .keys()
  .flatMap((file) => {
    // mount-<date>-<kind>-<count>-<rival>.csv; the rival's name can hold dashes.
    const match =
      /^\.\/mount-(\d{4}-\d{2}-\d{2})-(view|text|image)-(\d+)-(.+)\.csv$/.exec(
        file,
      );
    if (!match) return [];
    const [, , kind, count, rival] = match;
    return [
      {
        kind: kind as MountSession['kind'],
        count: Number(count),
        rival,
        launches: readLaunches(mountFiles(file) as string, file),
      },
    ];
  })
  .sort(
    (a, b) =>
      a.count - b.count ||
      ['view', 'text', 'image'].indexOf(a.kind) -
        ['view', 'text', 'image'].indexOf(b.kind),
  );

/** Linear interpolation between the closest ranks, as the harness's summarize.py. */
export const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
};

/** Apple's model identifiers for the phones the runs use. */
const DEVICE_NAMES: Record<string, string> = {
  'iPhone15,2': 'iPhone 14 Pro',
};

export const deviceName = (id: string): string => DEVICE_NAMES[id] ?? id;

/** The size of each app's release build for a phone (`harness/ios_size.sh`). */
export type AppSize = {
  readonly app: string;
  /** The .app's files, as the phone stores them. */
  readonly installedMb: number;
  /** The .app zipped into an .ipa, roughly what a download sends. */
  readonly downloadMb: number;
};

export const SIZES: readonly AppSize[] = parseCsv<
  'app' | 'installed_bytes' | 'download_bytes'
>(sizeCsv).map((row) => ({
  app: row.app,
  installedMb: Number(row.installed_bytes) / 1_000_000,
  downloadMb: Number(row.download_bytes) / 1_000_000,
}));

/** The apps in the results, AngularLynx first, then in the order apps.json lists them. */
export const APP_ORDER: readonly string[] = Object.keys(APPS).filter((app) =>
  LAUNCHES.some((launch) => launch.app === app),
);

/**
 * One sitting of the harness: AngularLynx and one other app, launched in
 * turn (`launch-<date>-<app>.csv`). Runs from different sessions don't mix:
 * the phone and the network differ from one sitting to the next (AngularLynx's
 * median moved by 60 ms between two sessions with the Mac equally idle), so
 * each app is compared with AngularLynx from its own session.
 */
export type Session = {
  readonly id: string;
  /** The other app. */
  readonly rival: string;
  readonly launches: readonly Launch[];
};

export const SESSIONS: readonly Session[] = [
  ...new Set(LAUNCHES.map((launch) => launch.session)),
]
  .map((id) => {
    const launches = LAUNCHES.filter((launch) => launch.session === id);
    const rival =
      launches.find((launch) => launch.app !== 'angular-lynx')?.app ?? '';
    return { id, rival, launches };
  })
  .sort((a, b) => APP_ORDER.indexOf(a.rival) - APP_ORDER.indexOf(b.rival));

/** Every CSV of the scroll benchmark (`harness/ios_scroll.py`). */
const scrollFiles = import.meta.webpackContext(
  '../../../../../benchmarks/results/ios',
  { recursive: false, regExp: /^\.\/scroll-.*\.csv$/ },
);

/**
 * One launch of the scroll benchmark: the app launched, then swiped up
 * through its list ten times, each swipe measured from the finger landing to
 * the list coming to rest. The CSV has a row per swipe; a run adds them up,
 * so one slow swipe counts by how long it lasted, as XCTest's own summary
 * does.
 */
export type ScrollRun = {
  readonly app: string;
  readonly session: string;
  readonly timestamp: string;
  readonly device: string;
  readonly osBuild: string;
  readonly run: number;
  readonly swipes: number;
  /**
   * Milliseconds of hitches (frames that reached the screen late) per second
   * of scrolling, Apple's measure of smoothness: under 5 is good, over 10
   * is bad.
   */
  readonly hitchRatio?: number;
  /** Frames drawn per second while the list moved, over every swipe. */
  readonly fps?: number;
  /** The app's CPU time per swipe, every thread. */
  readonly cpuMsPerSwipe?: number;
  /** The app's footprint after the last swipe. */
  readonly memoryMb?: number;
  readonly thermalState: string;
};

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

const readScrollRuns = (text: string, session: string): ScrollRun[] => {
  const rows = parseCsv<
    | 'app'
    | 'timestamp'
    | 'device'
    | 'os_build'
    | 'run'
    | 'swipe'
    | 'scroll_ms'
    | 'fps'
    | 'hitch_ms'
    | 'cpu_ms'
    | 'memory_mb'
    | 'thermal_state'
  >(text);
  const runs = new Map<string, typeof rows>();
  for (const row of rows) {
    // Run numbers start again at 1 each time ios_scroll.py appends to a CSV;
    // a launch's swipes all share its timestamp.
    const key = `${row.app} ${row.run} ${row.timestamp}`;
    runs.set(key, [...(runs.get(key) ?? []), row]);
  }
  return [...runs.values()].flatMap((swipes) => {
    const measured = swipes.filter((swipe) => swipe.scroll_ms !== '');
    if (measured.length === 0) return [];
    const [first] = measured;
    /**
     * The swipes that have a value in `column`: each metric is over those, so
     * a swipe the result bundle gave no value for is left out of that metric,
     * not counted as 0.
     */
    const having = (column: 'fps' | 'hitch_ms' | 'cpu_ms') =>
      measured.filter((s) => s[column] !== '');
    const perSecond = (
      column: 'fps' | 'hitch_ms',
      weight: (s: (typeof measured)[number]) => number,
    ): number | undefined => {
      const swipes = having(column);
      const seconds = sum(swipes.map((s) => Number(s.scroll_ms))) / 1000;
      return swipes.length > 0 ? sum(swipes.map(weight)) / seconds : undefined;
    };
    const cpu = having('cpu_ms');
    const last = measured.reduce((a, b) =>
      Number(b.swipe) > Number(a.swipe) ? b : a,
    );
    return [
      {
        app: first.app,
        session,
        timestamp: first.timestamp,
        device: first.device,
        osBuild: first.os_build,
        run: Number(first.run),
        swipes: measured.length,
        hitchRatio: perSecond('hitch_ms', (s) => Number(s.hitch_ms)),
        // Each swipe's rate, weighted by how long it moved: the frames drawn
        // over the seconds scrolled.
        fps: perSecond(
          'fps',
          (s) => (Number(s.fps) * Number(s.scroll_ms)) / 1000,
        ),
        cpuMsPerSwipe:
          cpu.length > 0
            ? sum(cpu.map((s) => Number(s.cpu_ms))) / cpu.length
            : undefined,
        memoryMb: number(last.memory_mb),
        thermalState: first.thermal_state,
      },
    ];
  });
};

/** One scroll session: AngularLynx and one other app, launched in turn. */
export type ScrollSession = {
  readonly id: string;
  readonly rival: string;
  readonly runs: readonly ScrollRun[];
};

export const SCROLL_SESSIONS: readonly ScrollSession[] = scrollFiles
  .keys()
  .map((file) => {
    const id = file.replace(/^\.\/scroll-|\.csv$/g, '');
    const runs = readScrollRuns(scrollFiles(file) as string, id);
    const rival = runs.find((run) => run.app !== 'angular-lynx')?.app ?? '';
    return { id, rival, runs };
  })
  .sort(
    (a, b) =>
      Object.keys(APPS).indexOf(a.rival) - Object.keys(APPS).indexOf(b.rival),
  );
