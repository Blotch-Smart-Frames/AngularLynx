/**
 * render() — bootstraps an Angular standalone component through the full
 * Lynx dual-thread pipeline and returns a container element (JSDOM) with
 * @testing-library/dom queries.
 *
 * Pipeline:
 *   1. switchToMainThread() → PAPI globals (__CreatePage, __CreateView, …) active
 *   2. createApplication({ provideRenderer(), … }), then
 *      appRef.bootstrap(component, { bindings }) with options.inputs as bindings
 *      → LynxDocument.createRootElement() → __CreatePage → JSDOM <page> in body
 *      → Angular renders tree → __CreateView/Text/… → JSDOM children
 *      → LynxRendererFactory2.end() → __FlushElementTree() (no-op in tests)
 *   3. appRef.tick() forces synchronous CD so all signal-driven updates land
 *   4. Return JSDOM container + queries (@testing-library/dom's, with the
 *      Lynx-aware *ByRole and *ByAccessibilityLabel; see queries.ts)
 */

import {
  type ApplicationRef,
  type ComponentMirror,
  type ComponentRef,
  type EnvironmentProviders,
  type InputSignalWithTransform,
  type Provider,
  inputBinding,
  provideZonelessChangeDetection,
  reflectComponentType,
  signal,
  type Type,
} from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import {
  type BoundFunctions,
  type Queries,
  getQueriesForElement,
} from '@testing-library/dom';
import {
  provideRenderer,
  ɵhideSplashScreenUnlessProvided,
} from '@blotch/angular-lynx';
import { type BoundLynxQueries, type LynxQueries, queries } from './queries.js';

/**
 * The value an input takes from a test: what a signal input or model accepts
 * (its transform's input type, if it has one), or the property's own type for
 * an `@Input()` or an input listed in `inputs` metadata.
 */
type InputValue<T> =
  // `any`, not `unknown`: the read type is invariant (the signal's node both
  // takes and returns it), so InputSignal<string> doesn't extend
  // InputSignalWithTransform<unknown, …>.
  T extends InputSignalWithTransform<any, infer Write> ? Write : T;

/**
 * Inputs for `render()` and `rerender()`, keyed by the name a template binds.
 *
 * Each of the component's properties is typed with the value its input takes,
 * so `inputs: { count: 'three' }` fails to compile for `count = input(0)`. Any
 * other name is allowed too, because an aliased input's name (such as `class`
 * for `input('', { alias: 'class' })`) isn't one of the component's
 * properties. `render()` checks each name against the component's inputs, so a
 * misspelled one still fails the test, at run time.
 */
export type RenderInputs<C = unknown> = {
  [K in keyof C]?: InputValue<C[K]>;
} & Record<string, unknown>;

export type RenderOptions<Q extends Queries = LynxQueries, C = unknown> = {
  providers?: (Provider | EnvironmentProviders)[];
  /**
   * Custom query helpers to merge with the library's queries (see queries.ts).
   * Each helper receives the container as its first argument when bound.
   * Workaround if omitted: call `getQueriesForElement(container, customQueries)` directly.
   */
  queries?: Q;
  /**
   * Values for the component's inputs, as a parent template would bind them.
   *
   * They're set before the first change detection, so a required input has
   * its value when the template first reads it, and `ngOnInit` sees them all.
   * Change them afterwards with `rerender({ inputs })`.
   *
   * render() passes them to Angular as `inputBinding()`s, which needs the
   * input metadata ahead-of-time compilation registers. `ng test` compiles
   * tests that way. Under plain Vitest, which compiles just in time, Angular
   * sees `@Input()` and `inputs` metadata, but not `input()` or `model()`.
   */
  inputs?: RenderInputs<C>;
};

