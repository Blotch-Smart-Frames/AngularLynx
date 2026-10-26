import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, type Fixture } from '../test-utils';
import type * as Packages from '../utils/packages.js';

const spinnerMock = { start: vi.fn(), stop: vi.fn() };

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: {
    message: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  },
  spinner: vi.fn(() => spinnerMock),
  confirm: vi.fn(),
  group: vi.fn(),
  text: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

// `printBanner` shells out to cfonts, which is noisy in test output and
// unrelated to init's own logic (it has its own dedicated test file).
vi.mock('../utils/banner.js', () => ({ printBanner: vi.fn() }));

let fixture: Fixture;

// Point the "copy theme files from @blotch/ui" step at the fixture's
// __ui_source tree instead of the real dist/ui, same pattern as other command
// tests that need controlled theme file content.
vi.mock('../utils/resolve-paths.js', () => ({
  getUiSourceDir: () => fixture.uiDir,
}));

// Never run a real package manager: init installs @blotch/dolan.
const installPackages = vi.fn((_cwd: string, _specs: string[]) => true);
vi.mock('../utils/packages.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Packages>()),
  installPackages: (cwd: string, specs: string[]) =>
    installPackages(cwd, specs),
}));

/**
 * The text of the "Next steps" note, colors stripped.
 */
