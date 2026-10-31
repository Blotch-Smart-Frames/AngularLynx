import { Component, type Provider, signal, viewChild } from '@angular/core';
import { LYNX_ELEMENTS, LynxTheme } from '@blotch/angular-lynx';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import type { ChartDefinition, ChartPoint } from '@tanstack/charts/types';
import {
  barY,
  defineChart,
  dot,
  lineY,
  ruleY,
} from '@tanstack/charts/universal';
import { describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UI_THEME_COLORS } from '../icon/icon-theme';
import { UiChart, UiChartTooltip, tooltip } from './chart';
import {
  CHART_DARK_COLORS,
  CHART_LIGHT_COLORS,
  type ChartColorScheme,
  provideChartTheme,
} from './chart-theme';
import type { ChartZoomAxes } from './chart-zoom';

const revenue = [
  { month: 'Jan', value: 40 },
  { month: 'Feb', value: 60 },
  { month: 'Mar', value: 80 },
];

const barChart = (extra: Record<string, unknown> = {}) =>
  defineChart({
    marks: [
      ruleY([0]),
      barY(revenue, { x: 'month', y: 'value', fill: 'var(--primary)' }),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.2) },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: 'Revenue' },
      },
    },
    tooltip,
    ...extra,
  }) as ChartDefinition<any, any, any>;

const series = [
  { x: 0, y: 1 },
  { x: 5, y: 3 },
  { x: 10, y: 2 },
];

const lineChart = (extra: Record<string, unknown> = {}) =>
  defineChart({
    marks: [lineY(series, { x: 'x', y: 'y' }), dot(series, { x: 'x', y: 'y' })],
    scales: {
      x: { scale: () => scaleLinear().domain([0, 10]) },
      y: { scale: () => scaleLinear().domain([0, 4]) },
    },
    tooltip,
    ...extra,
  }) as ChartDefinition<any, any, any>;

@Component({
  imports: [UiChart, LYNX_ELEMENTS],
  template: `
    <ui-chart
      [definition]="definition()"
      [width]="width()"
      [height]="height()"
      [colorScheme]="colorScheme()"
      [zoomable]="zoomable()"
      [zoomAxes]="zoomAxes()"
      [showZoomControls]="showZoomControls()"
      (focusChange)="focused.push($event)"
      (pointSelect)="selected.push($event)"
    />
  `,
})
class ChartHost {
  readonly definition = signal(barChart());
  readonly width = signal<number | undefined>(undefined);
  readonly height = signal<number | undefined>(undefined);
  readonly colorScheme = signal<ChartColorScheme | 'system' | undefined>(
    undefined,
  );
  readonly zoomable = signal(false);
  readonly zoomAxes = signal<ChartZoomAxes>('xy');
  readonly showZoomControls = signal(true);
  /** Every `focusChange`, in order. */
  readonly focused: (ChartPoint | null)[] = [];
  /** Every `pointSelect`, in order. */
  readonly selected: (ChartPoint | null)[] = [];
  readonly chart = viewChild.required(UiChart);
}

@Component({
  imports: [UiChart],
  template: `<ui-chart [definition]="definition" class="mt-2" />`,
})
class StaticClassHost {
  readonly definition = barChart();
}

/**
 * Renders the host 300px wide, after `configure` sets its inputs. Without a
 * width the chart waits for its layout (see "measures its layout").
 */
const renderChart = async (
  configure: (host: ChartHost) => void = () => {},
  providers: Provider[] = [],
) => {
  const result = await render(ChartHost, { providers });
  const host = result.componentRef.instance as ChartHost;
  host.width.set(300);
  configure(host);
  await waitForUpdate();
  return { ...result, host, root: chartRoot(result.container) };
};

/**
 * The chart's own view, which takes every touch.
 */
const chartRoot = (container: Element) =>
  container.querySelector('[accessibility-label]')!;

/**
 * The chart's box, its host, which its classes and size style and the root
 * view fills.
 */
const chartBox = (container: Element) => chartRoot(container).parentElement!;

/**
 * The SVG each layer draws: under the marks, the marks, over the marks.
 */
const layers = (container: Element) =>
  [...container.querySelectorAll('svg')].map(
    (svg) => svg.getAttribute('content') ?? '',
  );

/** What an empty layer draws. */
const EMPTY_LAYER = '<svg xmlns="http://www.w3.org/2000/svg" width="1"';

/**
 * The tooltip, while the chart shows one.
 */
const tooltipBox = (container: Element) =>
  container.querySelector<HTMLElement>('.flex-col.bg-card');

