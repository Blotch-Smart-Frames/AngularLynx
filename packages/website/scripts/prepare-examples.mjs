/**
 * Pre-build script that scans local examples and generates metadata + copies
 * source files to docs/public/examples/ for the <Go> component to consume.
 *
 * Adapted from Vue Lynx's prepare-examples script.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLES_SRC = path.resolve(REPO_ROOT, 'examples');
const EXAMPLES_DEST = path.resolve(__dirname, '../docs/public/examples');
const EXAMPLE_GIT_BASE_URL =
  'https://github.com/Blotch-Smart-Frames/AngularLynx/tree/master/examples';
/**
 * The `baseHref` every example is built with (see build-examples in
 * package.json): Lynx for Web resolves a bundle's images against the page
 * that shows the bundle, so the web bundles ask for them under this path,
 * and each example's `dist/static` is merged into `docs/public/examples/static`
 * below. The file names carry a content hash, so two examples' copies of a
 * file are the same file.
 */
const EXAMPLES_BASE_HREF = '/examples/';
const STATIC_DEST = path.join(EXAMPLES_DEST, 'static');

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv',
  '.webm',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
  '.otf',
  '.zip',
  '.tar',
  '.tgz',
  '.gz',
  '.rar',
  '.pdf',
  '.psd',
  '.tif',
]);

// `.angular` (the Angular CLI's compiler cache) and `.turbo` (turbo's logs)
// are build leftovers, not example source. Copying them shipped ~19 MB of
// caches with every deploy and listed them in the example's file browser.
// `.impeccable` holds a designed example's working files (its surface brief
// and decision logs), which aren't part of the app either.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.cache',
  '.git',
  '.angular',
  '.turbo',
  '.impeccable',
]);

const walkDir = (dir, base = dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, base));
    } else {
      results.push(relPath);
    }
  }
  return results;
};

const copyDirRecursive = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const isPreviewImage = (relPath) => {
  const basename = path.basename(relPath);
  return (
    /^preview-image\.(png|jpg|jpeg|webp|gif)$/.test(basename) &&
    !relPath.includes('/')
  );
};

const isTextFile = (relPath) => {
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true;
};

/**
 * Parse lynx.config.ts to extract entry points for templateFiles.
 */
const parseConfigEntries = (configPath) => {
  if (!fs.existsSync(configPath)) return [];

  const content = fs.readFileSync(configPath, 'utf-8');

  // Match entry object: entry: { 'name': './path', ... }
  const entryMatch = content.match(/entry:\s*\{([^}]+)\}/s);
  if (!entryMatch) {
    // Single entry shorthand: entry: './src/main.ts'
    const singleMatch = content.match(/entry:\s*['"]([^'"]+)['"]/);
    if (singleMatch) {
      return [{ name: 'main', entryPath: singleMatch[1] }];
    }
    return [];
  }

  const entries = [];
  const entryRegex = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = entryRegex.exec(entryMatch[1])) !== null) {
    entries.push({ name: match[1], entryPath: match[2] });
  }
  return entries;
};

/**
 * The example's pages: the entries its lynx.config.ts lists, or else the Lynx
 * bundles its build wrote. Most examples have no lynx.config.ts (`ng build`
 * takes the entry from angular.json), and some set no `entry` in theirs (the
 * plugin's `pages` option names the bundles after angular.json projects).
 */
const parseEntries = (srcDir) => {
  const configEntries = parseConfigEntries(path.join(srcDir, 'lynx.config.ts'));
  if (configEntries.length > 0) return configEntries;
  const distDir = path.join(srcDir, 'dist');
  if (!fs.existsSync(distDir)) return [];
  return fs
    .readdirSync(distDir)
    .filter((file) => file.endsWith('.lynx.bundle'))
    .map((file) => ({ name: file.slice(0, -'.lynx.bundle'.length) }))
    .sort((a, b) => (a.name === 'main' ? -1 : b.name === 'main' ? 1 : 0));
};

