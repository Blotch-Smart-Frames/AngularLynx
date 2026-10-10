import fs from 'node:fs';

/**
 * Identifies one on-disk version of a file: its mtime, or `null` when the file
 * doesn't exist (it was deleted).
 */
export type FileVersion = number | null;

/**
 * What one Angular compile reports back to the coordinator.
 */
export type AngularCompileResult = {
  /**
   * Files whose compiled output changed during this compile: re-emitted
   * TypeScript modules whose JS differs from the cached copy, and any scoped
   * stylesheets rewritten on disk. rspack must rebuild these even when their
   * own source didn't change (e.g. a parent component whose template
   * compilation depends on an edited child component).
   */
  changedOutputs: Iterable<string>;
  /**
   * Every file the compilation read: program sources plus component
   * resources such as external templates and stylesheets. Changes to any
   * other non-TypeScript file (global CSS, assets, the scoped-CSS cache this
   * plugin writes itself) can't affect Angular's output, so they don't
   * trigger a recompile.
   */
  inputFiles: Iterable<string>;
};

export type AngularRebuildCoordinator = {
  /**
   * Brings the shared Angular compilation up to date before one environment's
   * rspack compile.
   *
   * @param environmentName - the rsbuild environment about to compile.
   * @param changedFiles - files the environment's watcher reported as modified
   *   or removed since its previous compile (empty for its first compile).
   * @returns files whose compiled output changed since this environment last
   *   compiled. The caller adds them to the rspack compiler's
   *   `modifiedFiles` so rspack re-runs the loader for those modules.
   */
  prepare: (
    environmentName: string,
    changedFiles: Iterable<string>,
  ) => Promise<Set<string>>;
};

const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

const readFileVersion = (file: string): FileVersion =>
  fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;

/**
 * Keeps one Angular compilation in sync with rspack's watch rebuilds.
 *
 * Angular compiles the whole program up front and the rspack loader only
 * serves its cached output. So on every rebuild, Angular has to recompile the
 * changed files *before* rspack re-runs the loader. Otherwise the loader
 * serves the previous output and the dev server ships an empty hot update.
 *
 * Two things make this more than "recompile on every watchRun":
 *
 * - **Several environments share one compilation.** `rspeedy dev` builds `web`
 *   and `lynx` with separate rspack compilers. Each compiler's watcher reports
 *   the same edit, and rsbuild runs their before-compile hooks concurrently.
 *   Compiles are therefore serialized (two concurrent `initialize()` calls on
 *   one compilation would corrupt it). A file version Angular has already seen
 *   doesn't trigger a second compile; only versions it hasn't seen do.
 * - **rspack only rebuilds modules whose files changed.** When an edit changes
 *   the compiled output of another file, that file's module would keep its
 *   stale output. So each compile reports which outputs changed, and every
 *   environment gets back the ones it hasn't rebuilt yet.
 */
export const createAngularRebuildCoordinator = ({
  compile,
  getFileVersion = readFileVersion,
}: {
  /**
   * Runs one Angular compile. `changedFiles` is `undefined` for the initial
   * full compile and lists the changed inputs for incremental ones.
   */
  compile: (
    changedFiles: ReadonlySet<string> | undefined,
  ) => Promise<AngularCompileResult>;
  /** Injectable for tests; defaults to the file's mtime. */
  getFileVersion?: (file: string) => FileVersion;
}): AngularRebuildCoordinator => {
  // Chains compiles so only one ever touches the Angular compilation at a time.
  let queue: Promise<void> = Promise.resolve();
  let initialized = false;
  let inputFiles = new Set<string>();
  // Changed files waiting for the next compile.
  const pendingFiles = new Set<string>();
  // The version of each file that Angular was last asked to compile. A second
  // environment reporting the same version is a duplicate notification.
  const compiledVersions = new Map<string, FileVersion>();
  // Each compile that changes outputs bumps the generation. Outputs and
  // environments are stamped with it so `prepare()` can tell which outputs an
  // environment hasn't rebuilt yet.
  let generation = 0;
  const outputGenerations = new Map<string, number>();
  const environmentGenerations = new Map<string, number>();

  const isAngularInput = (file: string): boolean =>
    // Any TypeScript file counts, not just ones already in the program. A new
    // file only joins the program on the next compile, and the loader can't
    // serve it until Angular has emitted it.
    TYPESCRIPT_FILE.test(file) || inputFiles.has(file);

  const runCompile = async (): Promise<void> => {
    if (initialized && pendingFiles.size === 0) return;

    const changedFiles = new Set(pendingFiles);
    pendingFiles.clear();

    let result: AngularCompileResult;
    try {
      result = await compile(initialized ? changedFiles : undefined);
    } catch (error) {
      // Put the files back so the next rebuild retries them, rather than
      // treating them as compiled and serving output from before the edit.
      for (const file of changedFiles) {
        pendingFiles.add(file);
        compiledVersions.delete(file);
      }
      throw error;
    }

    inputFiles = new Set(result.inputFiles);
    if (!initialized) {
      // Each environment's first compile builds every module anyway, so the
      // initial compile's outputs never need to be pushed to rspack.
      initialized = true;
      return;
    }
    generation++;
    for (const file of result.changedOutputs) {
      outputGenerations.set(file, generation);
    }
  };

  return {
    prepare: async (environmentName, changedFiles) => {
      for (const file of changedFiles) {
        if (!isAngularInput(file)) continue;
        const version = getFileVersion(file);
        if (
          compiledVersions.has(file) &&
          compiledVersions.get(file) === version
        ) {
          continue;
        }
        compiledVersions.set(file, version);
        pendingFiles.add(file);
      }

      const run = queue.then(runCompile);
      // A failed compile rejects this environment's hook, so rsbuild reports
      // it. The next compile must still run, so the queue swallows the error.
      queue = run.catch(() => {});
      await run;

      const lastSeen = environmentGenerations.get(environmentName);
      environmentGenerations.set(environmentName, generation);
      const outdated = new Set<string>();
      if (lastSeen === undefined) return outdated;
      for (const [file, outputGeneration] of outputGenerations) {
        if (outputGeneration > lastSeen) outdated.add(file);
      }
      return outdated;
    },
  };
};
