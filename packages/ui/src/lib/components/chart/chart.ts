import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  Directive,
  TemplateRef,
  ViewEncapsulation,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxGestureDetector,
  LynxTheme,
  PanGesture,
  type PanGestureEvent,
} from '@blotch/angular-lynx';
import {
  resolveFocusPresentation,
  resolveMarkStateScene,
} from '@tanstack/charts/cursor/host';
import { createChartRuntime } from '@tanstack/charts/runtime';
import {
  createChartTooltipContent,
  orderChartTooltipPoints,
  resolveChartTooltipAnchor,
  resolveChartTooltipPlacement,
} from '@tanstack/charts/tooltip/model';
import type {
  ChartDefinition,
  ChartFocusSource,
  ChartFocusState,
  ChartPoint,
  ChartScene,
  ChartTextMeasurer,
  ChartTooltipContent,
  ChartTooltipExtensionToken,
  ChartTooltipOptions,
  ChartTooltipPosition,
  ChartValue,
} from '@tanstack/charts/types';

import { cn } from '../../utils/cn';
import { adjacentFocusPoint, createChartFocusModel } from './chart-focus';
import {
  type ChartLabel,
  type LynxGetTextInfo,
  chartLabelStyle,
  collectChartLabels,
  createLynxTextMeasurer,
  renderChartSvg,
} from './chart-scene';
import {
  type ChartColorSchemeOption,
  UI_CHART_THEME,
  resolveChartPaint,
} from './chart-theme';
import {
  type ChartViewport,
  type ChartWindow,
  type ChartZoomAxes,
  axisContentWindow,
  axisVisibleWindow,
  isFullWindow,
  panWindow,
  toViewportDomain,
  withViewport,
  zoomWindow,
} from './chart-zoom';

/**
 * The tooltip extension for `<ui-chart>`: put it in a definition the way
 * TanStack's web tooltip goes in, alone or with options.
 *
 * ```ts
 * defineChart({ marks, tooltip })
 * defineChart({ marks, tooltip: { use: tooltip, sticky: false } })
 * ```
 *
 * It's a marker only: `<ui-chart>` reads the options and draws the tooltip as
 * native views. TanStack's `@tanstack/charts/tooltip` is the browser's DOM
 * tooltip; a definition shared with a web app can keep it, and `<ui-chart>`
 * still draws its own.
 */
export const tooltip: ChartTooltipExtensionToken<'lynx'> = {
  id: 'lynx-tooltip',
  create: () => undefined,
  __chartExtensionType: 'tooltip',
  __chartTooltipHost: 'lynx',
};

/** What a custom tooltip template receives (as `let-tooltip`). */
export type UiChartTooltipContext = {
  /** Points in the tooltip's display order. */
  readonly points: readonly ChartPoint[];
  /** The touched point, whatever the row order. */
  readonly primaryPoint: ChartPoint;
  /** The default rows and title, already formatted. */
  readonly content: ChartTooltipContent | string;
  readonly pinned: boolean;
  /** Clears focus and unpins, for a close button in a pinned tooltip. */
  readonly dismiss: () => void;
};

/**
 * Replaces the default tooltip body:
 *
 * ```html
 * <ui-chart [definition]="definition">
 *   <ng-template uiChartTooltip let-tooltip>
 *     <text>{{ tooltip.primaryPoint.yValue }}</text>
 *   </ng-template>
 * </ui-chart>
 * ```
 */
@Directive({ selector: 'ng-template[uiChartTooltip]' })
export class UiChartTooltip {
  readonly template =
    inject<TemplateRef<{ $implicit: UiChartTooltipContext }>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: UiChartTooltip,
    _context: unknown,
  ): _context is { $implicit: UiChartTooltipContext } {
    return true;
  }
}

/** Default height, like the browser's 150px replaced-element default, but roomier. */
const DEFAULT_HEIGHT = 200;
/** A touch that moves less than this is a tap, not a drag. */
const TAP_SLOP = 8;
/**
 * Empty layers get a blank drawing rather than `content=""`: Lynx for Web keeps
 * showing the last image when the content is cleared.
 */
const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
const NEXT_POINT = 'Next point';
const PREVIOUS_POINT = 'Previous point';
const EMPTY_POINTS: readonly ChartPoint[] = [];

let nextChartId = 0;

