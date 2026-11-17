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
 * One CSV's rows, as launches of the given session.
 */
const readLaunches = (text: string, session: string): Launch[] =>
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
  }));

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
