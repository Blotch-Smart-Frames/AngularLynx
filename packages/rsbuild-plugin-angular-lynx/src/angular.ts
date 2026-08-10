// cspell:words ɵɵget ɵcmp
import fs from 'node:fs';
import path from 'node:path';
import {
  createAngularCompilation,
  DiagnosticModes,
} from '@angular/build/src/tools/angular/compilation';
import { JavaScriptTransformer } from '@angular/build/src/tools/esbuild/javascript-transformer';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import * as ts from 'typescript';
import { applyAngularConfig } from './utils/angular/angular-config.js';
import { transformWorklets } from './worklet-transform.js';
import { generateComponentScopeId } from './utils/angular/component-scope-id.js';
import { maxWorkers, useTypeChecking } from './utils/angular/env.js';
import { readBuildOptions } from './utils/angular/options.js';
import {
  getAngularWorkspace,
  getProjectByCwd,
} from './utils/angular/read-workspace.js';
import { resolvePages } from './utils/angular/resolve-pages.js';
import { injectLynxSchema } from './utils/inject-lynx-schema.js';
import { stripTemplateWhitespace } from './utils/strip-template-whitespace.js';
import {
  reportLynxDiagnostics,
  scanCompiledOutputForHtmlElements,
  scanCompiledOutputForStructuralIssues,
  scanSourcesForUnsupportedCss,
  scanSourcesForUnsupportedPatterns,
} from './lynx-diagnostics.js';
import type { PluginAngularLynxOptions } from './utils/options.js';

/**
 * Wires Angular's AOT/JIT compilation pipeline into the rsbuild/rspack build
 * graph. This is the heart of the AngularLynx build — it bridges three worlds:
 *
 *   1. **Angular's compiler** (`@angular/build`) — runs `createAngularCompilation`
 *      to type-check templates, transform component metadata, and emit JS+CSS.
 *   2. **Lynx's native element model** — Angular's template type-checker has
 *      no knowledge of `<view>`, `<text>`, `<scroll-view>`, etc., so we inject
 *      CUSTOM_ELEMENTS_SCHEMA into every @Component-bearing source file before
 *      Angular's compiler sees it.
 *   3. **rspack's loader pipeline** — Angular emits transformed output into a
 *      `typeScriptFileCache`; the `api.transform()` hook below intercepts every
 *      `.ts`/`.js` request and serves the precompiled content instead of
 *      letting rspack try to parse the original TypeScript.
 *
 * The flow runs once per environment build:
 *   onBeforeEnvironmentCompile → buildLynxSchemaSourceFileCache (schema inject)
 *     → compilation.initialize (Angular AOT walk + transformStylesheet callback)
 *     → emitAffectedFiles (fills typeScriptFileCache)
 *     → diagnoseFiles (filtered to suppress Lynx-element false positives)
 *
 * Then for each module request:
 *   api.transform → look up compiled output in typeScriptFileCache
 *     → prepend `import` statements for the component's scoped CSS files
 *     → patch ɵcmp.id to the deterministic scope ID
 *     → inject HMR self-accept on bootstrap entries (dev only)
 *     → run worklet directive transformation
 */
