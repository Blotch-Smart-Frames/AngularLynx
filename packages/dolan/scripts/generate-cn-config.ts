// Writes cn-config.ts, the tailwind-merge config cn() merges with, into
// both copies of cn() (packages/dolan's, which apps import, and
// packages/ui's, which the components' own tests use), then formats them.
//
//   npm run generate:cn-config -w @blotch/dolan
//
// Run it after updating tailwind-merge or changing COMPONENT_CLASS_ROOTS:
// cn-config.test.ts fails until the files match. See cn-config-source.ts for
// why the config is generated.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { getDefaultConfig } from 'tailwind-merge';

import {
  cnConfigSource,
  componentConfig,
} from '../src/utils/cn-config-source.ts';

const root = resolve(import.meta.dirname, '../../..');
const targets = [
  'packages/dolan/src/utils/cn-config.ts',
  'packages/ui/src/lib/utils/cn-config.ts',
];

// tailwind-merge's exports leave out its package.json: read it next to
// the CommonJS bundle, which is in its dist/.
const { version } = JSON.parse(
  readFileSync(
    resolve(
      dirname(createRequire(import.meta.url).resolve('tailwind-merge')),
      '../package.json',
    ),
    'utf8',
  ),
) as { version: string };
const source = cnConfigSource(componentConfig(getDefaultConfig()), version);
for (const target of targets) {
  writeFileSync(resolve(root, target), source);
}
const formatted = spawnSync('npx', ['oxfmt', ...targets], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(formatted.status ?? 1);
