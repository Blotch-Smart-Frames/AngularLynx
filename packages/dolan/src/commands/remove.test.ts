import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  confirm: vi.fn().mockResolvedValue(true),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

let fixture: Fixture;

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

describe('removeCommand', () => {
  it('removes component directory and lockfile entry', async () => {
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
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { removeCommand } = await import('./remove');
    await removeCommand('card', { force: true });

    const componentDir = join(
      fixture.dir,
      DEFAULT_CONFIG.aliases.components,
      'card',
    );
    expect(existsSync(componentDir)).toBe(false);

    const lockfile = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'),
    );
    expect(lockfile.components.card).toBeUndefined();
  });

  it('removes orphaned dependencies when confirmed', async () => {
    // button depends on spinner; removing button should orphan spinner
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { removeCommand } = await import('./remove');
    await removeCommand('button', { force: true });

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    expect(existsSync(join(componentsDir, 'button'))).toBe(false);
    expect(existsSync(join(componentsDir, 'spinner'))).toBe(false);

    const lockfile = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'),
    );
    expect(lockfile.components.button).toBeUndefined();
    expect(lockfile.components.spinner).toBeUndefined();
  });

  it('exits with error for non-installed component', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { removeCommand } = await import('./remove');
    await expect(removeCommand('card', { force: true })).rejects.toThrow(
      'process.exit(1)',
    );
  });

  it('exits with error for unknown component', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { removeCommand } = await import('./remove');
    await expect(removeCommand('nonexistent', { force: true })).rejects.toThrow(
      'process.exit(1)',
    );
  });

  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { removeCommand } = await import('./remove');
    await expect(removeCommand('card', { force: true })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan.config.json'),
    );
  });

  it('warns about dependents and proceeds when the user confirms', async () => {
    // spinner has no dependencies of its own, so removing it can't also
    // trigger the orphan-detection prompt — isolates the dependents branch.
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const { removeCommand } = await import('./remove');
    await removeCommand('spinner', {});

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('depend on'),
    );

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    // Removed despite the warning because the user confirmed.
    expect(existsSync(join(componentsDir, 'spinner'))).toBe(false);
    // button itself is untouched — only the target is removed.
    expect(existsSync(join(componentsDir, 'button'))).toBe(true);
  });

  it('cancels removal when dependents exist and the user declines', async () => {
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const { removeCommand } = await import('./remove');
    await expect(removeCommand('spinner', {})).rejects.toThrow(
      'process.exit(0)',
    );

    expect(p.cancel).toHaveBeenCalledWith(
      expect.stringContaining('Removal canceled'),
    );

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    // Nothing was removed — the user declined.
    expect(existsSync(join(componentsDir, 'spinner'))).toBe(true);
  });

  it('cancels removal when dependents exist and the user cancels the prompt', async () => {
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { removeCommand } = await import('./remove');
    await expect(removeCommand('spinner', {})).rejects.toThrow(
      'process.exit(0)',
    );
  });

  it('prompts to remove orphaned dependencies without --force, and removes them when confirmed', async () => {
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const { removeCommand } = await import('./remove');
    await removeCommand('button', {});

    expect(p.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('orphaned dependencies'),
      }),
    );

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    expect(existsSync(join(componentsDir, 'button'))).toBe(false);
    // Confirmed → orphaned spinner removed too.
    expect(existsSync(join(componentsDir, 'spinner'))).toBe(false);
  });

  it('keeps an orphaned dependency when the user declines removing it', async () => {
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const { removeCommand } = await import('./remove');
    await removeCommand('button', {});

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    expect(existsSync(join(componentsDir, 'button'))).toBe(false);
    // Declined → orphaned spinner is kept.
    expect(existsSync(join(componentsDir, 'spinner'))).toBe(true);
  });

  it('does not flag a dependency as orphaned when another installed component still needs it', async () => {
    // empty-state and nav-drawer both depend on icon — removing empty-state
    // must not touch icon (nav-drawer still needs it), and since there's
    // nothing left to orphan, the orphan-removal prompt should never appear.
    const emptyStateContent = 'export const EmptyState = {};';
    const navDrawerContent = 'export const NavDrawer = {};';
    const iconContent = 'export const Icon = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          'empty-state': {
            'empty-state.ts': { hash: hashContent(emptyStateContent) },
          },
          'nav-drawer': {
            'nav-drawer.ts': { hash: hashContent(navDrawerContent) },
          },
          icon: { 'icon.ts': { hash: hashContent(iconContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        'empty-state': { 'empty-state.ts': emptyStateContent },
        'nav-drawer': { 'nav-drawer.ts': navDrawerContent },
        icon: { 'icon.ts': iconContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockClear();

    const { removeCommand } = await import('./remove');
    await removeCommand('empty-state', {});

    // No orphans to decide on, so the confirm prompt is never shown.
    expect(p.confirm).not.toHaveBeenCalled();

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    expect(existsSync(join(componentsDir, 'empty-state'))).toBe(false);
    expect(existsSync(join(componentsDir, 'nav-drawer'))).toBe(true);
    expect(existsSync(join(componentsDir, 'icon'))).toBe(true);
  });

  it('does not orphan a dependency that was never installed in the first place', async () => {
    // avatar depends on skeleton, but skeleton was never installed here — the
    // "not installed" skip must short-circuit findOrphans before it ever
    // checks whether anything still needs it.
    const avatarContent = 'export const Avatar = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { avatar: { 'avatar.ts': { hash: hashContent(avatarContent) } } },
        utils: {},
        theme: {},
      },
      components: { avatar: { 'avatar.ts': avatarContent } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockClear();

    const { removeCommand } = await import('./remove');
    await removeCommand('avatar', {});

    expect(p.confirm).not.toHaveBeenCalled();

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    expect(existsSync(join(componentsDir, 'avatar'))).toBe(false);
  });

  it('drops the lockfile entry for an orphan whose directory already vanished', async () => {
    // Simulates the orphan's directory disappearing between the "what's
    // installed" scan and the actual removal pass (e.g. removed out-of-band
    // while the confirm prompt was on screen) — the removal loop must still
    // clean up its lockfile entry instead of throwing on the missing dir.
    const buttonContent = 'export const Button = {};';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          button: { 'button.ts': { hash: hashContent(buttonContent) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        button: { 'button.ts': buttonContent },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const componentsDir = join(fixture.dir, DEFAULT_CONFIG.aliases.components);
    const { rmSync } = await import('node:fs');

    const p = await import('@clack/prompts');
    (p.confirm as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      // Delete spinner's directory out from under the command right as the
      // user confirms removing it.
      rmSync(join(componentsDir, 'spinner'), { recursive: true, force: true });
      return true;
    });

    const { removeCommand } = await import('./remove');
    await removeCommand('button', {});

    // No throw, and the lockfile entry is still cleaned up despite the dir
    // already being gone.
    const lockfile = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'),
    );
    expect(lockfile.components.spinner).toBeUndefined();
    expect(lockfile.components.button).toBeUndefined();
  });
});
