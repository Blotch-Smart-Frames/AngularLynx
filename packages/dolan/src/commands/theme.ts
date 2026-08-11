import * as p from '@clack/prompts';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getUiSourceDir } from '../utils/resolve-paths.js';

export const themeCommand = async (name?: string) => {
  const cwd = process.cwd();

  p.intro(pc.bold('dolan theme'));

  if (!configExists(cwd)) {
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const themeDir = resolve(cwd, config.aliases.theme);

  if (name) {
    createTheme(name, themeDir);
  } else {
    listThemes(themeDir);
  }
};

const listThemes = (themeDir: string) => {
  if (!existsSync(themeDir)) {
    p.log.warn('No theme directory found.');
    p.outro('');
    return;
  }

  const files = readdirSync(themeDir).filter((f) => f.endsWith('.css'));

  if (files.length === 0) {
    p.log.warn('No theme files found.');
    p.outro('');
    return;
  }

  p.log.message(pc.bold('Installed themes:\n'));

  for (const file of files) {
    const name = file.replace('.css', '');
    p.log.message(`  ${pc.green('●')} ${name}`);
  }

  p.outro(`Create a custom theme: ${pc.bold('dolan theme <name>')}`);
};

const createTheme = (name: string, themeDir: string) => {
  const fileName = `${name}.css`;
  const destPath = resolve(themeDir, fileName);

  if (existsSync(destPath)) {
    p.log.error(`Theme ${pc.bold(name)} already exists at ${pc.dim(destPath)}`);
    process.exit(1);
  }

  // Read the default theme as a template
  const uiSrc = getUiSourceDir();
  const defaultThemePath = join(uiSrc, 'theme', 'default.css');

  if (!existsSync(defaultThemePath)) {
    p.log.error('Could not find default theme template in @blotch/ui.');
    process.exit(1);
  }

  const template = readFileSync(defaultThemePath, 'utf-8');

  // Replace only the first block comment (the header). The lazy `*?` is
  // critical — without it, the greedy version would consume everything from
  // the first `/*` to the LAST `*/` in the file, wiping all comments.
  const content = template.replace(
    /\/\*[\s\S]*?\*\//,
    `/* Custom theme: ${name}\n *\n * Edit the CSS variables below to customize your theme.\n * Values are complete rgba() colors (e.g., "rgba(24, 24, 27, 1)") referenced\n * directly via var(--x); Lynx drops Tailwind's space-separated hsl(var() / a).\n */`,
  );

  writeFileSync(destPath, content);

  p.log.success(`Created ${pc.bold(fileName)} in ${pc.dim(themeDir)}`);
  p.log.info(
    `Import it in your global styles:\n  ${pc.cyan(`@import './${fileName}';`)}`,
  );
  p.outro('Edit the CSS variables to customize your theme.');
};