const nextSteps = async (): Promise<string> => {
  const p = await import('@clack/prompts');
  const [text] = (p.note as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
  // oxlint-disable-next-line no-control-regex -- matching ANSI color codes
  return (text as string).replace(/\u001b\[\d+m/g, '');
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

const THEME_CSS = 'page { --background: rgba(255, 255, 255, 1); }';
const TAILWIND_PLUGIN = 'export const blotchPlugin = () => {};';

/**
 * Configures the `p.group`/`p.text` mocks to behave like the real
 * @clack/prompts group: invoke each field's builder function and resolve
 * `p.text` to its `defaultValue`. This exercises init.ts's `components: () =>
 * p.text(...)` and `theme: () => p.text(...)` field closures directly,
 * instead of skipping past them with a hardcoded resolved object.
 */
const useDefaultGroupAnswers = async () => {
  const p = await import('@clack/prompts');
  (p.text as ReturnType<typeof vi.fn>).mockImplementation(
    (opts: { defaultValue?: string }) => Promise.resolve(opts.defaultValue),
  );
  (p.group as ReturnType<typeof vi.fn>).mockImplementation(
    async (fields: Record<string, () => Promise<unknown>>) => {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(fields)) {
        result[key] = await fields[key]();
      }
      return result;
    },
  );
};

describe('initCommand', () => {
  it('writes config and copies theme files on a clean project', async () => {
    fixture = createFixture({
      themeFiles: {
        'default.css': THEME_CSS,
        'dark.css': THEME_CSS,
        'tailwind-plugin.ts': TAILWIND_PLUGIN,
      },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultGroupAnswers();
    const p = await import('@clack/prompts');

    const { initCommand } = await import('./init');
    await initCommand();

    const config = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
    );
    expect(config).toEqual({
      aliases: { components: 'src/components/ui', theme: 'src/styles' },
    });

    expect(
      readFileSync(join(fixture.dir, 'src/styles/default.css'), 'utf-8'),
    ).toBe(THEME_CSS);
    expect(
      readFileSync(join(fixture.dir, 'src/styles/dark.css'), 'utf-8'),
    ).toBe(THEME_CSS);
    expect(
      readFileSync(join(fixture.dir, 'src/styles/tailwind-plugin.ts'), 'utf-8'),
    ).toBe(TAILWIND_PLUGIN);

    expect(existsSync(join(fixture.dir, 'src/components/ui'))).toBe(true);
    expect(p.note).toHaveBeenCalled();
  });

  it('skips a theme file that does not exist upstream', async () => {
    // Only default.css is provided upstream — dark.css and tailwind-plugin.ts
    // should simply be skipped (the `if (!existsSync(src)) return;` guard),
    // not throw.
    fixture = createFixture({
      themeFiles: { 'default.css': THEME_CSS },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultGroupAnswers();

    const { initCommand } = await import('./init');
    await initCommand();

    expect(existsSync(join(fixture.dir, 'src/styles/default.css'))).toBe(true);
    expect(existsSync(join(fixture.dir, 'src/styles/dark.css'))).toBe(false);
    expect(existsSync(join(fixture.dir, 'src/styles/tailwind-plugin.ts'))).toBe(
      false,
    );
  });

  it('prompts to overwrite an existing config and proceeds when confirmed', async () => {
    fixture = createFixture({
      themeFiles: { 'default.css': THEME_CSS },
    });
    // Pre-seed an existing config so `configExists` is true.
    writeFileSync(
      join(fixture.dir, 'dolan.config.json'),
      JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultGroupAnswers();
    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { initCommand } = await import('./init');
    await initCommand();

    expect(p.confirm).toHaveBeenCalled();
    const config = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
    );
    expect(config.aliases.components).toBe('src/components/ui');
  });

  it('cancels when overwrite is declined', async () => {
    fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
    writeFileSync(
      join(fixture.dir, 'dolan.config.json'),
      JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const { initCommand } = await import('./init');
    await expect(initCommand()).rejects.toThrow('process.exit(0)');
    expect(p.cancel).toHaveBeenCalledWith('Init canceled.');
  });

  it('cancels when the overwrite confirm prompt itself is canceled', async () => {
    fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
    writeFileSync(
      join(fixture.dir, 'dolan.config.json'),
      JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(Symbol('cancel'));
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      true,
    );

    const { initCommand } = await import('./init');
    await expect(initCommand()).rejects.toThrow('process.exit(0)');
  });

  it('cancels via the group onCancel handler when a prompt in the group is canceled', async () => {
    fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    // Simulate @clack/prompts invoking the onCancel callback passed to
    // p.group when one of the grouped prompts is canceled.
    (p.group as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fields, config: { onCancel: () => void }) => {
        config.onCancel();
        return {};
      },
    );

    const { initCommand } = await import('./init');
    await expect(initCommand()).rejects.toThrow('process.exit(0)');
    expect(p.cancel).toHaveBeenCalledWith('Init canceled.');
  });

  describe('theme files that already exist', () => {
    const seedTheme = (files: Record<string, string>) => {
      mkdirSync(join(fixture.dir, 'src/styles'), { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        writeFileSync(join(fixture.dir, 'src/styles', file), content);
      }
    };
    const theme = (file: string) =>
      readFileSync(join(fixture.dir, 'src/styles', file), 'utf-8');

    beforeEach(() => {
      fixture = createFixture({
        themeFiles: {
          'default.css': THEME_CSS,
          'dark.css': THEME_CSS,
          'tailwind-plugin.ts': TAILWIND_PLUGIN,
        },
      });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    });

    it('asks before replacing them, and keeps them when declined', async () => {
      seedTheme({
        'default.css': 'page { --mine: red; }',
        'dark.css': THEME_CSS,
      });
      await useDefaultGroupAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { initCommand } = await import('./init');
      await initCommand();

      // Only the file that differs is asked about; dark.css already matches.
      expect(p.confirm).toHaveBeenCalledTimes(1);
      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/default\.css.*already exist/),
          initialValue: false,
        }),
      );
      expect(theme('default.css')).toBe('page { --mine: red; }');
      // A file that wasn't there is still written.
      expect(theme('tailwind-plugin.ts')).toBe(TAILWIND_PLUGIN);
      expect(p.log.info).toHaveBeenCalledWith(
        expect.stringContaining('dolan init --force'),
      );
    });

    it('keeps them when the question is canceled', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      await useDefaultGroupAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(
        Symbol('cancel'),
      );
      (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        true,
      );

      const { initCommand } = await import('./init');
      await initCommand();

      expect(theme('default.css')).toBe('page { --mine: red; }');
    });

    it('replaces them when confirmed', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      await useDefaultGroupAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { initCommand } = await import('./init');
      await initCommand();

      expect(theme('default.css')).toBe(THEME_CSS);
      expect(p.log.info).not.toHaveBeenCalled();
    });

    it('replaces them, and an existing config, without asking with --force', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      writeFileSync(
        join(fixture.dir, 'dolan.config.json'),
        JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
      );
      await useDefaultGroupAnswers();
      const p = await import('@clack/prompts');

      const { initCommand } = await import('./init');
      await initCommand({ force: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(theme('default.css')).toBe(THEME_CSS);
    });
  });

  describe('@blotch/dolan and the next steps', () => {
    beforeEach(() => {
      fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    });

    it('installs @blotch/dolan, which the components import', async () => {
      await useDefaultGroupAnswers();
      const { version } = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
      ) as { version: string };

      const { initCommand } = await import('./init');
      await initCommand();

      expect(installPackages).toHaveBeenCalledWith(fixture.dir, [
        `@blotch/dolan@^${version}`,
      ]);
      const steps = await nextSteps();
      expect(steps).not.toContain('Add @blotch/dolan');
      // A local install makes `npx dolan` run this CLI.
      expect(steps).toContain('npx dolan add button card');
    });

    it("doesn't install @blotch/dolan when the project has it", async () => {
      writeFileSync(
        join(fixture.dir, 'package.json'),
        JSON.stringify({ dependencies: { '@blotch/dolan': '^22.0.0' } }),
      );
      await useDefaultGroupAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      expect(installPackages).not.toHaveBeenCalled();
    });

    it('says how to install it when the install fails, and why', async () => {
      installPackages.mockReturnValueOnce(false);
      await useDefaultGroupAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      const steps = await nextSteps();
      expect(steps).toMatch(/1\. Add @blotch\/dolan to your dependencies/);
      expect(steps).toContain('@blotch/dolan/utils/cn');
      expect(steps).toContain('npm install @blotch/dolan@^');
      // Without a local install, `npx dolan` is an unrelated package.
      expect(steps).toContain('npx @blotch/dolan add button card');
    });

    it('imports the theme relative to the global stylesheet, dark.css too', async () => {
      await useDefaultGroupAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      const steps = await nextSteps();
      expect(steps).toContain('Import the theme in src/styles.css');
      expect(steps).toContain("@import './styles/default.css';");
      expect(steps).toContain("@import './styles/dark.css';");
      expect(steps).toContain(
        "import { blotchPlugin } from './src/styles/tailwind-plugin';",
      );
    });
  });
});

