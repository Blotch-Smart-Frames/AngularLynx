import fs from 'node:fs';
import path from 'node:path';
import { definesCrossThreadValues } from './cross-thread-transform.js';

const RUNTIME_MODULE = '@blotch/angular-lynx';

/**
 * The background half of each bundle starts from a module this file
 * generates, not from the app's own entry.
 *
 * Angular runs on the main thread only (issue #81). The background thread
 * needs three things from the bundle:
 *
 * - **the runtime**, whose module-level code installs the background half of
 *   each bridge (the call relay, the log relay, the exposure bridge and so on);
 * - **each module-level `backgroundFn()`**, so the function registers there;
 * - **each module-level `createMainThreadRef()` / `new MainThreadRef()`**, so a
 *   ref the main thread passes to a background function arrives as the
 *   background thread's copy.
 *
 * Starting from `main.ts` reached every component, the router and Angular
 * itself, which the background thread evaluated on every launch and never ran
 * (issue #84). The generated entry imports the runtime and the modules that
 * make those calls, and nothing else. They load at startup, so a background
 * function in a lazy route's file is there before the route is.
 *
 * The modules are the app's own files, found in Angular's compiled output, and
 * the files of any installed package that depends on the runtime (see
 * {@link findLibraryBackgroundModules}).
 */
export type BackgroundEntries = {
  /**
   * The file the background half of `entryName` starts from, in
   * `environmentName`. Created with the runtime alone if it doesn't exist yet,
   * so the entry resolves even before the first compile has written it.
   */
  fileFor: (environmentName: string, entryName: string) => string;
  /**
   * Whether `file` is one of the background entry's modules: a file it
   * imports. entry.ts marks them as having side effects in the background
   * layer, because the entry imports them only for their side effects and a
   * package's `"sideEffects": false` would otherwise drop them.
   */
  isBackgroundModule: (file: string) => boolean;
  /** Whether `file` is one of the generated entries. */
  isEntryFile: (file: string) => boolean;
  /**
   * Writes `environmentName`'s entry files for the compile about to start.
   *
   * @returns The files whose contents changed. The caller adds them to the
   *   compiler's `modifiedFiles`, so rspack rebuilds them in this compile.
   */
  update: (
    environmentName: string,
    options: {
      /** The app's modules that define a cross-thread value. */
      appModules: Iterable<string>;
      /**
       * Set for a watch build's compiles. The entry then also changes on every
       * compile with {@link rebuilt} set: see {@link renderBackgroundEntry}.
       */
      watch: boolean;
      /** Whether something the bundle is built from changed. */
      rebuilt: boolean;
    },
  ) => string[];
};

export const createBackgroundEntries = ({
  rootPath,
  findLibraryModules = findLibraryBackgroundModules,
}: {
  rootPath: string;
  findLibraryModules?: (rootPath: string) => string[];
}): BackgroundEntries => {
  const cacheDir = path.join(
    rootPath,
    'node_modules',
    '.cache',
    'angular-lynx',
    'background-entries',
  );
  const files = new Map<string, Set<string>>();
  // Packages don't change while a watch build runs, so they're scanned once.
  let libraryModules: string[] | undefined;
  const getLibraryModules = (): string[] =>
    (libraryModules ??= findLibraryModules(rootPath));
  let modules = new Set<string>();
  // Counts the compiles each environment's watch build rebuilt something in.
  const rebuilds = new Map<string, number>();

  return {
    fileFor: (environmentName, entryName) => {
      const file = path.join(cacheDir, environmentName, `${entryName}.js`);
      let environmentFiles = files.get(environmentName);
      if (!environmentFiles) {
        environmentFiles = new Set();
        files.set(environmentName, environmentFiles);
      }
      environmentFiles.add(file);
      if (!fs.existsSync(file)) {
        writeIfChanged(file, renderBackgroundEntry({ modules: [] }));
      }
      return file;
    },
    isBackgroundModule: (file) => modules.has(file),
    isEntryFile: (file) =>
      [...files.values()].some((environmentFiles) =>
        environmentFiles.has(file),
      ),
    update: (environmentName, { appModules, watch, rebuilt }) => {
      modules = new Set([...getLibraryModules(), ...[...appModules].sort()]);
      const rebuild =
        (rebuilds.get(environmentName) ?? 0) + (watch && rebuilt ? 1 : 0);
      rebuilds.set(environmentName, rebuild);
      const contents = renderBackgroundEntry({
        modules: [...modules],
        rebuild: watch ? rebuild : undefined,
      });
      return [...(files.get(environmentName) ?? [])].filter((file) =>
        writeIfChanged(file, contents),
      );
    },
  };
};

