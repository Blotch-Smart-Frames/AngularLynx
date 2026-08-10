/**
 * Injects CUSTOM_ELEMENTS_SCHEMA into every @Component decorator in a TypeScript
 * source file that doesn't already declare a schema.
 *
 * This is applied via the Angular compiler's sourceFileCache before compilation,
 * so Angular's template type-checker never sees unknown Lynx element errors
 * (<view>, <text>, <scroll-view>, etc.) without the user having to declare
 * schemas manually in every component.
 */
export const injectLynxSchema = (source: string): string => {
  // Skip files that already handle schemas — no double-injection.
  // Also handles the LYNX_ELEMENTS stub file itself (which imports from @angular/core).
  if (
    source.includes('CUSTOM_ELEMENTS_SCHEMA') ||
    source.includes('NO_ERRORS_SCHEMA')
  ) {
    return source;
  }

  // Use an alias to avoid colliding with any existing import named CUSTOM_ELEMENTS_SCHEMA.
  const importLine = `import { CUSTOM_ELEMENTS_SCHEMA as __LynxCES__ } from '@angular/core';\n`;

  // Inject schemas into every @Component({ ... }) call.
  // \s* handles whitespace/newlines between @Component and the opening brace.
  const patched = source.replace(
    /@Component\s*\(\s*\{/g,
    '@Component({ schemas: [__LynxCES__],',
  );

  // Only prepend the import if we actually found and patched at least one @Component.
  if (patched === source) {
    // No @Component decorator found (e.g. @Component was a false-positive in a string).
    return source;
  }

  return importLine + patched;
};
