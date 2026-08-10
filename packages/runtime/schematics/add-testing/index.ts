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
 * - `experimentalDecorators: true` — Angular's JIT compiler in tests still uses
 *   legacy TypeScript decorators (@Component, @Injectable)
 * - `useDefineForClassFields: false` — prevents class fields from being emitted
 *   as Object.defineProperty calls, which breaks Angular's metadata reflection
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
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(import.meta.dirname, 'src/setup.ts')],
    include: ['src/**/*.spec.ts'],
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
