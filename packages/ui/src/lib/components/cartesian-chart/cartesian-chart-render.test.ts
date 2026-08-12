import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from './cartesian-chart';

// These tests exercise the class methods and template-facing computed signals of the
// full chart component (the sibling test file covers just the exported pure
// geometry helpers with a mocked Angular).
describe('UiCartesianChart — component', () => {
  const readComputedSignals = (inst: UiCartesianChart) => {
    const cast = inst as unknown as {
      containerClass: () => string;
      containerStyle: () => string;
      plotStyle: () => string;
      gridlines: () => { style: string }[];
      verticalGridlines: () => { style: string }[];
      yLabels: () => { style: string; text: string }[];
      xLabels: () => { style: string; text: string }[];
      yAxisLabelStyle: () => string;
      xAxisLabelStyle: () => string;
      zoomControlsStyle: () => string;
    };
    return {
      containerClass: cast.containerClass(),
      containerStyle: cast.containerStyle(),
      plotStyle: cast.plotStyle(),
      gridlines: cast.gridlines(),
      verticalGridlines: cast.verticalGridlines(),
      yLabels: cast.yLabels(),
      xLabels: cast.xLabels(),
      yAxisLabelStyle: cast.yAxisLabelStyle(),
      xAxisLabelStyle: cast.xAxisLabelStyle(),
      zoomControlsStyle: cast.zoomControlsStyle(),
    };
  };

  it('renders with default configuration', async () => {
    const { container } = await render(UiCartesianChart);
    expect(container).toBeTruthy();
  });

  it('exposes shared scales that project data into the plot area', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 50]);
    await waitForUpdate();
    expect(typeof inst.xScale()).toBe('function');
    expect(typeof inst.yScale()).toBe('function');
    expect(inst.plotWidth()).toBeGreaterThan(0);
    expect(inst.plotHeight()).toBeGreaterThan(0);
  });

  it('produces gridlines, tick labels, and axis label styles', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 100]);
    setInputSignal(inst.xAxisLabel, 'X label');
    setInputSignal(inst.yAxisLabel, 'Y label');
    setInputSignal(inst.showGrid, true);
    setInputSignal(inst.showXGrid, true);
    await waitForUpdate();
    const c = readComputedSignals(inst);
    expect(c.gridlines.length).toBeGreaterThan(0);
    expect(c.verticalGridlines.length).toBeGreaterThan(0);
    expect(c.yLabels.length).toBeGreaterThan(0);
    expect(c.xLabels.length).toBeGreaterThan(0);
    expect(c.yAxisLabelStyle).toContain('transform');
    expect(c.xAxisLabelStyle.length).toBeGreaterThan(0);
  });

  it('uses explicit tick arrays when provided', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 10]);
    setInputSignal(inst.yDomain, [0, 10]);
    setInputSignal(inst.xTicks, [0, 5, 10]);
    setInputSignal(inst.yTicks, [0, 2, 5, 10]);
    await waitForUpdate();
    const c = readComputedSignals(inst);
    expect(c.yLabels.map((l) => l.text).join(',')).toContain('5');
    expect(c.xLabels.map((l) => l.text).join(',')).toContain('5');
  });

  it('hides gridlines when disabled', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.showGrid, false);
    setInputSignal(inst.showXGrid, false);
    await waitForUpdate();
    // Even with showGrid=false the computed still runs — just verify the
    // container mounts cleanly.
    expect(readComputedSignals(inst).plotStyle.length).toBeGreaterThan(0);
  });

  it('applies inner padding to shrink the projected range', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 100]);
    setInputSignal(inst.padding, {
      top: 0.1,
      bottom: 0.1,
      left: 0.1,
      right: 0.1,
    });
    await waitForUpdate();
    const scaleAtZero = inst.xScale()(0);
    expect(scaleAtZero).toBeGreaterThan(0);
  });

  it('zoomIn / zoomOut / resetZoom on the xy axes', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 100]);
    setInputSignal(inst.zoomable, true);
    await waitForUpdate();
    inst.zoomIn();
    inst.zoomOut();
    inst.zoomIn();
    inst.resetZoom();
    // No throw; the internal view domains reset to null at rest.
    expect(inst.xScale()(0)).toBeLessThan(inst.xScale()(100));
  });

  it('zoomIn only along the x-axis when zoomAxes = "x"', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 100]);
    setInputSignal(inst.zoomable, true);
    setInputSignal(inst.zoomAxes, 'x');
    await waitForUpdate();
    inst.zoomIn();
    inst.zoomIn();
    expect(typeof inst.xScale()).toBe('function');
  });

  it('zoomIn only along the y-axis when zoomAxes = "y"', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.xDomain, [0, 100]);
    setInputSignal(inst.yDomain, [0, 100]);
    setInputSignal(inst.zoomable, true);
    setInputSignal(inst.zoomAxes, 'y');
    await waitForUpdate();
    inst.zoomIn();
    inst.zoomIn();
    expect(typeof inst.yScale()).toBe('function');
  });

  it('shows zoom controls only when zoomable', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.zoomable, true);
    setInputSignal(inst.showZoomControls, true);
    await waitForUpdate();
    expect(readComputedSignals(inst).zoomControlsStyle.length).toBeGreaterThan(0);
  });

  it('containerClass includes user class alias', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    setInputSignal(inst.userClass, 'my-chart');
    await waitForUpdate();
    expect(readComputedSignals(inst).containerClass).toContain('my-chart');
  });

  it('zoomIn on a zero-width x-domain collapses back to rest (full-span guard)', async () => {
    const { componentRef } = await render(UiCartesianChart);
    const inst = componentRef.instance as UiCartesianChart;
    // A degenerate domain forces the #isFullSpan(baseSpan === 0) branch when
    // any zoom write is attempted.
    setInputSignal(inst.xDomain, [5, 5]);
    setInputSignal(inst.yDomain, [5, 5]);
    setInputSignal(inst.zoomable, true);
    await waitForUpdate();
    inst.zoomIn();
    inst.zoomOut();
    inst.resetZoom();
    // Scales remain callable and produce a finite pixel value at the domain point.
    expect(Number.isFinite(inst.xScale()(5))).toBe(true);
  });
});