/**
 * The chart's labels: native texts, which ignore touches like every layer
 * (unlike the tooltip's and zoom controls' texts).
 */
const labels = (container: Element) => [
  ...container.querySelectorAll('text[user-interaction-enabled="false"]'),
];

/**
 * The text of each of the chart's labels.
 */
const labelTexts = (container: Element) =>
  labels(container).map((text) => text.textContent);

/**
 * Fires a touch event at chart coordinates, as Lynx reports them.
 */
const touchAt = (
  type: 'touchstart' | 'touchmove' | 'touchend',
  root: Element,
  at: { x: number; y: number },
) => fireEvent[type](root, { touches: [at] });

/**
 * A point's position, nudged so it's clearly a touch near it.
 */
const pointAt = (host: ChartHost, index: number) => {
  const point = host.chart().scene()!.points[index]!;
  return { x: point.x + 1, y: point.y + 1 };
};

type Phase = 'onBegin' | 'onStart' | 'onUpdate' | 'onEnd';
/**
 * Runs a phase of the chart's pan gesture the way Lynx does: the testing
 * environment keeps what the gesture detector registered with
 * `__SetGestureDetector` on the element, and Lynx calls it with the
 * finger's position on the page.
 */
const pan = (root: Element, phase: Phase, pageX = 0, pageY = 0) => {
  const { gesture } = root as unknown as {
    gesture: {
      config: {
        callbacks: {
          name: string;
          callback: { _fn: (event: unknown) => void };
        }[];
      };
    };
  };
  gesture.config.callbacks
    .find((entry) => entry.name === phase)!
    .callback._fn({ params: { pageX, pageY } });
};

/**
 * Touches a point and lifts the finger right there: a tap.
 */
const tap = async (root: Element, at: { x: number; y: number }) => {
  touchAt('touchstart', root, at);
  touchAt('touchend', root, at);
  await waitForUpdate();
};

