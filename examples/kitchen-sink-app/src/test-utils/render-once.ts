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
 * It was written for the tests' old setup, plain Vitest compiling components
 * just in time, where that second tick reset already-created child views'
 * `input()`-bound values to their defaults. `ng test` compiles the tests
 * ahead of time, like the app, and `render()` renders these demos correctly
 * there too; the specs keep this helper because the initial render from
 * `bootstrapApplication()` already reflects all signal-driven state, so the
 * extra tick isn't needed.
 */
export const renderOnce = async <T>(
  component: Type<T>,
  options: { providers?: (Provider | EnvironmentProviders)[] } = {},
): Promise<{
  instance: T;
  // An HTMLElement, as @testing-library/dom's queries take: the testing
  // environment's elements are jsdom ones.
  container: HTMLElement;
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

  const container = (globalThis as any).elementTree.root as HTMLElement;
  const instance = appRef.components[0]?.instance as T;

  return { instance, container, destroy: () => appRef.destroy() };
};
