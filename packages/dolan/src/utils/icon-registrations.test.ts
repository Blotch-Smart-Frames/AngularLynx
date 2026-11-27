import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as p from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IconRegistration,
  logIconRegistration,
  registerAppIcons,
} from './icon-registrations';

vi.mock('@clack/prompts', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

/** The icon copy an app has once its icons take registrations. */
const ICON_SET = `export const checkIcon = {
  name: 'check' as const,
  body: '<path d="M20 6 9 17l-5-5"/>',
};
export const chevronRightIcon = {
  name: 'chevron-right' as const,
  body: '<path d="m9 18 6-6-6-6"/>',
};
export const homeIcon = {
  name: 'home' as const,
  body: '<path d="M3 9"/>',
};
export const undo2Icon = {
  name: 'undo-2' as const,
  body: '<path d="M9 14"/>',
};
`;
const ICONS = `export const provideIcons = () => [];\n`;

const APP_CONFIG = `import { type ApplicationConfig } from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';

export const appConfig: ApplicationConfig = {
  providers: [provideRenderer()],
};
`;

let cwd: string;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
};
const read = (path: string) => readFileSync(join(cwd, path), 'utf-8');
const components = () => join(cwd, 'src/components/ui');

/**
 * An app with the icon copy that takes registrations, and its config.
 */
