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
import type { JsonObject, JsonValue } from '@angular-devkit/core';
import { JSONFile } from '@schematics/angular/utility/json-file';
import {
  getWorkspace,
  updateWorkspace,
} from '@schematics/angular/utility/workspace';

import { useLynxExtractI18n } from '../utility/extract-i18n-target';
import type { Schema } from './schema';
import { VERSIONS, ownVersionRange } from './versions';

/**
 * Transforms a standard `ng new` Angular project into a Lynx-native application.
 * The schematic replaces browser-specific bootstrap (main.ts, app.config.ts,
 * app.component.ts) with Lynx equivalents, points `ng build`, `ng serve`,
 * `ng test` and `ng extract-i18n` at the AngularLynx builders and
 * `ng generate` at its schematics, and optionally sets up Tailwind with the
 * Lynx preset. Everything else stays as `ng new` left it: the app needs no
 * build config besides angular.json.
 * This is a one-shot destructive transform — the old browser-Angular files
 * are deleted because they reference DOM APIs and HTML elements that don't
 * exist on the Lynx runtime.
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
    // The tsconfig the app is built with. `ng new` points the build target's
    // `tsConfig` at tsconfig.app.json.
    const buildTsConfig = project.targets.get('build')?.options?.['tsConfig'];
    const appTsconfig =
      typeof buildTsConfig === 'string'
        ? buildTsConfig
        : `${projectRoot ? projectRoot + '/' : ''}tsconfig.app.json`;

    const rules: Rule[] = [
      addTemplateFiles(projectRoot, sourceRoot),
      replaceMainTs(sourceRoot),
      replaceAppConfig(sourceRoot),
      replaceApp(sourceRoot, prefix, projectName),
      deleteOldAppFiles(sourceRoot),
      excludeTestFilesFromAppBuild(appTsconfig),
      includeTestFilesInSpecTsconfig(
        `${projectRoot ? projectRoot + '/' : ''}tsconfig.spec.json`,
      ),
      useLynxBuilders(projectName),
      useLynxSchematics(),
      updatePackageScripts(),
      addCoreDependencies(),
    ];

    // `"false"` is how `ng add ... --tailwind=false` arrives (see schema.ts).
    if (options.tailwind !== false && options.tailwind !== 'false') {
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
    // idempotent so re-running it should refresh the template files
    // (src/rspeedy-env.d.ts) to the package's current version. Default merge
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
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';

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
    // `ng new` before Angular 20 generated app.component.ts — delete it and
    // create app.ts. The Angular 2025 style guide drops the `.component`
    // suffix, and AngularLynx's component schematic follows the same
    // convention so the bootstrap component should too.
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
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

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
    // The root component's template and styles are dead once we inline the
    // template above, and its spec tests the browser template we replaced, so
    // it would fail if left behind. Angular 20+ names them app.html, app.css
    // and app.spec.ts; earlier versions used an `app.component.` prefix. We
    // don't try to migrate the user's existing template/styles because this
    // schematic is intended for fresh `ng new` projects — running it on an
    // established app is unsupported.
    for (const file of [
      `${sourceRoot}/app/app.html`,
      `${sourceRoot}/app/app.spec.ts`,
      `${sourceRoot}/app/app.css`,
      `${sourceRoot}/app/app.scss`,
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

const excludeTestFilesFromAppBuild = (tsconfigPath: string): Rule => {
  return (tree: Tree) => {
    // `ng new` excludes `*.spec.ts` from the app build, but AngularLynx's
    // component and add-testing schematics name tests `*.test.ts`. Left
    // in, the Rsbuild plugin compiles every test file into the app, and a
    // test importing the testing library (a devDependency the app bundle
    // can't resolve) produces build errors.
    if (!tree.exists(tsconfigPath)) {
      return;
    }
    const tsconfig = new JSONFile(tree, tsconfigPath);
    const exclude = tsconfig.get(['exclude']);
    const patterns = Array.isArray(exclude) ? (exclude as string[]) : [];
    if (!patterns.includes('src/**/*.test.ts')) {
      tsconfig.modify(['exclude'], [...patterns, 'src/**/*.test.ts']);
    }
  };
};

const includeTestFilesInSpecTsconfig = (tsconfigPath: string): Rule => {
  return (tree: Tree) => {
    // `ng test` compiles `*.test.ts` files alongside `ng new`'s `*.spec.ts`
    // ones, and AngularLynx's schematics name tests `*.test.ts`. Listed in
    // tsconfig.spec.json, editors type-check them with the test types
    // (vitest/globals) instead of treating them as files of no project.
    if (!tree.exists(tsconfigPath)) {
      return;
    }
    const tsconfig = new JSONFile(tree, tsconfigPath);
    const include = tsconfig.get(['include']);
    if (Array.isArray(include) && !include.includes('src/**/*.test.ts')) {
      tsconfig.modify(
        ['include'],
        [...(include as string[]), 'src/**/*.test.ts'],
      );
    }
  };
};

