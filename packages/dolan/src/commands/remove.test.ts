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
});
