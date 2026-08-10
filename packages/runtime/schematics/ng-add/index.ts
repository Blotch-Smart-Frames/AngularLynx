import {
  type Rule,
  type Tree,
  chain,
  MergeStrategy,
  SchematicsException,
  apply,
  applyTemplates,
  mergeWith,
  move,
  url,
} from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  InstallBehavior,
} from '@schematics/angular/utility/dependency';
import { JSONFile } from '@schematics/angular/utility/json-file';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import type { Schema } from './schema';
import { VERSIONS } from './versions';

/**
 * Transforms a standard `ng new` Angular project into a Lynx-native application.
 * The schematic replaces browser-specific bootstrap (main.ts, app.config.ts,
 * app.component.ts) with Lynx equivalents, adds lynx.config.ts via template
 * files, rewires package.json scripts to rspeedy, and optionally sets up
 * Tailwind with the Lynx preset. This is a one-shot destructive transform —
 * the old browser-Angular files are deleted because they reference DOM APIs
 * and HTML elements that don't exist on the Lynx runtime.
 */
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
    const prefix = (project.extensions['prefix'] as string) ?? 'app';

    const rules: Rule[] = [
      addTemplateFiles(projectRoot, sourceRoot),
      replaceMainTs(sourceRoot),
      replaceAppConfig(sourceRoot),
      replaceApp(sourceRoot, prefix, projectName),
      deleteOldAppFiles(sourceRoot),
      updatePackageScripts(),
      addCoreDependencies(),
    ];

    if (options.tailwind !== false) {
      rules.push(
        addTailwindConfig(projectRoot),
        updateStylesCss(sourceRoot),
        addTailwindDependencies(),
      );
    }

    return chain(rules);
  };

const addTemplateFiles = (projectRoot: string, _sourceRoot: string): Rule =>
  mergeWith(
    // MergeStrategy.Overwrite is deliberate — `ng add` is meant to be
    // idempotent so re-running it should refresh the lynx.config.ts and any
    // other template assets to the package's current version. Default merge
    // strategy would error on file collisions.
    apply(url('../files'), [applyTemplates({}), move(projectRoot || '/')]),
    MergeStrategy.Overwrite,
  );

const replaceMainTs = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    // `ng new` generates a main.ts that calls bootstrapApplication from
    // @angular/platform-browser. That platform implementation reaches into
    // browser globals (document, history, navigator) which don't exist on
    // Lynx, so we replace the bootstrap entrypoint with the AngularLynx
    // equivalent that wires the Lynx renderer instead.
    const mainPath = `${sourceRoot}/main.ts`;
    const content = `import { bootstrapApplication } from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig);
`;
    tree.overwrite(mainPath, content);
  };
};

const replaceAppConfig = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    // Two providers are required for any AngularLynx app:
    //   1. provideZonelessChangeDetection() — Lynx doesn't carry zone.js, so
    //      Angular must run in zoneless mode (signals + manual change detection
    //      triggers are the only reactivity path).
    //   2. provideRenderer() — registers the Lynx RendererFactory2 over
    //      Angular's default DOM renderer so element creation calls go to
    //      __CreateElement/__SetAttribute instead of document.createElement.
    // provideRouter is included by default so the generated App has a working
    // <router-outlet> for the user to hang their routes off.
    const configPath = `${sourceRoot}/app/app.config.ts`;
    const content = `import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer, provideRouter, LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    provideRouter(routes),
  ],
};
`;
    tree.overwrite(configPath, content);
  };
};

