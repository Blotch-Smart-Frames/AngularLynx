import * as p from '@clack/prompts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import {
  getComponentNames,
  getEntry,
  resolveDependencies,
} from '../registry.js';
import {
  getComponentFiles,
  getComponentSourceDir,
  rewriteImports,
} from '../utils/resolve-paths.js';
import { formatContent } from '../utils/format.js';
import {
  getOrCreateLockfile,
  hashContent,
  writeLockfile,
} from '../lockfile.js';

/**
 * Copies one or more UI components from the dolan registry into the user's
 * project (`src/components/ui/<name>` by default) and records each file's
 * content hash in `dolan.lock.json`.
 *
 * The shadcn-style philosophy: components are *copied*, not installed as a
 * runtime dependency. Users own and edit the code in their repo. The lockfile
 * lets later commands (update, diff, doctor) detect local modifications by
 * comparing on-disk hashes against the recorded ones, so we know whether an
 * update would clobber user edits.
 *
 * Flow:
 *   1. Resolve the requested components plus transitive dependencies via
 *      `resolveDependencies` (topological order, see registry.ts).
 *   2. Detect any already-installed components and prompt for overwrite —
 *      "skip the conflicts" is the default so a stray re-run doesn't blow
 *      away local changes.
 *   3. For each component: copy every file, rewrite cross-component imports
 *      to use the user's alias config, hash the rewritten content, and record
 *      it in the lockfile.
 */
export const addCommand = async (components: string[]) => {
  const cwd = process.cwd();

  p.intro(pc.bold('dolan add'));

  if (!configExists(cwd)) {
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const allComponents = getComponentNames();

  let selected: string[];

  if (components.length === 0) {
    const result = await p.multiselect({
      message: 'Which components would you like to add?',
      options: allComponents.map((name) => ({ value: name, label: name })),
      required: true,
    });

    if (p.isCancel(result)) {
      p.cancel('Canceled.');
      process.exit(0);
    }

    selected = result as string[];
  } else {
    const invalid = components.filter((c) => !getEntry(c));
    if (invalid.length > 0) {
      p.log.error(
        `Unknown component(s): ${invalid.map((c) => pc.red(c)).join(', ')}`,
      );
      p.log.info(
        `Available: ${allComponents.map((c) => pc.cyan(c)).join(', ')}`,
      );
      process.exit(1);
    }
    selected = components;
  }

  const resolved = resolveDependencies(selected);
  const added = resolved.filter((name) => !selected.includes(name));

  if (added.length > 0) {
    // Components in `resolved` that weren't in `selected` are transitive
    // dependencies pulled in by the registry — surface them so the user
    // knows we're installing more than they explicitly asked for.
    p.log.info(
      `Adding dependencies: ${added.map((c) => pc.cyan(c)).join(', ')}`,
    );
  }

  const existing = resolved.filter((name) => {
    const destDir = resolve(cwd, config.aliases.components, name);
    return existsSync(destDir);
  });

  if (existing.length > 0) {
    // Default to "no" (initialValue: false) — destructive operations on
    // user-owned code should require an explicit affirmative. The user can
    // re-run with --force later if we add that flag.
    const overwrite = await p.confirm({
      message: `${existing.map((c) => pc.yellow(c)).join(', ')} already exist. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      // Filter the existing components out of `resolved` in-place via splice
      // so later code (the copy loop, the success message) operates on the
      // narrowed set. We can't just `resolved = filtered` because the array
      // reference is captured by the destructuring below.
      const filtered = resolved.filter((name) => !existing.includes(name));
      if (filtered.length === 0) {
        p.cancel('Nothing to add.');
        process.exit(0);
      }
      resolved.splice(0, resolved.length, ...filtered);
    }
  }

  const s = p.spinner();
  s.start('Adding components...');

  const componentsDir = resolve(cwd, config.aliases.components);
  const lockfile = getOrCreateLockfile(cwd);

  for (const name of resolved) {
    const srcDir = getComponentSourceDir(name);
    const destDir = resolve(componentsDir, name);
    mkdirSync(destDir, { recursive: true });

    if (!lockfile.components[name]) {
      lockfile.components[name] = {};
    }

    const files = getComponentFiles(name);
    for (const file of files) {
      // Read from the registry source, then rewrite cross-component imports.
      // The registry uses workspace-relative imports like
      // `@blotch/ui/components/button` which won't resolve in the user's
      // project — rewriteImports rewrites them to the user's alias
      // (e.g. `@/components/ui/button`) per dolan.config.json.
      const destPath = join(destDir, file);
      const content = readFileSync(join(srcDir, file), 'utf-8');
      // Normalize to the consumer's oxfmt config so what we write already
      // satisfies their formatter (the import rewrite can push lines past
      // printWidth). The hash below must be of this normalized content — see
      // formatContent's doc comment on the lockfile-base invariant.
      const rewritten = formatContent(rewriteImports(content), destPath);
      writeFileSync(destPath, rewritten);
      // Hash the *rewritten* content (not the source) so subsequent
      // dolan-diff/dolan-update compare apples to apples — they re-rewrite
      // the registry source and hash the result the same way.
      lockfile.components[name][file] = { hash: hashContent(rewritten) };
    }
  }

  writeLockfile(cwd, lockfile);

  s.stop('Done!');

  p.log.success(
    `Added ${resolved.length} component(s): ${resolved.map((c) => pc.green(c)).join(', ')}`,
  );

  p.outro('Components are ready to use.');
};
