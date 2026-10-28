// Prunes .turbo/cache down to one commit's entries before a CI job saves it
// to the Actions cache (see ci.yml).
//
// Usage: node .github/scripts/prune-turbo-cache.mts <tasks.json>
//
// turbo never evicts an entry from its local cache, and each run restores the
// last run's cache before adding its own, so every save used to carry every
// earlier build as well: one PR's entries had grown to 372 MB, nine builds'
// worth. A cache only helps a later run with the hashes it will look up, and
// those are this commit's (a pull request runs on its merge with master).
//
// <tasks.json> is the output of `turbo run <task> --dry=json`. It lists every
// task's hash across the repository, including tasks this job doesn't run
// itself, such as the example builds that the website's build runs, and a
// task's hash doesn't depend on which job or filter runs it. Write it before
// the job builds anything: a build output that git doesn't ignore would change
// the hashes a dry run gives afterwards.
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const [tasksPath] = process.argv.slice(2);
if (!tasksPath) {
  throw new Error(
    'Usage: node .github/scripts/prune-turbo-cache.mts <tasks.json>',
  );
}
const { tasks } = JSON.parse(readFileSync(tasksPath, 'utf8')) as {
  tasks: { hash: string }[];
};
const keep = new Set(tasks.map((task) => task.hash));

const dir = '.turbo/cache';
let keptBytes = 0;
let removedBytes = 0;
// Nothing to prune when the restore found no cache and no task wrote one.
if (existsSync(dir)) {
  for (const name of readdirSync(dir)) {
    // Each entry is <hash>.tar.zst, <hash>-meta.json and <hash>-manifest.json.
    const path = join(dir, name);
    const bytes = statSync(path).size;
    if (keep.has(name.split(/[.-]/)[0])) {
      keptBytes += bytes;
    } else {
      rmSync(path, { recursive: true, force: true });
      removedBytes += bytes;
    }
  }
}
const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
console.log(
  `Kept ${mb(keptBytes)} of the turbo cache; removed ${mb(removedBytes)}.`,
);
