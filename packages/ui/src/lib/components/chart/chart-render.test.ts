import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { LynxTheme } from '@blotch/angular-lynx';
import {
  UiChart,
  UiChartTooltip,
  type UiChartTooltipContext,
  tooltip,
} from './chart';
import {
  CHART_DARK_COLORS,
  CHART_LIGHT_COLORS,
  provideChartTheme,
} from './chart-theme';

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

/** The component's protected members, as tests drive them. */
type ChartInternals = {
  scene: () => {
    width: number;
    height: number;
    points: ChartPoint[];
    scales: Record<
      string,
      { domain: unknown[]; viewport?: { domain: unknown[] } }
    >;
  } | null;
  underSvg: () => string;
  marksSvg: () => string;
  overSvg: () => string;
  labelSlots: () => { text: string; style: string }[];
  tooltipView: () => {
    style: string;
    title: string | null;
    titleColor?: string;
    rows: readonly { label: string; value: string }[];
    context: UiChartTooltipContext;
  } | null;
  accessibilityValue: () => string;
  rootStyle: () => string;
  layerStyle: () => string;
  panGesture: { _callbacks: Record<string, (event?: unknown) => void> };
  onLayout(event: unknown): void;
  onTooltipLayout(event: unknown): void;
  onTouchStart(event: unknown): void;
  onTouchMove(event: unknown): void;
  onTouchEnd(event: unknown): void;
  onTouchCancel(): void;
  onAccessibilityAction(event: unknown): void;
};

const touch = (x: number, y: number) => ({ touches: [{ x, y }] });

const renderChart = async (
  definition: ChartDefinition<any, any, any> = barChart(),
  inputs: Partial<
    Record<
      'width' | 'height' | 'zoomable' | 'zoomAxes' | 'colorScheme',
      unknown
    >
  > = {},
) => {
  const result = await render(UiChart);
  const chart = result.componentRef.instance as UiChart;
  setInputSignal(chart.definition, definition);
  setInputSignal(chart.width, inputs.width ?? 300);
  setInputSignal(chart.height, inputs.height ?? 200);
  for (const [name, value] of Object.entries(inputs)) {
    if (name !== 'width' && name !== 'height') {
      setInputSignal(
        (chart as unknown as Record<string, unknown>)[name],
        value,
      );
    }
  }
  await waitForUpdate();
  return { ...result, chart, internals: chart as unknown as ChartInternals };
};

/**
 * A point's touch position, nudged so it's clearly a touch near it.
 */
