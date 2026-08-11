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

describe('listCommand', () => {
  it('lists installed components as up-to-date when matching upstream', async () => {
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

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(1);
    expect(output.components[0].name).toBe('card');
    expect(output.components[0].status).toBe('up-to-date');
  });

  it('detects outdated components when upstream differs', async () => {
    const installed = 'export const Card = {};';
    const upstream = 'export const Card = { updated: true };';
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

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components[0].status).toBe('auto-update');
  });

  it('detects user-modified components', async () => {
    const original = 'export const Card = {};';
    const userModified = 'export const Card = { custom: true };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': userModified } },
      uiSource: { card: { 'card.ts': original } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components[0].status).toBe('user-modified');
  });

  it('returns empty array when no components installed', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(0);
  });

  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { listCommand } = await import('./list');
    await expect(listCommand({ json: true })).rejects.toThrow(
      'process.exit(1)',
    );
  });
});
