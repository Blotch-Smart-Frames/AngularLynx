import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
} from '../components/icon/icon-theme';

/**
 * `<ui-icon>`, `<ui-spinner>` and pagination draw through native SVG, which
 * can't read CSS variables, so icon-theme.ts keeps a TypeScript copy of the
 * theme's colors. This keeps the copy in step with default.css and dark.css.
 */
const tokens = (file: string): Record<string, string> => {
  const css = readFileSync(new URL(file, import.meta.url), 'utf8');
  const values: Record<string, string> = {};
  for (const match of css.matchAll(/--([\w-]+):\s*(rgba\([^)]*\))/g)) {
    values[match[1]!] = match[2]!;
  }
  return values;
};

describe('icon color tables', () => {
  it('match default.css', () => {
    expect(ICON_LIGHT_COLORS).toEqual(tokens('./default.css'));
  });

  it('match dark.css', () => {
    expect(ICON_DARK_COLORS).toEqual(tokens('./dark.css'));
  });
});
