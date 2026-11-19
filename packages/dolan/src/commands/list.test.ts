import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
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

  it('exits with error when no config exists (non-json)', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await expect(listCommand({})).rejects.toThrow('process.exit(1)');

    expect(p.intro).toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan.config.json'),
    );
  });

  it('warns (json) when the components directory does not exist', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    const { rmSync } = await import('node:fs');
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.components).toHaveLength(0);
  });

  it('warns (non-json) when the components directory does not exist', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });

    const { rmSync } = await import('node:fs');
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await listCommand({});

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('warns (non-json) when nothing installed is recognized', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG, uiSource: {} });
    // Components dir exists (via createFixture) but is empty.

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await listCommand({});

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('prints the full non-json listing with a mixed-status summary', async () => {
    // One of each status so the outro summary exercises every branch of the
    // up-to-date/outdated/modified/conflict tally.
    const cardContent = 'export const Card = {};'; // up-to-date
    const buttonBase = 'export const Button = { v: 1 };'; // auto-update
    const buttonUpstream = 'export const Button = { v: 2 };';
    const badgeBase = 'export const Badge = { v: 1 };'; // user-modified
    const badgeLocal = 'export const Badge = { v: 1, custom: true };';
    const avatarBase = 'export const Avatar = { v: 1 };'; // conflict
    const avatarLocal = 'export const Avatar = { v: 1, custom: true };';
    const avatarUpstream = 'export const Avatar = { v: 2 };';

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent(cardContent) } },
          button: { 'button.ts': { hash: hashContent(buttonBase) } },
          badge: { 'badge.ts': { hash: hashContent(badgeBase) } },
          avatar: { 'avatar.ts': { hash: hashContent(avatarBase) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': cardContent },
        button: { 'button.ts': buttonBase },
        badge: { 'badge.ts': badgeLocal },
        avatar: { 'avatar.ts': avatarLocal },
      },
      uiSource: {
        card: { 'card.ts': cardContent },
        button: { 'button.ts': buttonUpstream },
        badge: { 'badge.ts': badgeBase },
        avatar: { 'avatar.ts': avatarUpstream },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await listCommand({});

    expect(p.intro).toHaveBeenCalled();
    expect(p.log.message).toHaveBeenCalled();
    const outroCalls = (p.outro as ReturnType<typeof vi.fn>).mock.calls;
    const outroArg = outroCalls[outroCalls.length - 1][0] as string;
    expect(outroArg).toContain('4 installed');
    expect(outroArg).toContain('up to date');
    expect(outroArg).toContain('outdated');
    expect(outroArg).toContain('modified');
    expect(outroArg).toContain('conflict(s)');
  });

  it('non-json summary omits zero-count categories (all up to date)', async () => {
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
    const { listCommand } = await import('./list');
    await listCommand({});

    const outroCalls = (p.outro as ReturnType<typeof vi.fn>).mock.calls;
    const outroArg = outroCalls[outroCalls.length - 1][0] as string;
    expect(outroArg).toContain('up to date');
    expect(outroArg).not.toContain('outdated');
    expect(outroArg).not.toContain('modified');
    expect(outroArg).not.toContain('conflict(s)');
  });

  it('non-json summary omits "up to date" when nothing is up to date', async () => {
    const base = 'export const Button = { v: 1 };';
    const upstream = 'export const Button = { v: 2 };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { button: { 'button.ts': { hash: hashContent(base) } } },
        utils: {},
        theme: {},
      },
      components: { button: { 'button.ts': base } },
      uiSource: { button: { 'button.ts': upstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await listCommand({});

    const outroCalls = (p.outro as ReturnType<typeof vi.fn>).mock.calls;
    const outroArg = outroCalls[outroCalls.length - 1][0] as string;
    expect(outroArg).not.toContain('up to date');
    expect(outroArg).toContain('outdated');
  });

  it('handles a multi-file component with no per-file hashes', async () => {
    // lockfile.components['card'] tracks card but records no file hashes.
    // Three files (one missing on disk) also exercises the plural
    // "N files" label and the new-upstream (currentContent === null) path.
    const mainContent = 'export const Card = {};';
    const iconContent = 'export const CardIcon = {};';
    const newFileContent = 'export const CardNew = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: { card: {} }, utils: {}, theme: {} },
      components: {
        card: { 'card.ts': mainContent, 'card-icon.ts': iconContent },
      },
      uiSource: {
        card: {
          'card.ts': mainContent,
          'card-icon.ts': iconContent,
          'card-new.ts': newFileContent,
        },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { listCommand } = await import('./list');
    await listCommand({});

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('3 files');
  });

  describe('ejected components', () => {
    const setup = () => {
      const content = 'export const Card = {};';
      fixture = createFixture({
        config: DEFAULT_CONFIG,
        lockfile: {
          version: 1,
          components: { card: { 'card.ts': { hash: hashContent(content) } } },
          utils: {},
          theme: {},
        },
        components: {
          card: { 'card.ts': content },
          spinner: { 'spinner.ts': 'export const Spinner = { mine: true };' },
        },
        uiSource: {
          card: { 'card.ts': content },
          spinner: { 'spinner.ts': 'export const Spinner = {};' },
        },
      });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
    };

    it('lists them apart, not as a conflict', async () => {
      setup();
      const p = await import('@clack/prompts');
      const { listCommand } = await import('./list');
      await listCommand({});

      const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0] as string)
        .join('\n');
      expect(messages).toMatch(/spinner.*ejected \(not tracked\)/);
      expect(messages).not.toMatch(/spinner.*conflict/);
      expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('ejected'));
    });

    it('puts them in their own JSON field', async () => {
      setup();
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { listCommand } = await import('./list');
      await listCommand({ json: true });

      const output = JSON.parse(log.mock.calls[0][0] as string);
      expect(output.ejected).toEqual(['spinner']);
      expect(output.components.map((c: { name: string }) => c.name)).toEqual([
        'card',
      ]);
    });

    it('lists a project whose only component is ejected', async () => {
      fixture = createFixture({
        config: DEFAULT_CONFIG,
        components: { card: { 'card.ts': 'export const Card = {};' } },
        uiSource: { card: { 'card.ts': 'export const Card = {};' } },
      });
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
      const p = await import('@clack/prompts');
      const { listCommand } = await import('./list');
      await listCommand({});

      expect(p.outro).toHaveBeenCalledWith(
        expect.stringContaining('0 installed'),
      );
    });
  });
});

