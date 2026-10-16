import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ownVersionRange } from './versions';

describe('ownVersionRange', () => {
  it("is a caret range on the runtime's own version", () => {
    // Read from here rather than imported: it must be the runtime's
    // package.json, not schematics/package.json one folder closer.
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(ownVersionRange()).toBe(`^${version}`);
  });
});
