import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');

const PACKAGES = [
  'packages/runtime',
  'packages/rsbuild-plugin-angular-lynx',
  'packages/testing-library',
];

// Only check once per lint run.
let checked = false;
let mismatch = null;

const check = () => {
  if (checked) return mismatch;
  checked = true;

  const versions = PACKAGES.map((p) => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, p, 'package.json'), 'utf-8'),
    );
    return { path: p, version: pkg.version };
  });

  const unique = new Set(versions.map((v) => v.version));
  if (unique.size !== 1) {
    mismatch = versions.map((v) => `${v.path}: ${v.version}`).join(', ');
  }
  return mismatch;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that published packages have matching version numbers',
    },
    messages: {
      versionMismatch:
        'Package version mismatch: {{ detail }}. All published packages must share the same version.',
    },
  },
  create(context) {
    return {
      Program() {
        const detail = check();
        if (detail) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'versionMismatch',
            data: { detail },
          });
        }
      },
    };
  },
};
