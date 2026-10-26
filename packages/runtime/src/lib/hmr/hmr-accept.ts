import { type Type, ɵɵreplaceMetadata } from '@angular/core';
import { isMainThread } from '../background-call';

/**
 * The parts of webpack's `module.hot` API that {@link ɵhmrAccept} uses.
 */
export type HotModule = {
  accept(): void;
  dispose(callback: (data: Record<string, unknown>) => void): void;
  invalidate(): void;
  /** What the module's previous version passed to its dispose handlers. */
  data?: Record<string, unknown>;
};

/**
 * What one version of a module hands the next through `hot.data`.
 */
type ModuleVersion = {
  /** The component classes the app renders, in declaration order. */
  components: Type<unknown>[];
  signature: string;
  code: string;
  /**
   * Set when this version passed the update on to the modules that import it.
   * The update then re-runs the module once more, as part of re-running
   * them, and that run must not pass it on again.
   */
  invalidated: boolean;
};

const DATA_KEY = 'angularLynx';

/**
 * Takes a hot update of a module that defines components. The build plugin
 * adds a call to the end of each such module in a development build, which
 * reassigns the module's component classes to what it returns.
 *
 * On the main thread, where the app runs, a new version of the module either
 * updates the running app in place or passes the update on:
 *
 * - **Only a template or stylesheet changed** (the source `signature`, which
 *   leaves those out, is the same, and the compiled `code` isn't): each
 *   component's new definition replaces the old one with Angular's
 *   `ɵɵreplaceMetadata()`, which Angular's own dev server uses for the same
 *   edits. It re-renders every view of the component in place and keeps the
 *   component instances, so their state survives. The module's bindings are
 *   pointed back at the old classes, so every module keeps using the one
 *   class the app's instances and injectors know.
 * - **Anything else changed**, such as the class, an import, or a module this
 *   one imports: the update can't be applied to the running instances, so
 *   `hot.invalidate()` passes it on to the modules that import this one, up
 *   to the app's entry, which bootstraps the app again (see
 *   `bootstrapApplication`).
 *
 * The background thread runs no Angular, only the module-level code that
 * registers background functions. It accepts every version, which re-runs
 * the module and registers them again.
 *
 * @param hot - The module's `import.meta.webpackHot`.
 * @param components - The component classes this version of the module defines.
 * @param signature - A hash of the module's source without its components'
 *   templates and styles.
 * @param code - A hash of the module's compiled code.
 * @returns The classes the module should use from now on.
 */
export const ɵhmrAccept = (
  hot: HotModule,
  components: Type<unknown>[],
  signature: string,
  code: string,
): Type<unknown>[] => {
  hot.accept();
  if (!isMainThread()) return components;

  const previous = hot.data?.[DATA_KEY] as ModuleVersion | undefined;
  let live = components;
  let invalidated = false;
  if (previous && !previous.invalidated) {
    if (
      previous.code !== code &&
      previous.signature === signature &&
      previous.components.length === components.length
    ) {
      try {
        previous.components.forEach((type, index) =>
          replaceComponent(type, components[index]),
        );
        live = previous.components;
      } catch (error) {
        // A template that throws when it renders, for example. Re-bootstrapping
        // from the entry recovers, or reports the error in the app's own way.
        console.error('[HMR] Could not update the component in place:', error);
        invalidated = true;
      }
    } else {
      invalidated = true;
    }
  }

  hot.dispose((data) => {
    data[DATA_KEY] = {
      components: live,
      signature,
      code,
      invalidated,
    } satisfies ModuleVersion;
  });
  if (invalidated) hot.invalidate();
  return live;
};

/**
 * Swaps the component definition of `current` for `next`'s, and re-renders
 * every view of the component. `ɵɵreplaceMetadata()` merges the definitions
 * in place, keeping the old one's `type`, so the views it creates from now on
 * still instantiate `current`.
 */
const replaceComponent = (
  current: Type<unknown>,
  next: Type<unknown>,
): void => {
  // The merge also keeps the old definition's dependencies, because Angular's
  // own update modules can't import them. Here the new definition comes from
  // the module's new version, whose dependencies are current: a component it
  // uses may have been re-run by the same update, as a new class. Copying them
  // onto the old definition first makes the merge keep the new ones.
  const currentDef = (current as any).ɵcmp;
  const nextDef = (next as any).ɵcmp;
  currentDef.directiveDefs = nextDef.directiveDefs;
  currentDef.pipeDefs = nextDef.pipeDefs;
  ɵɵreplaceMetadata(
    current,
    (type) => {
      (type as any).ɵcmp = (next as any).ɵcmp;
    },
    [],
    [],
  );
};
