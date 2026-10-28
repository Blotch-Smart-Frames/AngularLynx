import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
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
  // dolan's own theme, which the fixture's `themeFiles` write.
  getUiSourceDir: () => fixture.uiDir,
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

// What doctor requires (no router: no component imports it), plus the
// package button imports.
const FULL_ANGULAR_DEPS = {
  '@angular/core': '^20.0.0',
  '@blotch/angular-lynx': '^0.0.1',
  '@blotch/dolan': '^0.0.1',
  'class-variance-authority': '^0.7.1',
  tailwindcss: '^4.0.0',
};

/**
 * A lockfile that tracks the given components, as `dolan add` writes it.
 */
const tracking = (...names: string[]) => ({
  version: 1,
  components: Object.fromEntries(names.map((name) => [name, {}])),
  theme: {},
});

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
    writePackageJson(fixture.dir, {
      dependencies: { ...FULL_ANGULAR_DEPS, tailwindcss: '^3.4.19' },
    });

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

  it('warns when no tailwind config is found on Tailwind 3', async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, {
      dependencies: { ...FULL_ANGULAR_DEPS, tailwindcss: '^3.4.19' },
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Tailwind config found'),
    );
  });

  it("passes when a Tailwind 4 stylesheet imports the theme's tailwind.css", async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    writeFileSync(
      join(fixture.dir, DEFAULT_CONFIG.aliases.theme, 'tailwind.css'),
      '',
    );
    writeFileSync(
      join(fixture.dir, 'src/styles.css'),
      "@import 'tailwindcss/utilities.css';\n@import './styles/tailwind.css';\n",
    );

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('imported in'),
    );
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('found in theme'),
    );
  });

  it("warns when a Tailwind 4 stylesheet, or its absence, doesn't import tailwind.css", async () => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });

    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');
    // Tailwind's own imports don't count.
    writeFileSync(
      join(fixture.dir, 'src/styles.css'),
      "@import 'tailwindcss/utilities.css';",
    );
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(
      vi
        .mocked(p.log.warn)
        .mock.calls.filter(([message]) => message.includes('not imported in')),
    ).toHaveLength(2);
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
      expect.stringMatching(
        /Missing packages: .*@angular\/core.*@blotch\/angular-lynx.*@blotch\/dolan/,
      ),
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
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('Required packages found'),
    );
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
      lockfile: tracking('card'),
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
      lockfile: tracking('button'),
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
    // button depends on spinner, glass and icon, and spinner and glass on
    // icon (registry.ts) — installing all four means the
    // `!installed.includes(dep)` check in checkComponentHealth is false for
    // every dependency, so no "requires ... run dolan add" warning fires.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: {
        button: { 'button.ts': '' },
        spinner: { 'spinner.ts': '' },
        glass: { 'glass.ts': '' },
        icon: { 'icon.ts': '' },
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

  it('accepts the config init writes, which has no utils alias', async () => {
    fixture = createFixture({
      config: {
        aliases: { components: 'src/components/ui', theme: 'src/styles' },
      },
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith('Config is valid');
  });

  it("fails when components import a package the project doesn't have", async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { badge: { 'badge.ts': '' } },
      lockfile: tracking('badge'),
    });
    const { 'class-variance-authority': _, ...withoutCva } = FULL_ANGULAR_DEPS;
    writePackageJson(fixture.dir, { dependencies: withoutCva });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(1)');

    const p = await import('@clack/prompts');
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /class-variance-authority.*npm install class-variance-authority@\^0\.7\.1/,
      ),
    );
    expect(p.log.success).not.toHaveBeenCalledWith(
      expect.stringContaining('component(s) healthy'),
    );
  });

  it("warns about copied tests the project can't compile", async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { badge: { 'badge.ts': '', 'badge.test.ts': '' } },
      lockfile: tracking('badge'),
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /badge.*has tests that need.*@blotch\/angular-lynx-testing-library.*badge\.test\.ts/,
      ),
    );
  });

  it('leaves copied tests alone when the project has the testing library', async () => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { badge: { 'badge.ts': '', 'badge.test.ts': '' } },
      lockfile: tracking('badge'),
    });
    writePackageJson(fixture.dir, {
      dependencies: FULL_ANGULAR_DEPS,
      devDependencies: { '@blotch/angular-lynx-testing-library': '^22.0.0' },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining('component(s) healthy'),
    );
  });

  it("doesn't check an ejected component's files", async () => {
    // card is on disk without card's index.ts, but it has no lockfile entry:
    // it was ejected, so its files are the app's call.
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      components: { card: { 'card.ts': '' } },
      lockfile: tracking(),
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');

    const p = await import('@clack/prompts');
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('is missing files'),
    );
  });
});

