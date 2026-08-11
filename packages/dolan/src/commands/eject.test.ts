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

describe('ejectCommand', () => {
  it('removes component from lockfile while keeping files', async () => {
    const content = 'export const Button = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { button: { 'button.ts': { hash: hashContent(content) } } },
        utils: {},
        theme: {},
      },
      components: { button: { 'button.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { ejectCommand } = await import('./eject');
    await ejectCommand('button', { force: true });

    // Files should still exist
    const filePath = join(
      fixture.dir,
      DEFAULT_CONFIG.aliases.components,
      'button',
      'button.ts',
    );
    expect(existsSync(filePath)).toBe(true);

    // Lockfile should no longer track button
    const lockfile = JSON.parse(
      readFileSync(join(fixture.dir, 'dolan.lock.json'), 'utf-8'),
    );
    expect(lockfile.components.button).toBeUndefined();
  });

  it('reports already untracked if component not in lockfile', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      components: { button: { 'button.ts': 'content' } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { ejectCommand } = await import('./eject');
    await ejectCommand('button', { force: true });

    expect(p.log.warn).toHaveBeenCalled();
  });

  it('exits with error if component is not installed', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { ejectCommand } = await import('./eject');
    await expect(ejectCommand('button', { force: true })).rejects.toThrow(
      'process.exit(1)',
    );
  });

  it('exits with error if no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { ejectCommand } = await import('./eject');
    await expect(ejectCommand('button', { force: true })).rejects.toThrow(
      'process.exit(1)',
    );
  });
});
