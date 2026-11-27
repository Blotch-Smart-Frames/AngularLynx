import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { formatContent } from './format.js';

/**
 * What `registerAppIcons` did.
 *
 * - `none`: nothing to do. The app has no icon copy that takes registrations,
 *   registers its icons already, or names none.
 * - `written`: it put `provideIcons()` with the icons the app names in
 *   `file`, the app's config.
 * - `no-config`: the app names icons but has no config to put them in, so
 *   `snippet` is the call for the app to add itself.
 *
 * `iconsUsers` are the app's files that read `ICONS`, the map of every icon
 * that registrations replaced: they need changing by hand.
 */
export type IconRegistration =
  | { kind: 'none'; iconsUsers: string[] }
  | { kind: 'written'; file: string; names: string[]; iconsUsers: string[] }
  | {
      kind: 'no-config';
      names: string[];
      snippet: string;
      iconsUsers: string[];
    };

/** Folders that hold no source of the app's own. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage']);

/**
 * The app's `.ts` and `.html` files under `dir`, leaving out `skip`.
 */
const sourceFiles = (dir: string, skip: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return path === skip ||
        SKIPPED_DIRS.has(entry.name) ||
        entry.name.startsWith('.')
        ? []
        : sourceFiles(path, skip);
    }
    return /\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });

/**
 * The set's icons, by name, with the export that holds each:
 * `chevron-right` → `chevronRightIcon`.
 */