describe('doctorCommand theme channels', () => {
  /**
   * A plugin that maps primary and border with themeColor(), as dolan's does.
   */
  const PLUGIN = `colors: {
  primary: { DEFAULT: themeColor('primary') },
  border: themeColor("border"),
  destructive: { subtle: 'var(--destructive-subtle)' },
}`;

  /**
   * Writes the theme's plugin and stylesheets, then runs doctor.
   */
  const runDoctor = async (plugin: string, css: Record<string, string>) => {
    fixture = createFixture({ config: DEFAULT_CONFIG });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    const themeDir = join(fixture.dir, DEFAULT_CONFIG.aliases.theme);
    writeFileSync(join(themeDir, 'tailwind-plugin.ts'), plugin);
    for (const [file, content] of Object.entries(css)) {
      writeFileSync(join(themeDir, file), content);
    }
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');
    return import('@clack/prompts');
  };

  it('passes when every mapped color has matching channels', async () => {
    const p = await runDoctor(PLUGIN, {
      'default.css': `/* --primary: red; */
page {
  --primary: rgba(24, 24, 27, 1);
  --primary-rgb: 24, 24, 27;
  --border: #e4e4e7;
  --border-rgb: 228,228,231;
}`,
      // A theme that sets only some colors is checked for those alone.
      'ocean.css':
        'page { --primary: rgb(37 99 235); --primary-rgb: 37,99, 235; }',
    });

    expect(p.log.success).toHaveBeenCalledWith(
      'Theme colors have the channels opacity modifiers need',
    );
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('channels'),
    );
  });

  it('warns about colors without channels, with the line to add', async () => {
    // A theme copied before the -rgb variables, kept by dolan update.
    const p = await runDoctor(PLUGIN, {
      'default.css':
        'page { --primary: rgba(24, 24, 27, 1); --border: hsl(240, 6%, 90%); }',
    });

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /default\.css.*--primary.*--border.*bg-primary\/50.*--primary-rgb: 24, 24, 27;/,
      ),
    );
  });

  it("suggests placeholder channels when it can't read the color", async () => {
    const p = await runDoctor(PLUGIN, {
      'dark.css': 'page.dark { --border: hsl(240, 4%, 16%); }',
    });

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('--border-rgb: r, g, b;'),
    );
  });

  it("warns about channels that don't match their color", async () => {
    // The brand color changed, its channels didn't.
    const p = await runDoctor(PLUGIN, {
      'default.css': `page {
  --primary: #2563eb;
  --primary-rgb: 24, 24, 27;
  --border: #fff;
  --border-rgb: 0, 0, 0;
}`,
    });

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/default\.css.*--primary-rgb.*--border-rgb.*don't/),
    );
  });

  it('warns about space-separated channels, which rgba() reads as one argument', async () => {
    const p = await runDoctor(PLUGIN, {
      'default.css':
        'page { --primary: rgba(24, 24, 27, 1); --primary-rgb: 24 24 27; }',
    });

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/--primary-rgb.* doesn't hold .*comma-separated/),
    );
    expect(p.log.success).not.toHaveBeenCalledWith(
      expect.stringContaining('channels'),
    );
  });

  it('says "doesn\'t" for one differing color, and skips colors it can\'t read', async () => {
    const p = await runDoctor(PLUGIN, {
      'default.css': `page {
  --primary: rgba(37, 99, 235, 1);
  --primary-rgb: 24, 24, 27;
  --border: hsl(240, 6%, 90%);
  --border-rgb: 1, 2, 3;
}`,
    });

    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/--primary-rgb.* doesn't hold/),
    );
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('--border-rgb'),
    );
  });

  it("doesn't check a plugin that maps no themeColor()", async () => {
    // An older plugin: its modifiers never worked, so nothing needs channels.
    const p = await runDoctor("colors: { primary: 'var(--primary)' }", {
      'default.css': 'page { --primary: rgba(24, 24, 27, 1); }',
    });

    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('channels'),
    );
    expect(p.log.success).not.toHaveBeenCalledWith(
      expect.stringContaining('channels'),
    );
  });

  describe('on Tailwind 4', () => {
    /**
     * Writes the theme's tailwind.css and stylesheets, then runs doctor.
     */
    const runDoctor4 = async (css: Record<string, string>) => {
      fixture = createFixture({ config: DEFAULT_CONFIG });
      writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
      const themeDir = join(fixture.dir, DEFAULT_CONFIG.aliases.theme);
      for (const [file, content] of Object.entries(css)) {
        writeFileSync(join(themeDir, file), content);
      }
      vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

      const { doctorCommand } = await import('./doctor');
      await expect(doctorCommand()).rejects.toThrow('process.exit(0)');
      return import('@clack/prompts');
    };

    /**
     * The colors tailwind.css maps, as the theme's does.
     */
    const TAILWIND_CSS = `@theme inline {
  --color-primary: var(--primary);
  --color-destructive-subtle: var(--destructive-subtle);
}`;

    it('checks the colors tailwind.css maps, skipping translucent ones', async () => {
      const p = await runDoctor4({
        'tailwind.css': TAILWIND_CSS,
        'default.css':
          'page { --primary: rgba(24, 24, 27, 1); --primary-rgb: 24, 24, 27; --destructive-subtle: rgba(239, 68, 68, 0.1); }',
      });

      expect(p.log.success).toHaveBeenCalledWith(
        'Theme colors have the channels opacity modifiers need',
      );
    });

    it('warns about a color tailwind.css maps without channels', async () => {
      const p = await runDoctor4({
        'tailwind.css': TAILWIND_CSS,
        'default.css': 'page { --primary: rgba(24, 24, 27, 1); }',
      });

      expect(p.log.warn).toHaveBeenCalledWith(
        expect.stringMatching(/default\.css.*--primary-rgb: 24, 24, 27;/),
      );
    });

    it("doesn't check a theme without tailwind.css or the plugin", async () => {
      const p = await runDoctor4({
        'default.css': 'page { --primary: rgba(24, 24, 27, 1); }',
      });

      expect(p.log.success).not.toHaveBeenCalledWith(
        expect.stringContaining('channels'),
      );
    });
  });
});

