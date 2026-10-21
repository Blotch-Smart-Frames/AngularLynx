import { rectCornerRadiiPath } from '@tanstack/charts/renderer/rect';
import type {
  ChartBounds,
  ChartFocusState,
  ChartGradient,
  ChartTextMeasurer,
  ChartTooltipPosition,
  SceneLabel,
  SceneNode,
  SceneStyle,
} from '@tanstack/charts/types';

/**
 * Turns a TanStack Charts scene into what Lynx can draw: SVG strings for the
 * shapes, and a list of positioned labels for native `<text>`.
 *
 * ## Why not TanStack's own `renderChartSvg`
 * Its output targets a browser's DOM: it hides focus layers with
 * `visibility="hidden"` and CSS classes, relies on paints inheriting through
 * `<g>`, writes `<line>`, `stroke-dasharray="none"` and `font-family="inherit"`,
 * and omits `xmlns`. Lynx's native SVG engine (ServalSVG) ignores visibility and
 * CSS, skips a `<line>` whose stroke is inherited, hangs on a non-numeric dash
 * array, and the web preview can't load SVG without `xmlns` as an image. So this
 * serializer writes the same geometry in the subset every Lynx platform draws
 * the same way: explicit paints on every shape, paths instead of lines, focus
 * subtrees left out (the host paints the active one separately), and resolved
 * colors.
 *
 * ## Why labels are native text
 * Text drawn inside the SVG uses the SVG engine's own fonts and metrics, which
 * differ per platform and from the app's. Native `<text>` uses the app's fonts,
 * reads theme CSS variables directly, and matches the `lynx.getTextInfo`
 * measurements the layout was made with (see {@link createLynxTextMeasurer}).
 */

export type ChartPaintResolver = (paint: string) => string;

export type ChartSvgOptions = {
  readonly width: number;
  readonly height: number;
  /** Concrete color for a CSS-shaped paint (see `resolveChartPaint`). */
  readonly resolvePaint: ChartPaintResolver;
  /** Gradients the nodes may reference as `url(#id)`. */
  readonly gradients?: readonly ChartGradient[];
  /** Prefix for gradient and clip ids, so two charts' ids never collide. */
  readonly idPrefix?: string;
};

/** The paint properties SVG inherits from a group (opacity isn't one). */
const INHERITED_PAINT = [
  'fill',
  'fillOpacity',
  'stroke',
  'strokeOpacity',
  'strokeWidth',
  'lineCap',
  'lineJoin',
  'strokeDasharray',
] as const satisfies readonly (keyof SceneStyle)[];

type InheritedPaint = Pick<SceneStyle, (typeof INHERITED_PAINT)[number]>;

type SvgContext = {
  readonly options: ChartSvgOptions;
  readonly gradientIds: ReadonlySet<string>;
  readonly defs: string[];
  clipCount: number;
};

/**
 * Serializes `nodes` (labels excluded) into one `<svg>` the size of the chart.
 * Returns `''` when nothing would be drawn, so the host can skip the element:
 * the focus layers are empty until something is focused.
 */
export const renderChartSvg = (
  nodes: readonly SceneNode[],
  options: ChartSvgOptions,
): string => {
  const context: SvgContext = {
    options,
    gradientIds: new Set((options.gradients ?? []).map((g) => g.id)),
    defs: [],
    clipCount: 0,
  };
  const body = renderNodes(nodes, {}, context);
  if (!body) return '';
  const gradients = (options.gradients ?? [])
    .map((gradient) => renderGradient(gradient, context))
    .join('');
  const defs = gradients + context.defs.join('');
  const { width, height } = options;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    '</svg>'
  );
};

const renderNodes = (
  nodes: readonly SceneNode[],
  inherited: InheritedPaint,
  context: SvgContext,
): string => {
  let markup = '';
  for (const node of nodes) markup += renderNode(node, inherited, context);
  return markup;
};

