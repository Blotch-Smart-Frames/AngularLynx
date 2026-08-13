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
}));

let fixture: Fixture;
let consoleSpy: ReturnType<typeof vi.spyOn>;

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
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

describe('outdatedCommand', () => {
  it('shows nothing when all components are up-to-date', async () => {
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
    const { outdatedCommand } = await import('./outdated');
    await outdatedCommand({});

    expect(p.log.success).toHaveBeenCalled();
  });

  it('lists outdated components in JSON mode and exits with code 1', async () => {
    const installed = 'export const Card = {};';
    const upstream = 'export const Card = { v2: true };';
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

    const { outdatedCommand } = await import('./outdated');
    await expect(outdatedCommand({ json: true })).rejects.toThrow(
      'process.exit(1)',
    );

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(1);
    expect(output.components[0].name).toBe('card');
    expect(output.components[0].status).toBe('auto-update');
  });

  it('exits with error (json) when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { outdatedCommand } = await import('./outdated');
    await expect(outdatedCommand({ json: true })).rejects.toThrow(
      'process.exit(1)',
    );

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.error).toBe('no config found');
  });

  it('exits with error (non-json) when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { outdatedCommand } = await import('./outdated');
    await expect(outdatedCommand({})).rejects.toThrow('process.exit(1)');

    expect(p.intro).toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan.config.json'),
    );
  });

  it('returns empty JSON when the components directory does not exist', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    const { rmSync } = await import('node:fs');
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { outdatedCommand } = await import('./outdated');
    await outdatedCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(0);
  });

  it('reports success (non-json) when the components directory does not exist', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    const { rmSync } = await import('node:fs');
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { outdatedCommand } = await import('./outdated');
    await outdatedCommand({});

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('returns empty JSON when nothing installed is recognized', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });
    // components dir exists (via createFixture) but empty

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { outdatedCommand } = await import('./outdated');
    await outdatedCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(0);
  });

  it('reports success (non-json) when nothing installed is recognized', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { outdatedCommand } = await import('./outdated');
    await outdatedCommand({});

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('prints the non-json outdated listing and exits 1', async () => {
    const installed = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
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
    const { outdatedCommand } = await import('./outdated');
    await expect(outdatedCommand({})).rejects.toThrow('process.exit(1)');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('card');

    const outroCalls = (p.outro as ReturnType<typeof vi.fn>).mock.calls;
    const outroArg = outroCalls[outroCalls.length - 1][0] as string;
    expect(outroArg).toContain('component(s) need attention');
  });

  it('handles a multi-file outdated component with no lockfile entry at all', async () => {
    // lockfile.components['card'] is entirely absent (exercises the
    // `lockfile.components[name] ?? {}` fallback) and one file is missing on
    // disk (new-upstream, exercises the `currentContent === null` path).
    // Two files also exercises the plural "N files" label in the listing.
    const mainContent = 'export const Card = {};';
    const newFileContent = 'export const CardNew = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      components: { card: { 'card.ts': mainContent } },
      uiSource: {
        card: { 'card.ts': mainContent, 'card-new.ts': newFileContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { outdatedCommand } = await import('./outdated');
    await expect(outdatedCommand({})).rejects.toThrow('process.exit(1)');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('2 files');
  });

  it('returns empty JSON when all up-to-date and exits 0', async () => {
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

    const { outdatedCommand } = await import('./outdated');
    // exit(0) is called — but since our mock throws, catch it
    await expect(outdatedCommand({ json: true })).rejects.toThrow(
      'process.exit(0)',
    );

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(0);
  });
});