export type RenderResult<Q extends Queries = LynxQueries, C = unknown> = {
  /**
   * The JSDOM root element (page element) containing all rendered children.
   */
  container: Element;
  /**
   * Unmount the current Angular app.
   */
  unmount: () => void;
  /**
   * Change inputs that `render()` set, keeping the component and its state,
   * then run change detection. Inputs left out keep their values: Angular has
   * no way to put an input back to its initial value.
   *
   * Only inputs `render()` set can change. Angular sets those through
   * `inputBinding()`, and a component with input bindings refuses
   * `setInput()`, so there's no way to set another input later. Give
   * `render()` the input's starting value to change it here.
   */
  rerender(update: { inputs: RenderInputs<C> }): Promise<RenderResult<Q, C>>;
  /**
   * Re-render a (possibly different) component into the same body position,
   * replacing the running app without manually calling cleanup() first.
   */
  rerender<R extends Queries = Q, D = unknown>(
    component: Type<D>,
    options?: RenderOptions<R, NoInfer<D>>,
  ): Promise<RenderResult<R, D>>;
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
   * Note: `componentRef.setInput()` needs the input metadata that ahead-of-time
   * compilation registers for signal inputs (input()) and @Input() decorators.
   * `ng test` compiles tests that way, so it works there. Under plain Vitest,
   * which compiles components just in time, that metadata isn't available;
   * expose writable signals on the component instance instead.
   *
   * After `render()` with `inputs`, change inputs with `rerender({ inputs })`:
   * Angular refuses `setInput()` on a component whose inputs are bound
   * (NG0317).
   */
  componentRef: ComponentRef<C>;
} & BoundLynxQueries &
  BoundFunctions<Q>;

let currentAppRef: ApplicationRef | null = null;

export const cleanup = (): void => {
  if (currentAppRef) {
    const ref = currentAppRef;
    currentAppRef = null;
    ref.destroy();
  }
};

/**
 * The microtask turns that passed between bootstrap and an
 * `await bootstrapApplication()` resuming, as measured on Angular 22.2: the
 * promise chain its bootstrap returns through.
 */
const BOOTSTRAP_MICROTASK_TURNS = 6;

/**
 * Lets the microtasks the first change detection queued run, as many turns as
 * awaiting bootstrapApplication() did, so render() keeps its timing.
 *
 * Only microtasks: waiting for a timer would hang a test that turned on fake
 * timers, and would run the component's own timers before render() returns.
 */
const settleBootstrapMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < BOOTSTRAP_MICROTASK_TURNS; turn++) {
    await Promise.resolve();
  }
};

/**
 * Returns the component's mirror, after the check bootstrapApplication() makes:
 * that it's a standalone component. appRef.bootstrap() doesn't check, and given
 * a plain class it fails reading the missing definition, with a TypeError that
 * doesn't say what's wrong.
 */
const reflectRootComponent = <C>(component: Type<C>): ComponentMirror<C> => {
  const mirror = reflectComponentType(component);
  if (!mirror) {
    throw new Error(
      `render() can't render ${component.name}: it isn't an Angular component. Give it the @Component decorator.`,
    );
  }
  if (!mirror.isStandalone) {
    throw new Error(
      `render() can't render ${component.name}: it isn't standalone, and render() bootstraps it as an app's root component. Remove standalone: false.`,
    );
  }
  return mirror;
};

/**
 * Throws unless each name is one of the component's inputs, as a template
 * binds it.
 *
 * Angular reports a binding to a missing input during the first change
 * detection, which bootstrap runs inside a try/catch that hands the error to
 * the ErrorHandler and carries on. The test would go on with the input unset,
 * and LynxErrorHandler reports through lynx.reportError, which prints nothing
 * in a test, so render() checks first and names the inputs the component has.
 */
const assertInputsExist = (
  mirror: ComponentMirror<unknown>,
  names: string[],
  caller: string,
): void => {
  const templateNames = new Set(
    mirror.inputs.map((input) => input.templateName),
  );
  const missing = names.find((name) => !templateNames.has(name));
  if (missing === undefined) return;

  const component = mirror.type.name;
  // An aliased input's property name is the natural thing to type, since
  // that's what the component's code reads; say which name to use instead.
  const aliased = mirror.inputs.find((input) => input.propName === missing);
  if (aliased) {
    throw new Error(
      `${caller} can't set "${missing}": it's the property of ${component}'s "${aliased.templateName}" input. Use "${aliased.templateName}", the name a template binds.`,
    );
  }
  const known = mirror.inputs
    .map((input) => `"${input.templateName}"`)
    .join(', ');
  throw new Error(
    `${caller} can't set "${missing}": ${component} has no input by that name. ` +
      (known ? `Its inputs are ${known}. ` : 'It has no inputs. ') +
      'Plain Vitest compiles components just in time, where Angular sees no input() or model() inputs; ng test compiles them ahead of time.',
  );
};

/**
 * Renders `rootComponent` as a Lynx app's root component, with
 * `options.inputs` bound to its inputs, and resolves once the first change
 * detection has run.
 */
