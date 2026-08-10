import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    message: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

let fixture: Fixture;

vi.mock('../utils/resolve-paths.js', () => ({
  getUiSourceDir: () => fixture.uiDir,
}));

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

const THEME_TEMPLATE = `/*
 * @blotch/ui default theme
 */

page {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
}
`;

describe('themeCommand', () => {
  it('lists installed theme CSS files', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      themeFiles: { 'default.css': THEME_TEMPLATE },
    });

    // Put a theme file in the project theme dir too
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      THEME_TEMPLATE,
    );
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'dark.css'),
      'page.dark {}',
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { themeCommand } = await import('./theme');
    await themeCommand();

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('default');
    expect(messages).toContain('dark');
  });

  it('creates a new theme from the default template', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      themeFiles: { 'default.css': THEME_TEMPLATE },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { themeCommand } = await import('./theme');
    await themeCommand('ocean');

    const themePath = join(
      fixture.dir,
      DEFAULT_CONFIG.aliases.theme,
      'ocean.css',
    );
    expect(existsSync(themePath)).toBe(true);

    const content = readFileSync(themePath, 'utf-8');
    expect(content).toContain('Custom theme: ocean');
    expect(content).toContain('--background');
    expect(p.log.success).toHaveBeenCalled();
  });

  it('errors if theme already exists', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      themeFiles: { 'default.css': THEME_TEMPLATE },
    });

    // Create the theme file in the project
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'ocean.css'),
      'existing',
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { themeCommand } = await import('./theme');
    await expect(themeCommand('ocean')).rejects.toThrow('process.exit(1)');
  });

  it('errors if no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { themeCommand } = await import('./theme');
    await expect(themeCommand()).rejects.toThrow('process.exit(1)');
  });
});
