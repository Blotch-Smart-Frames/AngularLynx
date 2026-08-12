import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';
import { hashContent } from '../lockfile';

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
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue('upstream'),
  cancel: vi.fn(),
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

const readLockfile = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'dolan.lock.json'), 'utf-8'));

const readInstalledFile = (dir: string, component: string, file: string) =>
  readFileSync(
    join(dir, DEFAULT_CONFIG.aliases.components, component, file),
    'utf-8',
  );

describe('updateCommand --selective', () => {
  it('applies file when user chooses upstream', async () => {
    const original = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('upstream');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(upstream);

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('skips file and preserves lockfile hash when user chooses keep', async () => {
    const original = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    const originalHash = hashContent(original);
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: originalHash } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(original);

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(originalHash);
  });

  it('handles mixed decisions across multiple files', async () => {
    const cardOriginal = 'export const Card = { v: 1 };';
    const cardUpstream = 'export const Card = { v: 2 };';
    const spinnerOriginal = 'export const Spinner = { v: 1 };';
    const spinnerUpstream = 'export const Spinner = { v: 2 };';
    const cardHash = hashContent(cardOriginal);
    const spinnerHash = hashContent(spinnerOriginal);

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: cardHash } },
          spinner: { 'spinner.ts': { hash: spinnerHash } },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': cardOriginal },
        spinner: { 'spinner.ts': spinnerOriginal },
      },
      uiSource: {
        card: { 'card.ts': cardUpstream },
        spinner: { 'spinner.ts': spinnerUpstream },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('upstream')
      .mockResolvedValueOnce('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    // Card should be updated (first select → upstream)
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(
      cardUpstream,
    );

    // Spinner should be skipped (second select → keep)
    expect(readInstalledFile(fixture.dir, 'spinner', 'spinner.ts')).toBe(
      spinnerOriginal,
    );

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(cardUpstream),
    );
    expect(lockfile.components.spinner['spinner.ts'].hash).toBe(spinnerHash);
  });

  it('does not create new-upstream file when user chooses skip', async () => {
    const upstream = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: {},
      },
      components: { card: {} },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const filePath = join(
      fixture.dir,
      DEFAULT_CONFIG.aliases.components,
      'card',
      'card.ts',
    );
    expect(existsSync(filePath)).toBe(false);

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card?.['card.ts']).toBeUndefined();
  });

  it('force overrides selective — no per-file prompts', async () => {
    const original = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true, selective: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    expect(p.select).not.toHaveBeenCalled();
  });

  it('conflict-keep still advances lockfile hash in selective mode', async () => {
    const base = 'export const Card = { v: 1 };';
    const userVersion = 'export const Card = { v: 1, custom: true };';
    const upstream = 'export const Card = { v: 2 };';
    const baseHash = hashContent(base);

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: baseHash } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': userVersion } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    // File should be untouched
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(userVersion);

    // Lockfile hash should be advanced to upstream (conflict-keep semantics)
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('non-selective mode uses batch confirm, not per-file select', async () => {
    const original = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (p.select as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({});

    expect(p.confirm).toHaveBeenCalled();
    expect(p.select).not.toHaveBeenCalled();
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
  });

  it('shows selective-mode skip message in final summary', async () => {
    const original = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("they'll appear again on next update"),
    );
  });

  it('user-modified files can be reverted to upstream in selective mode', async () => {
    const upstream = 'export const Card = { v: 2 };';
    const userVersion = 'export const Card = { v: 2, custom: true };';
    // Lockfile hash matches upstream — simulates a previous conflict-keep
    // where the base was advanced but the user's file differs
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent(upstream) } },
        },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': userVersion } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValue('upstream');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    // File should be reverted to upstream
    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(upstream);

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });
});

/**
 * `--force` is the destructive path: it must reset every tracked file to the
 * upstream version and advance the lockfile, no matter how the file drifted,
 * and it must never prompt. These tests exhaustively pin that contract because
 * a regression here silently discards user work (or, worse, silently fails to).
 */
