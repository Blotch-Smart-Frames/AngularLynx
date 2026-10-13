// The shared publish list, so this rule checks exactly the packages that get
// published. It used to keep its own list, which fell behind and missed
// @blotch/dolan and create-angular-lynx.
import { readVersions } from '../../../e2e/src/packages.ts';

// Only check once per lint run.
let checked = false;
let mismatch = null;

const check = () => {
  if (checked) return mismatch;
  checked = true;

  const versions = readVersions();
  const unique = new Set(versions.map((v) => v.version));
  if (unique.size !== 1) {
    mismatch = versions.map((v) => `${v.name}@${v.version}`).join(', ');
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
        'Package version mismatch: {{ detail }}. All published packages must share the same version; set them with `node packages/e2e/src/set-version.ts <version>`.',
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