const app = () => {
  write('src/components/ui/icon/icon-set.ts', ICON_SET);
  write('src/components/ui/icon/icons.ts', ICONS);
  write('src/app/app.config.ts', APP_CONFIG);
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'dolan-icons-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('registerAppIcons', () => {
  it('registers every icon the app names, in its config', () => {
    app();
    write(
      'src/app/app.ts',
      '@Component({ template: `<ui-icon name="check" /><ui-icon [name]="done() ? \'undo-2\' : \'home\'" />` })\nclass App {}\n',
    );
    write('src/app/list.html', '<ui-tab-bar-item icon="chevron-right" />');

    const result = registerAppIcons(cwd, components());

    expect(result).toEqual({
      kind: 'written',
      file: join('src', 'app', 'app.config.ts'),
      names: ['check', 'chevron-right', 'home', 'undo-2'],
      iconsUsers: [],
    });
    expect(read('src/app/app.config.ts'))
      .toBe(`import { type ApplicationConfig } from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { checkIcon, chevronRightIcon, homeIcon, undo2Icon, provideIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [provideIcons({ checkIcon, chevronRightIcon, homeIcon, undo2Icon }), provideRenderer()],
};
`);
  });

  it('adds the call on a line of its own in a list laid out that way', () => {
    app();
    write(
      'src/app/app.config.ts',
      "import { a } from 'a';\n\nexport const appConfig: ApplicationConfig = {\n  providers: [\n    a(),\n  ],\n};\n",
    );
    write('src/app/app.ts', '<ui-icon name="home" />\n');
    registerAppIcons(cwd, components());
    expect(read('src/app/app.config.ts')).toBe(
      "import { a } from 'a';\nimport { homeIcon, provideIcons } from '../components/ui/icon';\n\nexport const appConfig: ApplicationConfig = {\n  providers: [\n    provideIcons({ homeIcon }),\n    a(),\n  ],\n};\n",
    );
  });

  // `[icon]="item.icon"` names no icon itself: the names are in the data.
  it('counts a name in TypeScript, for an icon bound from data', () => {
    app();
    write(
      'src/app/tabs.ts',
      'export const TABS = [{ icon: \'home\' }, { icon: "check" }];\n',
    );
    write('src/app/tabs.html', '<ui-tab-bar-item [icon]="tab.icon" />');
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['check', 'home'],
    });
  });

  // A chart's `'x'` axis is no icon: with every name written where it's
  // drawn, other strings don't count.
  it('counts other strings only once a binding reads its names from data', () => {
    app();
    write(
      'src/app/app.ts',
      "`<ui-icon name=\"home\" /><ui-icon [name]=\"on() ? 'check' : 'undo-2'\" />`; const axis = 'x';\n",
    );
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['check', 'home', 'undo-2'],
    });
  });

  it("leaves out the components' own copies and what isn't the app's source", () => {
    app();
    write('src/app/app.ts', '<ui-icon name="home" />\n');
    write('src/components/ui/menu/menu.ts', '<ui-icon name="check" />\n');
    write('src/node_modules/x/index.ts', '<ui-icon name="check" />\n');
    write('src/.cache/x.ts', '<ui-icon name="check" />\n');
    write('src/types.d.ts', "declare const e: 'check';\n");
    write('src/notes.md', "'check'\n");
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['home'],
    });
  });

  it('changes nothing once the app registers its icons', () => {
    app();
    write(
      'src/app/app.ts',
      'provideIcons({ homeIcon }); `<ui-icon name="check" />`;\n',
    );
    expect(registerAppIcons(cwd, components())).toEqual({
      kind: 'none',
      iconsUsers: [],
    });
    expect(read('src/app/app.config.ts')).toBe(APP_CONFIG);
  });

  // A spec registers the icons it renders with, not the app's.
  it("registers the app's icons when only a spec registers icons", () => {
    app();
    write('src/app/app.ts', '`<ui-icon name="home" />`;\n');
    write(
      'src/app/app.test.ts',
      'render(App, { providers: [provideIcons({ homeIcon })] });\n',
    );
    expect(registerAppIcons(cwd, components())).toMatchObject({
      kind: 'written',
      names: ['home'],
    });
  });

  it('reads attributes and bindings in single quotes', () => {
    app();
    write(
      'src/app/app.html',
      `<ui-icon name='home' /><ui-icon [name]='on() ? "check" : "undo-2"' />`,
    );
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['check', 'home', 'undo-2'],
    });
  });

  // `item.icon` is data, though the other outcome is written in the binding.
  it('reads data for a binding with one outcome that is no name', () => {
    app();
    write(
      'src/app/app.ts',
      "const item = { icon: 'home' };\n`<ui-icon [icon]=\"on() ? 'check' : item.icon\" />`;\n",
    );
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['check', 'home'],
    });
  });

  it('takes a ternary after optional chaining for one that names icons', () => {
    app();
    write(
      'src/app/app.ts',
      "const t = 'chevron-right';\n`<ui-icon [name]=\"a?.b ? 'check' : 'home'\" />`;\n",
    );
    expect(registerAppIcons(cwd, components())).toMatchObject({
      names: ['check', 'home'],
    });
  });

  // An icon the config draws with iconSvg() is imported there already.
  it('uses the imports the config has, under their local names', () => {
    app();
    write(
      'src/app/app.config.ts',
      "import { homeIcon as home, iconSvg } from '../components/ui/icon';\n\nexport const appConfig: ApplicationConfig = { providers: [] };\n",
    );
    write(
      'src/app/app.ts',
      '`<ui-icon name="home" /><ui-icon name="check" />`;\n',
    );
    registerAppIcons(cwd, components());
    expect(read('src/app/app.config.ts')).toBe(
      "import { homeIcon as home, iconSvg } from '../components/ui/icon';\nimport { checkIcon, provideIcons } from '../components/ui/icon';\n\nexport const appConfig: ApplicationConfig = { providers: [provideIcons({ checkIcon, home })] };\n",
    );
  });

  it('adds no import when the config has them all', () => {
    app();
    write(
      'src/app/app.config.ts',
      "import { homeIcon, provideIcons } from '../components/ui/icon';\n\nexport const appConfig: ApplicationConfig = { providers: [] };\n",
    );
    write('src/app/app.ts', '`<ui-icon name="home" />`;\n');
    registerAppIcons(cwd, components());
    expect(read('src/app/app.config.ts')).toBe(
      "import { homeIcon, provideIcons } from '../components/ui/icon';\n\nexport const appConfig: ApplicationConfig = { providers: [provideIcons({ homeIcon })] };\n",
    );
  });

  it('changes nothing for an app that registers every icon', () => {
    app();
    write('src/app/app.ts', 'provideAllIcons(); `<ui-icon name="check" />`;\n');
    expect(registerAppIcons(cwd, components()).kind).toBe('none');
  });

  it('changes nothing for an app that names no icon', () => {
    app();
    write('src/app/app.ts', '<ui-icon name="nothing" />\n');
    expect(registerAppIcons(cwd, components()).kind).toBe('none');
    expect(read('src/app/app.config.ts')).toBe(APP_CONFIG);
  });

  it('changes nothing without the icon component', () => {
    write('src/app/app.config.ts', APP_CONFIG);
    write('src/app/app.ts', '<ui-icon name="check" />\n');
    expect(registerAppIcons(cwd, components()).kind).toBe('none');
  });

  // A copy kept from before registrations has no provideIcons() to call.
  it('changes nothing for an app that kept its icons.ts from before', () => {
    app();
    write('src/components/ui/icon/icons.ts', 'export const ICONS = {};\n');
    write('src/app/app.ts', '<ui-icon name="check" />\n');
    expect(registerAppIcons(cwd, components()).kind).toBe('none');
  });

  it("lists the app's files that read ICONS, which is gone", () => {
    app();
    write('src/app/a.ts', "import { ICONS } from '../components/ui/icon';\n");
    write('src/app/b.ts', 'provideIcons({}); ICONS.x;\n');
    expect(registerAppIcons(cwd, components())).toEqual({
      kind: 'none',
      iconsUsers: [join('src', 'app', 'a.ts'), join('src', 'app', 'b.ts')],
    });
  });

  it('prefers app.config.ts to another file with an ApplicationConfig', () => {
    app();
    write(
      'src/app/a-other.ts',
      'export const other: ApplicationConfig = { providers: [] };\n',
    );
    write('src/app/app.ts', '<ui-icon name="check" />\n');
    expect(registerAppIcons(cwd, components())).toMatchObject({
      file: join('src', 'app', 'app.config.ts'),
    });
    expect(read('src/app/a-other.ts')).not.toContain('provideIcons');
  });

  it('imports from a folder below the config, and into a config with no imports', () => {
    write('src/components/ui/icon/icon-set.ts', ICON_SET);
    write('src/components/ui/icon/icons.ts', ICONS);
    write(
      'src/main.ts',
      'const config: ApplicationConfig = { providers: [] };\nconst a = \'<ui-icon name="check" />\';\n',
    );
    registerAppIcons(cwd, components());
    expect(read('src/main.ts')).toBe(
      "import { checkIcon, provideIcons } from './components/ui/icon';\nconst config: ApplicationConfig = { providers: [provideIcons({ checkIcon })] };\nconst a = '<ui-icon name=\"check\" />';\n",
    );
  });

  it('reads an app without a src folder from its root', () => {
    write('components/ui/icon/icon-set.ts', ICON_SET);
    write('components/ui/icon/icons.ts', ICONS);
    write('app.ts', '<ui-icon name="home" />\n');
    expect(registerAppIcons(cwd, join(cwd, 'components/ui'))).toMatchObject({
      kind: 'no-config',
      names: ['home'],
    });
  });

  it('gives the call to add for an app without a config', () => {
    write('src/components/ui/icon/icon-set.ts', ICON_SET);
    write('src/components/ui/icon/icons.ts', ICONS);
    write(
      'src/app/app.ts',
      '`<ui-icon name="home" /><ui-icon name="check" />`;\n',
    );
    expect(registerAppIcons(cwd, components())).toEqual({
      kind: 'no-config',
      names: ['check', 'home'],
      snippet:
        "import { checkIcon, homeIcon, provideIcons } from '<components>/icon';\n\nprovideIcons({ checkIcon, homeIcon })",
      iconsUsers: [],
    });
  });
});

