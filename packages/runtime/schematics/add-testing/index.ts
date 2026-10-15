import {
  type Rule,
  type Tree,
  chain,
  SchematicsException,
} from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  ExistingBehavior,
  InstallBehavior,
} from '@schematics/angular/utility/dependency';
import { JSONFile } from '@schematics/angular/utility/json-file';
import {
  getWorkspace,
  updateWorkspace,
} from '@schematics/angular/utility/workspace';

import type { Schema } from './schema';
import { VERSIONS, ownVersionRange } from '../ng-add/versions';

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

    return chain([
      useLynxTestBuilder(projectName),
      updatePackageScripts(),
      addTestingDependencies(),
    ]);
  };

/**
 * Tests run with `ng test`, through the AngularLynx unit-test builder (which
 * `ng add` already sets up; this covers projects set up before it). It sets
 * up the testing library's Lynx environment itself when the package is
 * installed, so the project needs no Vitest config or setup file of its own.
 */
const useLynxTestBuilder = (projectName: string): Rule =>
  updateWorkspace((workspace) => {
    const project = workspace.projects.get(projectName)!;
    const test = project.targets.get('test');
    if (test?.builder === '@blotch/angular-lynx-build:unit-test') {
      return;
    }
    if (test) {
      project.targets.delete('test');
    }
    project.targets.add({
      name: 'test',
      builder: '@blotch/angular-lynx-build:unit-test',
    });
  });

const updatePackageScripts = (): Rule => {
  return (tree: Tree) => {
    // `ng test` watches by default when run in a terminal, so the separate
    // watch script this schematic used to add is gone with Vitest's.
    const pkg = new JSONFile(tree, '/package.json');
    pkg.modify(['scripts', 'test'], 'ng test');
    if (pkg.get(['scripts', 'test:watch']) === 'vitest') {
      pkg.remove(['scripts', 'test:watch']);
    }
  };
};

const addTestingDependencies = (): Rule => {
  return chain([
    // At this package's own release, like the builders `ng add` installs.
    addDependency('@blotch/angular-lynx-testing-library', ownVersionRange(), {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    // `ng new` already adds vitest and jsdom: keep the project's versions
    // rather than replacing them (the default), which silently downgraded
    // every new project. The testing library works with Vitest 4 and 5 and
    // jsdom 25 to 30. The E2E tests run `npm test` in a fresh `ng new`
    // project to keep it that way.
    addDependency('vitest', VERSIONS.vitest, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
      existing: ExistingBehavior.Skip,
    }),
    addDependency('jsdom', VERSIONS.jsdom, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
      existing: ExistingBehavior.Skip,
    }),
  ]);
};