/**
 * Angular compiler options from `ng new`'s build target that the Lynx builder
 * accepts (see @blotch/angular-lynx-build's builders/application/schema.json).
 * @blotch/rsbuild-plugin-angular-lynx and `ng test` read them from
 * angular.json; anything else, such as options only the browser builder
 * knows, would fail the builder's option validation. `optimization` also picks
 * the bundle's production or development mode.
 */
const ANGULAR_BUILD_OPTIONS = new Set([
  'browser',
  'tsConfig',
  'polyfills',
  'styles',
  'assets',
  'scripts',
  'inlineStyleLanguage',
  'fileReplacements',
  'aot',
  'optimization',
  'sourceMap',
  'outputHashing',
  'i18nMissingTranslation',
  'budgets',
  'extractLicenses',
  'outputPath',
  'index',
]);

const keepAngularOptions = (
  options: Record<string, JsonValue | undefined> | undefined,
): Record<string, JsonValue | undefined> =>
  Object.fromEntries(
    Object.entries(options ?? {}).filter(([key]) =>
      ANGULAR_BUILD_OPTIONS.has(key),
    ),
  );

/**
 * Options of Angular's dev server that the Lynx dev server accepts too (see
 * @blotch/angular-lynx-build's builders/dev-server/schema.json).
 */
const DEV_SERVER_OPTIONS = new Set(['buildTarget', 'port', 'host']);

const keepDevServerOptions = (
  options: Record<string, JsonValue | undefined> | undefined,
): Record<string, JsonValue | undefined> =>
  Object.fromEntries(
    Object.entries(options ?? {}).filter(([key]) =>
      DEV_SERVER_OPTIONS.has(key),
    ),
  );

/**
 * `ng new`'s initial-bundle budget, sized for a web app's first download.
 */
const NG_NEW_INITIAL_BUDGET = { maximumWarning: '500kB', maximumError: '1MB' };

/**
 * The initial-bundle budget for a Lynx bundle. It carries more than a web
 * app's first download: Angular runs on both of Lynx's threads, so the
 * framework is in it twice, and a new app's bundle is already about 1 MB.
 * Kept at roughly the same multiples of a new app as Angular's budget.
 */
const LYNX_INITIAL_BUDGET = { maximumWarning: '2MB', maximumError: '5MB' };

/**
 * A configuration's options with `ng new`'s initial-bundle budget resized for
 * a Lynx bundle. Budgets the user set differently stay as they are.
 */
const withLynxBudgets = (
  options: Record<string, JsonValue | undefined>,
): Record<string, JsonValue | undefined> => {
  if (!Array.isArray(options['budgets'])) {
    return options;
  }
  return {
    ...options,
    budgets: (options['budgets'] as JsonObject[]).map((budget) =>
      budget['type'] === 'initial' &&
      budget['maximumWarning'] === NG_NEW_INITIAL_BUDGET.maximumWarning &&
      budget['maximumError'] === NG_NEW_INITIAL_BUDGET.maximumError
        ? { ...budget, ...LYNX_INITIAL_BUDGET }
        : budget,
    ),
  };
};

/**
 * Points `ng build`, `ng serve`, `ng test` and `ng extract-i18n` at the
 * AngularLynx builders. The first two run rspeedy with
 * @blotch/rsbuild-plugin-angular-lynx added, and
 * `ng build --platform ios|android` also produces the native app; the other
 * two run Angular's unit-test and extract-i18n builders set up for Lynx. The
 * build target keeps `ng new`'s Angular compiler options, which the build
 * plugin, `ng test` and `ng extract-i18n` read, and gains the app's identity
 * for native builds.
 */