const renderNode = (
  node: SceneNode,
  inherited: InheritedPaint,
  context: SvgContext,
): string => {
  if (node.kind === 'label') return '';
  const paint = inheritPaint(inherited, node.style);

  if (node.kind === 'group') {
    // A focus subtree holds the candidates for every point; the browser
    // renderer hides them with visibility, which ServalSVG ignores, so they'd
    // all paint. The host draws the active one from resolveFocusPresentation.
    if (node.focus) return '';
    const children = renderNodes(node.children, paint, context);
    if (!children) return '';
    const translate =
      node.translateX || node.translateY
        ? ` transform="translate(${num(node.translateX ?? 0)} ${num(node.translateY ?? 0)})"`
        : '';
    const clip = node.clip ? clipAttribute(node.clip, context) : '';
    return `<g${translate}${clip}${opacityAttribute(node.style)}>${children}</g>`;
  }

  const attributes =
    paintAttributes(paint, context) + opacityAttribute(node.style);
  switch (node.kind) {
    case 'rule':
      // A path, not <line>: ServalSVG skips a line unless its stroke is set on
      // the line element itself.
      return `<path d="M${num(node.x1)} ${num(node.y1)}L${num(node.x2)} ${num(node.y2)}"${attributes}/>`;
    case 'polyline':
      return `<path d="${escapeAttribute(node.path ?? pointsPath(node.points, false))}"${attributes}/>`;
    case 'area': {
      if (node.polygons !== undefined) {
        const rings = node.polygons
          .flatMap((polygon) => polygon)
          .filter((ring) => ring.length > 0)
          .map((ring) => pointsPath(ring, true))
          .join('');
        return `<path d="${rings}" fill-rule="evenodd"${attributes}/>`;
      }
      return `<path d="${escapeAttribute(node.path ?? pointsPath(node.points, true))}"${attributes}/>`;
    }
    case 'dot':
      return `<circle cx="${num(node.x)}" cy="${num(node.y)}" r="${num(node.radius)}"${attributes}/>`;
    case 'rect':
      return node.cornerRadii === undefined
        ? `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}"${node.radius ? ` rx="${num(node.radius)}"` : ''}${attributes}/>`
        : `<path d="${rectCornerRadiiPath(node.x, node.y, node.width, node.height, node.cornerRadii)}"${attributes}/>`;
  }
};