// `update` deletes a file upstream no longer ships, as 22.2.3 did with the
// `*-render.test.ts` specs, but `list` only looked at the files upstream
// ships now, so a component with one showed as up to date.
describe('listCommand — files upstream no longer ships', () => {
  const card = 'export const Card = {};';
  const stale = "import { setInputSignal } from '../../../test-utils/x';";
  const STALE = 'card-render.test.ts';

  /**
   * card matches upstream, and it has STALE (as add copied it, unless
   * `onDisk` says otherwise), which upstream no longer ships.
   */
  const setup = (onDisk: string | null = stale) => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: {
            'card.ts': { hash: hashContent(card) },
            [STALE]: { hash: hashContent(stale) },
          },
        },
        theme: {},
      },
      components: {
        card: {
          'card.ts': card,
          ...(onDisk === null ? {} : { [STALE]: onDisk }),
        },
      },
      uiSource: { card: { 'card.ts': card } },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);
  };
  /**
   * The log messages, colors stripped.
   */
  const messages = async () => {
    const p = await import('@clack/prompts');
    return stripVTControlCharacters(
      (p.log.message as ReturnType<typeof vi.fn>).mock.calls
        .map(([m]) => m as string)
        .join('\n'),
    );
  };

  beforeEach(() => {
    // Each test sees only its own messages.
    vi.clearAllMocks();
  });

  it('lists the component as outdated, and names the file', async () => {
    setup();
    const p = await import('@clack/prompts');

    const { listCommand } = await import('./list');
    await listCommand({});

    const text = await messages();
    expect(text).toMatch(/card\s+outdated\s+\(2 files\)/);
    expect(text).toContain(
      `card/${STALE} — upstream no longer ships it → delete`,
    );
    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('outdated'));
  });

  it('names it in the JSON output too', async () => {
    setup();

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      components: [
        {
          name: 'card',
          status: 'auto-update',
          fileCount: 2,
          removedUpstream: [STALE],
        },
      ],
    });
  });

  it('lists one you edited as a conflict: update asks before deleting it', async () => {
    setup(`${stale}\n// mine\n`);

    const { listCommand } = await import('./list');
    await listCommand({});

    const text = await messages();
    expect(text).toMatch(/card\s+conflict/);
    expect(text).toContain(
      `card/${STALE} — upstream no longer ships it, and you modified it`,
    );
  });

  it("is up to date when it's gone from disk: only a lockfile entry is left", async () => {
    setup(null);

    const { listCommand } = await import('./list');
    await listCommand({ json: true });

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      components: [{ name: 'card', status: 'up-to-date', fileCount: 1 }],
    });
  });
});