const replaceApp = (
  sourceRoot: string,
  prefix: string,
  projectName: string,
): Rule => {
  return (tree: Tree) => {
    // `ng new` generates app.component.ts — delete it and create app.ts.
    // The Angular 2025 style guide drops the `.component` suffix, and
    // AngularLynx's component schematic follows the same convention so the
    // bootstrap component should too.
    const oldPath = `${sourceRoot}/app/app.component.ts`;
    if (tree.exists(oldPath)) {
      tree.delete(oldPath);
    }

    // LYNX_ELEMENTS is the directive bundle that registers <view>, <text>,
    // <scroll-view>, etc. as Angular elements. Without it, the template would
    // fail compilation because those tags aren't known HTML elements and the
    // user hasn't yet added CUSTOM_ELEMENTS_SCHEMA (the build plugin injects
    // it automatically but the type-checker still surfaces template errors).
    const newPath = `${sourceRoot}/app/app.ts`;
    const content = `import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: '${prefix}-root',
  imports: [RouterOutlet, LYNX_ELEMENTS],
  template: \`
    <scroll-view scroll-orientation="vertical">
      <view style="padding: 24px; align-items: center;">
        <text style="font-size: 24px; font-weight: bold;">{{ title() }}</text>
        <text style="font-size: 14px; margin-top: 8px; color: #666;">
          Edit src/app/app.ts to get started
        </text>
        <router-outlet />
      </view>
    </scroll-view>
  \`,
})
export class App {
  title = signal('${projectName}');
}
`;
    if (tree.exists(newPath)) {
      tree.overwrite(newPath, content);
    } else {
      tree.create(newPath, content);
    }
  };
};

const deleteOldAppFiles = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    // Remove files generated by `ng new` that we don't need.
    // app.component.html/css/scss are dead once we inline the template above,
    // and the spec file references the deleted app.component.ts so it would
    // fail to compile if left behind. We don't try to migrate the user's
    // existing template/styles because this schematic is intended for fresh
    // `ng new` projects — running it on an established app is unsupported.
    for (const file of [
      `${sourceRoot}/app/app.component.html`,
      `${sourceRoot}/app/app.component.spec.ts`,
      `${sourceRoot}/app/app.component.css`,
      `${sourceRoot}/app/app.component.scss`,
    ]) {
      if (tree.exists(file)) {
        tree.delete(file);
      }
    }
  };
};

const updatePackageScripts = (): Rule => {
  return (tree: Tree) => {
    // `ng new` writes `ng serve` and `ng build` scripts that invoke the
    // Angular CLI's browser builder. AngularLynx builds via rspeedy (which
    // applies the rsbuild-plugin-angular-lynx plugin), so swap both scripts
    // to the rspeedy equivalents. The user's existing `test`/`lint` scripts
    // are left alone — they still work since they don't go through the
    // browser builder.
    const pkg = new JSONFile(tree, '/package.json');
    pkg.modify(['scripts', 'start'], 'rspeedy dev');
    pkg.modify(['scripts', 'build'], 'rspeedy build');
  };
};

const addCoreDependencies = (): Rule => {
  return chain([
    addDependency(
      '@blotch/rsbuild-plugin-angular-lynx',
      VERSIONS.rsbuildPluginAngularLynx,
      {
        type: DependencyType.Dev,
        install: InstallBehavior.Auto,
      },
    ),
    addDependency('@lynx-js/rspeedy', VERSIONS.rspeedy, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('@lynx-js/qrcode-rsbuild-plugin', VERSIONS.qrcodePlugin, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('@lynx-js/types', VERSIONS.lynxTypes, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
  ]);
};

const addTailwindConfig = (projectRoot: string): Rule => {
  return (tree: Tree) => {
    const configPath = `${projectRoot ? projectRoot + '/' : ''}tailwind.config.ts`;
    const content = `import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
};

export default config;
`;
    if (tree.exists(configPath)) {
      tree.overwrite(configPath, content);
    } else {
      tree.create(configPath, content);
    }
  };
};

const updateStylesCss = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    const cssPath = `${sourceRoot}/styles.css`;
    const scssPath = `${sourceRoot}/styles.scss`;
    const targetPath = tree.exists(scssPath) ? scssPath : cssPath;

    // Only @tailwind base + utilities — no @tailwind components. Lynx doesn't
    // support all of Tailwind's component-layer reset rules (e.g. button
    // resets that reference focus-visible, form input pseudo-classes), and
    // bundling them in would generate CSS the runtime can't parse, producing
    // diagnostic noise. The base layer ships with @lynx-js/tailwind-preset's
    // own Lynx-compatible normalize rules.
    const content = `@tailwind base;
@tailwind utilities;
`;

    if (tree.exists(targetPath)) {
      tree.overwrite(targetPath, content);
    } else {
      tree.create(cssPath, content);
    }
  };
};

const addTailwindDependencies = (): Rule => {
  return chain([
    addDependency('tailwindcss', VERSIONS.tailwindcss, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('@lynx-js/tailwind-preset', VERSIONS.tailwindPreset, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
  ]);
};
