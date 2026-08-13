import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';

const spinnerMock = { start: vi.fn(), stop: vi.fn() };

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
  spinner: vi.fn(() => spinnerMock),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

let fixture: Fixture;

// `add` reads component source through resolve-paths — stub it to read from
// the fixture's __ui_source tree instead of the real dist/ui, same pattern
// used by diff.test.ts / update.test.ts.
vi.mock('../utils/resolve-paths.js', () => ({
  getComponentSourceDir: (name: string) =>
    join(fixture.uiDir, 'components', name),
  getComponentFiles: (name: string) =>
    readdirSync(join(fixture.uiDir, 'components', name)).filter((f) =>
      f.endsWith('.ts'),
    ),
  rewriteImports: (content: string) => content,
}));

beforeEach(() => {
  // The @clack/prompts mock above is a module-level vi.fn() object shared by
  // every test in this file (vi.restoreAllMocks() in afterEach only restores
  // vi.spyOn spies, not plain vi.fn() mocks) — clear call history explicitly
  // so assertions like `not.toHaveBeenCalledWith` aren't polluted by earlier tests.
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

const readInstalledFile = (dir: string, component: string, file: string) =>
  readFileSync(
    join(dir, DEFAULT_CONFIG.aliases.components, component, file),
    'utf-8',
  );

describe('addCommand', () => {
  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { addCommand } = await import('./add');
    await expect(addCommand(['card'])).rejects.toThrow('process.exit(1)');
  });

  it('copies explicitly-named components and records lockfile hashes', async () => {
    const content = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: { card: { 'card.ts': content } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { addCommand } = await import('./add');
    await addCommand(['card']);

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(content);

    const lockfile = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'),
    );
    expect(lockfile.components.card['card.ts'].hash).toBeDefined();

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('Added 1 component(s)'),
    );
  });

  it('exits with error for unknown explicit component names', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: { card: { 'card.ts': '' } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { addCommand } = await import('./add');
    await expect(addCommand(['nonexistent'])).rejects.toThrow(
      'process.exit(1)',
    );

    const p = await import('@clack/prompts');
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining('Available:'),
    );
  });

  it('surfaces auto-added transitive dependencies', async () => {
    // button depends on spinner (registry.ts) — requesting only "button"
    // should pull spinner in automatically and announce it.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: {
        button: { 'button.ts': 'export const Button = {};' },
        spinner: { 'spinner.ts': 'export const Spinner = {};' },
      },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { addCommand } = await import('./add');
    await addCommand(['button']);

    const p = await import('@clack/prompts');
    // "spinner" is wrapped in its own pc.cyan(...) span, so when colors are
    // enabled (e.g. an interactive TTY) ANSI codes sit between "dependencies:"
    // and "spinner" — a plain stringContaining would fail outside CI. Match
    // loosely with a regex instead of relying on literal adjacency.
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringMatching(/Adding dependencies:.*spinner/),
    );
    expect(
      readInstalledFile(fixture.dir, 'spinner', 'spinner.ts'),
    ).toBeDefined();
  });

  it('does not announce dependencies when they were already explicitly requested', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: {
        button: { 'button.ts': 'export const Button = {};' },
        spinner: { 'spinner.ts': 'export const Spinner = {};' },
      },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { addCommand } = await import('./add');
    await addCommand(['button', 'spinner']);

    const p = await import('@clack/prompts');
    expect(p.log.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Adding dependencies'),
    );
  });

  it('prompts with multiselect when no components are given, and installs the selection', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: { card: { 'card.ts': 'export const Card = {};' } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.multiselect as ReturnType<typeof vi.fn>).mockResolvedValue(['card']);

    const { addCommand } = await import('./add');
    await addCommand([]);

    expect(p.multiselect).toHaveBeenCalled();
    expect(
      existsSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components, 'card')),
    ).toBe(true);
  });

  it('cancels when the multiselect prompt is canceled', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.multiselect as ReturnType<typeof vi.fn>).mockResolvedValue(
      Symbol('cancel'),
    );
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      true,
    );

    const { addCommand } = await import('./add');
    await expect(addCommand([])).rejects.toThrow('process.exit(0)');
    expect(p.cancel).toHaveBeenCalled();
  });

  it('prompts to overwrite when a component already exists, and proceeds when confirmed', async () => {
    // Also pre-seeds a lockfile entry for the component being re-added — this
    // exercises the "lockfile already tracks this component" branch (as
    // opposed to a brand-new `lockfile.components[name] = {}` initialization).
    const upstream = 'export const Card = { v: 2 };';
    const original = 'export const Card = { v: 1 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: 'stale' } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { addCommand } = await import('./add');
    await addCommand(['card']);

    expect(p.confirm).toHaveBeenCalled();
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
  });

  it('skips overwrite-declined components but still installs the rest', async () => {
    const cardOriginal = 'export const Card = { v: 1 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { card: { 'card.ts': cardOriginal } },
      uiSource: {
        card: { 'card.ts': 'export const Card = { v: 2 };' },
        spinner: { 'spinner.ts': 'export const Spinner = {};' },
      },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const { addCommand } = await import('./add');
    await addCommand(['card', 'spinner']);

    // card declined — left untouched
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(
      cardOriginal,
    );
    // spinner wasn't already installed, so it's unaffected by the decline
    expect(
      readInstalledFile(fixture.dir, 'spinner', 'spinner.ts'),
    ).toBeDefined();
  });

  it('cancels entirely when overwrite is declined and nothing else is left to add', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { card: { 'card.ts': 'export const Card = { v: 1 };' } },
      uiSource: { card: { 'card.ts': 'export const Card = { v: 2 };' } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const { addCommand } = await import('./add');
    await expect(addCommand(['card'])).rejects.toThrow('process.exit(0)');
    expect(p.cancel).toHaveBeenCalledWith('Nothing to add.');
  });

  it('cancels when the overwrite confirm prompt itself is canceled', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { card: { 'card.ts': 'export const Card = { v: 1 };' } },
      uiSource: { card: { 'card.ts': 'export const Card = { v: 2 };' } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(Symbol('cancel'));
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      true,
    );

    const { addCommand } = await import('./add');
    await expect(addCommand(['card'])).rejects.toThrow('process.exit(0)');
  });
});
