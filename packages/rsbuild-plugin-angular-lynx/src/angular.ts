import fs from 'node:fs';
import path from 'node:path';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { Compiler } from '@rspack/core';
import {
  type AngularCompileResult,
  createAngularRebuildCoordinator,
} from './angular-rebuild-coordinator.js';
import type { BackgroundEntries } from './background-entry.js';
import { applyBudgets } from './budgets-plugin.js';
import { LAYERS } from './layers.js';
import { buildLynxSchemaSourceFileCache } from './build-schema-source-file-cache.js';
import {
  createTransformStylesheet,
  forgetComponentStyleSizes,
} from './component-styles-cache.js';
import {
  extractComponentStyles,
  writeModuleStylesheets,
} from './component-styles.js';
import {
  type AngularDiagnostics,
  filterAngularDiagnostics,
  toAngularDiagnosticError,
} from './angular-diagnostics.js';
import { wrapPureClasses } from './pure-classes.js';
import { seedCompilationSourceFiles } from './seed-compilation-source-files.js';
import { addEntryHotAccept, hotUpdatesEnabled } from './hot-updates.js';
import {
  buildTransformedCode,
  type ModuleStylesheets,
} from './transform-module.js';
import {
  definesCrossThreadValues,
  transformCrossThread,
} from './cross-thread-transform.js';
import { transformWorklets } from './worklet-transform.js';
import { getAngularCliContext } from './angular-cli-context.js';
import { applyAngularConfig } from './utils/angular/angular-config.js';
import {
  createAngularCompilation,
  DiagnosticModes,
  JavaScriptTransformer,
} from './utils/angular/build-internals.js';
import type { ComponentStyleSize } from './utils/angular/budgets.js';
import { maxWorkers, useTypeChecking } from './utils/angular/env.js';
import { getAngularWorkspace } from './utils/angular/read-workspace.js';
import { resolvePrimaryBuild } from './utils/angular/resolve-primary-build.js';
import { resolvePages } from './utils/angular/resolve-pages.js';
import {
  reportLynxDiagnostics,
  scanCompiledOutputForHtmlElements,
  scanCompiledOutputForStructuralIssues,
  scanSourcesForUnsupportedCss,
  scanSourcesForUnsupportedPatterns,
} from './lynx-diagnostics.js';
import type { NormalizedPluginAngularLynxOptions } from './utils/options.js';

/**
 * Wires Angular's AOT/JIT compilation pipeline into the rsbuild/rspack build
 * graph. This is the heart of the AngularLynx build — it bridges three worlds:
 *
 *   1. **Angular's compiler** (`@angular/build`) — runs `createAngularCompilation`
 *      to type-check templates, transform component metadata, and emit JS+CSS.
 *   2. **Lynx's native element model** — Angular's template type-checker has
 *      no knowledge of `<view>`, `<text>`, `<scroll-view>`, etc., so we inject
 *      CUSTOM_ELEMENTS_SCHEMA into every @Component-bearing source file before
 *      Angular's compiler sees it (see build-schema-source-file-cache.ts).
 *   3. **rspack's loader pipeline** — Angular emits transformed output into a
 *      `typeScriptFileCache`; the `api.transform()` hook below intercepts every
 *      `.ts`/`.js` request and serves the precompiled content instead of
 *      letting rspack try to parse the original TypeScript.
 *
 * The flow runs before every environment build, including watch rebuilds:
 *   onBeforeEnvironmentCompile → angular-rebuild-coordinator (dedupe + serialize)
 *     → buildLynxSchemaSourceFileCache (schema inject)
 *     → compilation.update (rebuilds only: invalidate the changed files)
 *     → compilation.initialize (Angular AOT walk + transformStylesheet callback)
 *     → emitAffectedFiles (refreshes typeScriptFileCache)
 *     → diagnoseFiles (filtered to suppress Lynx-element false positives, then
 *       reported as rspack errors/warnings so type errors fail the build)
 *     → rspack rebuilds the changed files plus any whose compiled output changed
 *
 * Then for each module request the `api.transform` hook delegates the per-module
 * string transform (import-prepend + ɵcmp.id + worklet) to
 * `buildTransformedCode` in transform-module.ts.
 */