export const render = async <Q extends Queries = LynxQueries, C = unknown>(
  rootComponent: Type<C>,
  options: RenderOptions<Q, NoInfer<C>> = {},
): Promise<RenderResult<Q, C>> => {
  cleanup();

  const mirror = reflectRootComponent(rootComponent);
  const inputs: Record<string, unknown> = { ...options.inputs };
  const boundNames = new Set(Object.keys(inputs));
  assertInputsExist(mirror, [...boundNames], 'render()');

  // Switch to main thread so PAPI functions (__CreatePage, __CreateView, …)
  // are available as globals. LynxDocument requires them to create elements.
  const env = (globalThis as any).lynxTestingEnv;
  env.switchToMainThread();

  // Clear JSDOM body so previous render's elements are gone.
  const doc = (globalThis as any).document as Document;
  doc.body.innerHTML = '';

  // Each input reads its value from this signal. A binding is evaluated in the
  // root view on every change detection, so rerender({ inputs }) only has to
  // set the signal: reading it marks the root view for refresh, and Angular
  // passes the new value on as a parent template's binding would. With no
  // inputs there are no bindings, so componentRef.setInput() still works.
  const inputValues = signal(inputs);
  const bindings = [...boundNames].map((name) =>
    inputBinding(name, () => inputValues()[name]),
  );

  // bootstrapApplication() takes no bindings, and setting inputs after it
  // returns would be too late: bootstrap runs the first change detection, so
  // ngOnInit would see the defaults and reading an unset required input would
  // throw (NG0950). createApplication() plus appRef.bootstrap() is the same
  // bootstrap, split so the bindings can go in.
  const appRef = await createApplication({
    providers: [
      provideZonelessChangeDetection(),
      provideRenderer(),
      ...(options.providers ?? []),
    ],
  });

  // Set before bootstrapping, so cleanup() destroys the app even when the
  // component throws while it's created.
  currentAppRef = appRef;

  // LynxDocument.createRootElement() runs during bootstrap, calling
  // __CreatePage which appends the <page> element to document.body.
  const componentRef = appRef.bootstrap(rootComponent, { bindings });
  // What bootstrapApplication() does next: the splash screen goes at the
  // first frame, unless the app's provideSplashScreen() says when. A spec
  // reads LynxSplashScreen.visible() to see that it went.
  ɵhideSplashScreenUnlessProvided(appRef);

  // Force a synchronous CD cycle so signal-initialized state is reflected in
  // the DOM before we return. bootstrap already triggers one CD, but work it
  // starts may defer follow-up updates to a microtask: ngModel writes its
  // value a microtask later, and the control only shows it at the next CD.
  // Awaiting bootstrapApplication() let those run first, so wait as long.
  await settleBootstrapMicrotasks();
  appRef.tick();

  // elementTree.root is the JSDOM <page> element created by __CreatePage.
  const container = (globalThis as any).elementTree.root as Element;

  /**
   * rerender({ inputs }): updates the bound inputs in place and runs change
   * detection, so the DOM shows them when the promise resolves.
   */
  const changeInputs = async (
    changed: Record<string, unknown>,
  ): Promise<RenderResult<Q, C>> => {
    // A result whose app was unmounted, or replaced by a later render(), has
    // no component left to change. Setting the signal would do nothing, and
    // the tick would only warn that the app is destroyed.
    if (currentAppRef !== appRef) {
      throw new Error(
        'rerender({ inputs }) has no component to change: it was unmounted, or a later render() replaced it.',
      );
    }
    const names = Object.keys(changed);
    assertInputsExist(mirror, names, 'rerender({ inputs })');
    const unbound = names.find((name) => !boundNames.has(name));
    if (unbound !== undefined) {
      throw new Error(
        `rerender({ inputs }) can only change inputs render() set, and render() didn't set "${unbound}". ` +
          "Give it a starting value in render()'s inputs: Angular sets those through input bindings, and a component with input bindings can't take other inputs.",
      );
    }
    inputValues.update((values) => ({ ...values, ...changed }));
    appRef.tick();
    return result;
  };

  const result = {
    container,
    unmount: () => cleanup(),
    rerender: (
      componentOrUpdate: Type<unknown> | { inputs: Record<string, unknown> },
      newOptions?: RenderOptions<Queries, unknown>,
    ) =>
      // A component is a class, so a function; the update is a plain object.
      typeof componentOrUpdate === 'function'
        ? render(componentOrUpdate, newOptions)
        : changeInputs(componentOrUpdate.inputs),
    asFragment: () =>
      document.createRange().createContextualFragment(container.outerHTML),
    componentRef,
    ...getQueriesForElement(
      container as HTMLElement,
      {
        ...queries,
        ...options.queries,
      } as any,
    ),
  } as unknown as RenderResult<Q, C>;
  return result;
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
