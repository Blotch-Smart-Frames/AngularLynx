import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, installPackage, type Fixture } from '../test-utils';
import { hashContent, type Lockfile } from '../lockfile';
import type * as Packages from '../utils/packages.js';
import type * as ResolvePaths from '../utils/resolve-paths.js';

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
  text: vi.fn(),
  cancel: vi.fn(),
  // As the real one: a canceled prompt resolves to a symbol.
  isCancel: vi.fn((value: unknown) => typeof value === 'symbol'),
}));

// `printBanner` shells out to cfonts, which is noisy in test output and
// unrelated to init's own logic (it has its own dedicated test file).
vi.mock('../utils/banner.js', () => ({ printBanner: vi.fn() }));

let fixture: Fixture;

// Point the "copy theme files from @blotch/ui" step at the fixture's
// __ui_source tree instead of the real dist/ui, same pattern as other command
// tests that need controlled theme file content.
vi.mock('../utils/resolve-paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ResolvePaths>()),
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

// Vitest's stdin isn't a terminal, which reads as "nobody can answer". Most
// tests are about the questions, so they run as if in one.
let interactive = true;
vi.mock('../utils/interactive.js', () => ({
  isInteractive: () => interactive,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  interactive = true;
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

const THEME_CSS = 'page { --background: rgba(255, 255, 255, 1); }';
const TAILWIND_PLUGIN = 'export const blotchPlugin = () => {};';

const readLockfile = (): Lockfile =>
  JSON.parse(readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'));

/**
 * Answers each folder question as pressing Enter does in the real
 * @clack/prompts: with its `defaultValue`. That keeps the defaults coming from
 * init.ts's own `p.text` calls instead of a hardcoded answer.
 */
const useDefaultAnswers = async () => {
  const p = await import('@clack/prompts');
  (p.text as ReturnType<typeof vi.fn>).mockImplementation(
    (opts: { defaultValue?: string }) => Promise.resolve(opts.defaultValue),
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
    await useDefaultAnswers();
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

  // Without them, the first `update` after a release that changed the theme
  // called all three files a conflict, though nobody had touched them.
  it("records the theme files' hashes, so update can tell they're untouched", async () => {
    fixture = createFixture({
      themeFiles: {
        'default.css': THEME_CSS,
        'dark.css': THEME_CSS,
        'tailwind-plugin.ts': TAILWIND_PLUGIN,
      },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultAnswers();

    const { initCommand } = await import('./init');
    await initCommand();

    expect(readLockfile().theme).toEqual({
      'default.css': { hash: hashContent(THEME_CSS) },
      'dark.css': { hash: hashContent(THEME_CSS) },
      'tailwind-plugin.ts': { hash: hashContent(TAILWIND_PLUGIN) },
    });
  });

  it('keeps the components an existing lockfile tracks', async () => {
    const card = { 'card.ts': { hash: 'abc' } };
    fixture = createFixture({
      lockfile: { version: 1, components: { card }, theme: {} },
      themeFiles: { 'default.css': THEME_CSS },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultAnswers();

    const { initCommand } = await import('./init');
    await initCommand();

    expect(readLockfile()).toEqual({
      version: 1,
      components: { card },
      theme: { 'default.css': { hash: hashContent(THEME_CSS) } },
    });
  });

  it("copies the Tailwind plugin's test when the project has the testing library", async () => {
    // The test renders nothing, but dolan copies tests along with the testing
    // library, as for components: it covers tailwind-plugin.ts in the app's
    // coverage report.
    const PLUGIN_TEST = "import { blotchPlugin } from './tailwind-plugin';";
    fixture = createFixture({
      themeFiles: {
        'tailwind-plugin.ts': TAILWIND_PLUGIN,
        'tailwind-plugin.test.ts': PLUGIN_TEST,
      },
    });
    const pluginTest = join(fixture.dir, 'src/styles/tailwind-plugin.test.ts');
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    const { initCommand } = await import('./init');

    await initCommand({ yes: true });
    expect(existsSync(pluginTest)).toBe(false);

    writeFileSync(
      join(fixture.dir, 'package.json'),
      JSON.stringify({
        devDependencies: { '@blotch/angular-lynx-testing-library': '^22.2.3' },
      }),
    );
    await initCommand({ yes: true, force: true });
    expect(readFileSync(pluginTest, 'utf-8')).toBe(PLUGIN_TEST);
    expect(readLockfile().theme['tailwind-plugin.test.ts']).toEqual({
      hash: hashContent(PLUGIN_TEST),
    });
  });

  it('skips a theme file that does not exist upstream', async () => {
    // Only default.css is provided upstream — dark.css and tailwind-plugin.ts
    // should simply be skipped (the `if (!existsSync(src)) return;` guard),
    // not throw.
    fixture = createFixture({
      themeFiles: { 'default.css': THEME_CSS },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultAnswers();

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
    await useDefaultAnswers();
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

  it('cancels when a folder question is canceled', async () => {
    fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.text as ReturnType<typeof vi.fn>).mockResolvedValue(Symbol('cancel'));

    const { initCommand } = await import('./init');
    await expect(initCommand()).rejects.toThrow('process.exit(0)');
    expect(p.cancel).toHaveBeenCalledWith('Init canceled.');
    expect(existsSync(join(fixture.dir, 'dolan.config.json'))).toBe(false);
  });

  it('takes the folders from --components and --theme without asking', async () => {
    fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    await useDefaultAnswers();
    const p = await import('@clack/prompts');

    const { initCommand } = await import('./init');
    await initCommand({ theme: 'src/theme' });

    // Only the question without a flag is asked.
    expect(p.text).toHaveBeenCalledTimes(1);
    expect(p.text).toHaveBeenCalledWith(
      expect.objectContaining({ defaultValue: 'src/components/ui' }),
    );
    expect(
      readFileSync(join(fixture.dir, 'src/theme/default.css'), 'utf-8'),
    ).toBe(THEME_CSS);

    vi.clearAllMocks();
    await initCommand({
      force: true,
      components: 'src/ui',
      theme: 'src/theme',
    });

    expect(p.text).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8')),
    ).toEqual({ aliases: { components: 'src/ui', theme: 'src/theme' } });
    expect(existsSync(join(fixture.dir, 'src/ui'))).toBe(true);
    expect(await nextSteps()).toContain("@import './theme/default.css';");
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
      await useDefaultAnswers();
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
      // The kept file isn't upstream's, so upstream's hash isn't its base.
      // The two that are upstream's, written or already matching, are.
      expect(readLockfile().theme).toEqual({
        'dark.css': { hash: hashContent(THEME_CSS) },
        'tailwind-plugin.ts': { hash: hashContent(TAILWIND_PLUGIN) },
      });
    });

    it('leaves the base the lockfile has for a file it keeps', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      writeFileSync(
        join(fixture.dir, 'dolan.lock.json'),
        JSON.stringify({
          version: 1,
          components: {},
          theme: { 'default.css': { hash: 'base' } },
        }),
      );
      await useDefaultAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { initCommand } = await import('./init');
      await initCommand();

      expect(readLockfile().theme['default.css']).toEqual({ hash: 'base' });
    });

    it('keeps them when the question is canceled', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      await useDefaultAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(
        Symbol('cancel'),
      );

      const { initCommand } = await import('./init');
      await initCommand();

      expect(theme('default.css')).toBe('page { --mine: red; }');
    });

    it('replaces them when confirmed', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      await useDefaultAnswers();
      const p = await import('@clack/prompts');
      (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { initCommand } = await import('./init');
      await initCommand();

      expect(theme('default.css')).toBe(THEME_CSS);
      expect(p.log.info).not.toHaveBeenCalled();
      expect(readLockfile().theme['default.css']).toEqual({
        hash: hashContent(THEME_CSS),
      });
    });

    it('replaces them, and an existing config, without asking with --force', async () => {
      seedTheme({ 'default.css': 'page { --mine: red; }' });
      writeFileSync(
        join(fixture.dir, 'dolan.config.json'),
        JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
      );
      await useDefaultAnswers();
      const p = await import('@clack/prompts');

      const { initCommand } = await import('./init');
      await initCommand({ force: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(theme('default.css')).toBe(THEME_CSS);
    });
  });

  // CI, agents and scripts: a question there would wait for input that never
  // comes, so init takes each default instead.
  describe.each([
    {
      when: 'stdin is not a terminal',
      setup: () => {
        interactive = false;
      },
      options: {},
    },
    { when: 'given --yes', setup: () => {}, options: { yes: true } },
  ])('when $when', ({ setup, options }) => {
    beforeEach(() => {
      fixture = createFixture({
        themeFiles: {
          'default.css': THEME_CSS,
          'dark.css': THEME_CSS,
          'tailwind-plugin.ts': TAILWIND_PLUGIN,
        },
      });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
      setup();
    });

    const theme = (file: string) =>
      readFileSync(join(fixture.dir, 'src/styles', file), 'utf-8');

    it('asks nothing and uses the default folders', async () => {
      const p = await import('@clack/prompts');

      const { initCommand } = await import('./init');
      await initCommand(options);

      expect(p.text).not.toHaveBeenCalled();
      expect(p.confirm).not.toHaveBeenCalled();
      expect(
        JSON.parse(
          readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
        ),
      ).toEqual({
        aliases: { components: 'src/components/ui', theme: 'src/styles' },
      });
      expect(theme('default.css')).toBe(THEME_CSS);
      expect(existsSync(join(fixture.dir, 'src/components/ui'))).toBe(true);
      expect(p.note).toHaveBeenCalled();
    });

    it('still takes the folders from --components and --theme', async () => {
      const { initCommand } = await import('./init');
      await initCommand({ ...options, components: 'src/ui', theme: 'theme' });

      expect(
        JSON.parse(
          readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
        ),
      ).toEqual({ aliases: { components: 'src/ui', theme: 'theme' } });
      expect(readFileSync(join(fixture.dir, 'theme/dark.css'), 'utf-8')).toBe(
        THEME_CSS,
      );
    });

    it('keeps theme files that differ, and says how to replace them', async () => {
      mkdirSync(join(fixture.dir, 'src/styles'), { recursive: true });
      writeFileSync(
        join(fixture.dir, 'src/styles/default.css'),
        'page { --mine: red; }',
      );
      const p = await import('@clack/prompts');

      const { initCommand } = await import('./init');
      await initCommand(options);

      expect(p.confirm).not.toHaveBeenCalled();
      expect(theme('default.css')).toBe('page { --mine: red; }');
      expect(theme('dark.css')).toBe(THEME_CSS);
      expect(p.log.info).toHaveBeenCalledWith(
        expect.stringMatching(/default\.css.*differ.*dolan init --force/),
      );
    });

    it('fails on an existing config instead of canceling quietly', async () => {
      const existing = JSON.stringify({
        aliases: { components: 'old', theme: 'old' },
      });
      writeFileSync(join(fixture.dir, 'dolan.config.json'), existing);
      const p = await import('@clack/prompts');

      const { initCommand } = await import('./init');
      await expect(initCommand(options)).rejects.toThrow('process.exit(1)');

      expect(p.confirm).not.toHaveBeenCalled();
      expect(p.log.error).toHaveBeenCalledWith(
        expect.stringContaining('dolan init --force'),
      );
      expect(
        readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
      ).toBe(existing);
      expect(existsSync(join(fixture.dir, 'src/styles'))).toBe(false);
    });

    it('overwrites an existing config and theme files with --force', async () => {
      writeFileSync(
        join(fixture.dir, 'dolan.config.json'),
        JSON.stringify({ aliases: { components: 'old', theme: 'old' } }),
      );
      mkdirSync(join(fixture.dir, 'src/styles'), { recursive: true });
      writeFileSync(
        join(fixture.dir, 'src/styles/default.css'),
        'page { --mine: red; }',
      );

      const { initCommand } = await import('./init');
      await initCommand({ ...options, force: true });

      expect(
        JSON.parse(
          readFileSync(join(fixture.dir, 'dolan.config.json'), 'utf-8'),
        ).aliases.components,
      ).toBe('src/components/ui');
      expect(theme('default.css')).toBe(THEME_CSS);
    });
  });

  describe('@blotch/dolan and the next steps', () => {
    beforeEach(() => {
      fixture = createFixture({ themeFiles: { 'default.css': THEME_CSS } });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    });

    it('installs @blotch/dolan, which the components import', async () => {
      await useDefaultAnswers();
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
      await useDefaultAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      expect(installPackages).not.toHaveBeenCalled();
    });

    it('says how to install it when the install fails, and why', async () => {
      installPackages.mockReturnValueOnce(false);
      await useDefaultAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      const steps = await nextSteps();
      expect(steps).toMatch(/1\. Add @blotch\/dolan to your dependencies/);
      expect(steps).toContain('@blotch/dolan/utils/cn');
      expect(steps).toContain('npm install @blotch/dolan@^');
      // Without a local install, `npx dolan` is an unrelated package.
      expect(steps).toContain('npx @blotch/dolan add button card');
    });

    it('copies tailwind.css and imports the theme in the stylesheet on Tailwind 4', async () => {
      writeFileSync(join(fixture.uiDir, 'theme/tailwind.css'), '@theme {}');
      // As a workspace root or @tailwindcss/postcss may bring it: the
      // project's package.json doesn't list it.
      installPackage(fixture.dir, 'tailwindcss', '4.3.3');
      await useDefaultAnswers();

      const { initCommand } = await import('./init');
      await initCommand();

      const steps = await nextSteps();
      expect(steps).toContain(
        'Import the theme in src/styles.css, after Tailwind',
      );
      expect(steps).toContain("@import './styles/default.css';");
      expect(steps).toContain("@import './styles/tailwind.css';");
      expect(steps).not.toContain('tailwind.config.ts');
      expect(existsSync(join(fixture.dir, 'src/styles/tailwind.css'))).toBe(
        true,
      );
      expect(
        existsSync(join(fixture.dir, 'src/styles/tailwind-plugin.ts')),
      ).toBe(false);
    });

    it('imports the theme relative to the global stylesheet, dark.css too', async () => {
      await useDefaultAnswers();

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
