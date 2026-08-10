import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';
import { hashContent } from '../lockfile';

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
  select: vi.fn().mockResolvedValue('__none__'),
  isCancel: vi.fn().mockReturnValue(false),
}));

let fixture: Fixture;

vi.mock('../utils/resolve-paths.js', () => ({
  getUiSourceDir: () => fixture.uiDir,
  getComponentSourceDir: (name: string) =>
    join(fixture.uiDir, 'components', name),
  getComponentFiles: (name: string) =>
    readdirSync(join(fixture.uiDir, 'components', name)).filter((f) =>
      f.endsWith('.ts'),
    ),
  rewriteImports: (content: string) => content,
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

describe('diffCommand', () => {
  it('reports all up to date when content matches upstream', async () => {
    const content = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(content) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': content } },
      uiSource: { card: { 'card.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand();

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('up to date'),
    );
  });

  it('shows diff output for a specific changed component', async () => {
    const installed = 'export const Card = { old: true };';
    const upstream = 'export const Card = { new: true };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(installed) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': installed } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand('card');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('card');
    // Should contain diff markers (colored, but the text is there)
    expect(messages).toContain('old');
    expect(messages).toContain('new');
  });

  it('exits with error for non-installed component', async () => {
    const content = 'export const Card = {};';
    // Need at least one installed component to pass the early-exit check
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          spinner: { 'spinner.ts': { hash: hashContent(content) } },
        },
        utils: {},
        theme: {},
      },
      components: { spinner: { 'spinner.ts': content } },
      uiSource: {
        card: { 'card.ts': content },
        spinner: { 'spinner.ts': content },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await expect(diffCommand('card')).rejects.toThrow('process.exit(1)');
  });

  it('exits with error for unknown component', async () => {
    const content = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { spinner: { 'spinner.ts': content } },
      uiSource: { spinner: { 'spinner.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await expect(diffCommand('nonexistent')).rejects.toThrow('process.exit(1)');
  });
});
