import {
  type Rule,
  SchematicsException,
  type Tree,
} from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Schema } from './schema';

type Platform = 'ios' | 'android';

type NativeModule = {
  PACKAGE_VERSION: string;
  renderEjectedProject: (options: {
    platform: Platform;
    projectRoot: string;
    projectName: string;
    packageVersion?: string;
    app: Record<string, unknown>;
    generatorVersion: string;
  }) => Map<string, Buffer>;
};

/**
 * A real dynamic import. The schematics compile to CommonJS, where TypeScript
 * rewrites `import()` into `require()`, and @blotch/angular-lynx-native is
 * ESM-only (the same reason Angular CLI keeps its own `loadEsmModule`).
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

const loadNative = async (workspaceRoot: string): Promise<NativeModule> => {
  const require = createRequire(path.join(workspaceRoot, 'package.json'));
  let packageJsonPath: string;
  try {
    packageJsonPath =
      require.resolve('@blotch/angular-lynx-native/package.json');
  } catch {
    throw new SchematicsException(
      '@blotch/angular-lynx-native is not installed. Install it first: npm install --save-dev @blotch/angular-lynx-native',
    );
  }
  const entry = JSON.parse(readFileSync(packageJsonPath, 'utf8')).exports['.']
    .import as string;
  return (await importEsm(
    pathToFileURL(path.join(path.dirname(packageJsonPath), entry)).href,
  )) as NativeModule;
};

/**
 * `ng generate @blotch/angular-lynx:eject`: writes the native projects that
 * `ng build --platform` generates into `ios/` and `android/`, for apps that
 * need native changes the builder options don't cover. The builder then
 * builds those folders as they are.
 *
 * One-way on purpose, like Expo's bare workflow: once a project is ejected,
 * keeping it in step with Lynx, Xcode and Google Play is the app's job.
 */
export default (options: Schema): Rule =>
  async (tree: Tree, context) => {
    const workspace = await getWorkspace(tree);
    const projectName = options.project ?? [...workspace.projects.keys()][0];
    const project = projectName
      ? workspace.projects.get(projectName)
      : undefined;
    if (!projectName || !project) {
      throw new SchematicsException(
        `Project "${options.project ?? ''}" not found in angular.json.`,
      );
    }
    const projectRoot = project.root;
    const platforms: Platform[] =
      !options.platform || options.platform === 'all'
        ? ['ios', 'android']
        : [options.platform];

    for (const platform of platforms) {
      const dir = path.posix.join(projectRoot || '', platform);
      if (
        tree.getDir(dir).subfiles.length > 0 ||
        tree.getDir(dir).subdirs.length > 0
      ) {
        throw new SchematicsException(
          `${dir}/ already exists. Delete it first to eject ${platform} again.`,
        );
      }
    }

    // The schematic runs from the workspace root, where Angular CLI resolved
    // this package too.
    const workspaceRoot = process.cwd();
    const native = await loadNative(workspaceRoot);
    const app = (project.targets.get('build')?.options ?? {}) as Record<
      string,
      unknown
    >;
    const packageVersion = tree.exists('/package.json')
      ? (JSON.parse(tree.readText('/package.json')).version as string)
      : undefined;

    for (const platform of platforms) {
      const files = native.renderEjectedProject({
        platform,
        projectRoot: path.join(workspaceRoot, projectRoot),
        projectName,
        packageVersion,
        app,
        generatorVersion: native.PACKAGE_VERSION,
      });
      for (const [file, content] of files) {
        tree.create(
          path.posix.join(projectRoot || '', platform, file),
          content,
        );
      }
      context.logger.info(
        `Ejected ${platform}/. \`ng build --platform ${platform}\` now builds it as it is: edit it freely, but angular.json app options no longer apply to it, and Lynx, Xcode and Google Play upgrades are yours to make.`,
      );
    }
  };
