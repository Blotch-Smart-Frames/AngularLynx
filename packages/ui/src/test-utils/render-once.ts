import {
  type ApplicationRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
  provideZonelessChangeDetection,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { getQueriesForElement, queries } from '@testing-library/dom';
import { provideRenderer } from '@blotch/angular-lynx';

/**
 * Bootstraps a component with a SINGLE change-detection pass, unlike the shared
 * testing-library `render()` helper, which forces an extra explicit
 * `appRef.tick()` after `bootstrapApplication()` resolves.
 *
 * That second tick triggers an Angular 22 zoneless-JIT bug: re-refreshing an
 * already-created child view resets its `input()`-bound values back to their
 * defaults (reproducible with a bare custom component and a property-bound
 * input — unrelated to Lynx). Use this helper for specs whose assertions depend
 * on a child component's bound input actually reaching the DOM (e.g. a host that
 * binds `<ui-icon [name]="...">`, whose required `name` would otherwise reset to
 * undefined). The initial render from `bootstrapApplication()` already reflects
 * all signal-driven state, so the extra tick isn't needed anyway.
 *
 * Returns the component instance, the JSDOM container root, bound
 * `@testing-library/dom` queries, and a `destroy()` teardown. `cleanup()` from
 * the testing-library auto-`afterEach` also tears down the app it tracks, but
 * renderOnce bootstraps its own `ApplicationRef` outside that tracking, so tests
 * call `destroy()` themselves.
 */
export const renderOnce = async <T>(
  component: Type<T>,
  providers: (Provider | EnvironmentProviders)[],
): Promise<
  {
    instance: T;
    container: Element;
    destroy: () => void;
  } & ReturnType<typeof getQueriesForElement>
> => {
  const env = (globalThis as any).lynxTestingEnv;
  env.switchToMainThread();
  (globalThis as any).document.body.innerHTML = '';

  const appRef: ApplicationRef = await bootstrapApplication(component, {
    providers: [
      provideZonelessChangeDetection(),
      provideRenderer(),
      ...providers,
    ],
  });

  const container = (globalThis as any).elementTree.root as Element;
  const instance = appRef.components[0].instance as T;

  return {
    instance,
    container,
    destroy: () => appRef.destroy(),
    ...getQueriesForElement(container as HTMLElement, queries),
  };
};
