import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';

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

vi.mock('../utils/resolve-paths.js', () => ({
  getComponentFiles: () => ['button.ts', 'index.ts'],
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

describe('infoCommand', () => {
  it('displays component info when installed', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { button: { 'button.ts': 'content' } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    await infoCommand('button');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('button');
    expect(messages).toContain('installed');
    expect(messages).toContain('spinner');
  });

  it('shows not installed when component dir missing', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    await infoCommand('card');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('not installed');
  });

  it('exits with error for unknown component', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { infoCommand } = await import('./info');
    await expect(infoCommand('nonexistent')).rejects.toThrow('process.exit(1)');
  });

  it('shows reverse dependencies, marking an installed dependent with a checkmark', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { button: { 'button.ts': '' } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    await infoCommand('spinner');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    // button depends on spinner, and button IS installed here.
    expect(messages).toContain('button');
  });

  it('marks a not-installed dependent with "(not installed)"', async () => {
    // Config exists, but nothing is installed yet — spinner's dependent
    // (button) resolves to the "not installed" ternary branch rather than
    // the checkmark one covered by the test above.
    fixture = createFixture({ config: DEFAULT_CONFIG });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    await infoCommand('spinner');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('button');
    expect(messages).toContain('not installed');
  });

  it('marks an installed dependency with a checkmark', async () => {
    // button depends on spinner (registry.ts) — install both so the
    // "dependency is installed" ternary branch is exercised, not just the
    // "missing" one covered by the "displays component info" test above.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: {
        button: { 'button.ts': '' },
        spinner: { 'spinner.ts': '' },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    await infoCommand('button');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('Dependencies:');
    expect(messages).toContain('spinner');
  });

  it('shows dependencies and reverse dependencies as plain names when no config exists', async () => {
    // With no dolan.config.json at all, `hasConfig` is false throughout —
    // the componentsDir-relative installed checks short-circuit to bare
    // names instead of resolving install status.
    fixture = createFixture({});

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { infoCommand } = await import('./info');
    // button has a dependency (spinner) AND is itself a dependency of nothing.
    await infoCommand('button');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('not installed');
    expect(messages).toContain('spinner');
  });

  it('shows reverse dependencies as plain names when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { infoCommand } = await import('./info');
    // spinner is depended on by button, and has no dependencies of its own —
    // exercises the "Used by" plain-name branch with no config.
    await infoCommand('spinner');

    const p = await import('@clack/prompts');
    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('button');
    expect(messages).toContain('none');
  });
});
