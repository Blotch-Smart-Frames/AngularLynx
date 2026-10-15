import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import schema from './schema.json';

/**
 * Angular's component schematic schema, which its `exports` don't list.
 */
const angularSchema = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(
        createRequire(import.meta.url).resolve(
          '@schematics/angular/package.json',
        ),
      ),
      'component/schema.json',
    ),
    'utf8',
  ),
) as { properties: Record<string, Record<string, unknown>> };

describe('the component schematic', () => {
  it("takes the options of Angular's component schematic, which it hands them to", () => {
    // Update schema.json when this fails after an Angular update: copy
    // Angular's properties without their `default`s.
    const withoutDefaults = Object.fromEntries(
      Object.entries(angularSchema.properties).map(
        ([name, { default: _default, ...option }]) => [name, option],
      ),
    );
    expect(schema.properties).toEqual(withoutDefaults);
  });
});
