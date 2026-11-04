import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRspeedy } from '@lynx-js/rspeedy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pluginAngularCliContext } from './angular-cli-context.js';
import { pluginAngularLynx } from './plugin-angular-lynx.js';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * TypeScript's CommonJS output, which marks itself as converted from an ES
 * module with `__esModule`, and has no `default` export. Its exports are set
 * in a loop, as TypeScript's `export *` (`__exportStar`) sets obscenity's, so
 * rspack can't see them and imports them through its dynamic interop. (A
 * build of `exports.DataSet = …` failed instead, with "export 'default' was
 * not found".)
 */
const COMMON_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const members = { DataSet: class DataSet {} };
for (const name in members) exports[name] = members[name];
`;

/**
 * An ES module wrapper over `COMMON_JS`, as obscenity's `dist/index.mjs` is:
 * its default import is the whole `module.exports` in Node and esbuild.
 */
const wrapper = (commonJsFile: string) => `import mod from './${commonJsFile}';
export default mod;
export const DataSet = mod.DataSet;
`;

/**
 * Builds an app that imports two ES module wrappers over CommonJS, through
 * the whole plugin, and runs its main-thread bundle: an `.mjs` wrapper, and a
 * `.js` one in a `"type": "module"` package.
 */
describe('a build importing an ES module wrapper over CommonJS', () => {
  let root: string;
  let appDir: string;

  beforeAll(() => {
    // The real path: the Angular compile's output is looked up by the path
    // it was compiled from, and rspack resolves modules to theirs.
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-strict-esm-')),
    );
    appDir = path.join(root, 'app');
    const files: Record<string, string> = {
      'app/angular.json': JSON.stringify({
        version: 1,
        projects: {
          app: {
            projectType: 'application',
            root: '',
            sourceRoot: 'src',
            architect: {
              build: { builder: '@blotch/angular-lynx-build:application' },
            },
          },
        },
      }),
      'app/tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
        },
        files: ['src/main.ts', 'src/wrappers.d.ts'],
      }),
      // Stands in for @blotch/angular-lynx, which is built after this
      // package's tests run: the generated background entry imports it.
      'app/src/runtime.js': `export const ɵstartBackgroundThread = () => {};
`,
      'app/src/main.ts': `import { DataSet as MjsDataSet } from 'mjs-wrapper';
import { DataSet as ModuleDataSet } from 'module-wrapper';

console.info(typeof MjsDataSet, typeof ModuleDataSet);
`,
      'app/src/wrappers.d.ts': `declare module 'mjs-wrapper';
declare module 'module-wrapper';
`,
      'app/node_modules/mjs-wrapper/package.json': JSON.stringify({
        name: 'mjs-wrapper',
        main: './index.js',
        exports: { import: './index.mjs', default: './index.js' },
      }),
      'app/node_modules/mjs-wrapper/index.js': COMMON_JS,
      'app/node_modules/mjs-wrapper/index.mjs': wrapper('index.js'),
      'app/node_modules/module-wrapper/package.json': JSON.stringify({
        name: 'module-wrapper',
        type: 'module',
        exports: './index.js',
      }),
      'app/node_modules/module-wrapper/index.cjs': COMMON_JS,
      'app/node_modules/module-wrapper/index.js': wrapper('index.cjs'),
    };
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Built as `javascript/auto`, each wrapper's default import was
  // `module.exports.default`, so reading `DataSet` threw "cannot read
  // property 'DataSet' of undefined" as the bundle loaded.
  it("imports each wrapper's CommonJS module whole, as Node does", async () => {
    const rspeedy = await createRspeedy({
      cwd: appDir,
      rspeedyConfig: {
        // A development build (`optimization: false`) keeps the main
        // thread's code in its own file next to the bundle.
        mode: 'development',
        // No hot update clients: run from source, they're TypeScript that
        // only the package's own build compiles.
        dev: { hmr: false },
        source: { entry: path.join(appDir, 'src/main.ts') },
        environments: { lynx: {} },
        resolve: {
          alias: {
            '@blotch/angular-lynx': path.join(appDir, 'src/runtime.js'),
            // The plugin adds its polyfills by their path in its build
            // output. Run from source, that path is next to
            // angular-config.ts instead.
            [path.join(SOURCE_DIR, 'utils/angular/polyfills')]: path.join(
              SOURCE_DIR,
              'polyfills.js',
            ),
          },
        },
        plugins: [
          pluginAngularCliContext({
            workspaceRoot: appDir,
            project: 'app',
            buildOptions: {
              browser: 'src/main.ts',
              tsConfig: 'tsconfig.json',
              optimization: false,
            },
          }),
          pluginAngularLynx(),
        ],
      },
    });
    const { close } = await rspeedy.build();
    await close();

    const logged: unknown[][] = [];
    const noop = () => {};
    vm.runInNewContext(
      fs.readFileSync(path.join(appDir, 'dist/main/main-thread.js'), 'utf8'),
      {
        console: {
          info: (...args: unknown[]) => logged.push(args),
          log: noop,
          warn: noop,
          error: noop,
        },
      },
    );

    expect(logged).toEqual([['function', 'function']]);
  }, 120_000);
});
