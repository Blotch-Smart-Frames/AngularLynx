import { HostTree } from '@angular-devkit/schematics';
import { describe, expect, it } from 'vitest';

import { installedTailwindVersion, tailwindVersionFor } from './tailwind';

/**
 * A tree whose package.json has these dev dependencies, or none at all.
 */
const treeWith = (devDependencies?: Record<string, string>) => {
  const tree = new HostTree();
  if (devDependencies) {
    tree.create('package.json', JSON.stringify({ devDependencies }));
  }
  return tree;
};

describe('installedTailwindVersion', () => {
  it("reads the major version from the project's range", () => {
    expect(installedTailwindVersion(treeWith({ tailwindcss: '^3.4.19' }))).toBe(
      '3',
    );
    expect(installedTailwindVersion(treeWith({ tailwindcss: '~4.1.0' }))).toBe(
      '4',
    );
    expect(
      installedTailwindVersion(treeWith({ '@tailwindcss/postcss': '^4.0.0' })),
    ).toBe('4');
  });

  it("is undefined when it can't tell", () => {
    expect(installedTailwindVersion(treeWith())).toBeUndefined();
    expect(installedTailwindVersion(treeWith({}))).toBeUndefined();
    expect(
      installedTailwindVersion(treeWith({ tailwindcss: 'latest' })),
    ).toBeUndefined();
    expect(
      installedTailwindVersion(treeWith({ tailwindcss: '^2.2.0' })),
    ).toBeUndefined();
  });
});

describe('tailwindVersionFor', () => {
  it('prefers the version asked for, as a string or a number', () => {
    const tree = treeWith({ tailwindcss: '^4.0.0' });
    expect(tailwindVersionFor(tree, 3)).toBe('3');
    expect(tailwindVersionFor(tree, '3')).toBe('3');
  });

  it("falls back to the project's version, then to 4", () => {
    expect(
      tailwindVersionFor(treeWith({ tailwindcss: '^3.0.0' }), undefined),
    ).toBe('3');
    expect(tailwindVersionFor(treeWith(), undefined)).toBe('4');
  });
});
