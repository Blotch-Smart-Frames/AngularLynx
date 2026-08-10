import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getEntry, getComponentNames, registry } from '../registry.js';
import { getComponentFiles } from '../utils/resolve-paths.js';

export const infoCommand = async (component: string) => {
  p.intro(pc.bold('dolan info'));

  const entry = getEntry(component);

  if (!entry) {
    p.log.error(
      `Unknown component ${pc.bold(component)}. Available: ${getComponentNames().join(', ')}`,
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const hasConfig = configExists(cwd);
  let isInstalled = false;
  let installPath = '';

  if (hasConfig) {
    const config = readConfig(cwd);
    const componentsDir = resolve(cwd, config.aliases.components);
    const componentDir = resolve(componentsDir, component);
    isInstalled = existsSync(componentDir);
    if (isInstalled) {
      installPath = config.aliases.components + '/' + component;
    }
  }

  // Component name + install status
  const installLabel = isInstalled
    ? `${pc.green('✓')} installed at ${pc.dim(installPath)}`
    : pc.dim('not installed');

  p.log.message(`  ${pc.bold('Name:')}         ${component}`);
  p.log.message(`  ${pc.bold('Installed:')}    ${installLabel}`);

  // Files
  const files = getComponentFiles(component);
  p.log.message(`  ${pc.bold('Files:')}        ${files.join(', ')}`);

  // Dependencies
  const componentsDir = hasConfig
    ? resolve(cwd, readConfig(cwd).aliases.components)
    : '';

  if (entry.dependencies.length > 0) {
    const depLabels = entry.dependencies.map((dep) => {
      if (!hasConfig) return dep;
      const depInstalled = existsSync(resolve(componentsDir, dep));
      return depInstalled ? `${dep} ${pc.green('✓')}` : `${dep} ${pc.red('✗')}`;
    });
    p.log.message(`  ${pc.bold('Dependencies:')} ${depLabels.join(', ')}`);
  } else {
    p.log.message(`  ${pc.bold('Dependencies:')} ${pc.dim('none')}`);
  }

  // Reverse dependencies (who depends on this component)
  const dependents = registry
    .filter((r) => r.dependencies.includes(component))
    .map((r) => r.name);

  if (dependents.length > 0) {
    const depLabels = dependents.map((dep) => {
      if (!hasConfig) return dep;
      const depInstalled = existsSync(resolve(componentsDir, dep));
      return depInstalled
        ? `${dep} ${pc.green('✓')}`
        : `${dep} ${pc.dim('(not installed)')}`;
    });
    p.log.message(`  ${pc.bold('Used by:')}      ${depLabels.join(', ')}`);
  } else {
    p.log.message(`  ${pc.bold('Used by:')}      ${pc.dim('none')}`);
  }

  p.outro('');
};
