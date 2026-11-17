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

const parseCsv = <Column extends string>(
  text: string,
): Record<Column, string>[] => {
  // The harness writes plain values: no quoted commas or newlines.
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(
      columns.map((column, i) => [column, cells[i] ?? '']),
    ) as Record<Column, string>;
  });
};

const number = (value: string): number | undefined =>
  value === '' ? undefined : Number(value);

export const LAUNCHES: readonly Launch[] = launchFiles
  .keys()
  .flatMap((file) => {
    const session = file.replace(/^\.\/launch-|\.csv$/g, '');
    return parseCsv<
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
    >(launchFiles(file) as string).map((row) => ({
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
  });

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
