/// <reference types="node" />
// Not copied into apps (it reads the theme's CSS with Node), like the other
// theme checks next to it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { blotchPlugin } from './tailwind-plugin';

/**
 * Each opaque theme color is written twice: complete (`--primary:
 * rgba(24, 24, 27, 1)`) for plain classes, and as channels (`--primary-rgb:
 * 24, 24, 27`) for opacity modifiers. Nothing at runtime ties the two
 * together, so a typo would make `bg-primary/50` a different color from
 * `bg-primary`. These tests keep the pairs in step.
 */
const variables = (file: string): Map<string, string> => {
  // Comments mention variables too, so they go first.
  // Relative to the package, where `ng test` runs: the test runs from a build
  // of it elsewhere, so `import.meta.url` doesn't point next to the CSS.
  const css = readFileSync(`src/lib/theme/${file}`, 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  return new Map(
    [...css.matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map((match) => [
      match[1]!,
      match[2]!.trim(),
    ]),
  );
};

/**
 * The `--x-rgb` variables the plugin's opacity modifiers read.
 */
const channelVariables = (): string[] => {
  const factory = blotchPlugin as unknown as {
    config: { theme: { extend: { colors: Record<string, unknown> } } };
  };
  const names: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'function') {
      const css = (value as (options: object) => string)({
        opacityValue: '0.5',
      });
      names.push(
        ...[...css.matchAll(/var\((--[\w-]+-rgb)\)/g)].map((m) => m[1]!),
      );
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(walk);
    }
  };
  walk(factory.config.theme.extend.colors);
  return names;
};

describe.each(['./default.css', './dark.css'])('%s', (file) => {
  const vars = variables(file);

  it('has the channels of every color the plugin takes a modifier on', () => {
    const names = channelVariables();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(vars.get(name), name).toMatch(/^\d+, \d+, \d+$/);
    }
  });

  it("gives each color's channels the same values as the color", () => {
    for (const [name, value] of vars) {
      if (!name.endsWith('-rgb')) continue;
      const color = vars.get(name.slice(0, -'-rgb'.length));
      expect(color, `${name} has no color`).toBe(`rgba(${value}, 1)`);
    }
  });

  it('has channels for every opaque color', () => {
    // A new token added without its channels would draw nothing with a
    // modifier.
    for (const [name, value] of vars) {
      const channels = /^rgba\((\d+, \d+, \d+), 1\)$/.exec(value);
      if (!channels) continue;
      expect(vars.get(`${name}-rgb`), `${name}-rgb`).toBe(channels[1]);
    }
  });
});
