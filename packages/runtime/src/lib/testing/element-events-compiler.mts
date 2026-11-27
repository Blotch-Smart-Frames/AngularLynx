import { NgtscProgram } from '@angular/compiler-cli';
import { parentPort, workerData } from 'node:worker_threads';
import ts from 'typescript';

// types/element-events.test.ts runs this file in a worker thread rather than
// compiling in its own: Vitest's V8 coverage instruments the test's thread, and
// slows the compiler two to three times there, which CI's busy runners made
// a minute (issue #741). A worker thread is a new isolate, which the coverage
// session doesn't reach, and the compiler isn't the code whose coverage counts.

/** What the test sends: the fixture to compile, and the runtime's public API. */
export type CompileRequest = {
  readonly fixtureFile: string;
  readonly fixtureSource: string;
  readonly publicApi: string;
};

/**
 * What the test needs of a diagnostic. A `ts.Diagnostic` holds its source
 * file, which a worker can't send back.
 */
export type CompileDiagnostic = {
  readonly fileName: string | undefined;
  readonly start: number | undefined;
  /** The first line: the rest explains it, which the cases don't check. */
  readonly message: string;
};

/**
 * Type-checks the fixture with the runtime, as `ng build` does, with
 * strictTemplates as `ng new` sets it.
 */
const compile = async ({
  fixtureFile,
  fixtureSource,
  publicApi,
}: CompileRequest): Promise<readonly CompileDiagnostic[]> => {
  const options: ts.CompilerOptions & Record<string, unknown> = {
    strict: true,
    strictTemplates: true,
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => file === fixtureFile || fileExists(file);
  host.readFile = (file) =>
    file === fixtureFile ? fixtureSource : readFile(file);
  host.getSourceFile = (file, language, ...rest) =>
    file === fixtureFile
      ? ts.createSourceFile(file, fixtureSource, language, true)
      : getSourceFile(file, language, ...rest);
  const program = new NgtscProgram([fixtureFile, publicApi], options, host);
  await program.loadNgStructureAsync();
  return [
    ...program.getTsSemanticDiagnostics(),
    ...program.getNgSemanticDiagnostics(),
  ].map(({ file, start, messageText }) => ({
    fileName: file?.fileName,
    start,
    message: ts.flattenDiagnosticMessageText(messageText, '\n').split('\n')[0],
  }));
};

parentPort?.postMessage(await compile(workerData as CompileRequest));