/**
 * The background entry's source.
 *
 * @param options.modules - The files to import, in order.
 * @param options.rebuild - In a watch build, the number of compiles so far
 *   that rebuilt something. It's written into the entry so that every such
 *   compile changes the background bundle. The main thread doesn't run
 *   webpack's HMR runtime (issue #9), so a hot update only reaches the
 *   background thread, and an edit to a component would otherwise give it
 *   nothing to apply: the HMR client would report the app up to date and keep
 *   showing the old screen. With the entry changed, the update reaches a
 *   module that doesn't accept it, so it aborts, and the client falls back to
 *   a full reload, as it did when the background bundle held the whole app.
 */
export const renderBackgroundEntry = ({
  modules,
  rebuild,
}: {
  modules: readonly string[];
  rebuild?: number;
}): string => {
  const lines = [
    "// The background thread's entry, generated by",
    '// @blotch/rsbuild-plugin-angular-lynx (see background-entry.ts there).',
    '// Angular runs on the main thread only, so the background thread loads the',
    '// runtime and the modules that call backgroundFn(), createMainThreadRef()',
    '// or new MainThreadRef() at module level.',
    `import { ɵstartBackgroundThread } from '${RUNTIME_MODULE}';`,
    ...modules.map((file) => `import ${JSON.stringify(file)};`),
    'ɵstartBackgroundThread();',
  ];
  if (rebuild !== undefined) {
    lines.push(`// Rebuild ${rebuild}`);
  }
  return `${lines.join('\n')}\n`;
};

/**
 * Writes `contents` unless the file already has them.
 */
const writeIfChanged = (file: string, contents: string): boolean => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return true;
};

const JS_FILE = /\.[cm]?js$/;

/**
 * The files in installed packages that define a cross-thread value at module
 * level, such as a UI library with its own background functions.
 *
 * A package can only call the runtime's functions if it depends on the runtime,
 * so only the packages whose `package.json` lists `@blotch/angular-lynx` (as a
 * dependency, peer dependency or optional dependency) are read: every one of
 * their JavaScript files, outside nested `node_modules` folders. Packages are
 * found by walking the dependencies from the app's `package.json`, resolved as
 * Node does, so a nested or hoisted copy is found where the app's build
 * finds it.
 *
 * @param rootPath - The app's directory, which holds its `package.json`.
 * @returns The files' real paths, sorted.
 */
export const findLibraryBackgroundModules = (rootPath: string): string[] => {
  const found = new Set<string>();
  const visited = new Set<string>();

  const visit = (packageDir: string, isApp: boolean): void => {
    const manifest = readManifest(packageDir);
    if (!manifest) return;
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      // The app's dev dependencies are installed too; a package's aren't.
      ...(isApp ? Object.keys(manifest.devDependencies ?? {}) : []),
    ]);
    names.delete(RUNTIME_MODULE);
    for (const name of names) {
      const dependencyDir = resolvePackageDir(name, packageDir);
      if (!dependencyDir || visited.has(dependencyDir)) continue;
      visited.add(dependencyDir);
      const dependency = readManifest(dependencyDir);
      if (dependency && dependsOnRuntime(dependency)) {
        for (const file of listJsFiles(dependencyDir)) {
          if (definesCrossThreadValues(fs.readFileSync(file, 'utf8'), file)) {
            found.add(file);
          }
        }
      }
      visit(dependencyDir, false);
    }
  };
  visit(rootPath, true);
  return [...found].sort();
};

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const readManifest = (packageDir: string): Manifest | undefined => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    ) as Manifest;
  } catch {
    return undefined;
  }
};

const dependsOnRuntime = (manifest: Manifest): boolean =>
  [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].some((dependencies) => dependencies?.[RUNTIME_MODULE] !== undefined);

/**
 * The real path of the directory `name` resolves to from `fromDir`, looking in
 * each `node_modules` folder up from it, as Node does. Read directly rather
 * than through `require.resolve`, which a package's `exports` can refuse
 * `package.json` to.
 */
const resolvePackageDir = (
  name: string,
  fromDir: string,
): string | undefined => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate);
    }
    if (path.dirname(dir) === dir) return undefined;
  }
};

/**
 * The package's JavaScript files, outside nested `node_modules` folders.
 */
const listJsFiles = (packageDir: string): string[] =>
  fs
    .readdirSync(packageDir, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) =>
        JS_FILE.test(file) && !file.split(path.sep).includes('node_modules'),
    )
    .map((file) => path.join(packageDir, file));
