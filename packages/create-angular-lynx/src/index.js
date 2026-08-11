#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2];

if (!name) {
  console.error('Usage: npm create angular-lynx <project-name>');
  process.exit(1);
}

const dest = path.resolve(name);

if (existsSync(dest)) {
  console.error(`Directory "${name}" already exists.`);
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit' });
};

run(
  `npx -y @angular/cli@latest new ${name} --skip-install --skip-git --style css --ssr false`,
);
run(`npx -y -w ${dest} ng add @blotch/angular-lynx --skip-confirmation`);
run(`npm install --prefix ${dest}`);

console.log(`
Done! To get started:

  cd ${name}
  npm start
`);