const pointAt = (internals: ChartInternals, index: number) => {
  const point = internals.scene()!.points[index]!;
  return { x: point.x + 1, y: point.y + 1 };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('UiChart', () => {
  describe('rendering', () => {
    it('draws nothing until it has a size', async () => {
      const result = await render(UiChart);
      const chart = result.componentRef.instance as unknown as ChartInternals;
      expect(chart.scene()).toBeNull();
      expect(result.container.querySelectorAll('svg').length).toBe(0);
      // Everything derived from the scene is empty, and input does nothing.
      expect(chart.marksSvg()).toBe(chart.underSvg());
      expect(chart.labelSlots()).toEqual([]);
      expect(chart.layerStyle()).toContain('width: 0px; height: 0px;');
      chart.onTouchStart(touch(1, 1));
      chart.onTouchEnd(touch(1, 1));
      expect(chart.tooltipView()).toBeNull();
    });

    describe('color scheme', () => {
      const darkDevice = {
        provide: LynxTheme,
        useValue: { isDarkMode: () => true },
      };
      const primaryFill = async (providers: unknown[], scheme?: string) => {
        const result = await render(UiChart, { providers: providers as never });
        const chart = result.componentRef.instance as UiChart;
        setInputSignal(chart.definition, barChart());
        setInputSignal(chart.width, 300);
        if (scheme) setInputSignal(chart.colorScheme, scheme);
        return /fill="(rgba\([^)]*\))"/.exec(
          (chart as unknown as ChartInternals).marksSvg(),
        )?.[1];
      };

      it('stays light on a dark device unless the app opts in', async () => {
        expect(await primaryFill([darkDevice])).toBe(
          CHART_LIGHT_COLORS['primary'],
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
    });

    it('gives labels the foreground token when the theme sets no foreground', async () => {
      const result = await render(UiChart, {
        providers: [provideChartTheme({ chart: { foreground: undefined } })],
      });
      const chart = result.componentRef.instance as UiChart;
      setInputSignal(chart.definition, barChart());
      setInputSignal(chart.width, 300);
      expect(
        (chart as unknown as ChartInternals).labelSlots().length,
      ).toBeGreaterThan(0);
    });

    it('exposes a tooltip token that creates nothing itself', () => {
      expect(tooltip.create()).toBeUndefined();
    });

    it('draws marks, empty focus layers and native labels', async () => {
      const { container, internals } = await renderChart();
      expect(container.querySelectorAll('svg').length).toBe(3);
      expect(internals.marksSvg()).toContain('<rect');
      expect(internals.marksSvg()).toContain(
        `fill="${CHART_LIGHT_COLORS['primary']}"`,
      );
      expect(internals.underSvg()).toBe(internals.overSvg());
      expect(internals.underSvg()).toContain('width="1"');
      const texts = internals.labelSlots().map((label) => label.text);
      expect(texts).toEqual(
        expect.arrayContaining(['Jan', 'Feb', 'Mar', 'Revenue']),
      );
      expect(internals.rootStyle()).toBe('width: 300px; height: 200px;');
      expect(internals.layerStyle()).toContain('width: 300px; height: 200px;');
    });

    it('follows the color scheme', async () => {
      const { internals } = await renderChart(barChart(), {
        colorScheme: 'dark',
      });
      expect(internals.marksSvg()).toContain(
        `fill="${CHART_DARK_COLORS['primary']}"`,
      );
    });

    it('measures its layout when no size is given', async () => {
      const result = await render(UiChart);
      const chart = result.componentRef.instance as UiChart;
      const internals = chart as unknown as ChartInternals;
      setInputSignal(chart.definition, barChart());
      expect(internals.rootStyle()).toBe('');
      internals.onLayout({ detail: { width: 250, height: 120 } });
      expect(internals.scene()).toMatchObject({ width: 250, height: 120 });
      // Older Android reports the size in `params`.
      internals.onLayout({ params: { width: 260, height: 130 } });
      expect(internals.scene()).toMatchObject({ width: 260, height: 130 });
      // The same size again and malformed events change nothing.
      const scene = internals.scene();
      internals.onLayout({ detail: { width: 260, height: 130 } });
      internals.onLayout({ detail: {} });
      internals.onLayout({});
      expect(internals.scene()).toBe(scene);
    });

    it('uses the default height when the layout has none', async () => {
      const result = await render(UiChart);
      const chart = result.componentRef.instance as UiChart;
      const internals = chart as unknown as ChartInternals;
      setInputSignal(chart.definition, barChart());
      setInputSignal(chart.width, 100);
      expect(internals.scene()).toMatchObject({ width: 100, height: 200 });
      setInputSignal(chart.width, 0);
      expect(internals.scene()).toBeNull();
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
      const getTextInfo = vi.fn(() => ({ width: 12 }));
      mainLynx['getTextInfo'] = getTextInfo;
      try {
        const { internals } = await renderChart();
        expect(internals.scene()).not.toBeNull();
        expect(getTextInfo).toHaveBeenCalled();
      } finally {
        mainLynx['getTextInfo'] = original;
      }
    });
  });

  describe('touch', () => {
    it('focuses the touched point and shows the tooltip', async () => {
      const { chart, internals } = await renderChart();
      const focused = vi.fn();
      chart.focusChange.subscribe(focused);
      const at = pointAt(internals, 1);
      internals.onTouchStart(touch(at.x, at.y));
      expect(focused).toHaveBeenCalledWith(
        expect.objectContaining({ xValue: 'Feb' }),
      );
      expect(internals.overSvg()).not.toContain('width="1"');
      const view = internals.tooltipView()!;
      expect(view.rows.map((row) => row.value)).toContain('60');
      expect(view.style).toContain('opacity: 0;');
      expect(internals.accessibilityValue()).toContain('Feb');

      // Once laid out, the tooltip is placed for real and shown.
      internals.onTooltipLayout({ detail: { width: 80, height: 40 } });
      expect(internals.tooltipView()!.style).not.toContain('opacity');
      internals.onTooltipLayout({ detail: { width: 80, height: 40 } });
      internals.onTooltipLayout({});
    });

    it('scrubs as the touch moves, without repeating focus events', async () => {
      const { chart, internals } = await renderChart();
      const focused = vi.fn();
      chart.focusChange.subscribe(focused);
      const first = pointAt(internals, 0);
      const second = pointAt(internals, 2);
      internals.onTouchStart(touch(first.x, first.y));
      internals.onTouchMove(touch(first.x, first.y));
      internals.onTouchMove(touch(second.x, second.y));
      expect(focused.mock.calls.map(([p]) => p?.xValue)).toEqual([
        'Jan',
        'Mar',
      ]);
    });

    it('ends a scrub without selecting, clearing its focus', async () => {
      const { chart, internals } = await renderChart();
      const selected = vi.fn();
      chart.pointSelect.subscribe(selected);
      const first = pointAt(internals, 0);
      const last = pointAt(internals, 2);
      internals.onTouchStart(touch(first.x, first.y));
      internals.onTouchMove(touch(last.x, last.y));
      internals.onTouchEnd({ changedTouches: [last] });
      expect(selected).not.toHaveBeenCalled();
      expect(internals.tooltipView()).toBeNull();
    });

    it('keeps a pinned tooltip through a drag', async () => {
      const { internals } = await renderChart();
      const at = pointAt(internals, 1);
      internals.onTouchStart(touch(at.x, at.y));
      internals.onTouchEnd(touch(at.x, at.y));
      // A scroll that starts on the chart moves the finger well past a tap.
      internals.onTouchStart(touch(at.x, at.y));
      internals.onTouchEnd(touch(at.x, at.y - 100));
      expect(internals.tooltipView()!.context.pinned).toBe(true);
    });

    it('ignores touches without coordinates', async () => {
      const { internals } = await renderChart();
      internals.onTouchStart({});
      internals.onTouchMove({ touches: [{}] });
      internals.onTouchEnd({});
      expect(internals.tooltipView()).toBeNull();
    });

    it('pins the tooltip on tap, and unpins on the next tap', async () => {
      const { chart, internals } = await renderChart();
      const selected = vi.fn();
      chart.pointSelect.subscribe(selected);
      const at = pointAt(internals, 2);
      internals.onTouchStart(touch(at.x, at.y));
      internals.onTouchEnd({ changedTouches: [at] });
      expect(selected).toHaveBeenLastCalledWith(
        expect.objectContaining({ xValue: 'Mar' }),
      );
      expect(internals.tooltipView()!.context.pinned).toBe(true);

      // While pinned, touches don't move focus.
      const other = pointAt(internals, 0);
      internals.onTouchStart(touch(other.x, other.y));
      internals.onTouchMove(touch(other.x, other.y));
      internals.onTouchCancel();
      expect(
        internals.tooltipView()!.primaryPoint ??
          internals.tooltipView()!.context.primaryPoint,
      ).toMatchObject({ xValue: 'Mar' });

      internals.onTouchEnd(touch(other.x, other.y));
      expect(internals.tooltipView()).toBeNull();
    });

    it('selects nothing for a tap on empty space', async () => {
      const { chart, internals } = await renderChart(
        barChart({ maxFocusDistance: 1 }),
      );
      const selected = vi.fn();
      chart.pointSelect.subscribe(selected);
      internals.onTouchStart(touch(-50, -50));
      internals.onTouchEnd({});
      expect(selected).toHaveBeenCalledWith(null);
      expect(internals.tooltipView()).toBeNull();
    });

    it("tells the definition's selection about taps", async () => {
      const change = vi.fn();
      const { internals } = await renderChart(
        barChart({ selection: { change } }),
      );
      const at = pointAt(internals, 0);
      internals.onTouchEnd(touch(at.x, at.y));
      expect(change).toHaveBeenCalledWith(
        expect.objectContaining({ xValue: 'Jan' }),
        'pointer',
      );
    });

    it('keeps focus after a tap without a sticky tooltip', async () => {
      const { internals } = await renderChart(
        barChart({ tooltip: { use: tooltip, sticky: false } }),
      );
      const at = pointAt(internals, 0);
      internals.onTouchEnd(touch(at.x, at.y));
      expect(internals.tooltipView()!.context.pinned).toBe(false);
      internals.onTouchCancel();
      expect(internals.tooltipView()).toBeNull();
    });

    it('focuses without a tooltip when the definition has none', async () => {
      const { internals } = await renderChart(barChart({ tooltip: false }));
      const at = pointAt(internals, 0);
      internals.onTouchStart(touch(at.x, at.y));
      expect(internals.tooltipView()).toBeNull();
      expect(internals.overSvg()).not.toContain('width="1"');
      internals.onTouchEnd(touch(at.x, at.y));
      expect(internals.accessibilityValue()).toContain('Jan');
    });

    it('shows a pinned-only tooltip once pinned', async () => {
      const { internals } = await renderChart(
        barChart({ tooltip: { use: tooltip, visibility: 'pinned' } }),
      );
      const at = pointAt(internals, 0);
      internals.onTouchStart(touch(at.x, at.y));
      expect(internals.tooltipView()).toBeNull();
      internals.onTouchEnd(touch(at.x, at.y));
      expect(internals.tooltipView()).not.toBeNull();
    });

    it('shows a string tooltip as its title', async () => {
      const { internals } = await renderChart(
        barChart({ tooltip: { use: tooltip, format: () => 'Custom' } }),
      );
      const at = pointAt(internals, 0);
      internals.onTouchStart(touch(at.x, at.y));
      expect(internals.tooltipView()).toMatchObject({
        title: 'Custom',
        rows: [],
      });
    });

    it('dismisses from the tooltip context', async () => {
      const { internals } = await renderChart();
      const at = pointAt(internals, 0);
      internals.onTouchEnd(touch(at.x, at.y));
      internals.tooltipView()!.context.dismiss();
      expect(internals.tooltipView()).toBeNull();
    });
  });

  describe('focus across scene changes', () => {
    it('keeps focus on the same datum, and drops it when the datum is gone', async () => {
      const { chart, internals } = await renderChart();
      const at = pointAt(internals, 1);
      internals.onTouchEnd(touch(at.x, at.y));
      setInputSignal(chart.width, 320);
      await waitForUpdate();
      expect(internals.tooltipView()!.context.primaryPoint).toMatchObject({
        xValue: 'Feb',
      });

      setInputSignal(
        chart.definition,
        defineChart({
          marks: [
            barY([{ month: 'Apr', value: 1 }], { x: 'month', y: 'value' }),
          ],
          scales: {
            x: { scale: () => scaleBand() },
            y: { scale: scaleLinear },
          },
          tooltip,
        }),
      );
      await waitForUpdate();
      expect(internals.tooltipView()).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('steps through points with the screen reader actions', async () => {
      const { chart, internals } = await renderChart();
      const focused = vi.fn();
      chart.focusChange.subscribe(focused);
      const step = (name: string) =>
        internals.onAccessibilityAction({ detail: { name } });
      step('Next point');
      step('Next point');
      step('Previous point');
      expect(focused.mock.calls.map(([p]) => p?.xValue)).toEqual([
        'Jan',
        'Feb',
        'Jan',
      ]);
      step('Activate');
      internals.onAccessibilityAction({});
      expect(focused).toHaveBeenCalledTimes(3);
    });

    it('clears focus when there are no points to step to', async () => {
      const { internals } = await renderChart(barChart({ focus: false }));
      internals.onAccessibilityAction({ detail: { name: 'Next point' } });
      expect(internals.accessibilityValue()).toBe('');
    });

    it('describes values that are dates', async () => {
      const dated = defineChart({
        marks: [
          dot([{ t: new Date(Date.UTC(2026, 0, 2)), v: 3 }], {
            x: 't',
            y: 'v',
          }),
        ],
        scales: { x: { scale: () => scaleBand() }, y: { scale: scaleLinear } },
      }) as ChartDefinition<any, any, any>;
      const { internals } = await renderChart(dated);
      internals.onAccessibilityAction({ detail: { name: 'Next point' } });
      expect(internals.accessibilityValue()).toContain('2026-01-02');
    });
  });

  describe('zoom', () => {
    const xDomain = (internals: ChartInternals) =>
      internals.scene()!.scales['x']!.viewport?.domain ??
      internals.scene()!.scales['x']!.domain;

    it('zooms in and out with the controls, and resets', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
      });
      chart.zoomIn();
      const [lo, hi] = xDomain(internals) as number[];
      expect(hi! - lo!).toBeCloseTo(10 / 1.4);
      chart.zoomOut();
      expect(xDomain(internals)).toEqual([0, 10]);
      chart.zoomIn();
      chart.resetZoom();
      expect(internals.scene()!.scales['x']!.viewport).toBeUndefined();
    });

    it('only zooms the chosen axes, and only continuous ones', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
        zoomAxes: 'y',
      });
      chart.zoomIn();
      expect(internals.scene()!.scales['x']!.viewport).toBeUndefined();
      expect(internals.scene()!.scales['y']!.viewport).toBeDefined();

      // A band axis can't zoom.
      const bars = await renderChart(barChart(), {
        zoomable: true,
        zoomAxes: 'x',
      });
      bars.chart.zoomIn();
      expect(bars.internals.scene()!.scales['x']!.viewport).toBeUndefined();
    });

    it('does nothing before the chart has a scene', async () => {
      const result = await render(UiChart);
      const chart = result.componentRef.instance as UiChart;
      chart.zoomIn();
      const internals = chart as unknown as ChartInternals;
      internals.panGesture._callbacks['onBegin']!();
      internals.panGesture._callbacks['onUpdate']!({
        translationX: 10,
        translationY: 0,
      });
      expect(internals.scene()).toBeNull();
    });

    it('pans by dragging, from the window at touch-down', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
      });
      vi.useFakeTimers();
      chart.zoomIn();
      chart.zoomIn();
      const start = xDomain(internals) as number[];
      const callbacks = internals.panGesture._callbacks;
      callbacks['onBegin']!();
      callbacks['onStart']!();
      const plotWidth = internals.scene()!.width;
      callbacks['onUpdate']!({ translationX: 10, translationY: 5 });
      callbacks['onUpdate']!({ translationX: 20, translationY: 10 });
      const panned = xDomain(internals) as number[];
      // Dragging right moves the window to lower values, by the same amount
      // each frame relative to touch-down, not compounding.
      expect(panned[0]!).toBeLessThan(start[0]!);
      expect(panned[1]! - panned[0]!).toBeCloseTo(start[1]! - start[0]!);
      expect(plotWidth).toBeGreaterThan(0);

      // While panning, the label pool keeps its size and the tooltip hides.
      const slots = internals.labelSlots().length;
      callbacks['onUpdate']!({ translationX: 200, translationY: 0 });
      expect(internals.labelSlots().length).toBe(slots);
      callbacks['onEnd']!();
      vi.runAllTimers();
      expect(
        internals
          .labelSlots()
          .every((slot) => !slot.style.includes('display: none')),
      ).toBe(true);
    });

    it('anchors a pan that starts without onBegin', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
      });
      vi.useFakeTimers();
      chart.zoomIn();
      const callbacks = internals.panGesture._callbacks;
      callbacks['onStart']!();
      callbacks['onEnd']!();
      callbacks['onUpdate']!({ translationX: 0, translationY: 0 });
      callbacks['onEnd']!();
      vi.runAllTimers();
      expect(xDomain(internals)).toBeDefined();
    });

    it('hides gesture-only spare labels while a pan holds the pool', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
      });
      vi.useFakeTimers();
      const callbacks = internals.panGesture._callbacks;
      callbacks['onBegin']!();
      // Swap in a chart with fewer labels mid-gesture: the spare slots hide.
      setInputSignal(
        chart.definition,
        lineChart({
          scales: {
            x: { scale: () => scaleLinear().domain([0, 10]), axis: false },
            y: { scale: () => scaleLinear().domain([0, 4]), axis: false },
          },
        }),
      );
      expect(
        internals
          .labelSlots()
          .some((slot) => slot.style.includes('display: none')),
      ).toBe(true);
      callbacks['onEnd']!();
      vi.runAllTimers();
    });

    it("doesn't pan an axis that can't zoom", async () => {
      const bars = await renderChart(barChart(), {
        zoomable: true,
        zoomAxes: 'x',
      });
      vi.useFakeTimers();
      const callbacks = bars.internals.panGesture._callbacks;
      callbacks['onBegin']!();
      callbacks['onUpdate']!({ translationX: 30, translationY: 0 });
      callbacks['onEnd']!();
      vi.runAllTimers();
      expect(bars.internals.scene()!.scales['x']!.viewport).toBeUndefined();
    });

    it('treats only a short touch as a tap', async () => {
      const { chart, internals } = await renderChart(lineChart(), {
        zoomable: true,
      });
      const selected = vi.fn();
      chart.pointSelect.subscribe(selected);
      const at = pointAt(internals, 1);
      internals.onTouchStart(touch(at.x, at.y));
      internals.onTouchMove(touch(at.x + 40, at.y));
      // A zoomable chart's drag pans: no scrubbing, no selection.
      expect(internals.tooltipView()).toBeNull();
      internals.onTouchEnd(touch(at.x + 40, at.y));
      expect(selected).not.toHaveBeenCalled();
      internals.onTouchStart(touch(at.x, at.y));
      internals.onTouchEnd(touch(at.x + 2, at.y));
      expect(selected).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom tooltip', () => {
    @Component({
      imports: [UiChart, UiChartTooltip],
      template: `
        <ui-chart>
          <ng-template uiChartTooltip let-tooltip>
            <text>{{ tooltip.points.length }} custom</text>
          </ng-template>
        </ui-chart>
      `,
    })
    class Host {}

    // Signal queries (contentChild) are only wired by ahead-of-time
    // compilation, so under plain Vitest the chart never sees the template;
    // the examples exercise it in a real build. Here: the directive mounts and
    // types its context.
    it('mounts the template directive', async () => {
      const { container } = await render(Host);
      expect(container.querySelector('view')).not.toBeNull();
      expect(UiChartTooltip.ngTemplateContextGuard(null as never, {})).toBe(
        true,
      );
    });
  });
});
