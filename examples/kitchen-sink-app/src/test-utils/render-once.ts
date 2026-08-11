import {
  type ApplicationRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
  provideZonelessChangeDetection,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRenderer } from '@blotch/angular-lynx';

/**
 * Bootstraps a component with a SINGLE change-detection pass, unlike the
 * shared testing-library `render()` helper, which forces an extra explicit
 * `appRef.tick()` after `bootstrapApplication()` resolves.
 *
 * That second tick triggers an Angular 22 zoneless bug: re-refreshing an
 * already-created child view resets its `input()`-bound values back to
 * their defaults (reproducible with a bare custom component and a
 * property-bound input — unrelated to Lynx or this app). Use this helper
 * instead of `render()` for specs whose assertions depend on a child
 * component's bound input actually reaching the DOM; the initial render
 * from `bootstrapApplication()` already reflects all signal-driven state,
 * so the extra tick isn't needed anyway.
 */
export const renderOnce = async <T>(
  component: Type<T>,
  options: { providers?: (Provider | EnvironmentProviders)[] } = {},
): Promise<{
  instance: T;
  container: Element;
  destroy: () => void;
}> => {
  const env = (globalThis as any).lynxTestingEnv;
  env.switchToMainThread();
  (globalThis as any).document.body.innerHTML = '';

  const appRef: ApplicationRef = await bootstrapApplication(component, {
    providers: [
      provideZonelessChangeDetection(),
      provideRenderer(),
      ...(options.providers ?? []),
    ],
  });

  const container = (globalThis as any).elementTree.root as Element;
  const instance = appRef.components[0]?.instance as T;

  return { instance, container, destroy: () => appRef.destroy() };
};
