import { defineChart, dot, ruleX, text, tickX } from '@tanstack/charts';
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
 * One metric across the apps: a dot for every run, a bar at the median, the
 * median written over it. Every run stays visible, so a spread or an outlier
 * is there to see rather than hidden in an average.
 */
export const MetricChart = ({
  launches,
  metric,
  unit,
  axisLabel,
  order,
}: {
  readonly launches: readonly Launch[];
  readonly metric: Metric;
  readonly unit: string;
  readonly axisLabel: string;
  /** The apps, top to bottom. */
  readonly order: readonly string[];
}) => {
  const { rows, summaries } = useMemo(() => {
    const rows: Row[] = launches
      .filter(
        (launch) => launch[metric] !== undefined && order.includes(launch.app),
      )
      .map((launch) => ({
        app: launch.app,
        label: APPS[launch.app]?.label ?? launch.app,
        value: launch[metric]!,
        run: launch.run,
        session: launch.session,
      }));
    const summaries: Summary[] = order.flatMap((app) => {
      const values = rows
        .filter((row) => row.app === app)
        .map((row) => row.value);
      if (values.length === 0) return [];
      return [
        {
          app,
          label: APPS[app]?.label ?? app,
          median: percentile(values, 0.5),
          p90: percentile(values, 0.9),
          runs: values.length,
        },
      ];
    });
    return { rows, summaries };
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
        fillOpacity: 0.35,
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
        // The axis starts at zero, so the gaps between apps are to scale.
        ruleX([0], { strokeOpacity: 0.4 }),
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
        text(summaries, {
          x: 'median',
          y: 'label',
          text: (summary) => format(summary.median, unit),
          dy: -16,
          fontSize: 12,
          fontWeight: 600,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { label: axisLabel },
        },
        y: {
          scale: () => scaleBand().padding(0.3),
          domain: order.map((app) => APPS[app]?.label ?? app),
        },
      },
      tooltip,
    });
  }, [rows, summaries, order, unit, axisLabel]);

  return (
    <>
      <Chart
        definition={definition}
        height={Math.max(160, 56 * summaries.length + 60)}
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
              <tr key={summary.app}>
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