/**
 * Reads `lynx.getTextInfo` where this thread has it (native and web both do).
 */
const lynxTextMeasurer = (): ChartTextMeasurer | undefined => {
  const lynxGlobal = (
    globalThis as { lynx?: { getTextInfo?: LynxGetTextInfo } }
  ).lynx;
  const getTextInfo = lynxGlobal?.getTextInfo;
  return typeof getTextInfo === 'function'
    ? createLynxTextMeasurer(getTextInfo.bind(lynxGlobal))
    : undefined;
};

type TouchPoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * Renders a TanStack Charts definition with Lynx elements: build it with
 * `defineChart` from `@tanstack/charts` and any of its marks, scales and
 * transforms, then pass it in. The line, area, bar, scatter and candlestick
 * charts in this library are presets built the same way.
 *
 * ```ts
 * readonly definition = defineChart({
 *   marks: [barY(revenue, { x: 'month', y: 'value' })],
 *   scales: { x: { scale: () => scaleBand().padding(0.2) }, y: { scale: scaleLinear, nice: true, grid: true } },
 *   tooltip,
 * });
 * ```
 * ```html
 * <ui-chart [definition]="definition" label="Monthly revenue" />
 * ```
 *
 * ## How it draws
 * TanStack compiles the definition into a scene of plain shapes. The shapes are
 * serialized into Lynx `<svg>` elements, one each for the focus highlight
 * under the marks, the marks, and the highlight over them, and the labels are
 * native `<text>` (see chart-scene.ts for why). A touch is mapped to data
 * points by TanStack's focus strategy; the tooltip is native views.
 *
 * ## Sizing
 * Without `width`/`height` the chart fills its container's width and is 200px
 * tall (override with a height class), and re-renders when its layout changes.
 *
 * ## Pan and zoom
 * `zoomable` adds drag-to-pan and +/−/reset controls on the continuous axes the
 * definition configures (`scales.x`, `scales.y`), through TanStack's scale
 * `viewport`. Pinch isn't offered: Lynx has no native pinch handler yet.
 */
