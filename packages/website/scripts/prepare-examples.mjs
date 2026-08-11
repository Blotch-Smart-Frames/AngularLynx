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
  'https://github.com/Blotch-Smart-Frames/lynx-angular/tree/main/examples';

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

const SKIP_DIRS = new Set(['node_modules', 'dist', '.cache', '.git']);

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
const parseEntries = (configPath) => {
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

  const configPath = path.join(srcDir, 'lynx.config.ts');
  const entries = parseEntries(configPath);

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

// Copy pre-built @lynx-js/web-core client assets to docs/public/web-core/
// so lynx-view works without bundler processing (avoids worker/WASM issues)
const WEB_CORE_SRC = path.resolve(
  REPO_ROOT,
  'node_modules/@lynx-js/web-core/dist/client_prod/static',
);
const WEB_CORE_DEST = path.resolve(__dirname, '../docs/public/web-core/static');

if (fs.existsSync(WEB_CORE_SRC)) {
  if (fs.existsSync(WEB_CORE_DEST)) {
    fs.rmSync(WEB_CORE_DEST, { recursive: true });
  }
  copyDirRecursive(WEB_CORE_SRC, WEB_CORE_DEST);
  console.info(`Copied web-core static assets to ${WEB_CORE_DEST}`);
}

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
  // Ensure the runtime and plugin are built first
  const runtimeBuilt = fs.existsSync(
    path.join(REPO_ROOT, 'packages/runtime/dist/index.js'),
  );
  const pluginBuilt = fs.existsSync(
    path.join(REPO_ROOT, 'packages/rsbuild-plugin-angular-lynx/dist/index.js'),
  );

  if (!runtimeBuilt || !pluginBuilt) {
    console.info('Building runtime and plugin (required by examples)...');
    execSync(
      'npm run build -w packages/rsbuild-plugin-angular-lynx && npm run build -w packages/runtime',
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
  }

  for (const example of examples) {
    const exampleDir = path.join(EXAMPLES_SRC, example);
    const distDir = path.join(exampleDir, 'dist');
    if (!fs.existsSync(distDir)) {
      console.info(`Building example: ${example} (no dist/ found)`);
      try {
        execSync('npm run build', { cwd: exampleDir, stdio: 'inherit' });
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
