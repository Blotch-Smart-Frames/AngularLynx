import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, type Fixture } from '../test-utils';

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
    expect(
      existsSync(join(fixture.dir, 'src/styles/tailwind-plugin.ts')),
    ).toBe(false);
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
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

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
});