@Component({
  selector: 'ui-chart',
  imports: [LYNX_ELEMENTS, LynxGestureDetector, NgTemplateOutlet],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      [class]="rootClass()"
      [style]="rootStyle()"
      [lynxGesture]="zoomable() ? panGesture : noGesture"
      [accessibility-element]="true"
      [accessibility-label]="label()"
      [accessibility-value]="accessibilityValue()"
      [accessibility-actions]="accessibilityActions"
      (bindaccessibilityaction)="onAccessibilityAction($event)"
      (bindlayoutchange)="onLayout($event)"
      (bindtouchstart)="onTouchStart($event)"
      (bindtouchmove)="onTouchMove($event)"
      (bindtouchend)="onTouchEnd($event)"
      (bindtouchcancel)="onTouchCancel()"
    >
      @if (scene()) {
        <!--
          The layers ignore touches so every touch targets this root view, which
          keeps the touch's x/y relative to the chart. They always exist (an empty
          layer draws a blank SVG) so focusing never adds or removes elements.
        -->
        <svg
          [user-interaction-enabled]="false"
          [style]="layerStyle()"
          [attr.content]="underSvg()"
        />
        <svg
          [user-interaction-enabled]="false"
          [style]="layerStyle()"
          [attr.content]="marksSvg()"
        />
        <svg
          [user-interaction-enabled]="false"
          [style]="layerStyle()"
          [attr.content]="overSvg()"
        />
        @for (label of labelSlots(); track $index) {
          <text [user-interaction-enabled]="false" [style]="label.style">{{
            label.text
          }}</text>
        }
        @if (tooltipView(); as view) {
          <!--
            A pinned tooltip takes touches, so a custom template can hold a
            button (calling dismiss); the tap still reaches the chart, which
            unpins. While scrubbing it ignores them, so the touch stays on the
            chart and its coordinates stay chart-relative.
          -->
          <view
            [user-interaction-enabled]="view.context.pinned"
            class="flex-col gap-1 rounded-md border border-border bg-card px-2 py-1.5 flex"
            [style]="view.style"
            (bindlayoutchange)="onTooltipLayout($event)"
          >
            @if (tooltipTemplate(); as custom) {
              <ng-container
                *ngTemplateOutlet="
                  custom.template;
                  context: { $implicit: view.context }
                "
              />
            } @else {
              @if (view.title) {
                <view class="flex-row items-center gap-1.5 flex">
                  @if (view.titleColor) {
                    <view
                      class="h-2 w-2 rounded-sm"
                      [style]="'background-color: ' + view.titleColor"
                    ></view>
                  }
                  <text class="text-xs font-medium text-card-foreground">{{
                    view.title
                  }}</text>
                </view>
              }
              @for (row of view.rows; track $index) {
                <view class="flex-row items-center gap-1.5 flex">
                  @if (row.color) {
                    <view
                      class="h-2 w-2 rounded-sm"
                      [style]="'background-color: ' + row.color"
                    ></view>
                  }
                  <text class="text-xs text-muted-foreground">{{
                    row.label
                  }}</text>
                  <text class="text-xs font-medium text-card-foreground">{{
                    row.value
                  }}</text>
                </view>
              }
            }
          </view>
        }
        @if (zoomable() && showZoomControls()) {
          <view class="flex-col gap-1 flex absolute right-1.5 top-1.5">
            <view [class]="zoomButtonClass" (bindtap)="zoomIn()">
              <text class="text-base font-medium leading-none text-foreground"
                >+</text
              >
            </view>
            <view [class]="zoomButtonClass" (bindtap)="zoomOut()">
              <text class="text-base font-medium leading-none text-foreground"
                >−</text
              >
            </view>
            <view [class]="zoomButtonClass" (bindtap)="resetZoom()">
              <text class="text-[9px] font-medium leading-none text-foreground"
                >1:1</text
              >
            </view>
          </view>
        }
      }
    </view>
  `,
})
export class UiChart {
  /** The chart to draw: what `defineChart` from `@tanstack/charts` returns. */
  readonly definition = input.required<ChartDefinition<any, any, any>>();
  /** Fixed width in px. Omit to fill the container. */
  readonly width = input<number>();
  /** Fixed height in px. Omit for 200px, or set one with a height class. */
  readonly height = input<number>();
  /** What a screen reader announces for the chart. */
  readonly label = input('Chart');
  /**
   * Light or dark colors, or `'system'` to follow the device appearance.
   * Defaults to the chart theme's setting (`provideChartTheme`), which is
   * light unless the app says otherwise; see `ChartColorSchemeOption`.
   */
  readonly colorScheme = input<Exclude<ChartColorSchemeOption, Function>>();
  readonly zoomable = input(false);
  readonly zoomAxes = input<ChartZoomAxes>('xy');
  readonly showZoomControls = input(true);
  readonly minZoom = input(1);
  readonly maxZoom = input(8);
  /** Factor each zoom button press zooms by. */
  readonly zoomStep = input(1.4);
  readonly userClass = input<string>('', { alias: 'class' });

  /**
   * The focused point (the first of the focused group) each time focus moves,
   * as a touch scrubs or a screen reader steps; `null` when it clears.
   */
  readonly focusChange = output<ChartPoint | null>();
  /** The point a tap landed on, or `null` for a tap on empty space. */
  readonly pointSelect = output<ChartPoint | null>();

  protected readonly tooltipTemplate = contentChild(UiChartTooltip);

  readonly #theme = inject(UI_CHART_THEME);
  readonly #appearance = inject(LynxTheme);
  readonly #idPrefix = `chart${nextChartId++}`;
  readonly #runtime = createChartRuntime({ defaultTheme: this.#theme.chart });
  readonly #measureText = lynxTextMeasurer();

  readonly #layout = signal<{ width: number; height: number } | null>(null);
  readonly #viewport = signal<ChartViewport>({});
  readonly #focused = signal<readonly ChartPoint[]>(EMPTY_POINTS);
  readonly #pinned = signal(false);
  readonly #pointer = signal<ChartTooltipPosition | null>(null);
  readonly #focusSource = signal<ChartFocusSource>('pointer');
  readonly #tooltipSize = signal<{ width: number; height: number } | null>(
    null,
  );
  /** True from a pan's first frame until just after it ends. */
  readonly #gesturing = signal(false);
  #frozenLabelCount = 0;
  #touchStart: TouchPoint | null = null;

  protected readonly rootClass = computed(() =>
    cn('h-[200px] w-full flex-shrink-0 relative', this.userClass()),
  );

  protected readonly rootStyle = computed(() => {
    const width = this.width();
    const height = this.height();
    return (
      (width === undefined ? '' : `width: ${width}px; `) +
      (height === undefined ? '' : `height: ${height}px;`)
    );
  });

  /** The size the scene is laid out at: the inputs, else the measured box. */
  readonly #size = computed(() => {
    const layout = this.#layout();
    const width = this.width() ?? layout?.width;
    const height = this.height() ?? layout?.height ?? DEFAULT_HEIGHT;
    return width && width > 0 && height > 0 ? { width, height } : null;
  });

  /** The compiled scene, with any zoom window applied. */
  readonly scene = computed<ChartScene<any, any, any> | null>(() => {
    const size = this.#size();
    if (!size) return null;
    const definition = withViewport(this.definition(), this.#viewport());
    return this.#runtime.render(definition, size, {
      measureText: this.#measureText,
    });
  });

  readonly #focusModel = computed(() => {
    const scene = this.scene();
    return scene ? createChartFocusModel(scene, this.definition()) : null;
  });

  readonly #focusState = computed<ChartFocusState | null>(() => {
    const group = this.#focused();
    const primary = group[0];
    return primary
      ? {
          primary,
          group,
          source: this.#focusSource(),
          pinned: this.#pinned(),
        }
      : null;
  });

  /** The scene with mark states (e.g. dim the unfocused bars) resolved. */
  readonly #presented = computed(() => {
    const scene = this.scene();
    return scene
      ? resolveMarkStateScene(scene, this.#focusState(), this.#pointer()).scene
      : null;
  });

  readonly #focusPresentation = computed(() => {
    const scene = this.#presented();
    return scene
      ? resolveFocusPresentation(
          scene,
          this.#focusState(),
          this.#pointer(),
          null,
        )
      : { under: [], over: [] };
  });

  readonly #colors = computed(() => {
    const option = this.colorScheme() ?? this.#theme.colorScheme ?? 'light';
    const scheme =
      option === 'system'
        ? this.#appearance.isDarkMode()
          ? 'dark'
          : 'light'
        : typeof option === 'function'
          ? option()
          : option;
    return scheme === 'dark' ? this.#theme.dark : this.#theme.light;
  });

  readonly #svgOptions = computed(() => {
    const scene = this.scene();
    const colors = this.#colors();
    return {
      width: scene?.width ?? 0,
      height: scene?.height ?? 0,
      gradients: scene?.gradients,
      idPrefix: this.#idPrefix,
      resolvePaint: (paint: string) => resolveChartPaint(paint, colors),
    };
  });

  protected readonly underSvg = computed(
    () =>
      renderChartSvg(this.#focusPresentation().under, this.#svgOptions()) ||
      EMPTY_SVG,
  );
  protected readonly marksSvg = computed(
    () =>
      renderChartSvg(this.#presented()?.nodes ?? [], this.#svgOptions()) ||
      EMPTY_SVG,
  );
  protected readonly overSvg = computed(
    () =>
      renderChartSvg(this.#focusPresentation().over, this.#svgOptions()) ||
      EMPTY_SVG,
  );

  protected readonly layerStyle = computed(() => {
    const scene = this.scene();
    return `position: absolute; left: 0px; top: 0px; width: ${scene?.width ?? 0}px; height: ${scene?.height ?? 0}px;`;
  });

  readonly #labels = computed<readonly ChartLabel[]>(() => {
    const presentation = this.#focusPresentation();
    return collectChartLabels(
      [
        ...presentation.under,
        ...(this.#presented()?.nodes ?? []),
        ...presentation.over,
      ],
      {
        defaultColor: this.#theme.chart.foreground ?? 'var(--foreground)',
        focus: this.#focusState(),
        pointer: this.#pointer(),
      },
    );
  });

  /**
   * The labels as a pool of `<text>` slots. Outside a pan it's exactly the
   * labels. During one, its length is frozen at the start: TanStack picks nicer
   * ticks as the window moves, so the label count changes, and adding or
   * removing elements from a gesture callback can crash Lynx natively. Extra
   * labels wait until the pan ends; spare slots are hidden.
   */
  protected readonly labelSlots = computed(() => {
    const labels = this.#labels();
    const count = this.#gesturing() ? this.#frozenLabelCount : labels.length;
    return Array.from({ length: count }, (_, index) => {
      const label = labels[index];
      return label
        ? { text: label.text, style: chartLabelStyle(label) }
        : { text: '', style: 'position: absolute; display: none;' };
    });
  });

  readonly #tooltipOptions = computed<ChartTooltipOptions | null>(() => {
    const input = this.definition().tooltip;
    if (!input) return null;
    return 'create' in input ? {} : (input as ChartTooltipOptions);
  });

  /** Tooltips pin on tap unless the definition says `sticky: false`. */
  readonly #sticky = computed(() => {
    const options = this.#tooltipOptions();
    return options !== null && options.sticky !== false;
  });

  protected readonly tooltipView = computed(() => {
    const scene = this.scene();
    const focus = this.#focusState();
    // Hidden while panning: its rows could change mid-gesture, which would
    // add or remove elements in a gesture callback.
    if (!scene || !focus || this.#gesturing()) return null;
    const options = this.#tooltipOptions();
    if (!options) return null;
    if (options.visibility === 'pinned' && !focus.pinned) return null;

    const points = orderChartTooltipPoints(focus.group, scene, options.sort);
    const content = createChartTooltipContent(
      points,
      scene,
      focus.pinned,
      options,
      focus.primary,
    );
    const anchor = resolveChartTooltipAnchor(
      focus.primary,
      points,
      scene,
      this.#pointer(),
      options,
      focus,
    );
    // Until the tooltip has been laid out once its size is unknown, so it's
    // placed with a guess and kept invisible for that one frame. The layout
    // event then sets the size, which re-places it.
    const size = this.#tooltipSize();
    const placed = resolveChartTooltipPlacement(
      anchor,
      size ?? { width: 0, height: 0 },
      { left: 0, top: 0, right: scene.width, bottom: scene.height },
      options.placement,
      options.offset,
    );
    const context: UiChartTooltipContext = {
      points,
      primaryPoint: focus.primary,
      content,
      pinned: focus.pinned,
      dismiss: () => this.dismiss(),
    };
    const structured = typeof content === 'string' ? null : content;
    return {
      style:
        `position: absolute; left: ${placed.left}px; top: ${placed.top}px;` +
        (size ? '' : ' opacity: 0;'),
      context,
      title: structured ? (structured.title ?? null) : content,
      titleColor: structured?.color,
      rows: structured?.rows ?? [],
    };
  });

  protected readonly accessibilityValue = computed(() => {
    const point = this.#focused()[0];
    return point ? describePoint(point) : '';
  });
  protected readonly accessibilityActions = [NEXT_POINT, PREVIOUS_POINT];

  protected readonly zoomButtonClass =
    'flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card';

  constructor() {
    // A new scene (data, size or zoom changed) has new point objects. Keep the
    // focus on the same datum when it's still there, as TanStack's hosts do.
    effect(() => {
      const model = this.#focusModel();
      const previous = untracked(this.#focused);
      if (!model || previous.length === 0) return;
      const restored = model.restore(previous[0]!);
      this.#focused.set(restored ? model.group(restored) : EMPTY_POINTS);
      if (!restored) this.#pinned.set(false);
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Layout
   * ---------------------------------------------------------------------------
   */

  protected onLayout(event: unknown): void {
    const size = layoutSize(event);
    if (!size) return;
    const current = this.#layout();
    if (current?.width !== size.width || current?.height !== size.height) {
      this.#layout.set(size);
    }
  }

  protected onTooltipLayout(event: unknown): void {
    const size = layoutSize(event);
    const current = this.#tooltipSize();
    if (
      size &&
      (current?.width !== size.width || current?.height !== size.height)
    ) {
      this.#tooltipSize.set(size);
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Touch: scrub to focus, tap to select (and pin a sticky tooltip)
   * ---------------------------------------------------------------------------
   */

  protected onTouchStart(event: unknown): void {
    const touch = touchPoint(event);
    this.#touchStart = touch;
    // A pinned tooltip stays put until the next tap; a zoomable chart's drag
    // pans instead of scrubbing.
    if (!touch || this.#pinned() || this.zoomable()) return;
    this.#focusAt(touch);
  }

  protected onTouchMove(event: unknown): void {
    const touch = touchPoint(event);
    if (!touch || this.#pinned() || this.zoomable()) return;
    this.#focusAt(touch);
  }

  protected onTouchEnd(event: unknown): void {
    const touch = touchPoint(event) ?? this.#touchStart;
    const start = this.#touchStart;
    this.#touchStart = null;
    const model = this.#focusModel();
    if (!touch || !model) return;
    // Only a tap selects. A drag was a scrub, a pan on a zoomable chart, or a
    // scroll of the page that started on the chart (Android doesn't always
    // cancel the touch when a parent scroll-view takes it); either way the
    // focus it showed goes when the finger lifts, unless a tooltip is pinned.
    if (start && Math.hypot(touch.x - start.x, touch.y - start.y) > TAP_SLOP) {
      if (!this.#pinned()) this.dismiss();
      return;
    }
    const points = model.resolve(touch.x, touch.y);
    const point = points[0] ?? null;
    this.definition().selection?.change(point, 'pointer');
    this.pointSelect.emit(point);
    if (this.#sticky()) {
      if (this.#pinned()) {
        this.dismiss();
        return;
      }
      this.#pinned.set(point !== null);
    }
    this.#pointer.set(touch);
    this.#setFocus(points, 'pointer');
  }

  /**
   * The touch was taken over, typically by a scrolling parent.
   */
  protected onTouchCancel(): void {
    this.#touchStart = null;
    if (this.#pinned()) return;
    this.#pointer.set(null);
    this.#setFocus(EMPTY_POINTS, 'pointer');
  }

  #focusAt(touch: TouchPoint): void {
    const model = this.#focusModel();
    if (!model) return;
    this.#pointer.set(touch);
    this.#setFocus(model.resolve(touch.x, touch.y), 'pointer');
  }

  #setFocus(points: readonly ChartPoint[], source: ChartFocusSource): void {
    const previous = this.#focused();
    this.#focusSource.set(source);
    if (
      previous.length === points.length &&
      previous.every((point, index) => point === points[index])
    ) {
      return;
    }
    this.#focused.set(points);
    this.focusChange.emit(points[0] ?? null);
  }

  /**
   * Clears focus and unpins the tooltip.
   */
  dismiss(): void {
    this.#pinned.set(false);
    this.#pointer.set(null);
    this.#setFocus(EMPTY_POINTS, 'pointer');
  }

  /**
   * ---------------------------------------------------------------------------
   * Accessibility: step through the points with the screen reader's actions
   * ---------------------------------------------------------------------------
   */

  protected onAccessibilityAction(event: unknown): void {
    const name = (event as { detail?: { name?: string } }).detail?.name;
    const model = this.#focusModel();
    if (!model || (name !== NEXT_POINT && name !== PREVIOUS_POINT)) return;
    const point = adjacentFocusPoint(
      model,
      this.#focused()[0] ?? null,
      name === NEXT_POINT ? 1 : -1,
    );
    this.#pointer.set(null);
    this.#setFocus(point ? model.group(point) : EMPTY_POINTS, 'keyboard');
  }

  // ---------------------------------------------------------------------------
  // Pan / zoom
  // ---------------------------------------------------------------------------

  /**
   * Zooms in by `zoomStep` around the center of the visible window.
   */
  zoomIn(): void {
    this.#zoomBy(this.zoomStep());
  }

  /**
   * Zooms out by `zoomStep` around the center of the visible window.
   */
  zoomOut(): void {
    this.#zoomBy(1 / this.zoomStep());
  }

  /**
   * Back to the whole chart.
   */
  resetZoom(): void {
    this.#viewport.set({});
  }

  #zoomBy(factor: number): void {
    const scene = this.scene();
    if (!scene) return;
    this.#updateViewport(scene, (axis) => {
      const base = axisContentWindow(scene.scales[axis]);
      const current = axisVisibleWindow(scene.scales[axis]);
      if (!base || !current) return null;
      return zoomWindow(
        base,
        current,
        factor,
        (current[0] + current[1]) / 2,
        this.maxZoom(),
        this.minZoom(),
      );
    });
  }

  /**
   * Writes a new window for each zoomable axis. A window covering the whole
   * axis is dropped, so a fully zoomed-out chart renders exactly as one that
   * was never zoomed.
   */
  #updateViewport(
    scene: ChartScene<any, any, any>,
    next: (axis: 'x' | 'y') => ChartWindow | null,
  ): void {
    const axes = this.zoomAxes();
    const viewport: { x?: ChartViewport['x']; y?: ChartViewport['y'] } = {
      ...this.#viewport(),
    };
    for (const axis of ['x', 'y'] as const) {
      if (!axes.includes(axis)) continue;
      const scale = scene.scales[axis];
      const base = axisContentWindow(scale);
      const window = next(axis);
      if (!scale || !base || !window) continue;
      viewport[axis] = isFullWindow(base, window)
        ? undefined
        : toViewportDomain(window, scale);
    }
    this.#viewport.set(viewport);
  }

  // The window and scene at the start of the active pan; plain fields since
  // nothing renders from them.
  #panStart: { scene: ChartScene<any, any, any> } | null = null;

  /**
   * Drag to pan. Registering `onBegin` is required: Lynx only fires a pan's
   * `onStart`/`onEnd` after an `onBegin` callback was registered and fired
   * (see investigations/lynx-vs-web-differences.md). The pan works from the
   * scene at touch-down and the gesture's cumulative translation, so it tracks
   * the finger 1:1 without drift.
   */
  protected readonly panGesture = new PanGesture()
    .maxPointers(1)
    .onBegin(() => this.#beginPan())
    .onStart(() => {
      if (!this.#panStart) this.#beginPan();
    })
    .onUpdate((event) => this.#onPan(event))
    .onEnd(() => this.#endPan());

  #beginPan(): void {
    const scene = this.scene();
    if (!scene) return;
    this.#panStart = { scene };
    this.#frozenLabelCount = this.#labels().length;
    this.#gesturing.set(true);
  }

  #onPan(event: PanGestureEvent): void {
    if (!this.#panStart) this.#beginPan();
    const start = this.#panStart?.scene;
    if (!start) return;
    this.#updateViewport(start, (axis) => {
      const base = axisContentWindow(start.scales[axis]);
      const current = axisVisibleWindow(start.scales[axis]);
      if (!base || !current) return null;
      const extent = axis === 'x' ? start.chart.width : start.chart.height;
      // A collapsed plot has nothing to pan; max(1, …) just avoids 0/0.
      const perPixel = (current[1] - current[0]) / Math.max(1, extent);
      // Dragging right reveals lower x values; the y axis points down the
      // screen, so dragging down reveals higher y values.
      const delta =
        axis === 'x'
          ? -event.translationX * perPixel
          : event.translationY * perPixel;
      return panWindow(base, current, delta);
    });
  }

  #endPan(): void {
    this.#panStart = null;
    // Released on the next tick, outside the gesture callback, since it lets
    // the label pool and tooltip add or remove elements again.
    setTimeout(() => this.#gesturing.set(false), 0);
  }

  /** A stable empty list for `[lynxGesture]` when not zoomable. */
  protected readonly noGesture: never[] = [];
}

/**
 * A Lynx layoutchange event's size (iOS/web put it in `detail`, older Android in `params`).
 */
const layoutSize = (
  event: unknown,
): { width: number; height: number } | null => {
  const source = event as {
    detail?: { width?: number; height?: number };
    params?: { width?: number; height?: number };
  };
  const box = source.detail ?? source.params;
  const width = box?.width;
  const height = box?.height;
  return typeof width === 'number' && typeof height === 'number'
    ? { width, height }
    : null;
};

/**
 * The first touch's position relative to the chart: Lynx reports `x`/`y`
 * relative to the touched element, and every layer above the root ignores
 * touches, so that element is the chart itself.
 */
const touchPoint = (event: unknown): TouchPoint | null => {
  const source = event as {
    touches?: readonly { x?: number; y?: number }[];
    changedTouches?: readonly { x?: number; y?: number }[];
  };
  const touch = source.touches?.[0] ?? source.changedTouches?.[0];
  return typeof touch?.x === 'number' && typeof touch.y === 'number'
    ? { x: touch.x, y: touch.y }
    : null;
};

/**
 * What a screen reader says for the focused point: series, x, y.
 */
const describePoint = (point: ChartPoint): string =>
  [point.groupLabel, formatValue(point.xValue), formatValue(point.yValue)]
    .filter((part) => part !== undefined && part !== '')
    .join(', ');

const formatValue = (value: ChartValue): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
