import { isLynxUnknownElementMessage } from './is-lynx-unknown-element-message.js';

/**
 * Where an Angular diagnostic points. Mirrors the esbuild `Location` shape that
 * `@angular/build` converts TypeScript and Angular compiler diagnostics into:
 * `line` is 1-based and `column` 0-based.
 */
export type AngularDiagnosticLocation = {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
  readonly lineText?: string;
};

/**
 * One diagnostic from `compilation.diagnoseFiles()`: an esbuild
 * `PartialMessage`, whose `text` starts with the code (`TS2307: ...`,
 * `NG8001: ...`).
 */
export type AngularDiagnosticMessage = {
  readonly text?: string;
  readonly location?: AngularDiagnosticLocation | null;
  readonly notes?: readonly {
    readonly text?: string;
    readonly location?: AngularDiagnosticLocation | null;
  }[];
};

/**
 * The diagnostics of one Angular compile, normalized so callers don't have to
 * handle `diagnoseFiles()` leaving either list out.
 */
export type AngularDiagnostics = {
  readonly errors: readonly AngularDiagnosticMessage[];
  readonly warnings: readonly AngularDiagnosticMessage[];
};

/**
 * The shape rspack accepts in `compilation.errors` and `compilation.warnings`.
 * rsbuild prints `file` as the error's `File:` line, so a `path:line:column`
 * value makes it clickable in terminals and editors.
 */
export type AngularDiagnosticError = Error & {
  file?: string;
  hideStack: boolean;
};

/**
 * Keeps only the diagnostics a user can act on. Angular's template checker
 * doesn't know Lynx's native elements and their attributes, so it reports
 * them as unknown even though the renderer supports them.
 */
export const filterAngularDiagnostics = (diagnostics: {
  errors?: readonly AngularDiagnosticMessage[];
  warnings?: readonly AngularDiagnosticMessage[];
}): AngularDiagnostics => ({
  errors: (diagnostics.errors ?? []).filter(
    (message) => !isLynxUnknownElementMessage(message.text),
  ),
  warnings: (diagnostics.warnings ?? []).filter(
    (message) => !isLynxUnknownElementMessage(message.text),
  ),
});

/**
 * Formats a location as `file:line:column`, the form rsbuild recognizes as a
 * position (it otherwise appends `:1:1`) and editors open at the right spot.
 * A location without a line falls back to just the file.
 */
const formatLocation = ({
  file,
  line,
  column,
}: AngularDiagnosticLocation): string | undefined => {
  if (!file) return undefined;
  if (line === undefined) return file;
  // Editors and terminals expect 1-based columns.
  return `${file}:${line}:${(column ?? 0) + 1}`;
};

/**
 * Renders the offending source line with a caret under the reported range,
 * like `ng build` does, so the error is readable without opening the file.
 */
const formatCodeFrame = ({
  line,
  column,
  length,
  lineText,
}: AngularDiagnosticLocation): string | undefined => {
  if (line === undefined || lineText === undefined) return undefined;
  const gutter = `${line} | `;
  const caretIndent = ' '.repeat(gutter.length - 2) + '| ';
  const caret = ' '.repeat(column ?? 0) + '^'.repeat(Math.max(1, length ?? 1));
  return `${gutter}${lineText}\n${caretIndent}${caret}`;
};

/**
 * Converts an Angular diagnostic into an error rspack can report. Pushing it
 * into `compilation.errors` is what makes `rspeedy build` exit non-zero (and
 * the dev server show it) the way `ng build` and `ng serve` do; printing it
 * with `console.log` let builds with type errors succeed and ship.
 */
export const toAngularDiagnosticError = (
  message: AngularDiagnosticMessage,
  severity: 'error' | 'warning',
): AngularDiagnosticError => {
  const sections = [message.text ?? 'Unknown Angular compiler diagnostic'];
  const codeFrame = message.location && formatCodeFrame(message.location);
  if (codeFrame) sections.push(codeFrame);
  for (const note of message.notes ?? []) {
    const noteLocation = note.location && formatLocation(note.location);
    sections.push([noteLocation, note.text].filter((part) => part).join(': '));
  }

  const error = new Error(sections.join('\n\n')) as AngularDiagnosticError;
  error.name =
    severity === 'error' ? 'AngularCompilerError' : 'AngularCompilerWarning';
  const file = message.location && formatLocation(message.location);
  if (file) error.file = file;
  // The stack would point into this plugin, not at the user's code.
  error.hideStack = true;
  return error;
};
