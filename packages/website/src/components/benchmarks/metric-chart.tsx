import { defineChart, dot, text, tickX } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import { useMemo } from 'react';
import { APPS, type Launch, percentile } from './data';

/** AngularLynx in the site's red; the others in one gray, named on the axis. */
const ANGULAR_LYNX = '#dd0031';
const OTHER = '#8b8b94';

export type Metric = 'firstFrameMs' | 'fullyDrawnMs' | 'memoryMb';

type Condition = 'again' | 'afterOther';

/** How each condition reads on the axis, after the app's name. */
const CONDITION_LABELS: Record<Condition, string> = {
  again: 'again',
  afterOther: 'after the other',
};

type Row = {
  app: string;
  label: string;
  value: number;
  run: number;
  session: string;
};
type Summary = {
  app: string;
  label: string;
  median: number;
  p90: number;
  runs: number;
};

/**
 * One row of the chart: an app, launched in one condition.
 */
const rowLabel = (app: string, condition: Condition) =>
  `${APPS[app]?.label ?? app}, ${CONDITION_LABELS[condition]}`;

/**
 * One metric across the apps: a dot for every run, a bar at the median, the
 * median written over it. Every run stays visible, so a spread or an outlier
 * is there to see rather than hidden in an average.
 *
 * Each app has two rows: launched again, right after itself, and launched
 * after the other app. iOS keeps an app's files in memory for a while, so the
 * first is about 80 ms faster, and the second depends on what the other app
 * pushed out; mixing them would give each app two humps and a median between.
 */
export const MetricChart = ({
  launches,
  metric,
  unit,
  axisLabel,
  order,
  xMax,
}: {
  readonly launches: readonly Launch[];
  readonly metric: Metric;
  readonly unit: string;
  readonly axisLabel: string;
  /** The apps, top to bottom. */
  readonly order: readonly string[];
  /** The axis's end, so that charts side by side share one scale. */
  readonly xMax: number;
}) => {
  const { rows, summaries, labels } = useMemo(() => {
    const groups = (['again', 'afterOther'] as const).flatMap((condition) =>
      order.map((app) => ({ app, condition, label: rowLabel(app, condition) })),
    );
    const rows: Row[] = launches.flatMap((launch) =>
      launch[metric] === undefined ||
      launch.condition === 'first' ||
      !order.includes(launch.app)
        ? []
        : [
            {
              app: launch.app,
              label: rowLabel(launch.app, launch.condition),
              value: launch[metric],
              run: launch.run,
              session: launch.session,
            },
          ],
    );
    const summaries: Summary[] = groups.flatMap(({ app, label }) => {
      const values = rows
        .filter((row) => row.label === label)
        .map((row) => row.value);
      if (values.length === 0) return [];
      return [
        {
          app,
          label,
          median: percentile(values, 0.5),
          p90: percentile(values, 0.9),
          runs: values.length,
        },
      ];
    });
    return { rows, summaries, labels: groups.map((group) => group.label) };
  }, [launches, metric, order]);

  const definition = useMemo(() => {
    /**
     * Two layers each, so AngularLynx's paint is a constant: the apps are
     * named on the axis, and the color only picks it out.
     */
    const ours = (row: { app: string }) => row.app === 'angular-lynx';
    const dots = (source: readonly Row[], fill: string) =>
      dot(source, {
        x: 'value',
        y: 'label',
        r: 3,
        fill,
        fillOpacity: 0.5,
        key: (row) => `${row.app}-${row.session}-${row.run}`,
      });
    const medians = (source: readonly Summary[], stroke: string) =>
      tickX(source, {
        x: 'median',
        y: 'label',
        stroke,
        strokeWidth: 3,
        span: 0.6,
      });
    return defineChart({
      marks: [
        dots(
          rows.filter((row) => !ours(row)),
          OTHER,
        ),
        dots(rows.filter(ours), ANGULAR_LYNX),
        medians(
          summaries.filter((summary) => !ours(summary)),
          OTHER,
        ),
        medians(summaries.filter(ours), ANGULAR_LYNX),
        // Beside the median's tick, above the dots, so neither covers it.
        text(summaries, {
          x: 'median',
          y: 'label',
          text: (summary) => format(summary.median, unit),
          anchor: 'start',
          dx: 6,
          dy: -14,
          fontSize: 12,
          fontWeight: 600,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, xMax]),
          grid: true,
          axis: { label: axisLabel },
        },
        // An instance, not a factory, so the apps keep this order instead of
        // the order their rows come in.
        y: {
          scale: scaleBand().domain(labels).padding(0.3),
        },
      },
      tooltip,
    });
  }, [rows, summaries, labels, unit, axisLabel, xMax]);

  return (
    <>
      <Chart
        definition={definition}
        height={56 * summaries.length + 64}
        ariaLabel={`${axisLabel}, every run and the median, for ${summaries.map((s) => s.label).join(', ')}`}
      />
      {/* The same numbers as a table, for screen readers and for copying. */}
      <details>
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Median</th>
              <th>p90</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => (
              <tr key={summary.label}>
                <td>{summary.label}</td>
                <td>{format(summary.median, unit)}</td>
                <td>{format(summary.p90, unit)}</td>
                <td>{summary.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
};

const format = (value: number, unit: string) =>
  `${value < 100 ? value.toFixed(1) : Math.round(value)} ${unit}`;