const processExample = (exampleName) => {
  const srcDir = path.join(EXAMPLES_SRC, exampleName);
  const destDir = path.join(EXAMPLES_DEST, exampleName);

  if (!fs.statSync(srcDir).isDirectory()) return;

  console.info(`Processing example: ${exampleName}`);

  const allFiles = walkDir(srcDir);

  const textFiles = allFiles.filter((f) => {
    if (isPreviewImage(f)) return true;
    if (!isTextFile(f)) return false;
    return true;
  });

  const previewImage = allFiles.find(isPreviewImage) || undefined;

  const entries = parseEntries(srcDir);

  const templateFiles = entries.map(({ name }) => {
    const entry = {
      name,
      file: `dist/${name}.lynx.bundle`,
    };
    const webBundlePath = path.join(srcDir, `dist/${name}.web.bundle`);
    if (fs.existsSync(webBundlePath)) {
      entry.webFile = `dist/${name}.web.bundle`;
    }
    return entry;
  });

  // A web bundle names its images and other emitted files by the public path
  // it was built with, and Lynx for Web resolves that against the page that
  // shows the <lynx-view>, not against the bundle. The site serves them under
  // EXAMPLES_BASE_HREF (the merge into STATIC_DEST below), so an example that
  // emits any has to be built with `--base-href=/examples/`, which the root's
  // `npm run build:examples` passes. A build without it looks fine here and
  // ships previews with no pictures, which the deploy once did when its
  // workflow ran a plain `turbo run build`.
  const staticSrcDir = path.join(srcDir, 'dist', 'static');
  if (fs.existsSync(staticSrcDir) && walkDir(staticSrcDir).length > 0) {
    const publicPaths = templateFiles
      .filter(({ webFile }) => webFile)
      .map(
        (entry) =>
          // latin1 keeps every byte a character, so the match can't be thrown
          // off by binary sections of the bundle.
          fs
            .readFileSync(path.join(srcDir, entry.webFile), 'latin1')
            .match(/\.p=\\?"([^"\\]*)\\?"/)?.[1],
      );
    if (!publicPaths.includes(EXAMPLES_BASE_HREF)) {
      throw new Error(
        `${exampleName}'s web bundle was built with the public path ${JSON.stringify(publicPaths[0])}, not ${EXAMPLES_BASE_HREF}: ` +
          `the files under its dist/static would 404 on the site. Build the examples with \`npm run build:examples\` from the repo root.`,
      );
    }
  }

  const metadata = {
    name: exampleName,
    files: textFiles.filter((f) => !isPreviewImage(f)),
    templateFiles,
    previewImage: previewImage || undefined,
    exampleGitBaseUrl: EXAMPLE_GIT_BASE_URL,
  };

  fs.mkdirSync(destDir, { recursive: true });

  fs.writeFileSync(
    path.join(destDir, 'example-metadata.json'),
    JSON.stringify(metadata, null, 2),
  );

  for (const relPath of textFiles) {
    const srcFile = path.join(srcDir, relPath);
    const destFile = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
  }

  const distSrcDir = path.join(srcDir, 'dist');
  if (fs.existsSync(distSrcDir)) {
    copyDirRecursive(distSrcDir, path.join(destDir, 'dist'));
  }
  // The bundled images, where the web bundle asks for them (EXAMPLES_BASE_HREF).
  if (fs.existsSync(staticSrcDir)) {
    copyDirRecursive(staticSrcDir, STATIC_DEST);
  }

  // Note: Do NOT nullify empty styleInfo ({}) — it must remain truthy.
  // The decode worker awaits WASM before processing styleInfo, which
  // synchronizes section delivery with the main thread's WASM init.
  // Without this synchronization, a race condition in web-core causes
  // lepusCode to never be set on the bundle object.

  if (previewImage) {
    const srcFile = path.join(srcDir, previewImage);
    const destFile = path.join(destDir, previewImage);
    fs.copyFileSync(srcFile, destFile);
  }

  console.info(
    `  -> ${textFiles.length} files, ${templateFiles.length} entries`,
  );
};

// Main
console.info('Preparing examples...');
console.info(`Source: ${EXAMPLES_SRC}`);
console.info(`Dest:   ${EXAMPLES_DEST}`);

if (!fs.existsSync(EXAMPLES_SRC)) {
  console.info('No examples directory found, skipping.');
  process.exit(0);
}

if (fs.existsSync(EXAMPLES_DEST)) {
  fs.rmSync(EXAMPLES_DEST, { recursive: true });
}
fs.mkdirSync(EXAMPLES_DEST, { recursive: true });

const examples = fs
  .readdirSync(EXAMPLES_SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
  .map((d) => d.name);

// Build examples that don't have dist/ yet
const needsBuild = examples.some(
  (example) => !fs.existsSync(path.join(EXAMPLES_SRC, example, 'dist')),
);

if (needsBuild) {
  // Ensure the runtime and the builders are built first
  const runtimeBuilt = fs.existsSync(
    path.join(
      REPO_ROOT,
      'packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs',
    ),
  );
  const buildersBuilt = fs.existsSync(
    path.join(REPO_ROOT, 'packages/build/builders/application/index.js'),
  );

  if (!runtimeBuilt || !buildersBuilt) {
    console.info('Building runtime and builders (required by examples)...');
    execSync(
      'npx turbo run build --filter=@blotch/angular-lynx --filter=@blotch/angular-lynx-build',
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
  }

  for (const example of examples) {
    const exampleDir = path.join(EXAMPLES_SRC, example);
    const distDir = path.join(exampleDir, 'dist');
    if (!fs.existsSync(distDir)) {
      console.info(`Building example: ${example} (no dist/ found)`);
      try {
        execSync(`npm run build -- --base-href=${EXAMPLES_BASE_HREF}`, {
          cwd: exampleDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.error(`  Failed to build ${example}:`, err.message);
      }
    }
  }
}

for (const example of examples) {
  processExample(example);
}

console.info(`\nDone! Processed ${examples.length} examples.`);