describe('UiChart', () => {
  // Angular gives a component's host every static attribute written on it,
  // so the root view taking the class as well applied it twice (issue
  // #181).
  it('puts its class on one element, its box', async () => {
    const { container } = await render(StaticClassHost);
    expect([...container.querySelectorAll('.mt-2')]).toEqual([
      chartBox(container),
    ]);
    expect(chartBox(container).classList).toContain('h-[200px]');
  });

  describe('rendering', () => {
    it('draws nothing until it has a size, and ignores input until then', async () => {
      const { container, componentRef } = await render(ChartHost);
      const host = componentRef.instance as ChartHost;
      const root = chartRoot(container);
      expect(container.querySelectorAll('svg')).toHaveLength(0);
      expect(container.querySelectorAll('text')).toHaveLength(0);

      touchAt('touchstart', root, { x: 1, y: 1 });
      touchAt('touchend', root, { x: 1, y: 1 });
      fireLynxEvent(root, 'accessibilityaction', {
        detail: { name: 'Next point' },
      });
      // Nor do zoom and pan: there's no scene to zoom yet.
      host.chart().zoomIn();
      host.zoomable.set(true);
      await waitForUpdate();
      pan(root, 'onBegin');
      pan(root, 'onUpdate', 10, 0);
      pan(root, 'onEnd', 10, 0);
      await waitForUpdate();
      expect(host.focused).toEqual([]);
      expect(host.selected).toEqual([]);
      expect(root.getAttribute('accessibility-value')).toBe('');
      expect(host.chart().scene()).toBeNull();
    });

    it('draws marks, empty focus layers and native labels', async () => {
      const { container } = await renderChart((host) => host.height.set(200));
      const [under, marks, over] = layers(container);
      expect(layers(container)).toHaveLength(3);
      expect(marks).toContain('<rect');
      expect(marks).toContain(`fill="${CHART_LIGHT_COLORS['primary']}"`);
      expect(under).toContain(EMPTY_LAYER);
      expect(over).toContain(EMPTY_LAYER);
      expect(labelTexts(container)).toEqual(
        expect.arrayContaining(['Jan', 'Feb', 'Mar', 'Revenue']),
      );
      expect(chartBox(container).getAttribute('style')).toContain(
        'width: 300px',
      );
      expect(chartBox(container).getAttribute('style')).toContain(
        'height: 200px',
      );
      const layerStyle = container.querySelector('svg')!.getAttribute('style');
      expect(layerStyle).toContain('width: 300px');
      expect(layerStyle).toContain('height: 200px');
    });

    it('draws a blank image, rather than none, once a layer empties', async () => {
      // Lynx for Web keeps showing the last image when the content clears.
      const { container, host } = await renderChart();
      expect(layers(container)[1]).not.toContain(EMPTY_LAYER);
      const noData: typeof series = [];
      host.definition.set(
        defineChart({
          marks: [dot(noData, { x: 'x', y: 'y' })],
          scales: {
            x: { scale: () => scaleLinear().domain([0, 1]), axis: false },
            y: { scale: () => scaleLinear().domain([0, 1]), axis: false },
          },
        }) as ChartDefinition<any, any, any>,
      );
      await waitForUpdate();
      expect(layers(container)).toEqual([
        expect.stringContaining(EMPTY_LAYER),
        expect.stringContaining(EMPTY_LAYER),
        expect.stringContaining(EMPTY_LAYER),
      ]);
    });

    it('labels the chart for screen readers', async () => {
      const { root } = await renderChart();
      expect(root.getAttribute('accessibility-element')).toBe('true');
      expect(root.getAttribute('accessibility-label')).toBe('Chart');
      expect(root.getAttribute('accessibility-actions')).toBe(
        JSON.stringify(['Next point', 'Previous point']),
      );
    });

    describe('color scheme', () => {
      const darkDevice = {
        provide: LynxTheme,
        useValue: { isDarkMode: () => true },
      };
      /**
       * The color the bars are painted with.
       */
      const primaryFill = async (
        providers: Provider[],
        scheme?: ChartColorScheme | 'system',
      ) => {
        const { container } = await renderChart(
          (host) => host.colorScheme.set(scheme),
          providers,
        );
        return /fill="(rgba\([^)]*\))"/.exec(layers(container)[1]!)?.[1];
      };

      it('stays light on a dark device unless the app opts in', async () => {
        expect(await primaryFill([darkDevice])).toBe(
          CHART_LIGHT_COLORS['primary'],
        );
      });

      it('takes the scheme from its input', async () => {
        expect(await primaryFill([], 'dark')).toBe(
          CHART_DARK_COLORS['primary'],
        );
      });

      it("follows the device with 'system'", async () => {
        expect(await primaryFill([darkDevice], 'system')).toBe(
          CHART_DARK_COLORS['primary'],
        );
        expect(
          await primaryFill(
            [{ provide: LynxTheme, useValue: { isDarkMode: () => false } }],
            'system',
          ),
        ).toBe(CHART_LIGHT_COLORS['primary']);
      });

      it('takes the scheme from the chart theme, a function included', async () => {
        expect(
          await primaryFill([
            darkDevice,
            provideChartTheme({ colorScheme: 'system' }),
          ]),
        ).toBe(CHART_DARK_COLORS['primary']);
        expect(
          await primaryFill([provideChartTheme({ colorScheme: () => 'dark' })]),
        ).toBe(CHART_DARK_COLORS['primary']);
      });

      it('paints with colors set at runtime above it, such as the wallpaper’s', async () => {
        const wallpaper = {
          provide: UI_THEME_COLORS,
          useValue: signal({ dark: { primary: 'rgba(208, 188, 255, 1)' } }),
        };
        expect(await primaryFill([wallpaper], 'dark')).toBe(
          'rgba(208, 188, 255, 1)',
        );
        expect(await primaryFill([wallpaper], 'light')).toBe(
          CHART_LIGHT_COLORS['primary'],
        );
      });
    });

    it('gives labels the foreground token when the theme sets no foreground', async () => {
      const { getByText } = await renderChart(() => {}, [
        provideChartTheme({ chart: { foreground: undefined } }),
      ]);
      expect(getByText('Revenue').getAttribute('style')).toContain(
        'color: var(--foreground)',
      );
    });

    it('exposes a tooltip token that creates nothing itself', () => {
      // TanStack's DOM tooltip creates its element here; <ui-chart> draws its
      // own, so the token is only a marker.
      expect(tooltip.create()).toBeUndefined();
      expect(tooltip.__chartTooltipHost).toBe('lynx');
    });

    it('measures its layout when no size is given', async () => {
      const { container, componentRef } = await render(ChartHost);
      const host = componentRef.instance as ChartHost;
      const root = chartRoot(container);
      const layerStyle = () =>
        container.querySelector('svg')?.getAttribute('style');
      expect(chartBox(container).getAttribute('style') ?? '').not.toContain(
        'width',
      );

      fireEvent.layoutchange(root, { detail: { width: 250, height: 120 } });
      await waitForUpdate();
      expect(layerStyle()).toContain('width: 250px');
      expect(layerStyle()).toContain('height: 120px');

      // Older Android reports the size in `params`.
      fireEvent.layoutchange(root, { params: { width: 260, height: 130 } });
      await waitForUpdate();
      expect(layerStyle()).toContain('width: 260px');

      // The same size again and malformed events change nothing.
      const scene = host.chart().scene();
      fireEvent.layoutchange(root, { detail: { width: 260, height: 130 } });
      fireEvent.layoutchange(root, { detail: {} });
      fireEvent.layoutchange(root, {});
      await waitForUpdate();
      expect(host.chart().scene()).toBe(scene);
    });

    it('uses the default height when the layout has none', async () => {
      const { container, host } = await renderChart((host) =>
        host.width.set(100),
      );
      const layerStyle = container.querySelector('svg')!.getAttribute('style');
      expect(layerStyle).toContain('width: 100px');
      expect(layerStyle).toContain('height: 200px');

      host.width.set(0);
      await waitForUpdate();
      expect(container.querySelectorAll('svg')).toHaveLength(0);
    });

    it('measures text with lynx.getTextInfo where the thread has it', async () => {
      // render() switches to the testing environment's main thread, which
      // copies that thread's globals over, so the stub goes there.
      const mainLynx = (
        globalThis as unknown as {
          lynxTestingEnv: {
            mainThread: { globalThis: { lynx: Record<string, unknown> } };
          };
        }
      ).lynxTestingEnv.mainThread.globalThis.lynx;
      const original = mainLynx['getTextInfo'];
      const getTextInfo = vi.fn(
        (_text: string, _info: { fontSize: string }) => ({ width: 12 }),
      );
      mainLynx['getTextInfo'] = getTextInfo;
      try {
        const { container } = await renderChart();
        expect(container.querySelectorAll('svg')).toHaveLength(3);
        expect(getTextInfo).toHaveBeenCalledWith('Jan', expect.anything());
      } finally {
        mainLynx['getTextInfo'] = original;
      }
    });
  });

  describe('touch', () => {
    it('focuses the touched point and shows the tooltip', async () => {
      const { container, host, root } = await renderChart();
      touchAt('touchstart', root, pointAt(host, 1));
      await waitForUpdate();
      expect(host.focused).toEqual([
        expect.objectContaining({ xValue: 'Feb' }),
      ]);
      expect(layers(container)[2]).not.toContain(EMPTY_LAYER);
      expect(root.getAttribute('accessibility-value')).toContain('Feb');

      // Until it's been laid out, the tooltip's size is unknown: it's placed
      // with a guess and kept invisible.
      const box = tooltipBox(container)!;
      expect(within(box).getByText('60')).toBeTruthy();
      expect(box.getAttribute('style')).toContain('opacity: 0');

      fireEvent.layoutchange(box, { detail: { width: 80, height: 40 } });
      await waitForUpdate();
      expect(box.getAttribute('style')).not.toContain('opacity');

      // The same size again and malformed events change nothing.
      const style = box.getAttribute('style');
      fireEvent.layoutchange(box, { detail: { width: 80, height: 40 } });
      fireEvent.layoutchange(box, {});
      await waitForUpdate();
      expect(box.getAttribute('style')).toBe(style);
    });

    it('scrubs as the touch moves, without repeating focus events', async () => {
      const { host, root } = await renderChart();
      touchAt('touchstart', root, pointAt(host, 0));
      touchAt('touchmove', root, pointAt(host, 0));
      touchAt('touchmove', root, pointAt(host, 2));
      expect(host.focused.map((point) => point?.xValue)).toEqual([
        'Jan',
        'Mar',
      ]);
    });

    it('ends a scrub without selecting, clearing its focus', async () => {
      const { container, host, root } = await renderChart();
      touchAt('touchstart', root, pointAt(host, 0));
      touchAt('touchmove', root, pointAt(host, 2));
      // Lynx reports the lifted finger in changedTouches.
      fireEvent.touchend(root, { changedTouches: [pointAt(host, 2)] });
      await waitForUpdate();
      expect(host.selected).toEqual([]);
      expect(host.focused.at(-1)).toBeNull();
      expect(tooltipBox(container)).toBeNull();
    });

    it('ignores touches without coordinates', async () => {
      const { container, host, root } = await renderChart();
      fireEvent.touchstart(root, {});
      fireEvent.touchmove(root, { touches: [{}] });
      fireEvent.touchend(root, {});
      await waitForUpdate();
      expect(host.focused).toEqual([]);
      expect(host.selected).toEqual([]);
      expect(tooltipBox(container)).toBeNull();
    });

    it('pins the tooltip on tap, and unpins on the next tap', async () => {
      const { container, host, root } = await renderChart();
      await tap(root, pointAt(host, 2));
      expect(host.selected).toEqual([
        expect.objectContaining({ xValue: 'Mar' }),
      ]);
      // A pinned tooltip takes touches, for a button in a custom one.
      const box = tooltipBox(container)!;
      expect(box.getAttribute('user-interaction-enabled')).toBe('true');

      // While pinned, touches don't move focus, and a cancel keeps it.
      touchAt('touchstart', root, pointAt(host, 0));
      touchAt('touchmove', root, pointAt(host, 0));
      fireEvent.touchcancel(root);
      await waitForUpdate();
      expect(within(box).getByText('Mar')).toBeTruthy();

      await tap(root, pointAt(host, 0));
      expect(tooltipBox(container)).toBeNull();
      expect(host.focused.at(-1)).toBeNull();
    });

    it('keeps a pinned tooltip through a drag', async () => {
      const { container, host, root } = await renderChart();
      const at = pointAt(host, 1);
      await tap(root, at);
      // A scroll that starts on the chart moves the finger well past a tap.
      touchAt('touchstart', root, at);
      touchAt('touchend', root, { x: at.x, y: at.y - 100 });
      await waitForUpdate();
      expect(
        tooltipBox(container)!.getAttribute('user-interaction-enabled'),
      ).toBe('true');
    });

    it('selects nothing for a tap on empty space', async () => {
      const { container, host, root } = await renderChart((host) =>
        host.definition.set(barChart({ maxFocusDistance: 1 })),
      );
      touchAt('touchstart', root, { x: -50, y: -50 });
      // Without a position on the lifted finger, it's where the touch began.
      fireEvent.touchend(root, {});
      await waitForUpdate();
      expect(host.selected).toEqual([null]);
      expect(tooltipBox(container)).toBeNull();
    });

    it("tells the definition's selection about taps", async () => {
      const change = vi.fn((_point: ChartPoint | null, _source: string) => {});
      const { host, root } = await renderChart((host) =>
        host.definition.set(barChart({ selection: { change } })),
      );
      await tap(root, pointAt(host, 0));
      expect(change).toHaveBeenCalledWith(
        expect.objectContaining({ xValue: 'Jan' }),
        'pointer',
      );
    });

    it('keeps focus after a tap when the tooltip is not sticky', async () => {
      const { container, host, root } = await renderChart((host) =>
        host.definition.set(
          barChart({ tooltip: { use: tooltip, sticky: false } }),
        ),
      );
      await tap(root, pointAt(host, 0));
      const box = tooltipBox(container)!;
      expect(box.getAttribute('user-interaction-enabled')).toBe('false');

      // A scrolling parent taking the touch over clears it.
      fireEvent.touchcancel(root);
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();
    });

    it('focuses without a tooltip when the definition has none', async () => {
      const { container, host, root } = await renderChart((host) =>
        host.definition.set(barChart({ tooltip: false })),
      );
      touchAt('touchstart', root, pointAt(host, 0));
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();
      expect(layers(container)[2]).not.toContain(EMPTY_LAYER);

      await tap(root, pointAt(host, 0));
      expect(root.getAttribute('accessibility-value')).toContain('Jan');
    });

    it('shows a pinned-only tooltip once pinned', async () => {
      const { container, host, root } = await renderChart((host) =>
        host.definition.set(
          barChart({ tooltip: { use: tooltip, visibility: 'pinned' } }),
        ),
      );
      touchAt('touchstart', root, pointAt(host, 0));
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();

      touchAt('touchend', root, pointAt(host, 0));
      await waitForUpdate();
      expect(tooltipBox(container)).not.toBeNull();
    });

    describe('tooltip content', () => {
      /**
       * The tooltip's rows (its title first, if any), each as its texts.
       */
      const rows = (box: Element) =>
        [...box.querySelectorAll(':scope > .flex-row')].map((row) =>
          [...row.querySelectorAll('text')].map((text) => text.textContent),
        );
      /**
       * Each row's color swatch style, or `null` for a row without one.
       */
      const swatches = (box: Element) =>
        [...box.querySelectorAll(':scope > .flex-row')].map(
          (row) =>
            row.querySelector('.rounded-sm')?.getAttribute('style') ?? null,
        );

      it('lists the x and y values, labeled by axis', async () => {
        const { container, host, root } = await renderChart();
        touchAt('touchstart', root, pointAt(host, 1));
        await waitForUpdate();
        const box = tooltipBox(container)!;
        expect(rows(box)).toEqual([
          ['x', 'Feb'],
          ['Revenue', '60'],
        ]);
        expect(swatches(box)).toEqual([null, null]);
      });

      it("shows the definition's own content, with its colors", async () => {
        const { container, host, root } = await renderChart((host) =>
          host.definition.set(
            barChart({
              tooltip: {
                use: tooltip,
                content: () => ({
                  title: 'Totals',
                  color: 'red',
                  rows: [
                    { label: 'Sum', value: '180' },
                    { label: 'Best', value: 'Mar', color: 'blue' },
                  ],
                }),
              },
            }),
          ),
        );
        touchAt('touchstart', root, pointAt(host, 0));
        await waitForUpdate();
        const box = tooltipBox(container)!;
        expect(rows(box)).toEqual([
          ['Totals'],
          ['Sum', '180'],
          ['Best', 'Mar'],
        ]);
        expect(swatches(box)).toEqual([
          expect.stringContaining('background-color: red'),
          null,
          expect.stringContaining('background-color: blue'),
        ]);
      });

      it('leaves the title out when the content has none', async () => {
        const { container, host, root } = await renderChart((host) =>
          host.definition.set(
            barChart({
              tooltip: {
                use: tooltip,
                content: () => ({ rows: [{ label: 'Sum', value: '180' }] }),
              },
            }),
          ),
        );
        touchAt('touchstart', root, pointAt(host, 0));
        await waitForUpdate();
        expect(rows(tooltipBox(container)!)).toEqual([['Sum', '180']]);
      });

      it('shows a string tooltip as its title', async () => {
        const { container, host, root } = await renderChart((host) =>
          host.definition.set(
            barChart({ tooltip: { use: tooltip, format: () => 'Custom' } }),
          ),
        );
        touchAt('touchstart', root, pointAt(host, 0));
        await waitForUpdate();
        expect(rows(tooltipBox(container)!)).toEqual([['Custom']]);
      });
    });
  });

  describe('focus across scene changes', () => {
    it('keeps focus on the same datum, and drops it when the datum is gone', async () => {
      const { container, host, root } = await renderChart();
      await tap(root, pointAt(host, 1));
      host.width.set(320);
      await waitForUpdate();
      expect(within(tooltipBox(container)!).getByText('Feb')).toBeTruthy();

      host.definition.set(
        defineChart({
          marks: [
            barY([{ month: 'Apr', value: 1 }], { x: 'month', y: 'value' }),
          ],
          scales: {
            x: { scale: () => scaleBand() },
            y: { scale: scaleLinear },
          },
          tooltip,
        }) as ChartDefinition<any, any, any>,
      );
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();
      expect(root.getAttribute('accessibility-value')).toBe('');
    });
  });

  describe('accessibility', () => {
    const step = (root: Element, name: string) =>
      fireLynxEvent(root, 'accessibilityaction', { detail: { name } });

    it('steps through points with the screen reader actions', async () => {
      const { host, root } = await renderChart();
      step(root, 'Next point');
      step(root, 'Next point');
      step(root, 'Previous point');
      await waitForUpdate();
      expect(host.focused.map((point) => point?.xValue)).toEqual([
        'Jan',
        'Feb',
        'Jan',
      ]);
      expect(root.getAttribute('accessibility-value')).toContain('Jan');

      // Other actions, and actions without a name, do nothing.
      step(root, 'Activate');
      fireLynxEvent(root, 'accessibilityaction');
      expect(host.focused).toHaveLength(3);
    });

    it('clears focus when there are no points to step to', async () => {
      const { root } = await renderChart((host) =>
        host.definition.set(barChart({ focus: false })),
      );
      step(root, 'Next point');
      await waitForUpdate();
      expect(root.getAttribute('accessibility-value')).toBe('');
    });

    it('describes values that are dates', async () => {
      const { root } = await renderChart((host) =>
        host.definition.set(
          defineChart({
            marks: [
              dot([{ t: new Date(Date.UTC(2026, 0, 2)), v: 3 }], {
                x: 't',
                y: 'v',
              }),
            ],
            scales: {
              x: { scale: () => scaleBand() },
              y: { scale: scaleLinear },
            },
          }) as ChartDefinition<any, any, any>,
        ),
      );
      step(root, 'Next point');
      await waitForUpdate();
      expect(root.getAttribute('accessibility-value')).toContain('2026-01-02');
    });
  });

  describe('zoom', () => {
    /**
     * The visible window of an axis.
     */
    const domainOf = (host: ChartHost, axis: 'x' | 'y') => {
      const scale = host.chart().scene()!.scales[axis]!;
      return (scale.viewport?.domain ?? scale.domain) as number[];
    };
    const isZoomed = (host: ChartHost, axis: 'x' | 'y') =>
      host.chart().scene()!.scales[axis]!.viewport !== undefined;
    /**
     * Taps one of the zoom controls by its label.
     */
    const press = async (
      getByText: (text: string) => HTMLElement,
      label: '+' | '−' | '1:1',
    ) => {
      fireEvent.tap(getByText(label).parentElement!);
      await waitForUpdate();
    };

    const zoomable =
      (definition = lineChart()) =>
      (host: ChartHost) => {
        host.definition.set(definition);
        host.zoomable.set(true);
      };

    it('zooms in and out with the controls, and resets', async () => {
      const { getByText, host } = await renderChart(zoomable());
      await press(getByText, '+');
      const [lo, hi] = domainOf(host, 'x');
      expect(hi! - lo!).toBeCloseTo(10 / 1.4);

      // Zoomed all the way out, the chart renders as if never zoomed.
      await press(getByText, '−');
      expect(isZoomed(host, 'x')).toBe(false);
      expect(domainOf(host, 'x')).toEqual([0, 10]);

      await press(getByText, '+');
      await press(getByText, '1:1');
      expect(isZoomed(host, 'x')).toBe(false);
    });

    it('shows the controls only when zoomable and asked to', async () => {
      const { host, queryByText } = await renderChart();
      expect(queryByText('1:1')).toBeNull();
      host.zoomable.set(true);
      await waitForUpdate();
      expect(queryByText('1:1')).not.toBeNull();
      host.showZoomControls.set(false);
      await waitForUpdate();
      expect(queryByText('1:1')).toBeNull();
    });

    it('only zooms the chosen axes, and only continuous ones', async () => {
      const lines = await renderChart((host) => {
        zoomable()(host);
        host.zoomAxes.set('y');
      });
      await press(lines.getByText, '+');
      expect(isZoomed(lines.host, 'x')).toBe(false);
      expect(isZoomed(lines.host, 'y')).toBe(true);

      // A band axis can't zoom.
      const bars = await renderChart((host) => {
        zoomable(barChart())(host);
        host.zoomAxes.set('x');
      });
      await press(bars.getByText, '+');
      expect(isZoomed(bars.host, 'x')).toBe(false);
    });

    it('pans by dragging, from the window at touch-down', async () => {
      const { container, getByText, host, root } =
        await renderChart(zoomable());
      await press(getByText, '+');
      await press(getByText, '+');
      const [startX] = domainOf(host, 'x');
      const [startY] = domainOf(host, 'y');
      const span = domainOf(host, 'x')[1]! - startX!;

      pan(root, 'onBegin', 100, 100);
      pan(root, 'onStart', 100, 100);
      pan(root, 'onUpdate', 110, 105);
      await waitForUpdate();
      // Dragging right moves the window to lower values; the y axis points
      // down the screen, so dragging down moves it to higher ones.
      const firstShift = startX! - domainOf(host, 'x')[0]!;
      expect(firstShift).toBeGreaterThan(0);
      expect(domainOf(host, 'y')[0]!).toBeGreaterThan(startY!);

      // Each frame pans by the drag since touch-down, not by the frames'
      // sum, and keeps the window's span.
      pan(root, 'onUpdate', 120, 110);
      await waitForUpdate();
      const [x0, x1] = domainOf(host, 'x');
      expect(startX! - x0!).toBeCloseTo(firstShift * 2);
      expect(x1! - x0!).toBeCloseTo(span);

      // While panning, the label pool keeps its size.
      const count = labels(container).length;
      pan(root, 'onUpdate', 300, 110);
      await waitForUpdate();
      expect(labels(container)).toHaveLength(count);

      pan(root, 'onEnd', 300, 110);
      await waitForUpdate();
      expect(
        labels(container).every(
          (text) => !text.getAttribute('style')!.includes('display: none'),
        ),
      ).toBe(true);
    });

    it('hides the tooltip while panning', async () => {
      const { container, host, root } = await renderChart(zoomable());
      await tap(root, pointAt(host, 1));
      expect(tooltipBox(container)).not.toBeNull();

      pan(root, 'onBegin', 100, 100);
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();

      pan(root, 'onEnd', 100, 100);
      await waitForUpdate();
      expect(tooltipBox(container)).not.toBeNull();
    });

    it('anchors a pan that starts without onBegin', async () => {
      const { getByText, host, root } = await renderChart(zoomable());
      await press(getByText, '+');
      const start = domainOf(host, 'x');

      pan(root, 'onStart', 100, 0);
      pan(root, 'onUpdate', 130, 0);
      pan(root, 'onEnd', 130, 0);
      await waitForUpdate();
      const panned = domainOf(host, 'x');
      expect(panned[0]!).toBeLessThan(start[0]!);

      // One that skips onStart too begins at its first update, which is where
      // the finger's travel is measured from: the window doesn't jump.
      pan(root, 'onUpdate', 0, 0);
      pan(root, 'onEnd', 0, 0);
      await waitForUpdate();
      expect(domainOf(host, 'x')).toEqual(panned);
    });

    it('hides spare labels while a pan holds the pool', async () => {
      const { container, host, root } = await renderChart(zoomable());
      const count = labels(container).length;
      const hidden = () =>
        labels(container).filter((text) =>
          text.getAttribute('style')!.includes('display: none'),
        );
      pan(root, 'onBegin');
      // A chart with fewer labels arrives mid-gesture: the spare slots hide
      // rather than go, since removing elements mid-gesture can crash Lynx.
      host.definition.set(
        lineChart({
          scales: {
            x: { scale: () => scaleLinear().domain([0, 10]), axis: false },
            y: { scale: () => scaleLinear().domain([0, 4]), axis: false },
          },
        }),
      );
      await waitForUpdate();
      expect(labels(container)).toHaveLength(count);
      expect(hidden()).toHaveLength(count);

      pan(root, 'onEnd');
      await waitForUpdate();
      expect(labels(container)).toHaveLength(0);
    });

    it("doesn't pan an axis that can't zoom", async () => {
      const { host, root } = await renderChart((host) => {
        zoomable(barChart())(host);
        host.zoomAxes.set('x');
      });
      pan(root, 'onBegin', 100, 0);
      pan(root, 'onUpdate', 130, 0);
      pan(root, 'onEnd', 130, 0);
      await waitForUpdate();
      expect(isZoomed(host, 'x')).toBe(false);
    });

    it('treats only a short touch as a tap', async () => {
      const { container, host, root } = await renderChart(zoomable());
      const at = pointAt(host, 1);
      touchAt('touchstart', root, at);
      touchAt('touchmove', root, { x: at.x + 40, y: at.y });
      await waitForUpdate();
      // A zoomable chart's drag pans: no scrubbing, no selection.
      expect(tooltipBox(container)).toBeNull();
      touchAt('touchend', root, { x: at.x + 40, y: at.y });
      expect(host.selected).toEqual([]);

      await tap(root, at);
      expect(host.selected).toHaveLength(1);
    });
  });

  describe('custom tooltip', () => {
    @Component({
      imports: [UiChart, UiChartTooltip, LYNX_ELEMENTS],
      template: `
        <ui-chart [definition]="definition" [width]="300">
          <ng-template uiChartTooltip let-tooltip>
            <text>{{ tooltip.primaryPoint.xValue }}</text>
            <text>{{ tooltip.points.length }} point</text>
            @if (tooltip.pinned) {
              <view class="close" (bindtap)="tooltip.dismiss()">
                <text>Close</text>
              </view>
            }
          </ng-template>
        </ui-chart>
      `,
    })
    class CustomTooltipHost {
      readonly definition = barChart();
      readonly chart = viewChild.required(UiChart);
    }

    it('renders the template in place of the default rows', async () => {
      const { container, componentRef, getByText } =
        await render(CustomTooltipHost);
      const host = componentRef.instance as CustomTooltipHost;
      const root = chartRoot(container);
      const point = host.chart().scene()!.points[1]!;
      touchAt('touchstart', root, { x: point.x + 1, y: point.y + 1 });
      await waitForUpdate();
      const box = tooltipBox(container)!;
      expect(within(box).getByText('Feb')).toBeTruthy();
      expect(within(box).getByText('1 point')).toBeTruthy();
      expect(within(box).queryByText('60')).toBeNull();
      expect(within(box).queryByText('Close')).toBeNull();

      // Pinned, it can hold a button that dismisses it.
      touchAt('touchend', root, { x: point.x + 1, y: point.y + 1 });
      await waitForUpdate();
      fireEvent.tap(getByText('Close').parentElement!);
      await waitForUpdate();
      expect(tooltipBox(container)).toBeNull();
    });

    it("types the template's context for the template type checker", () => {
      // Angular's type checker reads this guard to type `let-tooltip`, as in
      // the template above; at runtime it only has to say yes.
      expect(UiChartTooltip.ngTemplateContextGuard(null as never, {})).toBe(
        true,
      );
    });
  });
});
