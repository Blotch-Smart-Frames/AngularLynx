/**
 * render() — bootstraps an Angular standalone component through the full
 * Lynx dual-thread pipeline and returns a container element (JSDOM) with
 * @testing-library/dom queries.
 *
 * Pipeline:
 *   1. switchToMainThread() → PAPI globals (__CreatePage, __CreateView, …) active
 *   2. bootstrapApplication(component, { provideRenderer(), … })
 *      → LynxDocument.createRootElement() → __CreatePage → JSDOM <page> in body
 *      → Angular renders tree → __CreateView/Text/… → JSDOM children
 *      → LynxRendererFactory2.end() → __FlushElementTree() (no-op in tests)
 *   3. appRef.tick() forces synchronous CD so all signal-driven updates land
 *   4. Return JSDOM container + @testing-library/dom queries
 */

import {
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
  provideZonelessChangeDetection,
  type Type,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  type BoundFunctions,
  type Queries,
  queries as domQueries,
  getQueriesForElement,
} from '@testing-library/dom';
import { provideRenderer } from '@blotch/angular-lynx';

export type RenderOptions<Q extends Queries = typeof domQueries> = {
  providers?: (Provider | EnvironmentProviders)[];
  /**
   * Custom query helpers to merge with the standard `@testing-library/dom` queries.
   * Each helper receives the container as its first argument when bound.
   * Workaround if omitted: call `getQueriesForElement(container, customQueries)` directly.
   */
  queries?: Q;
};

export type RenderResult<Q extends Queries = typeof domQueries> = {
  /**
   * The JSDOM root element (page element) containing all rendered children.
   */
  container: Element;
  /**
   * Unmount the current Angular app.
   */
  unmount: () => void;
  /**
   * Re-render a (possibly different) component into the same body position,
   * replacing the running app without manually calling cleanup() first.
   */
  rerender: <R extends Queries = Q>(
    component: Type<unknown>,
    options?: RenderOptions<R>,
  ) => Promise<RenderResult<R>>;
  /**
   * Returns a DocumentFragment snapshot of the container — use for snapshot testing.
   */
  asFragment: () => DocumentFragment;
  /**
   * The Angular ComponentRef for the bootstrapped root component.
   *
   * Key uses:
   *   - `componentRef.injector.get(Token)` — retrieve a service provided to the app.
   *   - `componentRef.instance.someSignal.set(v)` — drive writable signal state directly.
   *
   * Note: `componentRef.setInput()` requires the full AOT pipeline to register
   * signal inputs (input()) or @Input() decorators in component metadata. In the
   * Vitest JIT environment this metadata is not available, so the recommended
   * pattern is to expose writable signals on the component instance instead.
   */
  componentRef: ComponentRef<unknown>;
} & BoundFunctions<typeof domQueries> &
  BoundFunctions<Q>;

let currentAppRef: ApplicationRef | null = null;

export const cleanup = (): void => {
  if (currentAppRef) {
    const ref = currentAppRef;
    currentAppRef = null;
    ref.destroy();
  }
};

export const render = async <Q extends Queries = typeof domQueries>(
  rootComponent: Type<unknown>,
  options: RenderOptions<Q> = {} as RenderOptions<Q>,
): Promise<RenderResult<Q>> => {
  cleanup();

  // Switch to main thread so PAPI functions (__CreatePage, __CreateView, …)
  // are available as globals. LynxDocument requires them to create elements.
  const env = (globalThis as any).lynxTestingEnv;
  env.switchToMainThread();

  // Clear JSDOM body so previous render's elements are gone.
  const doc = (globalThis as any).document as Document;
  doc.body.innerHTML = '';

  // Bootstrap Angular. LynxDocument.createRootElement() runs during bootstrap,
  // calling __CreatePage which appends the <page> element to document.body.
  const appRef = await bootstrapApplication(rootComponent, {
    providers: [
      provideZonelessChangeDetection(),
      provideRenderer(),
      ...(options.providers ?? []),
    ],
  });

  currentAppRef = appRef;

  // Force a synchronous CD cycle so signal-initialized state is reflected in
  // the DOM before we return. bootstrapApplication already triggers one CD,
  // but zoneless scheduling may defer follow-up updates to a microtask.
  appRef.tick();

  // elementTree.root is the JSDOM <page> element created by __CreatePage.
  const container = (globalThis as any).elementTree.root as Element;

  const componentRef = appRef.components[0] as ComponentRef<unknown>;

  return {
    container,
    unmount: () => cleanup(),
    rerender: (newComponent, newOptions?) =>
      render(newComponent, newOptions ?? ({} as any)),
    asFragment: () =>
      document.createRange().createContextualFragment(container.outerHTML),
    componentRef,
    ...getQueriesForElement(
      container as HTMLElement,
      {
        ...domQueries,
        ...options.queries,
      } as any,
    ),
  } as RenderResult<Q>;
};

/**
 * Wait for all pending Angular reactive updates to flush through the pipeline.
 * Call this after programmatic signal changes that happen outside event handlers.
 */
export const waitForUpdate = async (): Promise<void> => {
  // Yield to the microtask/macrotask queue so zoneless CD scheduler can enqueue.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  // Then force synchronous CD to apply any queued updates to the DOM.
  currentAppRef?.tick();
};