describe('updateCommand --force', () => {
  const seedTheme = (fixture: Fixture, fileName: string, content: string) =>
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, fileName),
      content,
    );
  const readTheme = (fixture: Fixture, fileName: string) =>
    readFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, fileName),
      'utf-8',
    );

  it('overwrites a user-modified file (local drift, upstream unchanged)', async () => {
    // base == upstream, but the user edited their copy locally → the file
    // analyzes as "user-modified". Without --force this drift is preserved;
    // with --force it must be discarded and reset to upstream.
    const base = 'export const Card = { v: 1 };';
    const userVersion = 'export const Card = { v: 1, local: true };';
    const upstream = base;
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': userVersion } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockClear();
    (p.confirm as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    // Local edit discarded, file reset to upstream.
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    // Force never prompts.
    expect(p.select).not.toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('overwrites a conflicted file (both local and upstream changed)', async () => {
    // current != base AND upstream != base → "conflict". Interactive mode
    // would prompt; --force resolves every conflict in favor of upstream.
    const base = 'export const Card = { v: 1 };';
    const userVersion = 'export const Card = { v: 1, local: true };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': userVersion } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    expect(p.select).not.toHaveBeenCalled();

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('overwrites a drifted file with no lockfile entry (unknown base → conflict)', async () => {
    // With no stored hash the base is unknown, so any local difference is
    // treated as a conflict. --force must still overwrite it.
    const userVersion = 'export const Card = { v: 1, local: true };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      components: { card: { 'card.ts': userVersion } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('applies a routine auto-update (disk matches base, upstream moved)', async () => {
    const base = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': base } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('creates a new-upstream file that is missing on disk', async () => {
    // Component tracked, but a brand-new file exists upstream that the user
    // has never had. Force should create it.
    const existing = 'export const Card = { v: 1 };';
    const brandNew = 'export const helper = () => 42;';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(existing) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': existing } },
      uiSource: { card: { 'card.ts': existing, 'helper.ts': brandNew } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'helper.ts')).toBe(brandNew);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['helper.ts'].hash).toBe(
      hashContent(brandNew),
    );
  });

  it('leaves an up-to-date file untouched and records its hash', async () => {
    const content = 'export const Card = { v: 1 };';
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

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(content);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(hashContent(content));
  });

  it('resets every file of a multi-file component regardless of per-file status', async () => {
    // One file conflicts, one is user-modified, one is a clean auto-update —
    // force must bring all three to upstream in a single pass.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: {
            'a.ts': { hash: hashContent('base-a') },
            'b.ts': { hash: hashContent('base-b') },
            'c.ts': { hash: hashContent('base-c') },
          },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: {
          'a.ts': 'local-edit-a', // conflict (upstream also moved)
          'b.ts': 'local-edit-b', // user-modified (upstream unchanged)
          'c.ts': 'base-c', // auto-update (disk matches base)
        },
      },
      uiSource: {
        card: {
          'a.ts': 'upstream-a',
          'b.ts': 'base-b',
          'c.ts': 'upstream-c',
        },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'a.ts')).toBe('upstream-a');
    expect(readInstalledFile(fixture.dir, 'card', 'b.ts')).toBe('base-b');
    expect(readInstalledFile(fixture.dir, 'card', 'c.ts')).toBe('upstream-c');

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['a.ts'].hash).toBe(
      hashContent('upstream-a'),
    );
    expect(lockfile.components.card['b.ts'].hash).toBe(hashContent('base-b'));
    expect(lockfile.components.card['c.ts'].hash).toBe(
      hashContent('upstream-c'),
    );
  });

  it('resets multiple drifted components in a single run', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent('card-base') } },
          spinner: { 'spinner.ts': { hash: hashContent('spinner-base') } },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': 'card-local' },
        spinner: { 'spinner.ts': 'spinner-local' },
      },
      uiSource: {
        card: { 'card.ts': 'card-upstream' },
        spinner: { 'spinner.ts': 'spinner-upstream' },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(
      'card-upstream',
    );
    expect(readInstalledFile(fixture.dir, 'spinner', 'spinner.ts')).toBe(
      'spinner-upstream',
    );
  });

  it('does not delete untracked local files sitting alongside components', async () => {
    // Force overwrites tracked files but must not touch files the registry
    // doesn't know about (e.g. a user's own sibling file).
    const upstream = 'export const Card = { v: 2 };';
    const userExtra = 'export const mine = true;';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent('base') } } },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': 'local', 'extra.ts': userExtra },
      },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    // Untracked sibling is left exactly as-is.
    expect(readInstalledFile(fixture.dir, 'card', 'extra.ts')).toBe(userExtra);
  });

  it('is idempotent — a second force run reports nothing to do', async () => {
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent('base') } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': 'local-drift' } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);

    // Second run: everything now matches upstream, so it must be a no-op that
    // leaves the file (and lockfile) exactly as the first run left them.
    await updateCommand({ force: true });
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('overwrites a user-modified shared theme file', async () => {
    // Theme files travel through a separate apply path from component files,
    // so force must overwrite drift there too. upstream == base → user-modified.
    const base = ':root { --primary: rgba(1, 1, 1, 1); }';
    const userVersion = ':root { --primary: rgba(9, 9, 9, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: { 'default.css': { hash: hashContent(base) } },
      },
      themeFiles: { 'default.css': base },
    });
    seedTheme(fixture, 'default.css', userVersion);

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readTheme(fixture, 'default.css')).toBe(base);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(base));
  });

  it('overwrites a conflicted shared theme file', async () => {
    const base = ':root { --primary: rgba(1, 1, 1, 1); }';
    const userVersion = ':root { --primary: rgba(9, 9, 9, 1); }';
    const upstream = ':root { --primary: rgba(2, 2, 2, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: { 'default.css': { hash: hashContent(base) } },
      },
      themeFiles: { 'default.css': upstream },
    });
    seedTheme(fixture, 'default.css', userVersion);

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readTheme(fixture, 'default.css')).toBe(upstream);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(upstream));
  });

  it('creates a missing shared theme file from upstream', async () => {
    const upstream = ':root { --primary: rgba(2, 2, 2, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      themeFiles: { 'default.css': upstream },
    });
    // No default.css seeded on disk → new-upstream.

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(readTheme(fixture, 'default.css')).toBe(upstream);
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(upstream));
  });

  it('never prompts even when conflicts, user-modifications and new files coexist', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: {
            'card.ts': { hash: hashContent('card-base') },
            'util.ts': { hash: hashContent('util-base') },
          },
        },
        utils: {},
        theme: { 'default.css': { hash: hashContent('theme-base') } },
      },
      components: {
        card: { 'card.ts': 'card-local', 'util.ts': 'util-base' },
      },
      uiSource: {
        card: {
          'card.ts': 'card-upstream', // conflict
          'util.ts': 'util-upstream', // auto-update
          'new.ts': 'new-file', // new-upstream
        },
      },
      themeFiles: { 'default.css': 'theme-upstream' },
    });
    seedTheme(fixture, 'default.css', 'theme-local'); // theme conflict

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockClear();
    (p.confirm as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({ force: true });

    expect(p.select).not.toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(
      'card-upstream',
    );
    expect(readInstalledFile(fixture.dir, 'card', 'util.ts')).toBe(
      'util-upstream',
    );
    expect(readInstalledFile(fixture.dir, 'card', 'new.ts')).toBe('new-file');
    expect(readTheme(fixture, 'default.css')).toBe('theme-upstream');
  });
});

