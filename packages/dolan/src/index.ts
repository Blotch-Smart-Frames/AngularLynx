#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { doctorCommand } from './commands/doctor.js';
import { updateCommand } from './commands/update.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { diffCommand } from './commands/diff.js';
import { infoCommand } from './commands/info.js';
import { ejectCommand } from './commands/eject.js';
import { outdatedCommand } from './commands/outdated.js';
import { themeCommand } from './commands/theme.js';
import { printBanner } from './utils/banner.js';

const program = new Command();

program
  .name('dolan')
  .description('Add ui components to your AngularLynx project')
  .version('0.0.1')
  .action(() => {
    printBanner();
    program.outputHelp();
  });

program
  .command('init')
  .description('Initialize dolan in your project')
  .action(initCommand);

program
  .command('add')
  .description('Add components to your project')
  .argument('[components...]', 'components to add')
  .action(addCommand);

program
  .command('doctor')
  .description('Check your project setup for issues')
  .action(doctorCommand);

program
  .command('update')
  .description('Update installed components to latest versions')
  .option(
    '-f, --force',
    'overwrite all files with upstream, discarding local changes',
  )
  .option('-s, --selective', 'review and individually accept/skip each change')
  .action(updateCommand);

program
  .command('list')
  .alias('ls')
  .description('Show installed components and their status')
  .option('--json', 'output as JSON')
  .action(listCommand);

program
  .command('remove')
  .alias('rm')
  .description('Remove an installed component')
  .argument('<component>', 'component to remove')
  .option('-f, --force', 'skip confirmation prompts')
  .action(removeCommand);

program
  .command('diff')
  .description('Show changes between installed and upstream versions')
  .argument('[component]', 'specific component to diff')
  .action(diffCommand);

program
  .command('info')
  .description('Show information about a component')
  .argument('<component>', 'component to inspect')
  .action(infoCommand);

program
  .command('eject')
  .description('Stop tracking a component (keep files, remove from lockfile)')
  .argument('<component>', 'component to eject')
  .option('-f, --force', 'skip confirmation prompt')
  .action(ejectCommand);

program
  .command('outdated')
  .description('Show components that need updating')
  .option('--json', 'output as JSON')
  .action(outdatedCommand);

program
  .command('theme')
  .description('List themes or create a custom theme')
  .argument('[name]', 'create a new theme with this name')
  .action(themeCommand);

program.parse();
