import { expect } from 'vitest';

/**
 * Prints `ng-version` as a placeholder in this package's snapshots.
 *
 * Angular stamps its exact version on the root component's host (the
 * `<page>`), so without this every Angular patch, which Dependabot brings
 * weekly, would change each inline snapshot that includes the page. The
 * placeholder is the one Angular's own source uses before a release stamps
 * the real version.
 *
 * Only the specs load this (vitest.config.ts's setupFiles): an app's
 * snapshots from the published library keep the real version.
 */
const PLACEHOLDER = '0.0.0-PLACEHOLDER';

expect.addSnapshotSerializer({
  // Skips the masked copy itself, so printing it doesn't come back here.
  test: (value: unknown) =>
    value instanceof Element &&
    value.hasAttribute('ng-version') &&
    value.getAttribute('ng-version') !== PLACEHOLDER,
  serialize: (value: Element, config, indentation, depth, refs, printer) => {
    const masked = value.cloneNode(true) as Element;
    masked.setAttribute('ng-version', PLACEHOLDER);
    return printer(masked, config, indentation, depth, refs);
  },
});
