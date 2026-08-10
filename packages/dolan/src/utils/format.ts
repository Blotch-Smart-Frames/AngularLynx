import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Extensions oxfmt understands. Everything else (notably the `.css` theme
// files) is returned untouched — running them through a JS/TS formatter would
// at best no-op and at worst mangle them.
const FORMATTABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

// oxfmt config filenames we treat as "this project uses oxfmt". We only look
// for the JSON variants because that's what the schema-validated config in
// this monorepo (and generated projects) use; a project on a `.ts`/`.js`
// oxfmt config is niche enough that skipping formatting there is acceptable.
const OXFMT_CONFIG_NAMES = ['.oxfmtrc.json', '.oxfmtrc.jsonc'];

const extensionOf = (filePath: string): string => {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? '' : filePath.slice(dot);
};

/**
 * Walks up the directory tree from `startDir`, returning the first ancestor
 * that contains `relativePath`, or null if the filesystem root is reached
 * without a hit. Used to discover the consumer's oxfmt config and binary.
 */
const findUp = (startDir: string, relativePath: string): string | null => {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
};

/**
 * Normalizes upstream file content to the consuming project's oxfmt config.
 *
 * WHY THIS EXISTS: dolan copies component source verbatim and rewrites its
 * import paths (`../../utils/cn` → `@blotch/dolan/utils/cn`). That copy is not
 * guaranteed to satisfy the target project's formatter — the import rewrite
 * alone can push a line past `printWidth`, and any drift in the upstream source
 * lands as-is. Without normalization, `dolan add`/`update` writes files that
 * the project's own `oxfmt --check` (and CI) then reject.
 *
 * It MUST run during analysis, not as a post-write pass: the lockfile records
 * `hash(newContent)` as the merge base, and every command (`update`, `diff`,
 * `outdated`, `list`) recomputes that hash to detect drift. If we formatted
 * after writing, the on-disk content would no longer match the recorded hash
 * and every file would read as "user-modified" forever. Normalizing the
 * content itself keeps the hash, the diff, and the written file in agreement.
 *
 * BEST-EFFORT BY DESIGN: we only reformat when the target project genuinely
 * uses oxfmt — i.e. both an `.oxfmtrc` config and an `oxfmt` binary are
 * discoverable by walking up from `filePath`. Projects without oxfmt (and the
 * temp-dir fixtures in our own unit tests, which live outside any workspace)
 * get their content back unchanged, so dolan stays usable everywhere and its
 * tests stay deterministic. Any formatter failure also falls back to the
 * original content — a formatting hiccup must never corrupt the file we install.
 *
 * @param content  Raw (already import-rewritten) file content.
 * @param filePath Absolute destination path inside the consumer project. Used
 *                 to infer the parser (extension) and to resolve the project's
 *                 oxfmt config/ignore rules exactly as `oxfmt` itself would.
 */
export const formatContent = (content: string, filePath: string): string => {
  if (!FORMATTABLE_EXTENSIONS.has(extensionOf(filePath))) return content;

  const startDir = dirname(filePath);

  // Gate on the project actually using oxfmt. Checking the config first is the
  // cheap, decisive signal; without it we'd risk formatting to oxfmt defaults
  // in a project that never opted in.
  const hasConfig = OXFMT_CONFIG_NAMES.some((name) => findUp(startDir, name));
  if (!hasConfig) return content;

  const oxfmtBin = findUp(startDir, join('node_modules', '.bin', 'oxfmt'));
  if (!oxfmtBin) return content;

  const result = spawnSync(oxfmtBin, ['--stdin-filepath', filePath], {
    input: content,
    encoding: 'utf-8',
  });

  if (result.status !== 0 || !result.stdout) return content;
  return result.stdout;
};
