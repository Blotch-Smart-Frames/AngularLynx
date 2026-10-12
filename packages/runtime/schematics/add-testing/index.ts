import {
  type Rule,
  type Tree,
  chain,
  SchematicsException,
} from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  InstallBehavior,
} from '@schematics/angular/utility/dependency';
import { JSONFile } from '@schematics/angular/utility/json-file';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import type { Schema } from './schema';
import { VERSIONS } from '../ng-add/versions';

export default (options: Schema): Rule =>
  async (tree: Tree) => {
    const workspace = await getWorkspace(tree);
    const projectName =
      options.project ??
      (workspace.extensions['defaultProject'] as string | undefined) ??
      [...workspace.projects.keys()][0];

    if (!projectName) {
      throw new SchematicsException(
        'No project found. Run this schematic inside an Angular workspace.',
      );
    }

    const project = workspace.projects.get(projectName);
    if (!project) {
      throw new SchematicsException(
        `Project "${projectName}" not found in angular.json.`,
      );
    }

    const sourceRoot = (project.sourceRoot ?? `${project.root}/src`) as string;
    const projectRoot = project.root as string;

    return chain([
      addVitestConfig(projectRoot),
      addSetupFile(sourceRoot),
      updatePackageScripts(),
      addTestingDependencies(),
    ]);
  };

/**
 * Vitest config requires careful alignment with the AngularLynx build pipeline:
 * - `define.__MAIN_THREAD__: true` — tests run on the "main thread" path because
 *   PAPI functions (__CreateView, etc.) are available via the testing environment
 * - `define.__DEV__: true` — enables development-mode warnings and diagnostics
 * - `define.__WEB__`, `__PROFILE__`, `__ENABLE_SSR__` — the runtime reads these
 *   compile-time flags, which the Rsbuild plugin injects into app builds.
 *   Without them, importing the runtime in a test throws "ReferenceError:
 *   __WEB__ is not defined". Tests emulate the native main thread: not web,
 *   no profiling, no SSR. Keep in sync with the examples' vitest configs.
 * - `oxc.decorator.legacy: true` — Angular's JIT compiler in tests reads the
 *   metadata of legacy TypeScript decorators (@Component, @Injectable). Vite 8
 *   transforms TypeScript with OXC rather than esbuild, so the old
 *   `esbuild.tsconfigRaw.experimentalDecorators` setting is ignored.
 */
const addVitestConfig = (projectRoot: string): Rule => {
  return (tree: Tree) => {
    const configPath = `${projectRoot ? projectRoot + '/' : ''}vitest.config.ts`;
    const content = `import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: {
    __DEV__: JSON.stringify(true),
    __MAIN_THREAD__: JSON.stringify(true),
    __WEB__: JSON.stringify(false),
    __PROFILE__: JSON.stringify(false),
    __ENABLE_SSR__: JSON.stringify(false),
  },
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(import.meta.dirname, 'src/setup.ts')],
    include: ['src/**/*.test.ts'],
  },
});
`;
    if (tree.exists(configPath)) {
      tree.overwrite(configPath, content);
    } else {
      tree.create(configPath, content);
    }
  };
};

const addSetupFile = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    const setupPath = `${sourceRoot}/setup.ts`;
    const content = `import '@blotch/angular-lynx-testing-library/setup';
`;
    if (tree.exists(setupPath)) {
      tree.overwrite(setupPath, content);
    } else {
      tree.create(setupPath, content);
    }
  };
};

const updatePackageScripts = (): Rule => {
  return (tree: Tree) => {
    const pkg = new JSONFile(tree, '/package.json');
    pkg.modify(['scripts', 'test'], 'vitest run');
    pkg.modify(['scripts', 'test:watch'], 'vitest');
  };
};

const addTestingDependencies = (): Rule => {
  return chain([
    addDependency(
      '@blotch/angular-lynx-testing-library',
      VERSIONS.angularLynxTestingLibrary,
      {
        type: DependencyType.Dev,
        install: InstallBehavior.Auto,
      },
    ),
    // `ng new` already adds vitest and jsdom, at newer majors than these.
    // Replace them (the default): @lynx-js/testing-environment, which the
    // testing library runs on, doesn't work with Vitest 5 or jsdom 30 yet
    // (it can't replace jsdom 30's `window.document`, and Vitest 5 fails to
    // tear the environment down). The E2E tests run `npm test` in a fresh
    // `ng new` project to catch this.
    addDependency('vitest', VERSIONS.vitest, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('jsdom', VERSIONS.jsdom, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
  ]);
};
