import { describe, expect, it, vi } from 'vitest';
import type { ChartGradient, SceneNode } from '@tanstack/charts/types';
import {
  type ChartLabel,
  chartLabelStyle,
  collectChartLabels,
  createLynxTextMeasurer,
  renderChartSvg,
} from './chart-scene';

const options = {
  width: 100,
  height: 50,
  resolvePaint: (paint: string) =>
    paint === 'var(--primary)' ? '#111' : paint,
  idPrefix: 'c1',
};

/**
 * The SVG body without the root element, for compact assertions.
 */
const body = (
  nodes: SceneNode[],
  extra: Partial<typeof options> & { gradients?: ChartGradient[] } = {},
) =>
  renderChartSvg(nodes, { ...options, ...extra })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');

describe('renderChartSvg', () => {
  it('returns nothing when no shape would be drawn', () => {
    expect(renderChartSvg([], options)).toBe('');
    expect(
      renderChartSvg(
        [
          { kind: 'label', key: 'l', x: 0, y: 0, text: 'a' },
          { kind: 'group', key: 'g', children: [] },
        ],
        options,
      ),
    ).toBe('');
  });

  it('writes a standalone SVG the size of the chart', () => {
    expect(
      renderChartSvg(
        [{ kind: 'dot', key: 'd', x: 1, y: 2, radius: 3 }],
        options,
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><circle cx="1" cy="2" r="3"/></svg>',
    );
  });

  it('draws rules as paths, which ServalSVG strokes when inherited', () => {
    expect(
      body([
        {
          kind: 'rule',
          key: 'r',
          x1: 0,
          y1: 1.006,
          x2: 10,
          y2: 1,
          style: { stroke: 'var(--primary)', strokeDasharray: 'none' },
        },
      ]),
    ).toBe('<path d="M0 1.01L10 1" stroke="#111"/>');
  });

  it('pushes inherited paint down onto every shape', () => {
    expect(
      body([
        {
          kind: 'group',
          key: 'g',
          style: {
            fill: 'red',
            stroke: 'blue',
            strokeWidth: 2,
            opacity: 0.5,
            lineCap: 'round',
            lineJoin: 'arcs',
          },
          children: [
            {
              kind: 'rect',
              key: 'r',
              x: 0,
              y: 0,
              width: 4,
              height: 5,
              style: {
                fill: 'green',
                fillOpacity: 0.3,
                lineJoin: 'miter-clip',
              },
            },
            {
              kind: 'polyline',
              key: 'p',
              points: [
                [0, 0],
                [1, 1],
              ],
              style: { strokeDasharray: '4 2', strokeOpacity: 0.4 },
            },
          ],
        },
      ]),
    ).toBe(
      '<g opacity="0.5">' +
        '<rect x="0" y="0" width="4" height="5" fill="green" fill-opacity="0.3" stroke="blue" stroke-width="2" stroke-linecap="round" stroke-linejoin="miter"/>' +
        '<path d="M0 0L1 1" fill="red" stroke="blue" stroke-opacity="0.4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2"/>' +
        '</g>',
    );
  });

  it('translates and clips groups, with clip paths in the root defs', () => {
    const svg = renderChartSvg(
      [
        {
          kind: 'group',
          key: 'g',
          translateX: 5,
          translateY: 0,
          clip: { x: 0, y: 0, width: 10, height: 20 },
          children: [{ kind: 'dot', key: 'd', x: 0, y: 0, radius: 1 }],
        },
        {
          kind: 'group',
          key: 'h',
          translateX: 0,
          children: [{ kind: 'dot', key: 'e', x: 0, y: 0, radius: 1 }],
        },
      ],
      options,
    );
    expect(svg).toContain(
      '<defs><clipPath id="c1-clip-0"><rect x="0" y="0" width="10" height="20"/></clipPath></defs>',
    );
    expect(svg).toContain(
      '<g transform="translate(5 0)" clip-path="url(#c1-clip-0)"><circle',
    );
    // A zero translation writes no transform.
    expect(svg).toContain('<g><circle cx="0" cy="0" r="1"/></g>');
    expect(
      body([
        {
          kind: 'group',
          key: 'y',
          translateY: 3,
          children: [{ kind: 'dot', key: 'd', x: 0, y: 0, radius: 1 }],
        },
      ]),
    ).toBe('<g transform="translate(0 3)"><circle cx="0" cy="0" r="1"/></g>');
    expect(
      body([
        {
          kind: 'group',
          key: 'x',
          translateX: 2,
          children: [{ kind: 'dot', key: 'd', x: 0, y: 0, radius: 1 }],
        },
      ]),
    ).toBe('<g transform="translate(2 0)"><circle cx="0" cy="0" r="1"/></g>');
  });

  it('leaves out focus subtrees and labels', () => {
    expect(
      body([
        {
          kind: 'group',
          key: 'f',
          focus: { match: 'x', points: [], placement: 'over' },
          children: [{ kind: 'dot', key: 'd', x: 0, y: 0, radius: 1 }],
        } as unknown as SceneNode,
        { kind: 'label', key: 'l', x: 0, y: 0, text: 'a' },
        { kind: 'dot', key: 'e', x: 0, y: 0, radius: 2 },
      ]),
    ).toBe('<circle cx="0" cy="0" r="2"/>');
  });

  it('draws polylines and areas from their path or points', () => {
    expect(
      body([
        { kind: 'polyline', key: 'a', points: [], path: 'M0,0C1,1 2,2 3,3' },
        {
          kind: 'area',
          key: 'b',
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        },
        { kind: 'area', key: 'c', points: [], path: 'M0 0Z' },
        { kind: 'area', key: 'e', points: [] },
      ]),
    ).toBe(
      '<path d="M0,0C1,1 2,2 3,3"/>' +
        '<path d="M0 0L1 0L1 1Z"/>' +
        '<path d="M0 0Z"/>' +
        '<path d=""/>',
    );
  });

  it('joins area polygons and their holes with the even-odd rule', () => {
    expect(
      body([
        {
          kind: 'area',
          key: 'a',
          points: [],
          polygons: [
            [
              [
                [0, 0],
                [4, 0],
                [4, 4],
              ],
              [],
            ],
          ],
        },
      ]),
    ).toBe('<path d="M0 0L4 0L4 4Z" fill-rule="evenodd"/>');
  });

  it('draws rects with a radius or per-corner radii', () => {
    const svg = body([
      { kind: 'rect', key: 'a', x: 0, y: 0, width: 4, height: 4, radius: 2 },
      { kind: 'rect', key: 'b', x: 0, y: 0, width: 4, height: 4, radius: 0 },
      {
        kind: 'rect',
        key: 'c',
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        cornerRadii: [2, 2, 0, 0],
      },
    ]);
    expect(svg).toContain('<rect x="0" y="0" width="4" height="4" rx="2"/>');
    expect(svg).toContain('<rect x="0" y="0" width="4" height="4"/>');
    expect(svg).toMatch(/<path d="M[^"]+"\/>$/);
  });

  it('writes gradients and points fills at them', () => {
    const gradients: ChartGradient[] = [
      {
        id: 'fade',
        stops: [
          { offset: 0.5, color: 'var(--primary)', opacity: 0.4 },
          { offset: 0.2, color: 'red' },
          { offset: Number.NaN, color: 'blue' },
        ],
      },
      { id: 'glow', type: 'radial', stops: [{ offset: 2, color: 'red' }] },
    ];
    const svg = renderChartSvg(
      [
        {
          kind: 'rect',
          key: 'r',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          style: { fill: 'url(#fade)', stroke: 'url(#other)' },
        },
      ],
      { ...options, gradients },
    );
    expect(svg).toContain(
      '<linearGradient id="c1-gradient-fade" x1="0%" y1="100%" x2="0%" y2="0%">' +
        '<stop offset="50%" stop-color="#111" stop-opacity="0.4"/>' +
        // Offsets never go backwards, and NaN counts as 0.
        '<stop offset="50%" stop-color="red"/>' +
        '<stop offset="50%" stop-color="blue"/></linearGradient>',
    );
    expect(svg).toContain(
      '<radialGradient id="c1-gradient-glow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%"><stop offset="100%" stop-color="red"/></radialGradient>',
    );
    expect(svg).toContain('fill="url(#c1-gradient-fade)"');
    // Not one of the scene's gradients: left to the paint resolver.
    expect(svg).toContain('stroke="url(#other)"');
  });

  it('escapes attribute values and writes non-finite numbers as 0', () => {
    expect(
      body([
        {
          kind: 'dot',
          key: 'd',
          x: Number.NaN,
          y: Number.POSITIVE_INFINITY,
          radius: -0,
          style: { fill: 'a"<&>' },
        },
      ]),
    ).toBe('<circle cx="0" cy="0" r="0" fill="a&quot;&lt;&amp;&gt;"/>');
  });

  it('scopes ids with a default prefix and sanitizes them', () => {
    const svg = renderChartSvg(
      [
        {
          kind: 'group',
          key: 'g',
          clip: { x: 0, y: 0, width: 1, height: 1 },
          children: [
            {
              kind: 'dot',
              key: 'd',
              x: 0,
              y: 0,
              radius: 1,
              style: { fill: 'url(#a b)' },
            },
          ],
        },
      ],
      {
        width: 1,
        height: 1,
        resolvePaint: (p) => p,
        gradients: [{ id: 'a b', stops: [] }],
      },
    );
    expect(svg).toContain('id="chart-clip-0"');
    expect(svg).toContain('fill="url(#chart-gradient-a_b)"');
  });
});

describe('collectChartLabels', () => {
  it('resolves labels to absolute positions and final paint', () => {
    const labels = collectChartLabels(
      [
        {
          kind: 'group',
          key: 'axis',
          translateX: 10,
          translateY: 20,
          style: {
            fill: 'var(--muted-foreground)',
            fillOpacity: 0.5,
            opacity: 0.8,
          },
          children: [
            {
              kind: 'label',
              key: 'tick',
              x: 1,
              y: 2,
              text: '42',
              anchor: 'end',
              baseline: 'middle',
              rotate: -90,
              fontSize: 10,
              fontWeight: 600,
              style: { opacity: 0.5 },
            },
          ],
        },
        { kind: 'label', key: 'title', x: 0, y: 0, text: 'T' },
        { kind: 'dot', key: 'd', x: 0, y: 0, radius: 1 },
      ],
      { defaultColor: 'var(--foreground)' },
    );
    expect(labels).toEqual<ChartLabel[]>([
      {
        key: 'tick',
        text: '42',
        x: 11,
        y: 22,
        anchor: 'end',
        baseline: 'middle',
        rotate: -90,
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        opacity: 0.8 * 0.5 * 0.5,
      },
      {
        key: 'title',
        text: 'T',
        x: 0,
        y: 0,
        anchor: 'start',
        baseline: 'auto',
        rotate: 0,
        fontSize: 16,
        fontWeight: 400,
        color: 'var(--foreground)',
        opacity: 1,
      },
    ]);
  });

  it('gives currentColor labels the default color', () => {
    const [label] = collectChartLabels(
      [
        {
          kind: 'label',
          key: 'l',
          x: 0,
          y: 0,
          text: 'a',
          style: { fill: 'currentColor', fillOpacity: 0.5 },
        },
      ],
      { defaultColor: 'black' },
    );
    expect(label).toMatchObject({ color: 'black', opacity: 0.5 });
  });

  it('drops labels outside their clip, and skips focus subtrees', () => {
    const labels = collectChartLabels(
      [
        {
          kind: 'group',
          key: 'plot',
          translateX: 10,
          clip: { x: 0, y: 0, width: 20, height: 20 },
          children: [
            {
              kind: 'group',
              key: 'inner',
              children: [
                { kind: 'label', key: 'in', x: 5, y: 5, text: 'in' },
                { kind: 'label', key: 'right', x: 25, y: 5, text: 'out' },
                { kind: 'label', key: 'left', x: -5, y: 5, text: 'out' },
                { kind: 'label', key: 'above', x: 5, y: -5, text: 'out' },
                { kind: 'label', key: 'below', x: 5, y: 25, text: 'out' },
              ],
            },
          ],
        },
        {
          kind: 'group',
          key: 'focus',
          focus: { match: 'x', points: [], placement: 'over' },
          children: [{ kind: 'label', key: 'hidden', x: 0, y: 0, text: 'x' }],
        } as unknown as SceneNode,
      ],
      { defaultColor: 'black' },
    );
    expect(labels.map((l) => l.key)).toEqual(['in']);
  });

  it('applies focus-driven opacity', () => {
    const focusOpacity = vi.fn(() => 0.25);
    const [label] = collectChartLabels(
      [{ kind: 'label', key: 'l', x: 0, y: 0, text: 'a', focusOpacity }],
      { defaultColor: 'black', pointer: { x: 1, y: 2 } },
    );
    expect(label!.opacity).toBe(0.25);
    expect(focusOpacity).toHaveBeenCalledWith({
      focus: null,
      pointer: { x: 1, y: 2 },
    });

    const [unfocused] = collectChartLabels(
      [
        {
          kind: 'label',
          key: 'l',
          x: 0,
          y: 0,
          text: 'a',
          focusOpacity: () => undefined,
        },
      ],
      { defaultColor: 'black' },
    );
    expect(unfocused!.opacity).toBe(1);
  });
});

describe('chartLabelStyle', () => {
  const label: ChartLabel = {
    key: 'k',
    text: 't',
    x: 1.234,
    y: 5,
    anchor: 'start',
    baseline: 'hanging',
    rotate: 0,
    fontSize: 10,
    fontWeight: 400,
    color: 'red',
    opacity: 1,
  };

  it('positions the anchor point and sizes the line box', () => {
    expect(chartLabelStyle(label)).toBe(
      'position: absolute; left: 1.23px; top: 5px; font-size: 10px; line-height: 10px; ' +
        'font-weight: 400; color: red; opacity: 1; white-space: nowrap; ' +
        'transform-origin: 0 0; transform: translate(0%, 0%);',
    );
  });

  it('shifts for the anchor and baseline, and rotates about the anchor', () => {
    expect(
      chartLabelStyle({
        ...label,
        anchor: 'middle',
        baseline: 'middle',
        rotate: -90,
      }),
    ).toContain('transform: rotate(-90deg) translate(-50%, -50%);');
    expect(
      chartLabelStyle({ ...label, anchor: 'end', baseline: 'auto' }),
    ).toContain('transform: translate(-100%, -80%);');
  });
});

describe('createLynxTextMeasurer', () => {
  const base = {
    fontSize: 10,
    fontFamily: 'sans-serif',
    fontStyle: 'normal',
    fontStretch: 'normal',
    letterSpacing: 0,
    direction: 'ltr' as const,
    fontScale: 1,
    anchor: 'start' as const,
    baseline: 'auto' as const,
  };

  it('measures through getTextInfo, once per text and size', () => {
    const getTextInfo = vi.fn(() => ({ width: 30 }));
    const measure = createLynxTextMeasurer(getTextInfo);
    expect(measure('abc', base)).toEqual({
      x: 0,
      y: -8,
      width: 30,
      height: 10,
    });
    measure('abc', base);
    expect(getTextInfo).toHaveBeenCalledTimes(1);
    expect(getTextInfo).toHaveBeenCalledWith('abc', { fontSize: '10px' });
  });

  it('offsets the box for the anchor and baseline', () => {
    const measure = createLynxTextMeasurer(() => ({ width: 20 }));
    expect(
      measure('a', { ...base, anchor: 'middle', baseline: 'middle' }),
    ).toEqual({
      x: -10,
      y: -5,
      width: 20,
      height: 10,
    });
    expect(
      measure('a', { ...base, anchor: 'end', baseline: 'hanging' }),
    ).toEqual({
      x: -20,
      y: 0,
      width: 20,
      height: 10,
    });
  });

  it('scales the font size and widens bold text', () => {
    const getTextInfo = vi.fn(() => ({ width: 100 }));
    const measure = createLynxTextMeasurer(getTextInfo);
    const metrics = measure('a', { ...base, fontScale: 2, fontWeight: 900 });
    expect(getTextInfo).toHaveBeenCalledWith('a', { fontSize: '20px' });
    expect(metrics.width).toBeCloseTo(104);
    // A missing scale counts as 1.
    measure('a', { ...base, fontScale: 0 });
    expect(getTextInfo).toHaveBeenLastCalledWith('a', { fontSize: '10px' });
  });

  it('measures empty text and zero sizes as nothing', () => {
    const getTextInfo = vi.fn(() => ({ width: 5 }));
    const measure = createLynxTextMeasurer(getTextInfo);
    expect(measure('', base)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(measure('a', { ...base, fontSize: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(getTextInfo).not.toHaveBeenCalled();
  });
});