describe('globalStylesheet', () => {
  beforeEach(() => {
    fixture = createFixture({});
  });

  const writeWorkspace = (styles: unknown) =>
    writeFileSync(
      join(fixture.dir, 'angular.json'),
      JSON.stringify({
        projects: {
          app: { architect: { build: { options: { styles } } } },
        },
      }),
    );

  it("reads the first project's first stylesheet", async () => {
    const { globalStylesheet } = await import('./init');
    writeWorkspace(['src/global.css', 'src/other.css']);
    expect(globalStylesheet(fixture.dir)).toBe('src/global.css');
    writeWorkspace([{ input: 'src/app.css', bundleName: 'app' }]);
    expect(globalStylesheet(fixture.dir)).toBe('src/app.css');
  });

  it('falls back to src/styles.css', async () => {
    const { globalStylesheet } = await import('./init');
    expect(globalStylesheet(fixture.dir)).toBe('src/styles.css');
    writeWorkspace([]);
    expect(globalStylesheet(fixture.dir)).toBe('src/styles.css');
    writeFileSync(join(fixture.dir, 'angular.json'), JSON.stringify({}));
    expect(globalStylesheet(fixture.dir)).toBe('src/styles.css');
  });
});

describe('cssImportPath', () => {
  it('is relative to the importing stylesheet', async () => {
    const { cssImportPath } = await import('./init');
    expect(cssImportPath('src/styles.css', 'src/styles/default.css')).toBe(
      './styles/default.css',
    );
    expect(cssImportPath('src/app/app.css', 'src/styles/dark.css')).toBe(
      '../styles/dark.css',
    );
    expect(cssImportPath('styles.css', 'theme/default.css')).toBe(
      './theme/default.css',
    );
  });
});