export const applyAngularRules = async (
  api: RsbuildPluginAPI,
  pluginOptions: Required<PluginAngularLynxOptions>,
): Promise<void> => {
  const { basePath, workspace } = await getAngularWorkspace();

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

  // The primary project provides shared build config (tsconfig, polyfills, styles,
  // output path). When using `pages`, use the first resolved page's project.
  // Otherwise fall back to the CWD-based single-project resolution.
  const primaryProjectName = pluginOptions.pages
    ? ((Array.isArray(pluginOptions.pages)
        ? pluginOptions.pages[0]
        : Array.from(workspace.projects.entries()).find(
            ([, def]) => def.extensions['projectType'] === 'application',
          )?.[0]) ?? null)
    : getProjectByCwd(workspace, basePath);

  if (!primaryProjectName) {
    throw new Error("couldn't find the project");
  }
  const projectDefinition = workspace.projects.get(primaryProjectName);
  if (!projectDefinition) {
    throw new Error(`Project "${primaryProjectName}" not found in workspace`);
  }
  const buildOptions = await readBuildOptions(projectDefinition, basePath);
  applyAngularConfig(api, buildOptions);
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
    },
    maxWorkers,
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
  // Determines if TypeScript should process JavaScript files based on tsconfig `allowJs` option
  // let shouldTsIgnoreJs = true;
  // Determines if transpilation should be handle by TypeScript or esbuild
  // let useTypeScriptTranspilation = true;
  // Write scoped CSS to a cache directory instead of next to source files.
  // The bundler resolves them via relative imports computed by path.relative().
  // Using node_modules/.cache means the files are gitignored by default and
  // cleared on `npm install` if cache invalidation is needed.
  const scopedCssCacheDir = path.join(
    basePath,
    'node_modules',
    '.cache',
    'angular-lynx-css',
  );
  fs.mkdirSync(scopedCssCacheDir, { recursive: true });

  // Tracks every stylesheet emitted by Angular's transformStylesheet callback
  // for a given component source file. `imports` lists the on-disk paths the
  // loader will prepend as `import` statements; `processedFiles` deduplicates
  // calls that Angular's AOT compiler makes multiple times for the same
  // stylesheet (see comment inside transformStylesheet for the dedup rationale).
  const componentStylesCache = new Map<
    string,
    {
      imports: string[];
      inlineStyles: string[];
      scopeId: string;
      processedFiles: Map<string, string>;
    }
  >();
  // Maps component source file → { className, scopeId } so the loader can emit
  // the `Component.ɵcmp.id = '<scopeId>'` assignment that ties the CSS files
  // (whose filenames carry the same scope ID) to the runtime component instance.
  const componentScopeIds = new Map<
    string,
    { className: string; scopeId: string }
  >();
  // Fix: onBeforeEnvironmentCompile fires once per environment (web + lynx), and
  // rsbuild's callBatch runs them concurrently. Without deduplication, both calls
  // race on the same `compilation` instance. The first to finish calls close(),
  // destroying piscina's worker pool, which crashes the second with
  // "Terminating worker thread" — a fatal error that kills `rspeedy dev`.
  //
  // The Angular compilation output is environment-independent (same AOT transform
  // regardless of target layer), so we gate it behind a single promise. The second
  // environment awaits the same result without re-running the compilation.
  let compilationPromise: Promise<void> | null = null;
  const isDevMode = process.env['NODE_ENV'] !== 'production';

  api.onBeforeEnvironmentCompile(async () => {
    if (compilationPromise) {
      await compilationPromise;
      return;
    }

    compilationPromise = (async () => {
      // Pre-populate Angular's sourceFileCache with schema-injected TypeScript source
      // so that Angular's template type-checker never errors on Lynx native elements
      // (<view>, <text>, <scroll-view>, etc.) — users don't need CUSTOM_ELEMENTS_SCHEMA
      // in every component.
      const { sourceFileCache, fileNames } =
        buildLynxSchemaSourceFileCache(tsconfig);

      try {
        await compilation.initialize(
          tsconfig,
          {
            sourceFileCache,
            processWebWorker: (workerFile, _containingFile) => {
              return workerFile;
            },
            async transformStylesheet(
              data,
              containingFile,
              stylesheetFile,
              order,
              className,
            ) {
              const resolvedClassName = className ?? 'Component';
              const scopeId = generateComponentScopeId(
                resolvedClassName,
                containingFile,
              );
              let componentStyles = componentStylesCache.get(containingFile);
              if (!componentStyles) {
                componentStyles = {
                  imports: [],
                  inlineStyles: [],
                  scopeId,
                  processedFiles: new Map(),
                };
                componentStylesCache.set(containingFile, componentStyles);
              }

              // Angular's AOT compiler may invoke this callback multiple times
              // for the same stylesheet — once with className undefined (fallback
              // to 'Component') and once with the real class name. Deduplicate:
              // skip fallback calls when the stylesheet was already processed,
              // but allow real-className calls to overwrite the fallback.
              const stylesheetKey = stylesheetFile ?? `__inline_${order}`;
              const previousPath =
                componentStyles.processedFiles.get(stylesheetKey);

              if (previousPath && !className) {
                return '';
              }

              // Prefer the real class name for the scope ID set on ɵcmp.id
              if (className || !componentScopeIds.has(containingFile)) {
                componentScopeIds.set(containingFile, {
                  className: resolvedClassName,
                  scopeId,
                });
              }

              // Use raw CSS without Angular's encapsulateStyle scoping.
              // Angular's encapsulateStyle generates [_ngcontent-xxx] attribute selectors,
              // and even class-conjunction replacements (.class._ngscope-xxx) don't work
              // because the Lynx template stores the scope ID separately from element class
              // lists — elements only get their component classes (e.g. "nav-title"), not
              // scope classes. Plain class selectors (.nav-title) match correctly since
              // enableCSSSelector handles them, and per-component scoping in the template
              // already associates the CSS with the right component scope.
              const scopedCss = data;

              const writeIfChanged = (
                filePath: string,
                content: string,
              ): void => {
                try {
                  if (fs.readFileSync(filePath, 'utf-8') === content) return;
                } catch {}
                fs.writeFileSync(filePath, content);
              };

              let scopedPath: string;
              if (stylesheetFile) {
                const relName = path.relative(basePath, stylesheetFile);
                scopedPath = path.join(
                  scopedCssCacheDir,
                  `${relName.replace(/[/\\]/g, '__')}.__scoped_${scopeId}.css`,
                );
              } else {
                const relDir = path.relative(
                  basePath,
                  path.dirname(containingFile),
                );
                scopedPath = path.join(
                  scopedCssCacheDir,
                  `${relDir.replace(/[/\\]/g, '__')}__inline_${resolvedClassName}_${order}.__scoped_${scopeId}.css`,
                );
              }

              writeIfChanged(scopedPath, scopedCss);

              if (previousPath) {
                const idx = componentStyles.imports.indexOf(previousPath);
                if (idx >= 0) {
                  componentStyles.imports[idx] = scopedPath;
                } else {
                  componentStyles.imports.push(scopedPath);
                }
                if (previousPath !== scopedPath) {
                  try {
                    fs.unlinkSync(previousPath);
                  } catch {}
                }
              } else {
                componentStyles.imports.push(scopedPath);
              }

              componentStyles.processedFiles.set(stylesheetKey, scopedPath);
              return '';
            },
          },
          (compilerOptions) => {
            // Do NOT set _enableHmr here. That flag is for Angular's esbuild build path:
            // it makes the AOT compiler emit AppComponent_HmrLoad() functions that call
            // ɵɵgetReplaceMetadataURL(), which constructs `new URL('...', 'file:///src/...')`.
            // Lynx's URL implementation rejects file:// as a base URL, crashing on startup.
            // Additionally, _enableHmr requires the dev server to serve Angular's HMR update
            // modules at /__angular_hmr/* endpoints — infrastructure we don't yet provide.
            // Component-level Angular HMR would need a custom endpoint in the Lynx dev server
            // and a runtime that applies templateUpdates from compilation.initialize().
            // Live reload works without this: webpack falls back to a full CDP Page.reload
            // when no module calls module.hot.accept().
            return {
              ...compilerOptions,
              noEmitOnError: false,
              inlineSources: !!sourcemap,
              inlineSourceMap: !!sourcemap,
              sourceMap: undefined,
              mapRoot: undefined,
              sourceRoot: undefined,
              preserveSymlinks: false,
            };
          },
        );
        // shouldTsIgnoreJs = !initializationResult.compilerOptions.allowJs;
        // // Isolated modules option ensures safe non-TypeScript transpilation.
        // // Typescript printing support for sourcemaps is not yet integrated.
        // useTypeScriptTranspilation =
        //   !initializationResult.compilerOptions.isolatedModules ||
        //   !!initializationResult.compilerOptions.sourceMap ||
        //   !!initializationResult.compilerOptions.inlineSourceMap;
        // referencedFiles = initializationResult.referencedFiles;
        // externalStylesheets = initializationResult.externalStylesheets;
      } catch {}
      try {
        for (const {
          filename,
          contents,
        } of await compilation.emitAffectedFiles()) {
          // emitAffectedFiles is incremental — on the first build it returns
          // every project file; on rebuilds (watch mode) only the files whose
          // contents or transitive template dependencies changed. The cache is
          // therefore additive and survives across builds, which is what makes
          // dev-mode rebuilds fast.
          typeScriptFileCache.set(path.normalize(filename), contents);
        }
      } catch {}

      reportLynxDiagnostics([
        ...scanCompiledOutputForHtmlElements(typeScriptFileCache),
        ...scanCompiledOutputForStructuralIssues(typeScriptFileCache),
        ...scanSourcesForUnsupportedPatterns(fileNames),
        ...scanSourcesForUnsupportedCss(fileNames),
      ]);

      const diagnostics = await compilation.diagnoseFiles(
        useTypeChecking
          ? DiagnosticModes.All
          : DiagnosticModes.All & ~DiagnosticModes.Semantic,
      );
      // Only log diagnostics that aren't suppressed by the schema injection — i.e. real errors
      // the user should know about, not "unknown element" noise for Lynx native elements.
      // diagnoseFiles returns { errors?: PartialMessage[], warnings?: PartialMessage[] }
      // where PartialMessage.text holds the message string.
      const actionableErrors = diagnostics.errors?.filter(
        (e: { text?: string }) => !isLynxUnknownElementMessage(e.text),
      );
      const actionableWarnings = diagnostics.warnings?.filter(
        (w: { text?: string }) => !isLynxUnknownElementMessage(w.text),
      );
      if (actionableErrors?.length || actionableWarnings?.length) {
        console.log({ errors: actionableErrors, warnings: actionableWarnings });
      }
      // Fix: calling close() in dev mode destroyed the piscina worker pool, making
      // incremental rebuilds impossible and crashing when a second environment's hook
      // tried to use the compilation. In production, close is safe because each
      // environment runs in a separate process (rspeedy build --environment X) and
      // no rebuild cycle follows.
      if (!isDevMode) {
        await compilation.close?.();
      }
    })();

    await compilationPromise;
  });

  api.transform(
    {
      test: /\.[cm]?[jt]sx?$/,
    },
    async (context) => {
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
          false,
          false,
        );
        return {
          code: transformWorklets(
            Buffer.from(contents).toString(),
            context.resourcePath,
          ),
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
      let code: string;
      if (typeof content === 'string') {
        code = content;
      } else {
        code = Buffer.from(content).toString();
      }
      const componentStyles = componentStylesCache.get(context.resourcePath);
      if (componentStyles) {
        const { imports } = componentStyles;
        let importsString = '';
        for (let i = 0; i < imports.length; ++i) {
          // Stylesheets live in node_modules/.cache/angular-lynx-css/, so
          // compute the relative path from the component file. Prepending
          // `./` when the relative path doesn't start with `..` keeps it a
          // valid ES module specifier (rspack rejects bare specifiers here).
          let relativeImport = path.relative(
            path.dirname(context.resourcePath),
            imports[i],
          );
          if (!relativeImport.startsWith('.')) {
            relativeImport = `./${relativeImport}`;
          }
          importsString += `import "${relativeImport}";`;
        }
        // Prepend the imports so the CSS chunks are pulled into the bundle
        // before the component class is defined — matching the side-effect
        // ordering Angular itself produces in its standard build.
        code = importsString + code;
      }
      // Patch the component's \u0275cmp.id to match the scope ID derived from the
      // component's class name + file path. Angular normally generates this via
      // encapsulateStyle, but we bypass Angular's style encapsulation entirely
      // (Lynx's template engine handles scoping). This ID connects CSS files
      // (which use the scope ID in their filename) to the component's renderer
      // (EmulatedLynxRenderer adds _nghost-{id} to the host element).
      const scopeInfo = componentScopeIds.get(context.resourcePath);
      if (scopeInfo) {
        code += `\n;${scopeInfo.className}.\u0275cmp.id = '${scopeInfo.scopeId}';\n`;
      }
      // In dev mode, inject HMR self-accept in entry files so webpack doesn't
      // trigger a full page reload. The entry re-evaluates on any dependency
      // update, calling bootstrapApplication again (which handles
      // re-bootstrap by destroying the previous app and creating a fresh one).
      // Without this, webpack falls back to a full CDP Page.reload on every
      // change because no module calls module.hot.accept() — the reload works
      // but is slow (rebuilds everything, loses navigation state).
      if (
        process.env['NODE_ENV'] !== 'production' &&
        code.includes('bootstrapApplication')
      ) {
        code += `\n;if (module.hot) { module.hot.accept(); }`;
      }
      code = transformWorklets(code, context.resourcePath);
      return {
        code,
      };
    },
  );
};

