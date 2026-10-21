import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolvePackages } from '../registry.js';
import {
  detectPackageManager,
  installCommand,
  installPackages,
  missingPackages,
} from '../utils/packages.js';

/**
 * Installs the npm packages `components` import that the project doesn't
 * depend on yet. A failed install isn't fatal (the files are already copied),
 * so it prints the command to run instead.
 */
export const installComponentPackages = (
  cwd: string,
  components: string[],
): void => {
  const missing = missingPackages(cwd, resolvePackages(components));
  if (missing.length === 0) return;
  const command = installCommand(detectPackageManager(cwd), missing).join(' ');
  p.log.step(`Installing ${missing.map((spec) => pc.cyan(spec)).join(', ')}`);
  if (!installPackages(cwd, missing)) {
    p.log.warn(`Couldn't install them. Run ${pc.bold(command)} yourself.`);
  }
};
