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
