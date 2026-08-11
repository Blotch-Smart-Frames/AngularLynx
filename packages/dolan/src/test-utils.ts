import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
