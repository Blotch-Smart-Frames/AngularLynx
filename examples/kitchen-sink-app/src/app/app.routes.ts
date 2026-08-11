import type { Routes } from '@angular/router';
import { ScrollExample } from './scroll-example/scroll-example';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: 'list-example',
    loadComponent: () =>
      import('./list-example/list-example').then((m) => m.ListExample),
  },
  { path: 'scroll-example', component: ScrollExample },
  {
    path: 'events',
    loadComponent: () =>
      import('./events-demo/events-demo').then((m) => m.EventsDemo),
  },
  {
    path: 'images-demo',
    loadComponent: () =>
      import('./images-demo/images-demo').then((m) => m.ImagesDemo),
  },
  {
    path: 'query-selector-demo',
    loadComponent: () =>
      import('./query-selector-demo/query-selector-demo').then(
        (m) => m.QuerySelectorDemo,
      ),
  },
  {
    path: 'tailwind-demo',
    loadComponent: () =>
      import('./tailwind-demo/tailwind-demo').then((m) => m.TailwindDemo),
  },
  {
    path: 'motion-demo',
    loadComponent: () =>
      import('./motion-demo/motion-demo').then((m) => m.MotionDemo),
  },
  {
    path: 'css-modules-demo',
    loadComponent: () =>
      import('./css-modules-demo/css-modules-demo').then(
        (m) => m.CssModulesDemo,
      ),
  },
  {
    path: 'defer-demo',
    loadComponent: () =>
      import('./defer-demo/defer-demo').then((m) => m.DeferDemo),
  },
  {
    path: 'gesture-demo',
    loadComponent: () =>
      import('./gesture-demo/gesture-demo').then((m) => m.GestureDemo),
  },
  {
    path: 'fonts-demo',
    loadComponent: () =>
      import('./fonts-demo/fonts-demo').then((m) => m.FontsDemo),
  },
  {
    path: 'text-measure-demo',
    loadComponent: () =>
      import('./text-measure-demo/text-measure-demo').then(
        (m) => m.TextMeasureDemo,
      ),
  },
  {
    path: 'content-projection-demo',
    loadComponent: () =>
      import('./content-projection-demo/content-projection-demo').then(
        (m) => m.ContentProjectionDemo,
      ),
  },
  {
    path: 'line-chart-demo',
    loadComponent: () =>
      import('./line-chart-demo/line-chart-demo').then((m) => m.LineChartDemo),
  },
  {
    path: 'area-chart-demo',
    loadComponent: () =>
      import('./area-chart-demo/area-chart-demo').then((m) => m.AreaChartDemo),
  },
  {
    path: 'candlestick-chart-demo',
    loadComponent: () =>
      import('./candlestick-chart-demo/candlestick-chart-demo').then(
        (m) => m.CandlestickChartDemo,
      ),
  },
  {
    path: 'bar-chart-demo',
    loadComponent: () =>
      import('./bar-chart-demo/bar-chart-demo').then((m) => m.BarChartDemo),
  },
  {
    path: 'scatter-chart-demo',
    loadComponent: () =>
      import('./scatter-chart-demo/scatter-chart-demo').then(
        (m) => m.ScatterChartDemo,
      ),
  },
  {
    path: 'chart-zoom-demo',
    loadComponent: () =>
      import('./chart-zoom-demo/chart-zoom-demo').then((m) => m.ChartZoomDemo),
  },
  {
    path: 'icon-showcase',
    loadComponent: () =>
      import('./icon-showcase/icon-showcase').then((m) => m.IconShowcase),
  },
  {
    path: 'exposure-demo',
    loadComponent: () =>
      import('./exposure-demo/exposure-demo').then((m) => m.ExposureDemo),
  },
  {
    path: 'main-thread-demo',
    loadComponent: () =>
      import('./main-thread-demo/main-thread-demo').then(
        (m) => m.MainThreadDemo,
      ),
  },
  {
    path: 'session-storage-demo',
    loadComponent: () =>
      import('./session-storage-demo/session-storage-demo').then(
        (m) => m.SessionStorageDemo,
      ),
  },
  {
    path: 'worklet-directive-demo',
    loadComponent: () =>
      import('./worklet-directive-demo/worklet-directive-demo').then(
        (m) => m.WorkletDirectiveDemo,
      ),
  },
  {
    path: 'transition-demo',
    loadComponent: () =>
      import('./transition-demo/transition-demo').then((m) => m.TransitionDemo),
  },
  {
    path: 'i18n-demo',
    loadComponent: () =>
      import('./i18n-demo/i18n-demo').then((m) => m.I18nDemo),
  },
  {
    path: 'forms-demo',
    loadComponent: () =>
      import('./forms-demo/forms-demo').then((m) => m.FormsDemo),
  },
  {
    path: 'ssr-demo',
    loadComponent: () => import('./ssr-demo/ssr-demo').then((m) => m.SsrDemo),
  },
  {
    path: 'css-var-validation',
    loadComponent: () =>
      import('./css-var-validation/css-var-validation').then(
        (m) => m.CssVarValidation,
      ),
  },
  {
    path: 'text-projection-validation',
    loadComponent: () =>
      import('./text-projection-validation/text-projection-validation').then(
        (m) => m.TextProjectionValidation,
      ),
  },
  {
    path: 'text-whitespace-demo',
    loadComponent: () =>
      import('./text-whitespace-demo/text-whitespace-demo').then(
        (m) => m.TextWhitespaceDemo,
      ),
  },
  {
    path: 'refresh-demo',
    loadComponent: () =>
      import('./refresh-demo/refresh-demo').then((m) => m.RefreshDemo),
  },
];