const inheritPaint = (
  inherited: InheritedPaint,
  style: SceneStyle | undefined,
): InheritedPaint => {
  if (!style) return inherited;
  const merged: InheritedPaint = { ...inherited };
  for (const key of INHERITED_PAINT) {
    if (style[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = style[key];
    }
  }
  return merged;
};

const paintAttributes = (paint: InheritedPaint, context: SvgContext): string =>
  attribute('fill', resolvePaint(paint.fill, context)) +
  attribute('fill-opacity', paint.fillOpacity) +
  attribute('stroke', resolvePaint(paint.stroke, context)) +
  attribute('stroke-opacity', paint.strokeOpacity) +
  attribute('stroke-width', paint.strokeWidth) +
  attribute('stroke-linecap', paint.lineCap) +
  attribute('stroke-linejoin', lineJoin(paint.lineJoin)) +
  // `none` is the default; anything else that isn't a number list is dropped
  // by the runtime before it reaches ServalSVG (see svg-content.ts there).
  attribute(
    'stroke-dasharray',
    paint.strokeDasharray === 'none' ? undefined : paint.strokeDasharray,
  );

const opacityAttribute = (style: SceneStyle | undefined): string =>
  attribute('opacity', style?.opacity);

/**
 * SVG 2's `arcs` and `miter-clip` aren't in the SVG 1.1 subset Lynx draws.
 */
const lineJoin = (value: SceneStyle['lineJoin']): string | undefined =>
  value === 'arcs' ? 'round' : value === 'miter-clip' ? 'miter' : value;

const resolvePaint = (
  paint: string | undefined,
  context: SvgContext,
): string | undefined => {
  if (paint === undefined) return undefined;
  const gradient = /^url\(#(.+)\)$/.exec(paint.trim())?.[1];
  if (gradient !== undefined && context.gradientIds.has(gradient)) {
    return `url(#${scopedId(context, `gradient-${gradient}`)})`;
  }
  return context.options.resolvePaint(paint);
};

const clipAttribute = (clip: ChartBounds, context: SvgContext): string => {
  const id = scopedId(context, `clip-${context.clipCount++}`);
  // Clip paths go in the root <defs> rather than next to their group, the
  // placement every SVG engine agrees on.
  context.defs.push(
    `<clipPath id="${id}"><rect x="${num(clip.x)}" y="${num(clip.y)}" width="${num(clip.width)}" height="${num(clip.height)}"/></clipPath>`,
  );
  return ` clip-path="url(#${id})"`;
};

const renderGradient = (
  gradient: ChartGradient,
  context: SvgContext,
): string => {
  let minimumOffset = 0;
  const stops = gradient.stops
    .map((stop) => {
      // Offsets must not decrease; clamp like browsers do so every engine
      // agrees on the result.
      const offset = Math.max(minimumOffset, clampUnit(stop.offset));
      minimumOffset = offset;
      return `<stop offset="${percent(offset)}" stop-color="${escapeAttribute(context.options.resolvePaint(stop.color))}"${attribute('stop-opacity', stop.opacity)}/>`;
    })
    .join('');
  const id = scopedId(context, `gradient-${gradient.id}`);
  if (gradient.type === 'radial') {
    const cx = gradient.cx ?? 0.5;
    const cy = gradient.cy ?? 0.5;
    return `<radialGradient id="${id}" cx="${percent(cx)}" cy="${percent(cy)}" r="${percent(gradient.r ?? 0.5)}" fx="${percent(gradient.fx ?? cx)}" fy="${percent(gradient.fy ?? cy)}">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" x1="${percent(gradient.x1 ?? 0)}" y1="${percent(gradient.y1 ?? 1)}" x2="${percent(gradient.x2 ?? 0)}" y2="${percent(gradient.y2 ?? 0)}">${stops}</linearGradient>`;
};

const scopedId = (context: SvgContext, id: string): string =>
  `${context.options.idPrefix ?? 'chart'}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const pointsPath = (
  points: readonly (readonly [number, number])[],
  close: boolean,
): string =>
  points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`)
    .join('') + (close && points.length > 0 ? 'Z' : '');

const attribute = (name: string, value: string | number | undefined): string =>
  value === undefined
    ? ''
    : ` ${name}="${typeof value === 'number' ? num(value) : escapeAttribute(value)}"`;

/**
 * Two decimals are well under a device pixel at any scale, and keep the SVG
 * short. `+` turns `-0` and trailing zeros into their shortest form.
 */
const num = (value: number): string =>
  Number.isFinite(value) ? String(+value.toFixed(2) || 0) : '0';

const percent = (value: number): string => `${num(clampUnit(value) * 100)}%`;

const clampUnit = (value: number): number =>
  Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** A scene label resolved to absolute chart coordinates and final paint. */
export type ChartLabel = {
  readonly key: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly baseline: 'auto' | 'middle' | 'hanging';
  readonly rotate: number;
  readonly fontSize: number;
  readonly fontWeight: number;
  /** A CSS color; `var(--token)` is fine, native text resolves it. */
  readonly color: string;
  readonly opacity: number;
};

export type ChartLabelOptions = {
  /** Color for a label with no fill of its own or inherited. */
  readonly defaultColor: string;
  /** Feeds labels whose opacity follows focus (e.g. dimmed axis ticks). */
  readonly focus?: ChartFocusState | null;
  readonly pointer?: ChartTooltipPosition | null;
};

type LabelFrame = {
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  readonly fill: string | undefined;
  readonly fillOpacity: number;
  /** Absolute clip bounds of the nearest clipping group. */
  readonly clip: ChartBounds | undefined;
};

/** TanStack's own default when a label sets no size (see estimateSceneText). */
const DEFAULT_FONT_SIZE = 16;

export const collectChartLabels = (
  nodes: readonly SceneNode[],
  options: ChartLabelOptions,
): ChartLabel[] => {
  const labels: ChartLabel[] = [];
  const visit = (children: readonly SceneNode[], frame: LabelFrame) => {
    for (const node of children) {
      if (node.kind === 'group') {
        if (node.focus) continue;
        const x = frame.x + (node.translateX ?? 0);
        const y = frame.y + (node.translateY ?? 0);
        visit(node.children, {
          x,
          y,
          opacity: frame.opacity * (node.style?.opacity ?? 1),
          fill: node.style?.fill ?? frame.fill,
          fillOpacity: node.style?.fillOpacity ?? frame.fillOpacity,
          clip: node.clip
            ? { ...node.clip, x: node.clip.x + x, y: node.clip.y + y }
            : frame.clip,
        });
      } else if (node.kind === 'label') {
        const label = resolveLabel(node, frame, options);
        if (label) labels.push(label);
      }
    }
  };
  visit(nodes, {
    x: 0,
    y: 0,
    opacity: 1,
    fill: undefined,
    fillOpacity: 1,
    clip: undefined,
  });
  return labels;
};

const resolveLabel = (
  node: SceneLabel,
  frame: LabelFrame,
  options: ChartLabelOptions,
): ChartLabel | null => {
  const x = frame.x + node.x;
  const y = frame.y + node.y;
  // A native <text> can't be clipped to part of its parent the way an SVG
  // group is, so a label whose anchor falls outside its clip (a value label
  // scrolled out of a zoomed viewport) is left out instead.
  const { clip } = frame;
  if (
    clip &&
    (x < clip.x ||
      x > clip.x + clip.width ||
      y < clip.y ||
      y > clip.y + clip.height)
  ) {
    return null;
  }
  const focusOpacity =
    node.focusOpacity?.({
      focus: options.focus ?? null,
      pointer: options.pointer ?? null,
    }) ?? 1;
  const opacity =
    frame.opacity *
    (node.style?.opacity ?? 1) *
    (node.style?.fillOpacity ?? frame.fillOpacity) *
    focusOpacity;
  return {
    key: node.key,
    text: node.text,
    x,
    y,
    anchor: node.anchor ?? 'start',
    baseline: node.baseline ?? 'auto',
    rotate: node.rotate ?? 0,
    fontSize: node.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: node.fontWeight ?? 400,
    color: nativeColor(node.style?.fill ?? frame.fill, options.defaultColor),
    opacity,
  };
};

/**
 * `currentColor` means nothing to a native `<text>`; use the theme's text color.
 */
const nativeColor = (paint: string | undefined, fallback: string): string =>
  paint === undefined || paint === 'currentColor' ? fallback : paint;

/**
 * Inline style placing a native `<text>` so its anchor point lands where the
 * SVG label's would.
 *
 * The text box is as tall as one line at `line-height: font-size`, and
 * `translate` percentages are relative to the text's own box, so the anchor
 * shifts need no measurement: half the width for `middle`, all of it for `end`;
 * half the height for a `middle` baseline, and 80% for an alphabetic one (the
 * same ascent TanStack assumes when it lays out guides). Rotation turns about
 * the anchor point, which `transform-origin: 0 0` plus applying the translate
 * first gives.
 */
export const chartLabelStyle = (label: ChartLabel): string => {
  const tx =
    label.anchor === 'middle' ? -50 : label.anchor === 'end' ? -100 : 0;
  const ty =
    label.baseline === 'middle' ? -50 : label.baseline === 'hanging' ? 0 : -80;
  const rotate = label.rotate ? `rotate(${num(label.rotate)}deg) ` : '';
  return (
    `position: absolute; left: ${num(label.x)}px; top: ${num(label.y)}px; ` +
    `font-size: ${num(label.fontSize)}px; line-height: ${num(label.fontSize)}px; ` +
    `font-weight: ${label.fontWeight}; color: ${label.color}; opacity: ${num(label.opacity)}; ` +
    `white-space: nowrap; transform-origin: 0 0; transform: ${rotate}translate(${tx}%, ${ty}%);`
  );
};

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/** `lynx.getTextInfo`'s shape: width in px for text at a CSS font size. */
export type LynxGetTextInfo = (
  text: string,
  info: { fontSize: string },
) => { width: number };

/**
 * A TanStack text measurer backed by `lynx.getTextInfo`, so axis margins fit
 * the labels as the platform will actually draw them. Heights and the
 * anchor/baseline offsets follow TanStack's estimator, which the label style
 * above mirrors. `getTextInfo` takes no weight, so bold text is widened with the
 * estimator's weight factor. Results are cached: guide layout measures every
 * tick label on every render.
 */
export const createLynxTextMeasurer = (
  getTextInfo: LynxGetTextInfo,
): ChartTextMeasurer => {
  const cache = new Map<string, number>();
  return (text, options) => {
    const fontSize = options.fontSize * (options.fontScale || 1);
    if (!text || !fontSize) return { x: 0, y: 0, width: 0, height: 0 };
    const key = `${fontSize}\u0000${text}`;
    let measured = cache.get(key);
    if (measured === undefined) {
      measured = getTextInfo(text, { fontSize: `${fontSize}px` }).width;
      cache.set(key, measured);
    }
    const weight = Math.min(900, Math.max(100, options.fontWeight ?? 400));
    const width = measured * (1 + (weight - 400) / 12_500);
    const x =
      options.anchor === 'middle'
        ? -width / 2
        : options.anchor === 'end'
          ? -width
          : 0;
    const y =
      options.baseline === 'middle'
        ? -fontSize / 2
        : options.baseline === 'hanging'
          ? 0
          : -fontSize * 0.8;
    return { x, y, width, height: fontSize };
  };
};
