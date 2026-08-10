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

  it('shows reverse dependencies', async () => {
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

    // button depends on spinner
    expect(messages).toContain('button');
  });
});
