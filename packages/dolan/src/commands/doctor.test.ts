import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

let fixture: Fixture;

vi.mock('../utils/resolve-paths.js', () => ({
  getComponentFiles: (name: string) => {
    // Mirrors registry component shapes closely enough to drive
    // checkComponentHealth's "missing files" branch deterministically.
    if (name === 'card') return ['card.ts', 'index.ts'];
    return [`${name}.ts`];
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

const writePackageJson = (dir: string, content: unknown) =>
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content));

const FULL_ANGULAR_DEPS = {
  '@angular/core': '^20.0.0',
  '@angular/common': '^20.0.0',
  '@angular/platform-browser': '^20.0.0',
  '@angular/router': '^20.0.0',
  '@blotch/angular-lynx': '^0.0.1',
  tailwindcss: '^4.0.0',
};

describe('doctorCommand', () => {
  it('exits with error when no config exists', async () => {
    fixture = createFixture({});
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('dolan init'),
    );
  });

  it('fails when config.json is not valid JSON', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writeFileSync(join(fixture.dir, 'dolan.config.json'), '{ not json');
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('not valid JSON'),
    );
  });

  it('fails when config is missing required alias keys', async () => {
    fixture = createFixture({});
    writeFileSync(
      join(fixture.dir, 'dolan.config.json'),
      JSON.stringify({ aliases: { components: 'src/components/ui' } }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Config missing aliases'),
    );
  });

  it('reports a fully healthy project with zero failures', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { card: { 'card.ts': '', 'index.ts': '' } },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'tailwind-plugin.ts'),
      '',
    );
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'default.css'),
      '',
    );
    writeFileSync(
      join(fixture.dir, 'tailwind.config.ts'),
      "import { blotchPlugin } from './src/styles/tailwind-plugin';\nexport default { plugins: [blotchPlugin] };\n",
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.error).not.toHaveBeenCalled();
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('component(s) healthy'),
    );
  });

  it('fails when the components or theme directories are missing', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.theme), {
      recursive: true,
      force: true,
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('components'),
    );
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining('theme'));
  });

  it('warns when tailwind-plugin.ts and theme CSS are both missing', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('tailwind-plugin.ts'),
    );
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No theme CSS files'),
    );
  });

  it('passes theme CSS check when only dark.css is present', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'dark.css'),
      '',
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith('Theme CSS found');
  });

  it('warns when no tailwind config is found', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Tailwind config found'),
    );
  });

  it('warns when a tailwind config exists but does not reference blotchPlugin', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    writeFileSync(
      join(fixture.dir, 'tailwind.config.js'),
      'module.exports = { plugins: [] };',
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('tailwind.config.js'),
    );
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('blotchPlugin'),
    );
  });

  it('fails when package.json is missing', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
    );
  });

  it('fails when package.json is not valid JSON', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writeFileSync(join(fixture.dir, 'package.json'), '{ not json');
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
    );
  });

  it('fails when required Angular packages or @blotch/angular-lynx are missing, and warns on missing tailwindcss', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: {} });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Missing Angular packages'),
    );
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining('@blotch/angular-lynx'),
    );
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('tailwindcss'),
    );
  });

  it('reads Angular deps from devDependencies too', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { devDependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith('Angular packages found');
  });

  it('handles a components path that is not a directory when listing installed components', async () => {
    // Replace the components dir with a plain file: existsSync is still true
    // (so checkComponentHealth doesn't early-return), but readdirSync throws
    // ENOTDIR — exercising the try/catch around the initial directory listing.
    fixture = createFixture({ config: DEFAULT_CONFIG });
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.components),
      'not a directory',
    );
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    // The same file-not-a-directory condition also fails checkDirectories'
    // "components directory exists" check, so the overall run exits 1.
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');
  });

  it('warns about a component directory unknown to the registry', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { 'my-custom-thing': { 'index.ts': '' } },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a known dolan component'),
    );
  });

  it('warns about a known component missing expected files', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      // Registry declares card ships card.ts + index.ts (per the
      // resolve-paths mock above) — only providing card.ts leaves index.ts
      // missing.
      components: { card: { 'card.ts': '' } },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('is missing files'),
    );
  });

  it('warns when getComponentFiles throws while verifying source files', async () => {
    // Simulate a component directory that IS in the registry but whose
    // upstream source can't be read (e.g. corrupted dist/ui) — the
    // try/catch around getComponentFiles must degrade to a warning, not throw.
    const resolvePaths = await import('../utils/resolve-paths.js');
    vi.spyOn(resolvePaths, 'getComponentFiles').mockImplementation(() => {
      throw new Error('boom');
    });

    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { button: { 'button.ts': '' } },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not verify source files'),
    );
  });

  it('warns when an installed component is missing an installed dependency', async () => {
    // button depends on spinner (registry.ts) — install button without spinner.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { button: { 'button.ts': '' } },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('dolan add spinner'),
    );
  });

  it('does not warn about a dependency that is also installed', async () => {
    // button depends on spinner (registry.ts) — installing both means the
    // `!installed.includes(dep)` check in checkComponentHealth is false for
    // every dependency, so no "requires ... run dolan add" warning fires.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: {
        button: { 'button.ts': '' },
        spinner: { 'spinner.ts': '' },
      },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('requires'),
    );
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('component(s) healthy'),
    );
  });

  it('skips component health checks entirely when the components dir is empty', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('healthy'),
    );
    expect(p.log.success).not.toHaveBeenCalledWith(
      expect.stringContaining('component(s) healthy'),
    );
  });

  it('skips component health checks entirely when the components dir does not exist', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    rmSync(join(fixture.dir, DEFAULT_CONFIG.aliases.components), {
      recursive: true,
      force: true,
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    // Missing components dir also fails checkDirectories, so overall exit is 1.
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');
  });
});