/**
 * Multi-line content with two separate change regions (hunks) separated
 * by enough unchanged lines that structuredPatch produces 2 distinct hunks.
 */
const makeMultiHunkContent = () => {
  const lines = (changes: [number, string][]) => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    for (const [idx, value] of changes) {
      base[idx] = value;
    }
    return base.join('\n') + '\n';
  };

  return {
    original: lines([]),
    upstream: lines([
      [1, 'CHANGED line 2'],
      [18, 'CHANGED line 19'],
    ]),
  };
};

describe('updateCommand --selective hunk review', () => {
  it('partially applies only accepted hunks', async () => {
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      // File-level prompt → choose hunk review
      .mockResolvedValueOnce('hunk-review')
      // Hunk 1 → accept
      .mockResolvedValueOnce('accept')
      // Hunk 2 → reject
      .mockResolvedValueOnce('reject');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    // First hunk accepted: line 2 should be changed
    expect(content).toContain('CHANGED line 2');
    // Second hunk rejected: line 19 should be original
    expect(content).toContain('line 19');
    expect(content).not.toContain('CHANGED line 19');

    // Lockfile should be advanced to upstream hash
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(upstream),
    );
  });

  it('treats all hunks accepted as full upstream apply', async () => {
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('accept')
      .mockResolvedValueOnce('accept');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(upstream);
  });

  it('treats all hunks rejected as keep', async () => {
    const { original, upstream } = makeMultiHunkContent();
    const originalHash = hashContent(original);
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: originalHash } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('reject')
      .mockResolvedValueOnce('reject');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(original);

    // Lockfile should be preserved (selective skip semantics)
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(originalHash);
  });
});

