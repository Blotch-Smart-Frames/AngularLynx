// Compares an app's Lynx scripts with the sizes checked in to
// .github/script-sizes.json, and fails when one has grown past its budget
// (see script-sizes.yml, which builds the apps first).
//
// Usage: node .github/scripts/script-sizes.mts [--update] [--report <file>]
//
//   (no flag)        measure, compare, and exit 1 if a script is over budget
//   --update         write the measured sizes into the baseline instead
//   --report <file>  also write the comparison as Markdown, for the PR comment
//
// Nothing checked how big an app's scripts were until the canvas 2D context
// (#695) grew every app's main.lynx.bundle by 166 KB, apps that draw no canvas
// included, and nobody noticed for about ten PRs (#835). Size isn't only
// download size: PrimJS keeps a loaded script's bytecode in the heap (#707),
// so each byte of the main-thread script also costs memory at launch.
//
// Each app must have been built with `DEBUG=rspeedy ng build --environment
// lynx`: the scripts the bundle carries stay in dist/.lynx/main/ only when
// DEBUG names rspeedy (LynxEncodePlugin deletes them otherwise).
//
// The baseline is the PR's own copy of the file, so a PR that means to grow a
// script raises the baseline in the same change (`--update`), where review
// sees it. The budget is against that fixed baseline, not the last PR, so
// small growth adds up until it fails rather than slipping through a few KB
// at a time.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BASELINE_PATH = '.github/script-sizes.json';

/** The files measured, by the name the report gives them, under dist/. */
const SCRIPTS = {
  'main-thread': '.lynx/main/main-thread.js',
  background: '.lynx/main/background-thread.js',
  bundle: 'main.lynx.bundle',
} as const;
type Script = keyof typeof SCRIPTS;

type Size = {
  raw: number;
  gzip: number;
};

type Baseline = {
  /**
   * How far a script may grow past its baseline before the check fails, raw:
   * whichever of the two is larger. The bytes keep a small script, such as a
   * 50 KB background script, from failing on a few hundred bytes; the percent
   * scales with the main-thread script.
   */
  budget: { bytes: number; percent: number };
  apps: Record<string, { dir: string; sizes: Record<Script, Size> }>;
};

const args = process.argv.slice(2);
const update = args.includes('--update');
const reportIndex = args.indexOf('--report');
const reportPath = reportIndex < 0 ? undefined : args[reportIndex + 1];
if (reportIndex >= 0 && !reportPath) {
  throw new Error('--report needs a file to write the report to');
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

const measure = (file: string): Size => {
  if (!existsSync(file)) {
    throw new Error(
      `${file} doesn't exist. Build the app with \`DEBUG=rspeedy ng build --environment lynx\` first.`,
    );
  }
  const bytes = readFileSync(file);
  // Level 9, as a CDN compresses a static file once and keeps it.
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
};

const measured = Object.fromEntries(
  Object.entries(baseline.apps).map(([app, { dir }]) => [
    app,
    Object.fromEntries(
      Object.entries(SCRIPTS).map(([script, file]) => [
        script,
        measure(join(dir, 'dist', file)),
      ]),
    ) as Record<Script, Size>,
  ]),
);

if (update) {
  for (const [app, sizes] of Object.entries(measured)) {
    baseline.apps[app]!.sizes = sizes;
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote the measured sizes to ${BASELINE_PATH}.`);
  process.exit(0);
}

const allowance = (before: number) =>
  Math.max(
    baseline.budget.bytes,
    Math.round((before * baseline.budget.percent) / 100),
  );

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;
const signedKb = (bytes: number) =>
  bytes === 0 ? '0' : `${bytes > 0 ? '+' : '−'}${kb(Math.abs(bytes))}`;
const percent = (change: number, before: number) =>
  `${change > 0 ? '+' : change < 0 ? '−' : ''}${((Math.abs(change) / before) * 100).toFixed(1)}%`;

const over: string[] = [];
const under: string[] = [];
const rows: string[] = [];
for (const [app, sizes] of Object.entries(measured)) {
  for (const script of Object.keys(SCRIPTS) as Script[]) {
    const before = baseline.apps[app]!.sizes[script];
    const now = sizes[script];
    const change = now.raw - before.raw;
    const limit = allowance(before.raw);
    let status = '';
    if (change > limit) {
      status = `❌ over by ${kb(change - limit)}`;
      over.push(`${app} ${script}`);
    } else if (-change > limit) {
      // Not a failure, but worth keeping: until the baseline comes down, the
      // next PR can grow the script back by as much without failing.
      status = '⬇️ update the baseline';
      under.push(`${app} ${script}`);
    }
    rows.push(
      `| ${app} | ${script} | ${kb(before.raw)} | ${kb(now.raw)} | ${signedKb(change)} (${percent(change, before.raw)}) | ${kb(before.gzip)} → ${kb(now.gzip)} | ${status} |`,
    );
  }
}

const { bytes, percent: budgetPercent } = baseline.budget;
const report = [
  // script-sizes.yml finds its own comment by this line, to edit it.
  '<!-- script-sizes -->',
  '## Lynx script sizes',
  '',
  over.length > 0
    ? `❌ **Over budget:** ${over.join(', ')}. If the growth is meant, run the update below and commit \`${BASELINE_PATH}\` with this PR.`
    : '✅ Every script is within its budget.',
  '',
  '| App | Script | Baseline | This PR | Change | Gzip | |',
  '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ...rows,
  '',
  `A script fails once it's more than ${kb(bytes)} or ${budgetPercent}% (whichever is larger) over \`${BASELINE_PATH}\`. Gzip is shown, not checked.`,
  ...(under.length > 0
    ? [
        '',
        `⬇️ **Smaller than the baseline:** ${under.join(', ')}. Run the update below so the next PR can't grow them back unnoticed.`,
      ]
    : []),
  '',
  'To update the baseline, build the packages (`npm run build`), then:',
  '',
  '```sh',
  ...Object.values(baseline.apps).map(
    ({ dir }) =>
      `(cd ${dir} && DEBUG=rspeedy npx ng build --environment lynx)${dir.startsWith('benchmarks/') ? '  # after node scripts/use-local-packages.mjs' : ''}`,
  ),
  'node .github/scripts/script-sizes.mts --update',
  '```',
  '',
].join('\n');

console.log(report);
if (reportPath) writeFileSync(reportPath, report);
if (over.length > 0) process.exit(1);