/**
 * Reads the tsconfig to enumerate all project TypeScript files, then returns a
 * Map<filePath, SourceFile> where every file containing an @Component decorator
 * has had CUSTOM_ELEMENTS_SCHEMA injected. Angular's compiler host checks this
 * cache before reading from disk, so the template type-checker never sees unknown
 * Lynx element errors without the user having to add the schema manually.
 *
 * Returns Map<string, any> to avoid TypeScript instance mismatch: the plugin's
 * local `typescript` package and `@angular/build`'s TypeScript resolve to different
 * module instances in the monorepo, making their SourceFile types structurally
 * incompatible at the type level even though they're identical at runtime.
 */
const buildLynxSchemaSourceFileCache = (
  tsconfig: string,
): { sourceFileCache: Map<string, any>; fileNames: string[] } => {
  const sourceFileCache = new Map<string, any>();

  let fileNames: string[];
  try {
    const configFile = ts.readConfigFile(tsconfig, (p) =>
      fs.readFileSync(p, 'utf-8'),
    );
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsconfig),
    );
    fileNames = parsedConfig.fileNames;
  } catch {
    // If we can't parse the tsconfig, skip cache population — Angular will read
    // files from disk normally and the user's explicit schemas (if any) apply.
    return { sourceFileCache, fileNames: [] };
  }

  for (const filePath of fileNames) {
    // Skip library files — only project source needs the schema injection.
    if (filePath.includes('node_modules')) continue;

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Quick bail-out: files without @Component don't need transformation.
    if (!source.includes('@Component')) continue;

    // stripTemplateWhitespace runs here — before Angular's compiler — because this
    // is the only point where we still have the original template structure, with
    // newlines that tell us "this whitespace is indentation" vs "this space is
    // inter-word spacing next to an inline child element". By the time Angular emits
    // ɵɵtext instructions the structural information is gone and trimming blindly
    // would break inline text like <text>Hello <text>world</text> again</text> by
    // eating the spaces between words. Running injectLynxSchema first means the
    // schema import is already prepended, but stripTemplateWhitespace only matches
    // the >\n..content..\n< pattern inside template strings, so the two transforms
    // are order-independent in practice.
    const transformed = stripTemplateWhitespace(injectLynxSchema(source));
    // Even if the transforms returned the source unchanged, we still cache it
    // so Angular uses a consistent file view during the build.
    sourceFileCache.set(
      filePath,
      ts.createSourceFile(filePath, transformed, ts.ScriptTarget.Latest, true),
    );
  }

  return { sourceFileCache, fileNames };
};

/**
 * Returns true for Angular template diagnostic messages that are expected noise
 * for Lynx native elements and should not be shown to the user:
 *
 * - "is not a known element" — suppressed by sourceFileCache schema injection but may
 *   still appear for files not in the tsconfig file list
 * - "isn't a known property of" — Lynx element stubs don't declare @Input() for every
 *   platform-specific attribute (src, item-key, scroll-orientation, etc.) so Angular
 *   reports these as unknown property bindings on the stub components; the renderer
 *   handles them at runtime via setAttribute
 */
const isLynxUnknownElementMessage = (text: string | undefined): boolean =>
  (text?.includes('is not a known element') ||
    text?.includes("isn't a known property of")) ??
  false;