const iconExports = (iconSet: string): Map<string, string> =>
  new Map(
    [
      ...iconSet.matchAll(
        /export const (\w+) = \{\s*name: '([a-z0-9-]+)'(?: as const)?,/g,
      ),
    ].map(([, exported, name]) => [name, exported]),
  );

/**
 * `../components/ui/icon`, an import specifier from `from`'s folder.
 */
const importPath = (from: string, to: string): string => {
  const path = relative(dirname(from), to).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
};

/**
 * Registers the icons an app draws by name, for an app whose icon copy now
 * takes registrations (`provideIcons()`) where it used to bundle every icon.
 * Run after `add` or `update` writes the icon component, it changes nothing
 * once the app registers icons itself.
 *
 * An app names an icon in a template (`name="check"`, `icon="home"`), in a
 * binding (`[name]="done() ? 'check' : 'x'"`), or in data a binding reads
 * (`{ icon: 'home' }`, bound as `[icon]="item.icon"`). The first two are
 * read where they are. Data could be anywhere, so once a binding names no
 * icon itself, every quoted string in the app's source that's the name of an
 * icon counts. That can register an icon the app doesn't draw, such as `'x'`
 * for a chart's axis, which costs a few hundred bytes; missing one it does
 * draw would throw on the screen that draws it. A name the app builds at
 * runtime (`'arrow-' + side`) can't be found, and throws naming the icon to
 * add.
 *
 * The components' own copies are left out: each registers or imports the
 * icons it draws itself.
 */
export const registerAppIcons = (
  cwd: string,
  componentsDir: string,
): IconRegistration => {
  const iconDir = join(componentsDir, 'icon');
  const iconSetFile = join(iconDir, 'icon-set.ts');
  const iconsFile = join(iconDir, 'icons.ts');
  // An app that kept its own icons.ts, from before registrations, has
  // nothing to register them with.
  if (
    !existsSync(iconSetFile) ||
    !existsSync(iconsFile) ||
    !readFileSync(iconsFile, 'utf-8').includes('export const provideIcons')
  ) {
    return { kind: 'none', iconsUsers: [] };
  }

  const srcDir = existsSync(join(cwd, 'src')) ? join(cwd, 'src') : cwd;
  const files = sourceFiles(srcDir, componentsDir).map((path) => ({
    path,
    content: readFileSync(path, 'utf-8'),
  }));
  const iconsUsers = files
    .filter(({ content }) => /\bICONS\b/.test(content))
    .map(({ path }) => relative(cwd, path));

  // The app's own registrations: a spec that registers the icons it renders
  // with doesn't register them for the app.
  if (
    files.some(
      ({ path, content }) =>
        !/\.(spec|test)\.ts$/.test(path) &&
        /\bprovide(All)?Icons\s*\(/.test(content),
    )
  ) {
    return { kind: 'none', iconsUsers };
  }

  const exports = iconExports(readFileSync(iconSetFile, 'utf-8'));
  const names = new Set<string>();
  const add = (name: string) => {
    if (exports.has(name)) names.add(name);
  };
  const quoted = (text: string) =>
    [...text.matchAll(/(['"`])([a-z0-9-]+)\1/g)].map(([, , name]) => name);
  /**
   * A binding whose every outcome is a name written in it, such as
   * `[name]="done() ? 'check' : 'x'"`. Any other outcome, as in
   * `on() ? 'check' : item.icon`, takes its names from data.
   */
  const allWritten = (expression: string): boolean => {
    const literal = /^\s*(['"`])[a-z0-9-]+\1\s*$/;
    // The condition, up to a `?` that isn't optional chaining (`a?.b`).
    const ternary = /^[^'"`]*?\?(?!\.)([^:]*):(.*)$/s.exec(expression);
    return ternary
      ? literal.test(ternary[1]) && allWritten(ternary[2])
      : literal.test(expression);
  };
  let fromData = false;
  for (const { content } of files) {
    // Angular takes either quote around an attribute.
    for (const [, , name] of content.matchAll(
      /\b(?:name|icon)=(["'])([a-z0-9-]+)\1/g,
    )) {
      add(name);
    }
    for (const [, , expression] of content.matchAll(
      /\[(?:name|icon)\]=(["'])(.*?)\1/g,
    )) {
      quoted(expression).forEach(add);
      if (!allWritten(expression)) fromData = true;
    }
  }
  if (fromData) {
    for (const { content } of files) quoted(content).forEach(add);
  }
  if (names.size === 0) return { kind: 'none', iconsUsers };

  const sorted = [...names].sort();
  const imported = sorted.map((name) => exports.get(name)!);

  // The app's config: the file that declares its ApplicationConfig with a
  // providers array, app.config.ts in an Angular CLI app.
  const config = files
    .filter(
      ({ content }) =>
        /\bApplicationConfig\b/.test(content) &&
        /\bproviders:\s*\[/.test(content),
    )
    .sort(
      (a, b) =>
        Number(b.path.endsWith('app.config.ts')) -
        Number(a.path.endsWith('app.config.ts')),
    )[0];
  if (!config) {
    return {
      kind: 'no-config',
      names: sorted,
      snippet: `import { ${[...imported, 'provideIcons'].join(', ')} } from '<components>/icon';\n\nprovideIcons({ ${imported.join(', ')} })`,
      iconsUsers,
    };
  }

  const imports = [...config.content.matchAll(/^import [^;]+;\n/gm)];
  const afterImports = imports.length
    ? imports[imports.length - 1].index + imports[imports.length - 1][0].length
    : 0;
  // A name the config imports already, such as an icon it draws with
  // iconSvg(), is used under its local name rather than imported twice.
  const local = new Map<string, string>();
  for (const [, list] of config.content.matchAll(/^import\s*\{([^}]*)\}/gm)) {
    for (const [, name, alias] of list.matchAll(/(\w+)(?:\s+as\s+(\w+))?/g)) {
      local.set(name, alias ?? name);
    }
  }
  const missing = [...imported, 'provideIcons'].filter(
    (name) => !local.has(name),
  );
  const statement = missing.length
    ? `import { ${missing.join(', ')} } from '${importPath(config.path, iconDir)}';\n`
    : '';
  const call = `${local.get('provideIcons') ?? 'provideIcons'}({ ${imported
    .map((name) => local.get(name) ?? name)
    .join(', ')} })`;
  const withImport =
    config.content.slice(0, afterImports) +
    statement +
    config.content.slice(afterImports);
  // First in the list, so it's easy to find and add to, in the list's own
  // layout: one provider to a line, or all on the one.
  const updated = withImport.replace(
    /\bproviders:\s*\[(\s*)(\]?)/,
    (_, space: string, close: string) => {
      if (close) return `providers: [${call}]`;
      if (space.includes('\n')) return `providers: [${space}${call},${space}`;
      return `providers: [${call}, `;
    },
  );
  writeFileSync(config.path, formatContent(updated, config.path));
  return {
    kind: 'written',
    file: relative(cwd, config.path),
    names: sorted,
    iconsUsers,
  };
};

/**
 * Tells the user what `registerAppIcons` did, and what's theirs to finish:
 * an app that can't be migrated by itself would otherwise find out from an
 * error on the screen that draws an icon.
 */
export const logIconRegistration = (registration: IconRegistration): void => {
  if (registration.kind === 'written') {
    p.log.info(
      `Registered the ${registration.names.length} icon(s) your app names (${registration.names.join(', ')}) with ${pc.bold('provideIcons()')} in ${pc.cyan(registration.file)}. An app's scripts now carry only the icons it registers. A spec that renders one of your components needs them too: add the same ${pc.bold('provideIcons()')} to its providers.`,
    );
  } else if (registration.kind === 'no-config') {
    p.log.warn(
      `Your app draws icons by name (${registration.names.join(', ')}), and an icon now draws only once it's registered. Add this to your app's providers:\n\n${registration.snippet}`,
    );
  }
  if (registration.iconsUsers.length > 0) {
    p.log.warn(
      `${pc.bold('ICONS')} is gone, so these files need changing: ${registration.iconsUsers.map((file) => pc.cyan(file)).join(', ')}. Import the icon instead, such as ${pc.bold('iconSvg(chevronRightIcon)')} for its markup, or ${pc.bold('provideAllIcons()')} to register every icon.`,
    );
  }
};
