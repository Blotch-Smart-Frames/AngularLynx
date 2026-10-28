import { describe, expect, it } from 'vitest';

import { readdirSync, readFileSync } from 'node:fs';
import {
  getComponentNames,
  getEntry,
  registry,
  resolveDependencies,
  resolvePackages,
} from './registry';

describe('getComponentNames', () => {
  it('returns all component names', () => {
    const names = getComponentNames();
    expect(names).toContain('button');
    expect(names).toContain('card');
    expect(names).toContain('spinner');
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('getEntry', () => {
  it('returns entry for existing component', () => {
    const entry = getEntry('button');
    expect(entry).toEqual({
      name: 'button',
      dependencies: ['spinner', 'glass', 'icon'],
      packages: ['class-variance-authority@^0.7.1'],
      themeColors: [
        'glass-tint',
        'glass-tint-foreground',
        'glass-foreground',
        'glass-muted-foreground',
        'glass-clear-foreground',
        'glass-dim',
      ],
    });
  });

  it('returns undefined for non-existent component', () => {
    expect(getEntry('nonexistent')).toBeUndefined();
  });
});

describe('resolveDependencies', () => {
  it('returns component with no dependencies', () => {
    expect(resolveDependencies(['card'])).toEqual(['card']);
  });

  it('resolves transitive dependencies in dependency-first order', () => {
    const resolved = resolveDependencies(['button']);
    expect(resolved).toEqual(['icon', 'spinner', 'glass', 'button']);
  });

  it('deduplicates when dependency is also explicitly listed', () => {
    const resolved = resolveDependencies(['button', 'spinner']);
    expect(resolved).toEqual(['icon', 'spinner', 'glass', 'button']);
  });

  it('handles empty input', () => {
    expect(resolveDependencies([])).toEqual([]);
  });

  it('resolves empty-state with its icon dependency', () => {
    const resolved = resolveDependencies(['empty-state']);
    expect(resolved).toEqual(['icon', 'empty-state']);
  });

  it('resolves select with its bottom-sheet dependency', () => {
    expect(resolveDependencies(['select'])).toEqual([
      'icon',
      'glass',
      'bottom-sheet',
      'select',
    ]);
  });

  it('resolves sheet with its bottom-sheet dependency', () => {
    expect(resolveDependencies(['sheet'])).toEqual([
      'icon',
      'glass',
      'bottom-sheet',
      'sheet',
    ]);
  });

  it.each([
    'line-chart',
    'area-chart',
    'bar-chart',
    'scatter-chart',
    'candlestick-chart',
  ])('resolves %s with the chart it builds on first', (preset) => {
    expect(resolveDependencies([preset])).toEqual(['chart', preset]);
  });

  it('deduplicates bottom-sheet when both select and sheet are selected', () => {
    expect(resolveDependencies(['select', 'sheet'])).toEqual([
      'icon',
      'glass',
      'bottom-sheet',
      'select',
      'sheet',
    ]);
  });

  it('skips unknown component names', () => {
    expect(resolveDependencies(['nonexistent'])).toEqual([]);
  });

  it("lists every component another one's files import", () => {
    // A component that imports a sibling it doesn't list gets copied without
    // it, and the app doesn't build. Tests count too: dolan copies them.
    const components = new URL('../../ui/src/lib/components/', import.meta.url);
    for (const name of getComponentNames()) {
      const folder = new URL(`${name}/`, components);
      const imported = new Set<string>();
      for (const file of readdirSync(folder)) {
        const source = readFileSync(new URL(file, folder), 'utf-8');
        for (const [, sibling] of source.matchAll(/from '\.\.\/([\w-]+)/g)) {
          imported.add(sibling!);
        }
      }
      expect([...imported].sort(), name).toEqual(
        [...getEntry(name)!.dependencies].sort(),
      );
    }
  });
});

describe('resolvePackages', () => {
  it('collects the npm packages of the given components, once each', () => {
    const packages = resolvePackages(['chart', 'line-chart', 'card']);
    expect(packages.map((spec) => spec.replace(/@[^@]*$/, ''))).toEqual([
      '@tanstack/charts',
      'd3-shape',
    ]);
    expect(resolvePackages(['card', 'nonexistent'])).toEqual([]);
  });

  it('asks for the versions packages/ui builds against', () => {
    const ui = JSON.parse(
      readFileSync(new URL('../../ui/package.json', import.meta.url), 'utf-8'),
    ) as { dependencies: Record<string, string> };
    for (const entry of registry) {
      for (const spec of entry.packages ?? []) {
        const at = spec.lastIndexOf('@');
        expect(ui.dependencies[spec.slice(0, at)], spec).toBe(
          spec.slice(at + 1),
        );
      }
    }
  });

  it('lists every npm package a component imports', () => {
    // A component whose import isn't listed gets copied without the package,
    // and the app doesn't build (class-variance-authority, #65). A package its
    // dependencies list counts too (the chart presets use `chart`'s), since
    // `add` installs those along with it. Angular, the runtime and dolan's own
    // utils are already the app's dependencies; tests aren't checked, since
    // their imports only matter to a test setup.
    const provided = /^(@angular\/|@blotch\/angular-lynx|@blotch\/dolan\/)/;
    const components = new URL('../../ui/src/lib/components/', import.meta.url);
    for (const { name } of registry) {
      const folder = new URL(`${name}/`, components);
      const imported = new Set<string>();
      for (const file of readdirSync(folder)) {
        if (file.endsWith('.test.ts')) continue;
        const source = readFileSync(new URL(file, folder), 'utf-8');
        for (const [, specifier] of source.matchAll(/from '([^.'][^']*)'/g)) {
          if (provided.test(specifier!)) continue;
          // `@scope/name/sub/path` and `name/sub/path` → the package name.
          const parts = specifier!.split('/');
          imported.add(
            parts.slice(0, specifier!.startsWith('@') ? 2 : 1).join('/'),
          );
        }
      }
      const listed = resolvePackages(resolveDependencies([name])).map((spec) =>
        spec.slice(0, spec.lastIndexOf('@')),
      );
      expect(listed, name).toEqual(expect.arrayContaining([...imported]));
    }
  });
});

describe('themeColors', () => {
  it("names colors dolan's theme sets in both schemes and maps for both Tailwinds", () => {
    // doctor checks an app's theme for these, and quotes dolan's lines.
    const theme = new URL('../../ui/src/lib/theme/', import.meta.url);
    const read = (file: string) => readFileSync(new URL(file, theme), 'utf-8');
    const [light, dark, plugin, css] = [
      'default.css',
      'dark.css',
      'tailwind-plugin.ts',
      'tailwind.css',
    ].map(read);
    const colors = registry.flatMap((entry) => entry.themeColors ?? []);
    expect(colors).toContain('glass-foreground');
    for (const color of colors) {
      expect(light, color).toContain(`--${color}:`);
      expect(dark, color).toContain(`--${color}:`);
      expect(plugin, color).toMatch(
        new RegExp(`'${color}'|'var\\(--${color}\\)'`),
      );
      expect(css, color).toContain(`var(--${color})`);
    }
  });

  it("lists every glass color the glass component's code names", () => {
    const folder = new URL(
      '../../ui/src/lib/components/glass/',
      import.meta.url,
    );
    const named = new Set<string>();
    for (const file of readdirSync(folder)) {
      if (file.endsWith('.test.ts')) continue;
      const source = readFileSync(new URL(file, folder), 'utf-8');
      for (const [color] of source.matchAll(
        /glass-(?:[a-z]+-)*foreground|glass-tint|glass-dim/g,
      )) {
        named.add(color);
      }
    }
    expect(getEntry('glass')!.themeColors).toEqual(
      expect.arrayContaining([...named]),
    );
  });
});
