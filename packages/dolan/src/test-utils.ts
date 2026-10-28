import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DolanConfig } from './config';
import type { Lockfile } from './lockfile';

export type FixtureOptions = {
  config?: DolanConfig;
  lockfile?: Lockfile;
  components?: Record<string, Record<string, string>>;
  uiSource?: Record<string, Record<string, string>>;
  themeFiles?: Record<string, string>;
};

export type Fixture = {
  dir: string;
  uiDir: string;
  cleanup: () => void;
};

export const createFixture = (options: FixtureOptions = {}): Fixture => {
  const dir = join(tmpdir(), `dolan-test-${randomUUID().slice(0, 8)}`);
  const uiDir = join(dir, '__ui_source');

  mkdirSync(dir, { recursive: true });
  mkdirSync(uiDir, { recursive: true });

  if (options.config) {
    writeFileSync(
      join(dir, 'dolan.config.json'),
      JSON.stringify(options.config, null, 2),
    );

    // Create the directories referenced in config
    mkdirSync(join(dir, options.config.aliases.components), {
      recursive: true,
    });
    if (options.config.aliases.utils) {
      mkdirSync(join(dir, options.config.aliases.utils), { recursive: true });
    }
    mkdirSync(join(dir, options.config.aliases.theme), { recursive: true });
  }

  if (options.lockfile) {
    writeFileSync(
      join(dir, 'dolan.lock.json'),
      JSON.stringify(options.lockfile, null, 2),
    );
  }

  if (options.components && options.config) {
    const componentsDir = join(dir, options.config.aliases.components);
    for (const [name, files] of Object.entries(options.components)) {
      const componentDir = join(componentsDir, name);
      mkdirSync(componentDir, { recursive: true });
      for (const [fileName, content] of Object.entries(files)) {
        writeFileSync(join(componentDir, fileName), content);
      }
    }
  }

  if (options.uiSource) {
    const componentsDir = join(uiDir, 'components');
    mkdirSync(componentsDir, { recursive: true });
    for (const [name, files] of Object.entries(options.uiSource)) {
      const componentDir = join(componentsDir, name);
      mkdirSync(componentDir, { recursive: true });
      for (const [fileName, content] of Object.entries(files)) {
        writeFileSync(join(componentDir, fileName), content);
      }
    }
  }

  if (options.themeFiles) {
    const themeDir = join(uiDir, 'theme');
    mkdirSync(themeDir, { recursive: true });
    for (const [fileName, content] of Object.entries(options.themeFiles)) {
      writeFileSync(join(themeDir, fileName), content);
    }
  }

  return {
    dir,
    uiDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

export const DEFAULT_CONFIG: DolanConfig = {
  aliases: {
    components: 'src/components/ui',
    utils: 'src/lib/utils',
    theme: 'src/styles',
  },
};

/**
 * Sets the project in `dir` up for a Tailwind version as apps have it:
 * Tailwind 4 as `ng add` installs it (`tailwindcss` and `@tailwindcss/postcss`,
 * no Tailwind config), or Tailwind 3 with a `tailwind.config.ts`. Tailwind is
 * both listed and installed, so it's found by reading `package.json` or by
 * resolving the package. `testing` adds the testing library, so dolan copies
 * tests, and `dependencies` are listed as well.
 */
export const onTailwind = (
  dir: string,
  version: 3 | 4,
  {
    testing = false,
    dependencies = {},
  }: { testing?: boolean; dependencies?: Record<string, string> } = {},
): void => {
  const installed = version === 4 ? '4.3.3' : '3.4.19';
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      dependencies,
      devDependencies: {
        tailwindcss: `^${installed}`,
        ...(version === 4 && { '@tailwindcss/postcss': `^${installed}` }),
        ...(testing && { '@blotch/angular-lynx-testing-library': '^22.2.4' }),
      },
    }),
  );
  mkdirSync(join(dir, 'node_modules', 'tailwindcss'), { recursive: true });
  writeFileSync(
    join(dir, 'node_modules', 'tailwindcss', 'package.json'),
    JSON.stringify({ name: 'tailwindcss', version: installed }),
  );
  if (version === 3) {
    writeFileSync(join(dir, 'tailwind.config.ts'), 'export default {};');
  }
};

/**
 * A theme file exactly as 22.2.2's `init` copied it (from the v22.2.2 tag),
 * which left the lockfile without its hash. lockfile.ts knows its hash. The
 * plugin is stored as `.txt`, so the build, lint, format and coverage, which
 * would each take it for dolan's own source, leave it alone.
 */
export const shippedTheme = (
  file: 'default.css' | 'dark.css' | 'tailwind-plugin.ts',
): string =>
  readFileSync(
    new URL(
      `./fixtures/theme-22.2.2/${file.endsWith('.ts') ? `${file}.txt` : file}`,
      import.meta.url,
    ),
    'utf-8',
  );
