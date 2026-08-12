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
  select: vi.fn().mockResolvedValue('__none__'),
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

describe('diffCommand', () => {
  it('reports all up to date when content matches upstream', async () => {
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
    const { diffCommand } = await import('./diff');
    await diffCommand();

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('up to date'),
    );
  });

  it('shows diff output for a specific changed component', async () => {
    const installed = 'export const Card = { old: true };';
    const upstream = 'export const Card = { new: true };';
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

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand('card');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');

    expect(messages).toContain('card');
    // Should contain diff markers (colored, but the text is there)
    expect(messages).toContain('old');
    expect(messages).toContain('new');
  });

  it('exits with error for non-installed component', async () => {
    const content = 'export const Card = {};';
    // Need at least one installed component to pass the early-exit check
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          spinner: { 'spinner.ts': { hash: hashContent(content) } },
        },
        utils: {},
        theme: {},
      },
      components: { spinner: { 'spinner.ts': content } },
      uiSource: {
        card: { 'card.ts': content },
        spinner: { 'spinner.ts': content },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await expect(diffCommand('card')).rejects.toThrow('process.exit(1)');
  });

  it('exits with error for unknown component', async () => {
    const content = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { spinner: { 'spinner.ts': content } },
      uiSource: { spinner: { 'spinner.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await expect(diffCommand('nonexistent')).rejects.toThrow('process.exit(1)');
  });

  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await expect(diffCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan.config.json'),
    );
  });

  it('warns when the components directory does not exist', async () => {
    const content = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      uiSource: { card: { 'card.ts': content } },
    });

    // createFixture always creates the configured components dir up front —
    // remove it to exercise the "nothing installed yet" branch.
    const { rmSync } = await import('node:fs');
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand();

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('warns when the components directory has nothing recognized', async () => {
    const content = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      // components dir exists (via createFixture) but is empty — nothing
      // known to the registry is installed.
      uiSource: { card: { 'card.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand();

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No components installed'),
    );
  });

  it('shows a new-upstream file as full green content', async () => {
    // The file exists upstream but was never installed on disk — analyzeFile
    // reports "new-upstream" and showComponentDiff should render the whole
    // file instead of a diff (there's nothing to diff against).
    const cardContent = 'export const Card = {};';
    const helperContent = 'export const helper = () => 1;';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(cardContent) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': cardContent } },
      uiSource: {
        card: { 'card.ts': cardContent, 'helper.ts': helperContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    const { diffCommand } = await import('./diff');
    await diffCommand('card');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('helper.ts');
    expect(messages).toContain(helperContent);
  });

  it('reports all files up to date when diffing a specific up-to-date component', async () => {
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
    const { diffCommand } = await import('./diff');
    await diffCommand('card');

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('All files up to date.');
  });

  it('summary mode: lists changed components and shows the chosen one', async () => {
    const cardInstalled = 'export const Card = { old: true };';
    const cardUpstream = 'export const Card = { new: true };';
    const spinnerContent = 'export const Spinner = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent(cardInstalled) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerContent) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': cardInstalled },
        spinner: { 'spinner.ts': spinnerContent },
      },
      uiSource: {
        card: { 'card.ts': cardUpstream },
        spinner: { 'spinner.ts': spinnerContent },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('card');

    const { diffCommand } = await import('./diff');
    await diffCommand();

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('1 component(s) with changes');
    expect(messages).toContain('old');
    expect(messages).toContain('new');
    // Spinner never diverged, so its diff should not have been printed.
    expect(p.select).toHaveBeenCalled();
  });

  it('summary mode: "All changed components" shows every diff', async () => {
    const cardInstalled = 'export const Card = { old: true };';
    const cardUpstream = 'export const Card = { new: true };';
    const spinnerInstalled = 'export const Spinner = { old: true };';
    const spinnerUpstream = 'export const Spinner = { new: true };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: {
          card: { 'card.ts': { hash: hashContent(cardInstalled) } },
          spinner: { 'spinner.ts': { hash: hashContent(spinnerInstalled) } },
        },
        utils: {},
        theme: {},
      },
      components: {
        card: { 'card.ts': cardInstalled },
        spinner: { 'spinner.ts': spinnerInstalled },
      },
      uiSource: {
        card: { 'card.ts': cardUpstream },
        spinner: { 'spinner.ts': spinnerUpstream },
      },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('__all__');

    const { diffCommand } = await import('./diff');
    await diffCommand();

    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('2 component(s) with changes');
    expect(messages).toContain('card');
    expect(messages).toContain('spinner');
  });

  it('handles a component with no lockfile entry at all', async () => {
    // Installed and matches upstream, but was never recorded in the lockfile
    // (e.g. lockfile predates this component) — lockfile.components[name] is
    // undefined and must fall back to {} rather than throwing.
    const content = 'export const Card = {};';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: { version: 1, components: {}, utils: {}, theme: {} },
      components: { card: { 'card.ts': content } },
      uiSource: { card: { 'card.ts': content } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { diffCommand } = await import('./diff');
    await diffCommand('card');

    const p = await import('@clack/prompts');
    const messages = (p.log.message as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(messages).toContain('All files up to date.');
  });

  it('summary mode: exits cleanly when the user cancels the selection', async () => {
    const cardInstalled = 'export const Card = { old: true };';
    const cardUpstream = 'export const Card = { new: true };';
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: {
        version: 1,
        components: { card: { 'card.ts': { hash: hashContent(cardInstalled) } } },
        utils: {},
        theme: {},
      },
      components: { card: { 'card.ts': cardInstalled } },
      uiSource: { card: { 'card.ts': cardUpstream } },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const p = await import('@clack/prompts');
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('cancel-token');
    (p.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { diffCommand } = await import('./diff');
    await diffCommand();

    expect(p.outro).toHaveBeenCalled();
  });
});
