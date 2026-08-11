import * as p from '@clack/prompts';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getEntry, getComponentNames, registry } from '../registry.js';
import { getOrCreateLockfile, writeLockfile } from '../lockfile.js';

/**
 * Removes one installed UI component from the user's project, and offers to
 * also remove any dependencies that would become orphaned (installed but no
 * longer referenced by any remaining installed component).
 *
 * Two safety nets:
 *   - **Dependents check** — if other installed components still depend on
 *     this one, warn before removal because removing it would break them.
 *   - **Orphan detection** — `findOrphans` walks the registry to find
 *     dependencies that became "dead weight" after this removal. The user
 *     opts in via prompt (default yes — cleanup is usually what they want).
 *
 * `--force` skips both prompts: dependents are removed anyway, and orphans
 * are auto-removed without asking.
 */
export const removeCommand = async (
  component: string,
  options: { force?: boolean },
) => {
  const cwd = process.cwd();

  p.intro(pc.bold('dolan remove'));

  if (!configExists(cwd)) {
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const entry = getEntry(component);
  if (!entry) {
    p.log.error(
      `Unknown component ${pc.bold(component)}. Available: ${getComponentNames().join(', ')}`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const componentsDir = resolve(cwd, config.aliases.components);
  const componentDir = resolve(componentsDir, component);

  if (!existsSync(componentDir)) {
    p.log.error(`${pc.bold(component)} is not installed.`);
    process.exit(1);
  }

  // Determine what's currently installed by intersecting the components dir
  // with the registry — directories we don't recognize from the registry are
  // assumed to be user-owned and ignored. The Set lookup is required for the
  // O(1) `installed.has()` checks inside the dependents filter below.
  const allKnown = new Set(getComponentNames());
  const installed = new Set(
    existsSync(componentsDir)
      ? readdirSync(componentsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && allKnown.has(e.name))
          .map((e) => e.name)
      : [],
  );

  // A component is a "dependent" if (a) the registry lists `component` in its
  // dependencies array AND (b) it's currently installed. The self-exclusion
  // guard (`r.name !== component`) handles the degenerate case of a component
  // appearing in its own dependency list — shouldn't happen, but it would
  // produce a misleading warning if it did.
  const dependents = registry.filter(
    (r) =>
      r.dependencies.includes(component) &&
      installed.has(r.name) &&
      r.name !== component,
  );

  if (dependents.length > 0 && !options.force) {
    p.log.warn(
      `The following installed components depend on ${pc.bold(component)}: ${dependents.map((d) => pc.bold(d.name)).join(', ')}`,
    );
    const proceed = await p.confirm({
      message: 'Remove anyway? This may break those components.',
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Removal canceled.');
      process.exit(0);
    }
  }

  // Identify orphaned dependencies
  const removalSet = new Set([component]);

  if (entry.dependencies.length > 0) {
    const orphans = findOrphans(component, installed, removalSet);

    if (orphans.length > 0 && !options.force) {
      const removeOrphans = await p.confirm({
        message: `Also remove orphaned dependencies? (${orphans.map((o) => pc.bold(o)).join(', ')})`,
        initialValue: true,
      });

      if (!p.isCancel(removeOrphans) && removeOrphans) {
        for (const orphan of orphans) {
          removalSet.add(orphan);
        }
      }
    } else if (options.force) {
      for (const orphan of findOrphans(component, installed, removalSet)) {
        removalSet.add(orphan);
      }
    }
  }

  // Perform removal
  const lockfile = getOrCreateLockfile(cwd);

  for (const name of removalSet) {
    const dir = resolve(componentsDir, name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
    delete lockfile.components[name];
  }

  writeLockfile(cwd, lockfile);

  const removed = [...removalSet].sort();
  p.log.success(`Removed: ${removed.map((n) => pc.bold(n)).join(', ')}`);
  p.outro('Done.');
};

/**
 * Find dependencies of `target` that are installed but no longer needed by
 * any other installed component (excluding those already in the removal set).
 *
 * Algorithm: for each direct dependency of the target, ask "is any OTHER
 * installed component (that isn't itself being removed) still referencing
 * this dependency?" — if no, it's orphaned.
 *
 * Note: this is intentionally single-level, not transitive. If A depends on B
 * which depends on C, and we remove A, we'll detect B as orphaned but won't
 * automatically detect C — the user would need to re-run remove on B (or run
 * `dolan doctor` which scans for all orphans). Transitive orphan detection
 * here would require a fixed-point iteration and is overkill given how short
 * component dependency chains typically are (1-2 levels deep).
 */
const findOrphans = (
  target: string,
  installed: Set<string>,
  removalSet: Set<string>,
): string[] => {
  const targetEntry = getEntry(target);
  if (!targetEntry) return [];

  const orphans: string[] = [];

  for (const dep of targetEntry.dependencies) {
    // Skip deps that aren't actually installed (e.g. the user removed them
    // manually) — there's nothing to orphan.
    if (!installed.has(dep)) continue;
    // Skip deps already queued for removal — avoid double-reporting.
    if (removalSet.has(dep)) continue;

    // Check if any other installed component (not being removed) depends on this
    const stillNeeded = registry.some(
      (r) =>
        r.name !== target &&
        !removalSet.has(r.name) &&
        installed.has(r.name) &&
        r.dependencies.includes(dep),
    );

    if (!stillNeeded) {
      orphans.push(dep);
    }
  }

  return orphans;
};
