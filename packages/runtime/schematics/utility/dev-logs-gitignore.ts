import type { Rule, Tree } from '@angular-devkit/schematics';

/** An entry that already ignores `.dev-logs`, anchored or not. */
const DEV_LOGS_ENTRY = /^\/?\.dev-logs\/?\s*$/m;

/**
 * Adds `.dev-logs` to the workspace's `.gitignore`. `ng serve` writes
 * `LynxLogger`'s output to that file, in the folder it runs from, and it
 * shouldn't be committed. The entry has no leading slash, so it matches
 * wherever the file is.
 *
 * A workspace without a `.gitignore` (`ng new --skip-git`) is left alone,
 * and so is one that ignores the file already.
 */
export const ignoreDevLogs = (): Rule => (tree: Tree) => {
  const file = '/.gitignore';
  if (!tree.exists(file)) return;
  const text = tree.readText(file);
  if (DEV_LOGS_ENTRY.test(text)) return;
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  tree.overwrite(
    file,
    `${text}${separator}\n# LynxLogger's output while \`ng serve\` runs\n.dev-logs\n`,
  );
};