const useLynxBuilders = (projectName: string): Rule =>
  updateWorkspace((workspace) => {
    const project = workspace.projects.get(projectName)!;
    const build = project.targets.get('build');
    const configurations = Object.fromEntries(
      Object.entries(build?.configurations ?? {}).map(([name, options]) => [
        name,
        withLynxBudgets(keepAngularOptions(options)),
      ]),
    );
    const buildDefinition = {
      builder: '@blotch/angular-lynx-build:application',
      options: {
        ...keepAngularOptions(build?.options),
        appName: projectName,
        // A placeholder the user replaces before publishing: the stores
        // identify the app by it, and it can't change after the first upload.
        appId: `com.example.${projectName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app'}`,
      },
      configurations,
      defaultConfiguration: build?.defaultConfiguration ?? 'production',
    };
    if (build) {
      project.targets.delete('build');
    }
    project.targets.add({ name: 'build', ...buildDefinition });

    // The Lynx dev server takes `buildTarget` like Angular's, so `ng new`'s
    // configurations (production and development, each naming its build
    // configuration) carry over, and `ng serve -c production` keeps working.
    // Options only the browser dev server knows (ssl, proxyConfig, ...) are
    // dropped: they would fail the builder's option validation.
    // Without a serve target to keep, write the one `ng new` would have, for
    // the build configurations that exist. Without a development one, serve
    // the build target's default configuration rather than the dev server's
    // default (`::development`), which would point at nothing.
    const serve = project.targets.get('serve');
    const serveConfigurations = Object.fromEntries(
      Object.entries(
        serve?.configurations ??
          Object.fromEntries(
            ['production', 'development']
              .filter((name) => name in configurations)
              .map((name) => [
                name,
                { buildTarget: `${projectName}:build:${name}` },
              ]),
          ),
      ).map(([name, options]) => [name, keepDevServerOptions(options)]),
    );
    const serveDefinition = serve
      ? {
          builder: '@blotch/angular-lynx-build:dev-server',
          options: keepDevServerOptions(serve.options),
          configurations: serveConfigurations,
          defaultConfiguration: serve.defaultConfiguration,
        }
      : {
          builder: '@blotch/angular-lynx-build:dev-server',
          options:
            'development' in serveConfigurations
              ? {}
              : { buildTarget: `${projectName}:build` },
          configurations: serveConfigurations,
          defaultConfiguration:
            'development' in serveConfigurations ? 'development' : undefined,
        };
    if (serve) {
      project.targets.delete('serve');
    }
    project.targets.add({ name: 'serve', ...serveDefinition });

    // The Lynx unit-test builder is Angular's, set up for Lynx, so it takes
    // the same options and `ng new`'s carry over (as do its own, when `ng add`
    // runs again). Any other test builder (Karma, from older `ng new`
    // versions) can't run Lynx code; its options don't apply.
    const test = project.targets.get('test');
    const keepTest =
      test?.builder === '@angular/build:unit-test' ||
      test?.builder === '@blotch/angular-lynx-build:unit-test';
    if (test) {
      project.targets.delete('test');
    }
    project.targets.add({
      name: 'test',
      builder: '@blotch/angular-lynx-build:unit-test',
      ...(keepTest && {
        options: test.options,
        configurations: test.configurations,
        defaultConfiguration: test.defaultConfiguration,
      }),
    });

    useLynxExtractI18n(project);
  });

/**
 * Makes `ng generate` reach AngularLynx's schematics first, so
 * `ng generate component` makes a component with Lynx elements. Angular's own
 * collection stays after it: AngularLynx only has the schematics that differ
 * on Lynx, and `ng generate service`, `pipe`, `guard` and the rest come from
 * Angular's as before.
 */
const useLynxSchematics = (): Rule =>
  updateWorkspace((workspace) => {
    const cli = (workspace.extensions['cli'] ?? {}) as JsonObject;
    const collections = Array.isArray(cli['schematicCollections'])
      ? (cli['schematicCollections'] as string[])
      : // What Angular CLI uses when the list isn't set.
        ['@schematics/angular'];
    workspace.extensions['cli'] = {
      ...cli,
      schematicCollections: [
        '@blotch/angular-lynx',
        ...collections.filter(
          (collection) => collection !== '@blotch/angular-lynx',
        ),
      ],
    };
  });

const updatePackageScripts = (): Rule => {
  return (tree: Tree) => {
    // `npm start` and `npm run build` go through the Angular CLI, which runs
    // the AngularLynx builders set up by useLynxBuilders. `ng new` already
    // writes these (and `npm test` as `ng test`); this keeps them for
    // projects whose scripts called rspeedy directly.
    const pkg = new JSONFile(tree, '/package.json');
    pkg.modify(['scripts', 'start'], 'ng serve');
    pkg.modify(['scripts', 'build'], 'ng build');
  };
};

const addCoreDependencies = (): Rule => {
  return chain([
    // The `ng build`, `ng serve` and `ng test` builders, the one build
    // dependency an AngularLynx app needs, as `@angular/build` is for a web
    // app. They bring rspeedy, the rsbuild plugin that compiles Angular, the
    // QR code plugin and the iOS and Android app builder with them. Taken at
    // this package's own release, which they were tested with.
    addDependency('@blotch/angular-lynx-build', ownVersionRange(), {
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
  content: ['./src/**/*.{html,ts}'],
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