describe('updateCommand — config / no-op paths', () => {
  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { updateCommand } = await import('./update');
    await expect(updateCommand({})).rejects.toThrow('process.exit(1)');

    expect(p.intro).toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan.config.json'),
    );
  });

  it('reports nothing to do when only user-modified files exist (no force, no selective)', async () => {
    const base = 'export const Badge = { v: 1 };';
    const userVersion = 'export const Badge = { v: 1, custom: true };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { badge: { 'badge.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { badge: { 'badge.ts': userVersion } },
      uiSource: { badge: { 'badge.ts': base } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockClear();
    (p.select as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({});

    // Nothing prompts — a lone user-modified file with no force/selective is
    // treated as "nothing actionable," not something to resolve.
    expect(p.confirm).not.toHaveBeenCalled();
    expect(p.select).not.toHaveBeenCalled();
    expect(p.outro).toHaveBeenCalledWith(
      expect.stringContaining('Everything is up to date'),
    );

    // The user's file is left completely untouched.
    expect(readInstalledFile(fixture.dir, 'badge', 'badge.ts')).toBe(
      userVersion,
    );
  });

  it('cancels when the user declines the batch auto-update confirmation', async () => {
    const base = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': base } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const { updateCommand } = await import('./update');
    await expect(updateCommand({})).rejects.toThrow('process.exit(0)');

    expect(p.cancel).toHaveBeenCalledWith(
      expect.stringContaining('Update canceled'),
    );
    // Untouched — the confirm was declined before anything was written.
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(base);
  });

  it('cancels when the batch auto-update confirmation prompt itself is canceled', async () => {
    const base = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': base } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { updateCommand } = await import('./update');
    await expect(updateCommand({})).rejects.toThrow('process.exit(0)');
  });

  it('keeps an unrelated user-modified file untouched alongside a batch auto-update, and records an up-to-date theme file', async () => {
    // card is a routine auto-update (drives the batch confirm path); badge is
    // user-modified with nothing to do about it outside selective/force mode
    // — it must fall through to the "kept as-is" bookkeeping branch instead of
    // being silently dropped. The theme file is already up to date, which
    // only gets exercised because *something* else keeps this update from
    // short-circuiting at "everything is up to date".
    const cardBase = 'export const Card = { v: 1 };';
    const cardUpstream = 'export const Card = { v: 2 };';
    const badgeBase = 'export const Badge = { v: 1 };';
    const badgeUserVersion = 'export const Badge = { v: 1, custom: true };';
    const themeContent = ':root { --primary: rgba(1, 1, 1, 1); }';

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent(cardBase) } },
          badge: { 'badge.ts': { hash: hashContent(badgeBase) } },
        },
        utils: {},
        theme: { 'default.css': { hash: hashContent(themeContent) } },
      },
      components: {
        card: { 'card.ts': cardBase },
        badge: { 'badge.ts': badgeUserVersion },
      },
      uiSource: {
        card: { 'card.ts': cardUpstream },
        badge: { 'badge.ts': badgeBase },
      },
      themeFiles: { 'default.css': themeContent },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      themeContent,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (p.select as ReturnType<typeof vi.fn>).mockClear();

    const { updateCommand } = await import('./update');
    await updateCommand({});

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(
      cardUpstream,
    );
    // Badge is untouched — no force, no selective, nothing to resolve.
    expect(readInstalledFile(fixture.dir, 'badge', 'badge.ts')).toBe(
      badgeUserVersion,
    );
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining('kept as-is'),
    );

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(cardUpstream),
    );
    // Badge's lockfile hash is preserved as-is (still points at its base).
    expect(lockfile.components.badge['badge.ts'].hash).toBe(
      hashContent(badgeBase),
    );
    // The already up-to-date theme file's hash is still recorded.
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(themeContent));
  });

  it('advances the lockfile for an up-to-date component and theme file with no prior lockfile entries', async () => {
    // Neither the component nor the theme file has ANY lockfile record at
    // all (not just a missing hash) — buildLockfile() must create fresh
    // entries for both from scratch on the "nothing to do" fast path.
    const cardContent = 'export const Card = {};';
    const themeContent = ':root { --primary: rgba(1, 1, 1, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      components: { card: { 'card.ts': cardContent } },
      uiSource: { card: { 'card.ts': cardContent } },
      themeFiles: { 'default.css': themeContent },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      themeContent,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { updateCommand } = await import('./update');
    await updateCommand({});

    expect(p.outro).toHaveBeenCalledWith(
      expect.stringContaining('Everything is up to date'),
    );

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(cardContent),
    );
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(themeContent));
  });
});

