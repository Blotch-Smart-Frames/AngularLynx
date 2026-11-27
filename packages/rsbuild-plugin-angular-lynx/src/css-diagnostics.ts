/**
 * The CSS properties Lynx drops from the stylesheet that the runtime applies
 * itself, from the build's style index (see style-index.ts): `quotes`, which
 * sets the marks the runtime draws for a `<q>` (issue #821). Lynx's template
 * encoder still warns `Unsupported property "quotes" was removed during
 * template encode`, which reads as though the app's `quotes` did nothing.
 */
const PROPERTIES_THE_RUNTIME_APPLIES = new Set(['quotes']);

/**
 * Leaves out of the encoder's CSS diagnostics (a JSON list, as Lynx's
 * template plugin hands them to its `beforeEmit` hook, which turns each into
 * a warning) those about a property the runtime applies itself. Anything
 * else, a list it can't read included, is kept as it is.
 */
export const withoutAppliedProperties = (
  cssDiagnostics: string | undefined,
): string | undefined => {
  if (!cssDiagnostics) return cssDiagnostics;
  let diagnostics: unknown;
  try {
    diagnostics = JSON.parse(cssDiagnostics);
  } catch {
    return cssDiagnostics;
  }
  if (!Array.isArray(diagnostics)) return cssDiagnostics;
  const kept = diagnostics.filter(
    (diagnostic: unknown) =>
      !(
        typeof diagnostic === 'object' &&
        diagnostic !== null &&
        (diagnostic as { type?: unknown }).type === 'property' &&
        typeof (diagnostic as { name?: unknown }).name === 'string' &&
        PROPERTIES_THE_RUNTIME_APPLIES.has(
          (diagnostic as { name: string }).name.toLowerCase(),
        )
      ),
  );
  return kept.length === diagnostics.length
    ? cssDiagnostics
    : JSON.stringify(kept);
};
