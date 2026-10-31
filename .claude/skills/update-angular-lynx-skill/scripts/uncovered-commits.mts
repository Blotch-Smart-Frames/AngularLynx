// Lists the commits in <base>..<head> that changed code apps use but didn't
// touch the public skill (skills/angular-lynx), with the packages each one
// changed. Each is a candidate for the skill; whether app developers need to
// know about it is a judgment call this script leaves to the reader.
//
//   node .claude/skills/update-angular-lynx-skill/scripts/uncovered-commits.mts <base> [<head>]
//
// <head> defaults to origin/master. "Code apps use" is every published package
// (from packages.ts, so the list follows it) and packages/ui, whose components
// dolan copies into apps. Tests are left out: they don't change what an app
// sees.
import { execFileSync } from 'node:child_process';

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
} from '../../../../packages/release/src/packages.ts';

const SKILL_DIR = 'skills/angular-lynx';

const [base, head = 'origin/master'] = process.argv.slice(2);
if (!base) {
  console.error(
    'Usage: node .claude/skills/update-angular-lynx-skill/scripts/uncovered-commits.mts <base> [<head>]',
  );
  process.exit(1);
}

const git = (...args: string[]) =>
  execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });

const packageDirs = [
  ...new Set([...PUBLISHABLE_PACKAGES.map(({ dir }) => dir), 'packages/ui']),
];
const appCode = [
  ...packageDirs,
  ':(exclude,glob)**/*.test.ts',
  ':(exclude,glob)**/*.spec.ts',
];

/** The files a commit changed among `paths`. */
const changed = (hash: string, paths: string[]) =>
  git('diff-tree', '--no-commit-id', '--name-only', '-r', hash, '--', ...paths)
    .split('\n')
    .filter(Boolean);

const commits = git('log', '--format=%H %s', `${base}..${head}`, '--', ...appCode)
  .split('\n')
  .filter(Boolean);

let uncovered = 0;
for (const line of commits) {
  const [hash, ...subject] = line.split(' ');
  // A release commit only changes versions (see the release skill).
  if (subject.join(' ').startsWith('chore: Release ')) continue;
  // A commit that updated the skill was already checked against it in its PR.
  if (changed(hash!, [SKILL_DIR]).length > 0) continue;
  uncovered++;
  const packages = [
    ...new Set(
      changed(hash!, appCode).map(
        (file) => packageDirs.find((dir) => file.startsWith(`${dir}/`))!,
      ),
    ),
  ];
  console.log(`${hash!.slice(0, 7)} ${subject.join(' ')}`);
  console.log(`        ${packages.join(', ')}`);
}
console.error(
  `${uncovered} of ${commits.length} commits that changed app code since ${base} didn't touch ${SKILL_DIR}.`,
);