export const applyAngularRules = async (
  api: RsbuildPluginAPI,
  pluginOptions: NormalizedPluginAngularLynxOptions,
  backgroundEntries: BackgroundEntries,
  appEntries: ReadonlySet<string>,
): Promise<void> => {
  // Set under `ng build` / `ng serve`: the project being built and its build
  // options as Angular CLI resolved them. Plain rspeedy reads angular.json.
  const cli = getAngularCliContext(api);
  const { basePath, workspace } = await getAngularWorkspace(cli?.workspaceRoot);

  // When `pages` is set, resolve multiple angular.json projects into entries.
  // Each project's `browser` field becomes a named entry that the entry-splitting
  // loop in entry.ts will duplicate into main-thread + background pairs.
  if (pluginOptions.pages) {
    const pages = resolvePages(workspace, basePath, pluginOptions.pages);
    api.modifyRsbuildConfig((config) => {
      config.source ??= {};
      config.source.entry = Object.fromEntries(
        pages.map((page) => [page.name, page.browser]),
      );
    });
  }

  // The primary project provides shared build config (tsconfig, polyfills,
  // styles, output path).
  const { buildOptions } = await resolvePrimaryBuild({
    workspace,
    basePath,
    pages: pluginOptions.pages,
    cli,
  });
  applyAngularConfig(api, buildOptions);
  // The compiled size of each component stylesheet, which `transformStylesheet`
  // records on every compile, for `anyComponentStyle` budgets.
  const componentStyleSizes = new Map<string, ComponentStyleSize>();
  applyBudgets(api, {
    budgets: buildOptions.budgets,
    componentStyleSizes,
    underAngularCli: cli !== undefined,
  });
  const sourcemap = !!(
    !!buildOptions.sourcemapOptions.scripts &&
    (buildOptions.sourcemapOptions.hidden ? 'external' : true)
  );
  const thirdPartySourcemaps = buildOptions.sourcemapOptions.vendor;
  const advancedOptimizations = buildOptions.advancedOptimizations;
  const aot = buildOptions.aot;
  const javascriptTransformer = new JavaScriptTransformer(
    {
      sourcemap,
      thirdPartySourcemaps,
      advancedOptimizations,
      jit: !aot,
      // Angular 22.2 folded the former positional `maxThreads` argument into
      // the options; it sizes the worker pool the same way.
      maxConcurrency: maxWorkers,
    },
    undefined,
  );
  const tsconfig = buildOptions.tsconfig;
  const compilation = await createAngularCompilation(false, aot);
  // typeScriptFileCache holds the *already-compiled* JS for every TS source
  // emitted by Angular. The rspack loader (api.transform below) reads from here
  // instead of running tsc/esbuild itself — Angular has already done the work
  // including template compilation, component metadata generation, and DI
  // ɵfac wiring, none of which a plain TS transpile would reproduce.
  const typeScriptFileCache = new Map<string, string | Uint8Array>();
  // Write component CSS to a cache directory instead of next to source files.
  // The bundler resolves them via relative imports computed by path.relative().
  // Using node_modules/.cache means the files are gitignored by default and
  // cleared on `npm install` if cache invalidation is needed.
  const componentCssCacheDir = path.join(
    basePath,
    'node_modules',
    '.cache',
    'angular-lynx-css',
  );
  fs.mkdirSync(componentCssCacheDir, { recursive: true });

  // The CSS files extracted from each compiled module's components, and their
  // scope IDs, keyed by source file (see component-styles.ts). The loader
  // imports the files and ties the scope IDs to the components.
  const moduleStylesheets = new Map<string, ModuleStylesheets>();
  // Template and stylesheet files each component reads, keyed by the
  // component's source file. The loader registers them as dependencies so
  // rspack watches them: editing an external template must rebuild the
  // component that uses it.
  let componentResourceDependencies = new Map<string, readonly string[]>();
  // Component CSS files rewritten during the current compile. They change after
  // rspack's watcher collected the edit, so they're reported as changed
  // outputs to make rspack pick them up in the same rebuild.
  const writtenStylesheets = new Set<string>();
  // Project files seen by the previous compile. A rebuild re-parses only new
  // or changed files for schema injection instead of every component.
  let knownSourceFiles = new Set<string>();
  // The compiled modules that call backgroundFn(), createMainThreadRef() or
  // new MainThreadRef() at module level, which the background entry imports
  // (background-entry.ts). Kept up to date from each compile's output.
  const backgroundModules = new Set<string>();
  // The files the latest compile read: program sources and the templates and
  // stylesheets components use.
  let angularInputs = new Set<string>();
  // Type and template diagnostics from the most recent Angular compile. They
  // stay until the next compile, because a rebuild that doesn't recompile
  // (e.g. a global CSS edit) still contains the code they point at.
  let angularDiagnostics: AngularDiagnostics = { errors: [], warnings: [] };

  const transformStylesheet = createTransformStylesheet({
    basePath,
    componentStyleSizes,
  });

  /**
   * Runs one Angular compile and refreshes `typeScriptFileCache`.
   * `changedFiles` is `undefined` for the initial full compile.
   */
  const compileAngular = async (
    changedFiles: ReadonlySet<string> | undefined,
  ): Promise<AngularCompileResult> => {
    // Pre-populate Angular's sourceFileCache with schema-injected TypeScript source
    // so that Angular's template type-checker never errors on Lynx native elements
    // (<view>, <text>, <scroll-view>, etc.) — users don't need CUSTOM_ELEMENTS_SCHEMA
    // in every component.
    const { sourceFileCache, fileNames } = buildLynxSchemaSourceFileCache(
      tsconfig,
      changedFiles &&
        ((file) =>
          changedFiles.has(path.normalize(file)) ||
          !knownSourceFiles.has(file)),
    );
    knownSourceFiles = new Set(fileNames);

    if (changedFiles) {
      // Evicts Angular's cached copies of the changed files. For the default
      // ParallelCompilation this is also the only way to tell its worker what
      // changed; the worker ignores `hostOptions.modifiedFiles` below.
      await compilation.update?.(new Set(changedFiles));
    }
    // Angular 22.2 removed `hostOptions.sourceFileCache`; the cache now lives
    // on the compilation, so seed it there before initialize() builds the host.
    // Seeding has to follow update(), which would evict the fresh copies.
    const seeded = seedCompilationSourceFiles(compilation, sourceFileCache);
    const seededFiles = new Set(
      seeded
        ? [...sourceFileCache.keys()].map((file) => path.normalize(file))
        : [],
    );

    writtenStylesheets.clear();
    let result: Awaited<ReturnType<typeof compilation.initialize>>;
    try {
      result = await compilation.initialize(
        tsconfig,
        {
          processWebWorker: (workerFile, _containingFile) => {
            return workerFile;
          },
          transformStylesheet,
          // Angular reads this to find changed templates and stylesheets. An
          // in-process compilation also evicts these files from its source
          // cache again, so the files just seeded are left out to keep their
          // schema-injected copies.
          modifiedFiles:
            changedFiles &&
            new Set([...changedFiles].filter((file) => !seededFiles.has(file))),
        },
        // Angular 22.2 replaced the compiler-options transformer callback with
        // declarative overrides. `transformCompilerOptions()` in @angular/build
        // now applies what the callback used to set by hand: noEmitOnError=false,
        // inlineSources/inlineSourceMap from `sourcemap`, and clearing
        // sourceMap/mapRoot/sourceRoot so maps stay inline for rspack to consume.
        {
          sourcemap: !!sourcemap,
          preserveSymlinks: false,
          // Do NOT set enableHmr here (it maps to _enableHmr). That flag is for Angular's
          // esbuild build path: it makes the AOT compiler emit AppComponent_HmrLoad()
          // functions that call ɵɵgetReplaceMetadataURL(), which constructs
          // `new URL('...', 'file:///src/...')`. Lynx's URL implementation rejects file://
          // as a base URL, crashing on startup. Additionally, _enableHmr requires the dev
          // server to serve Angular's HMR update modules at /__angular_hmr/* endpoints —
          // infrastructure we don't yet provide. Component-level Angular HMR would need a
          // custom endpoint in the Lynx dev server and a runtime that applies
          // templateUpdates from compilation.initialize(). Live reload works without
          // this: webpack falls back to a full CDP Page.reload when no module calls
          // module.hot.accept().
        },
      );
    } catch (error) {
      // Do NOT swallow initialization failures. `compilation.initialize()`
      // drives Angular's worker pool (piscina), which can reject if a worker
      // dies under CPU/memory pressure — a real risk in CI where many example
      // builds run concurrently. When it was swallowed, `#state` was never set
      // on the AotCompilation, so the later `diagnoseFiles()` call asserted
      // "Angular compilation must be initialized prior to collecting
      // diagnostics" — a cryptic message that hid the true cause. Re-throw with
      // actionable context so the real failure surfaces and the misleading
      // downstream assertion never runs (the code below depends on a
      // successful init and is unreachable once we throw here).
      throw new Error(
        `Angular compilation failed to initialize for "${tsconfig}". ` +
          `This often means a compiler worker crashed under resource pressure — ` +
          `lower NG_BUILD_MAX_WORKERS or reduce parallel build concurrency. ` +
          `Original error: ${
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error)
          }`,
      );
    }
    componentResourceDependencies = new Map(
      [...(result.componentResourcesDependencies ?? [])].map(
        ([file, dependencies]) => [
          path.normalize(file),
          dependencies.map((dependency) => path.normalize(dependency)),
        ],
      ),
    );

    const changedOutputs = new Set<string>();
    try {
      for (const {
        filename,
        contents,
      } of await compilation.emitAffectedFiles()) {
        // emitAffectedFiles is incremental — on the first build it returns
        // every project file; on rebuilds only the files whose contents or
        // transitive template dependencies changed. The cache is therefore
        // additive and survives across builds, which is what makes dev-mode
        // rebuilds fast.
        const file = path.normalize(filename);
        // Lynx can't add CSS at runtime, so each component's styles leave the
        // compiled code here and ship as CSS files the module imports.
        const { code, components } = extractComponentStyles(
          typeof contents === 'string'
            ? contents
            : Buffer.from(contents).toString(),
          file,
        );
        const stylesheets = writeModuleStylesheets({
          basePath,
          cacheDir: componentCssCacheDir,
          fileName: file,
          components,
          onWritten: (filePath) => writtenStylesheets.add(filePath),
        });
        if (stylesheets) {
          moduleStylesheets.set(file, stylesheets);
        } else {
          moduleStylesheets.delete(file);
        }
        if (typeScriptFileCache.get(file) !== code) {
          changedOutputs.add(file);
          if (definesCrossThreadValues(code, file)) {
            backgroundModules.add(file);
          } else {
            backgroundModules.delete(file);
          }
        }
        typeScriptFileCache.set(file, code);
      }
    } catch (error) {
      // Same rationale as initialize(): emitAffectedFiles also runs on the
      // worker pool. Swallowing a failure here left typeScriptFileCache empty,
      // so every api.transform() below threw "No compiled output found" —
      // again hiding the real cause. Surface it instead.
      throw new Error(
        `Angular failed to emit compiled output for "${tsconfig}". ` +
          `Original error: ${
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error)
          }`,
      );
    }
    for (const file of writtenStylesheets) {
      changedOutputs.add(file);
    }
    for (const file of changedFiles ?? []) {
      // Drop the output of deleted files so the scans below stop reporting
      // diagnostics for code that no longer exists.
      if (!fs.existsSync(file)) {
        typeScriptFileCache.delete(file);
        backgroundModules.delete(file);
        moduleStylesheets.delete(file);
        forgetComponentStyleSizes(componentStyleSizes, file);
      }
    }

    reportLynxDiagnostics([
      ...scanCompiledOutputForHtmlElements(typeScriptFileCache),
      ...scanCompiledOutputForStructuralIssues(typeScriptFileCache),
      ...scanSourcesForUnsupportedPatterns(fileNames),
      ...scanSourcesForUnsupportedCss(fileNames),
    ]);

    // Kept rather than printed: the compiler hook below reports them through
    // rspack, so type and template errors fail the build like `ng build`.
    // Only diagnostics the schema injection doesn't already cover are kept,
    // i.e. real errors, not "unknown element" noise for Lynx native elements.
    angularDiagnostics = filterAngularDiagnostics(
      await compilation.diagnoseFiles(
        useTypeChecking
          ? DiagnosticModes.All
          : DiagnosticModes.All & ~DiagnosticModes.Semantic,
      ),
    );

    const inputFiles = result.referencedFiles.map((file) =>
      path.normalize(file),
    );
    angularInputs = new Set([
      ...inputFiles,
      ...[...componentResourceDependencies.values()].flat(),
    ]);
    return { changedOutputs, inputFiles };
  };

  // onBeforeEnvironmentCompile fires once per environment (web + lynx) on
  // every build and rebuild, and rsbuild's callBatch runs them concurrently.
  // The coordinator serializes them onto the one shared `compilation` (two
  // concurrent initialize() calls would corrupt it) and only compiles again
  // for file versions Angular hasn't seen yet.
  //
  // It replaces a single cached promise that the first build created and every
  // later build awaited. That stopped the second environment from re-running
  // the compilation, but it also meant watch rebuilds never recompiled:
  // the loader kept serving the first build's output, so `.ts` edits shipped
  // empty hot updates until the dev server restarted.
  const coordinator = createAngularRebuildCoordinator({
    compile: compileAngular,
  });

  // rsbuild doesn't pass the rspack compiler to onBeforeEnvironmentCompile,
  // but its watcher's `modifiedFiles` is the only record of what changed.
  // rsbuild names each compiler after its environment, so index them by name.
  const compilersByEnvironment = new Map<string, Compiler>();
  api.onAfterCreateCompiler(({ compiler }) => {
    const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];
    for (const environmentCompiler of compilers) {
      if (environmentCompiler.name) {
        compilersByEnvironment.set(
          environmentCompiler.name,
          environmentCompiler,
        );
      }
    }

    // Every environment shares the one Angular compilation, so only the first
    // compiler reports its diagnostics: rsbuild concatenates the errors of all
    // compilers, and reporting in each would print every error once per
    // environment. One compiler with errors is enough to fail the build.
    // `thisCompilation` runs after `onBeforeEnvironmentCompile` (rsbuild
    // calls that from the compiler's `run`/`watchRun`), so the diagnostics are
    // already up to date for this compile.
    compilers[0]?.hooks.thisCompilation.tap(
      'lynx:angular:diagnostics',
      (rspackCompilation) => {
        rspackCompilation.errors.push(
          ...angularDiagnostics.errors.map((message) =>
            toAngularDiagnosticError(message, 'error'),
          ),
        );
        rspackCompilation.warnings.push(
          ...angularDiagnostics.warnings.map((message) =>
            toAngularDiagnosticError(message, 'warning'),
          ),
        );
      },
    );
  });

  let compilationClosed = false;
  api.onBeforeEnvironmentCompile(async ({ environment, isWatch }) => {
    const compiler = compilersByEnvironment.get(environment.name);
    const changedFiles = [
      ...(compiler?.modifiedFiles ?? []),
      ...(compiler?.removedFiles ?? []),
    ];
    const outdatedFiles = await coordinator.prepare(
      environment.name,
      changedFiles,
    );
    const changedEntries = backgroundEntries.update(environment.name, {
      appModules: backgroundModules,
      watch: isWatch,
      // A change to a file Angular reads but whose output stayed the same,
      // such as saving a file unchanged, changes nothing in the bundle.
      rebuilt:
        outdatedFiles.size > 0 ||
        changedFiles.some(
          (file) =>
            !angularInputs.has(path.normalize(file)) &&
            !backgroundEntries.isEntryFile(file),
        ),
    });
    if (compiler && outdatedFiles.size + changedEntries.length > 0) {
      // rspack reads `modifiedFiles` after watchRun to decide which modules
      // to rebuild. Adding the files whose Angular output changed makes it
      // re-run the loader for them, not just for the files that were edited.
      // The same goes for the background entries just rewritten.
      compiler.modifiedFiles = new Set([
        ...(compiler.modifiedFiles ?? []),
        ...outdatedFiles,
        ...changedEntries,
      ]);
    }

    // Closing destroys the piscina worker pool, after which the compilation
    // can't rebuild. That's only safe in a one-shot build: a watch build
    // (`rspeedy dev`) compiles again on every change. An earlier version closed
    // based on NODE_ENV, which would also break a production-mode watch build.
    if (!isWatch && !compilationClosed) {
      compilationClosed = true;
      await compilation.close?.();
    }
  });

  /**
   * Compiles one module for one thread. `background` is set for the
   * background layer.
   */
  const transformModule = async (
    context: {
      code: string;
      resourcePath: string;
      addDependency: (file: string) => void;
      environment: Parameters<typeof hotUpdatesEnabled>[0];
    },
    background: boolean,
  ): Promise<{ code: string }> => {
    const hot = hotUpdatesEnabled(context.environment);
    const isJs = /\.[cm]?js$/.test(context.resourcePath);
    if (isJs) {
      // Plain JS files (third-party deps, .mjs/.cjs sources) bypass the
      // Angular compiler — they don't carry component metadata. Run them
      // through @angular/build's JavaScriptTransformer to apply the same
      // advanced optimizations (pure annotations, async removal, etc.) as
      // Angular's normal build, then run worklet transforms on top.
      const contents = await javascriptTransformer.transformData(
        context.resourcePath,
        context.code,
        {
          skipLinker: false,
          // Angular 22.2 turned this positional `false` into a lazy resolver;
          // resolving to false still means "side-effect free", which lets the
          // transformer add pure annotations and wrap tslib decorators.
          sideEffects: () => Promise.resolve(false),
        },
      );
      const code = transformCrossThread(
        transformWorklets(
          Buffer.from(contents).toString(),
          context.resourcePath,
        ),
        context.resourcePath,
        { root: api.context.rootPath },
      );
      if (!background) return { code };
      const wrapped = wrapPureClasses(code, context.resourcePath);
      // The generated background entry takes every hot update the
      // background thread's modules pass on to it: running it again runs the
      // updated modules again, which registers their background functions
      // and refs again. The background thread has no app to update.
      return {
        code:
          hot && backgroundEntries.isEntryFile(context.resourcePath)
            ? addEntryHotAccept(wrapped)
            : wrapped,
      };
    }
    const content = typeScriptFileCache.get(context.resourcePath);
    if (!content) {
      // No entry in the cache means Angular's compiler never saw this file
      // — usually because the user imported a .ts file that isn't in the
      // tsconfig include list. Surface this as a hard error rather than
      // silently passing through (which would let rspack try to parse raw
      // TypeScript with @angular decorators, producing confusing errors).
      throw new Error(`No compiled output found for ${context.resourcePath}`);
    }
    // Register the component's external template and stylesheets so rspack
    // watches them. Their contents are compiled into this module's output,
    // so an edit to one must rebuild this module, and the coordinator must
    // hear about it to recompile with Angular first.
    for (const dependency of componentResourceDependencies.get(
      context.resourcePath,
    ) ?? []) {
      context.addDependency(dependency);
    }
    const code = buildTransformedCode({
      code:
        typeof content === 'string' ? content : Buffer.from(content).toString(),
      resourcePath: context.resourcePath,
      stylesheets: moduleStylesheets.get(context.resourcePath),
      root: api.context.rootPath,
      // Only the main thread's modules take hot updates themselves; the
      // background thread's pass theirs on to its entry (above).
      hot:
        hot && !background
          ? {
              entry: appEntries.has(path.normalize(context.resourcePath)),
              source: () => fs.readFileSync(context.resourcePath, 'utf-8'),
            }
          : undefined,
    });
    if (!background) {
      return { code };
    }
    // The background thread runs a module like this for its background
    // functions and refs, never for its components, services or pipes.
    // Angular's own build wraps each such class in a pure IIFE when it
    // optimizes a library (`sideEffects: false`), so the minifier drops the
    // ones nothing uses, and with them the Angular code they'd need. Doing the
    // same here keeps a component file's background functions in the
    // background bundle without the component. It runs after
    // buildTransformedCode, so the cross-thread IDs come from the same code
    // as the main thread's. Top-level calls in the app's files, such as
    // backgroundFn() itself, aren't marked pure.
    return {
      code: wrapPureClasses(
        Buffer.from(
          await javascriptTransformer.transformData(
            context.resourcePath,
            code,
            {
              skipLinker: true,
              sideEffects: () => Promise.resolve(false),
            },
          ),
        ).toString(),
        context.resourcePath,
      ),
    };
  };

  // One transform per layer, as the background layer compiles the app's
  // modules differently (see transformModule).
  api.transform(
    { test: /\.[cm]?[jt]sx?$/, issuerLayer: LAYERS.MAIN_THREAD },
    (context) => transformModule(context, false),
  );
  api.transform(
    { test: /\.[cm]?[jt]sx?$/, issuerLayer: LAYERS.BACKGROUND },
    (context) => transformModule(context, true),
  );
};
