#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// The publish workflow releases this scaffolder in lockstep with
// @blotch/angular-lynx under one version, whose major mirrors the Angular major
// the renderer supports. Pinning the Angular CLI and the renderer to it keeps
// `npm create angular-lynx` working after a newer Angular ships:
// `@angular/cli@latest` would generate a project that the renderer's peer
// range rejects, failing `ng add`. A bare major (rather than a `^` range) also
// sidesteps cmd.exe treating `^` as an escape character on Windows.
const { version } = createRequire(import.meta.url)('../package.json');
const angularMajor = version.split('.')[0];

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

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd });
};

run(
  `npx -y @angular/cli@${angularMajor} new ${name} --skip-install --skip-git --style css --ssr false`,
);
// `ng add` must run inside the new project so it finds its angular.json and
// package.json. (`npx -w <dir>` doesn't do this: it treats the current
// directory as an npm workspace root and fails when it has no package.json.)
// The CLI is fetched by package name rather than via `npx ng`, because
// `--skip-install` leaves no local `ng` binary and `npx ng` would download the
// unrelated `ng` package from npm instead.
run(
  `npx -y @angular/cli@${angularMajor} add @blotch/angular-lynx@${version} --skip-confirmation`,
  dest,
);
run(`npm install --prefix ${dest}`);

console.log(`
Done! To get started:

  cd ${name}
  npm start
`);