const logged = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map(([message]) => stripVTControlCharacters(String(message)));

describe('logIconRegistration', () => {
  it('says what it registered, and where', () => {
    logIconRegistration({
      kind: 'written',
      file: 'src/app/app.config.ts',
      names: ['check', 'home'],
      iconsUsers: [],
    });
    expect(logged(vi.mocked(p.log.info))[0]).toContain(
      'Registered the 2 icon(s) your app names (check, home) with provideIcons() in src/app/app.config.ts.',
    );
    expect(p.log.warn).not.toHaveBeenCalled();
  });

  it('gives the call to add when it found no config', () => {
    logIconRegistration({
      kind: 'no-config',
      names: ['home'],
      snippet: 'provideIcons({ homeIcon })',
      iconsUsers: [],
    });
    expect(logged(vi.mocked(p.log.warn))[0]).toContain(
      'provideIcons({ homeIcon })',
    );
    expect(p.log.info).not.toHaveBeenCalled();
  });

  it('names the files that read ICONS', () => {
    const registration: IconRegistration = {
      kind: 'none',
      iconsUsers: ['src/app/a.ts'],
    };
    logIconRegistration(registration);
    expect(logged(vi.mocked(p.log.warn))[0]).toContain(
      'ICONS is gone, so these files need changing: src/app/a.ts.',
    );
  });

  it('says nothing when there was nothing to do', () => {
    logIconRegistration({ kind: 'none', iconsUsers: [] });
    expect(p.log.info).not.toHaveBeenCalled();
    expect(p.log.warn).not.toHaveBeenCalled();
  });
});