/**
 * Two independent edits far enough apart (given `context`) that
 * structuredPatch always produces two distinct, non-adjacent hunks — one
 * hook for user edits, one for upstream edits, so tests can target either
 * independently.
 */
const makeTwoRegionContent = () => {
  const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const current = [...base];
  current[4] = 'USER change line 5';
  const upstream = [...base];
  upstream[14] = 'UPSTREAM change line 15';
  return {
    base: base.join('\n') + '\n',
    current: current.join('\n') + '\n',
    upstream: upstream.join('\n') + '\n',
  };
};

describe('updateCommand — hunk review edge cases', () => {
  it('cancels mid hunk-review when the user cancels a hunk prompt', async () => {
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('hunk-review');
    // First isCancel check is for the file-level 'hunk-review' choice itself
    // (not canceled); the second is for the first hunk prompt (canceled).
    (p.isCancel as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const { updateCommand } = await import('./update');
    await expect(updateCommand({ selective: true })).rejects.toThrow(
      'process.exit(0)',
    );

    expect(p.cancel).toHaveBeenCalledWith(
      expect.stringContaining('Update canceled'),
    );
    // Untouched — canceled before any hunk decision was applied.
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(original);
  });

  it('expands context when the user asks to see more, then accepts every hunk', async () => {
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('hunk-review')
      // Hunk 1: ask for more context first, then accept.
      .mockResolvedValueOnce('context')
      .mockResolvedValueOnce('accept')
      // Hunk 2: accept directly.
      .mockResolvedValueOnce('accept');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const content = readInstalledFile(fixture.dir, 'card', 'card.ts');
    expect(content).toBe(upstream);
  });

  it('keeps the current version when hunk reconstruction fails to apply', async () => {
    // A defensive fallback for when applySelectedHunks() can't reconstruct a
    // valid file from the accepted subset of hunks. Simulated via a spy since
    // it's not practically reachable through real diff/patch content.
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(original) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': original } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const analyzeUtils = await import('../utils/analyze.js');
    const applySpy = vi
      .spyOn(analyzeUtils, 'applySelectedHunks')
      .mockReturnValue(false);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('accept')
      .mockResolvedValueOnce('reject');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    expect(applySpy).toHaveBeenCalled();
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not apply selected hunks'),
    );
    // Falls back to keeping the user's current file untouched.
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(original);
  });
});