describe('doctorCommand theme colors components read', () => {
  /** Every glass color, as dolan's default.css sets them. */
  const GLASS_CSS = `page {
  --glass-tint: rgba(24, 24, 27, 1);
  --glass-tint-rgb: 24, 24, 27;
  --glass-tint-foreground: rgba(250, 250, 250, 1);
  --glass-tint-foreground-rgb: 250, 250, 250;
  --glass-foreground: rgba(9, 9, 11, 1);
  --glass-foreground-rgb: 9, 9, 11;
  --glass-muted-foreground: rgba(63, 63, 70, 1);
  --glass-muted-foreground-rgb: 63, 63, 70;
  --glass-clear-foreground: rgba(255, 255, 255, 1);
  --glass-clear-foreground-rgb: 255, 255, 255;
  --glass-dim: rgba(0, 0, 0, 0.35);
}`;

  /** The glass colors mapped as dolan's tailwind.css maps them. */
  const GLASS_TAILWIND_CSS = `@theme inline {
  --color-glass-tint: var(--glass-tint);
  --color-glass-tint-foreground: var(--glass-tint-foreground);
  --color-glass-foreground: var(--glass-foreground);
  --color-glass-muted-foreground: var(--glass-muted-foreground);
  --color-glass-clear-foreground: var(--glass-clear-foreground);
  --color-glass-dim: var(--glass-dim);
}`;

  /**
   * A Tailwind 4 project with glass installed and the given theme files,
   * and dolan's own theme if `bundled` is given. Runs doctor.
   */
  /**
   * Every warning, without the colors picocolors adds in CI.
   */
  const warnings = async (): Promise<string[]> => {
    const p = await import('@clack/prompts');
    return vi
      .mocked(p.log.warn)
      .mock.calls.map(([message]) => stripVTControlCharacters(String(message)));
  };

  const runDoctor = async (
    theme: Record<string, string>,
    bundled?: Record<string, string>,
    root: Record<string, string> = {},
  ) => {
    fixture = createFixture({
      config: DEFAULT_CONFIG,
      lockfile: tracking('glass', 'icon'),
      components: {
        glass: { 'glass.ts': '' },
        icon: { 'icon.ts': '' },
      },
      themeFiles: bundled,
    });
    writePackageJson(fixture.dir, { dependencies: FULL_ANGULAR_DEPS });
    const themeDir = join(fixture.dir, DEFAULT_CONFIG.aliases.theme);
    for (const [file, content] of Object.entries(theme)) {
      writeFileSync(join(themeDir, file), content);
    }
    for (const [file, content] of Object.entries(root)) {
      writeFileSync(join(fixture.dir, file), content);
    }
    vi.spyOn(process, 'cwd').mockReturnValue(fixture.dir);

    const { doctorCommand } = await import('./doctor');
    await expect(doctorCommand()).rejects.toThrow('process.exit(0)');
    return import('@clack/prompts');
  };

  it('passes when the theme has and maps every color the components read', async () => {
    const p = await runDoctor({
      'default.css': GLASS_CSS,
      'tailwind.css': GLASS_TAILWIND_CSS,
    });

    expect(p.log.success).toHaveBeenCalledWith(
      'Theme has the colors your components read',
    );
  });

  it("lists the colors a theme lacks, with dolan's lines for them", async () => {
    // A theme copied before glass, and edited, so dolan update kept it.
    const p = await runDoctor(
      {
        'default.css': 'page { --primary: rgba(24, 24, 27, 1); }',
        'dark.css': GLASS_CSS.replace('page', 'page.dark'),
      },
      { 'default.css': GLASS_CSS },
    );

    expect(await warnings()).toContainEqual(
      expect.stringMatching(
        /default\.css lacks theme colors that glass read: --glass-tint, .*--glass-dim\..*dolan update.*\n--glass-tint: rgba\(24, 24, 27, 1\);\n--glass-tint-rgb: 24, 24, 27;\n/s,
      ),
    );
    expect(await warnings()).not.toContainEqual(
      expect.stringContaining('dark.css lacks'),
    );
    expect(p.log.success).not.toHaveBeenCalledWith(
      'Theme has the colors your components read',
    );
  });

  it("points at dolan update alone without dolan's theme to quote", async () => {
    await runDoctor({ 'default.css': 'page {}' });

    expect(await warnings()).toContainEqual(
      expect.stringMatching(/default\.css lacks .*haven't edited\.$/),
    );
  });

  it("lists the colors tailwind.css doesn't map", async () => {
    await runDoctor({
      'default.css': GLASS_CSS,
      'tailwind.css': GLASS_TAILWIND_CSS.replace(
        '  --color-glass-dim: var(--glass-dim);\n',
        '',
      ),
    });

    expect(await warnings()).toContainEqual(
      expect.stringMatching(
        /tailwind\.css doesn't map theme colors that glass read to classes: glass-dim\./,
      ),
    );
  });

  it("accepts the Tailwind 3 plugin's themeColor() and var() mappings", async () => {
    const p = await runDoctor(
      {
        'default.css': GLASS_CSS,
        'tailwind-plugin.ts': `glass: {
  tint: { DEFAULT: themeColor('glass-tint'), foreground: themeColor("glass-tint-foreground") },
  foreground: themeColor('glass-foreground'),
  'muted-foreground': themeColor('glass-muted-foreground'),
  'clear-foreground': themeColor('glass-clear-foreground'),
  dim: 'var(--glass-dim)',
}`,
      },
      undefined,
      { 'tailwind.config.ts': 'export default { plugins: [blotchPlugin] };' },
    );

    expect(p.log.success).toHaveBeenCalledWith(
      'Theme has the colors your components read',
    );
  });
});