describe('updateCommand — file review "show diff" branch', () => {
  it('shows a diff and loops back for an existing changed file before applying upstream', async () => {
    const base = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': base } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('diff')
      .mockResolvedValueOnce('upstream');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('Diff');
    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(upstream);
  });

  it('shows the full new-file preview and loops back before adding it', async () => {
    const existing = 'export const Card = { v: 1 };';
    const brandNew = 'export const helper = () => 42;';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(existing) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': existing } },
      uiSource: { card: { 'card.ts': existing, 'helper.ts': brandNew } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('diff')
      .mockResolvedValueOnce('upstream');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('New file');
    expect(readInstalledFile(fixture.dir, 'card', 'helper.ts')).toBe(brandNew);
  });

  it('cancels the file-level review prompt', async () => {
    const base = 'export const Card = { v: 1 };';
    const upstream = 'export const Card = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': base } },
      uiSource: { card: { 'card.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { updateCommand } = await import('./update');
    await expect(updateCommand({ selective: true })).rejects.toThrow(
      'process.exit(0)',
    );

    expect(readInstalledFile(fixture.dir, 'card', 'card.ts')).toBe(base);
  });
});

describe('updateCommand — conflict resolution outside selective mode', () => {
  it('applies a partial hunk resolution to both a conflicting component file and a conflicting shared theme file', async () => {
    const card = makeTwoRegionContent();
    const theme = makeTwoRegionContent();

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(card.base) } } },
        utils: {},
        theme: { 'default.css': { hash: hashContent(theme.base) } },
      },
      components: { card: { 'card.ts': card.current } },
      uiSource: { card: { 'card.ts': card.upstream } },
      themeFiles: { 'default.css': theme.upstream },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      theme.current,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      // card.ts: conflict → hunk review → reject the user-edit hunk, accept
      // the upstream-change hunk.
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('reject')
      .mockResolvedValueOnce('accept')
      // theme/default.css: same pattern.
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('reject')
      .mockResolvedValueOnce('accept');

    const { updateCommand } = await import('./update');
    // Not selective, not force — only the conflict-resolution pass runs.
    await updateCommand({});

    const cardContent = readInstalledFile(fixture.dir, 'card', 'card.ts');
    // User's own edit (line 5) is preserved; upstream's real change (line 15)
    // is merged in.
    expect(cardContent).toContain('USER change line 5');
    expect(cardContent).toContain('UPSTREAM change line 15');

    const themeContent = readFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      'utf-8',
    );
    expect(themeContent).toContain('USER change line 5');
    expect(themeContent).toContain('UPSTREAM change line 15');

    const lockfile = readLockfile(fixture.dir);
    // Partial resolutions still advance the lockfile base to upstream.
    expect(lockfile.components.card['card.ts'].hash).toBe(
      hashContent(card.upstream),
    );
    expect(lockfile.theme['default.css'].hash).toBe(
      hashContent(theme.upstream),
    );
  });

  it('keeps a conflicting shared theme file as-is when the user chooses to keep it', async () => {
    const base = ':root { --primary: rgba(1, 1, 1, 1); }';
    const userVersion = ':root { --primary: rgba(9, 9, 9, 1); }';
    const upstream = ':root { --primary: rgba(2, 2, 2, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: { 'default.css': { hash: hashContent(base) } },
      },
      themeFiles: { 'default.css': upstream },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      userVersion,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({});

    const themeContent = readFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      'utf-8',
    );
    expect(themeContent).toBe(userVersion);

    // Lockfile base still advances to upstream (conflict-keep semantics),
    // same as the component-file equivalent.
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(upstream));
  });
});

describe('updateCommand — selective review of shared theme files', () => {
  it('skips a shared theme file in selective mode when the user chooses to skip it', async () => {
    const base = ':root { --primary: rgba(1, 1, 1, 1); }';
    const upstream = ':root { --primary: rgba(2, 2, 2, 1); }';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: { 'default.css': { hash: hashContent(base) } },
      },
      themeFiles: { 'default.css': upstream },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      base,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('keep');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const themeContent = readFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      'utf-8',
    );
    // Skipped — left exactly as it was.
    expect(themeContent).toBe(base);

    // Lockfile hash preserved at its old base so it surfaces again next run.
    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(base));

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("they'll appear again on next update"),
    );
  });

  it('partially applies hunks to a shared theme file reviewed in selective mode', async () => {
    const { original, upstream } = makeMultiHunkContent();
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {},
        utils: {},
        theme: { 'default.css': { hash: hashContent(original) } },
      },
      themeFiles: { 'default.css': upstream },
    });
    const { writeFileSync: seedFile } = await import('node:fs');
    seedFile(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      original,
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('hunk-review')
      .mockResolvedValueOnce('accept')
      .mockResolvedValueOnce('reject');

    const { updateCommand } = await import('./update');
    await updateCommand({ selective: true });

    const themeContent = readFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      'utf-8',
    );
    expect(themeContent).toContain('CHANGED line 2');
    expect(themeContent).not.toContain('CHANGED line 19');

    const lockfile = readLockfile(fixture.dir);
    expect(lockfile.theme['default.css'].hash).toBe(hashContent(upstream));
  });
});
