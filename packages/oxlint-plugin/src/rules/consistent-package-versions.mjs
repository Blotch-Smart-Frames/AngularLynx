// The shared publish list, so this rule checks exactly the packages that get
// published. It used to keep its own list, which fell behind and missed
// @blotch/dolan and create-angular-lynx.
import {
  findPackageGroupMismatches,
  readVersions,
} from '../../../release/src/packages.ts';

// Only check once per lint run.
let checked = false;
let mismatch = null;
let groupMismatch = null;

const check = () => {
  if (checked) return;
  checked = true;

  const versions = readVersions();
  const unique = new Set(versions.map((v) => v.version));
  if (unique.size !== 1) {
    mismatch = versions.map((v) => `${v.name}@${v.version}`).join(', ');
  }
  // The packages are released together, so `ng update` must move them
  // together too: each lists the same `ng-update.packageGroup`.
  const groups = findPackageGroupMismatches();
  if (groups.length > 0) {
    groupMismatch = groups.join(', ');
  }
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that published packages have matching version numbers and ng update package groups',
    },
    messages: {
      versionMismatch:
        'Package version mismatch: {{ detail }}. All published packages must share the same version; set them with `npm run set-version <version>`.',
      packageGroupMismatch:
        'ng-update.packageGroup differs from NG_UPDATE_PACKAGE_GROUP in packages/release/src/packages.ts in: {{ detail }}. Each package `ng update` moves together must list the group in its package.json.',
    },
  },
  create(context) {
    return {
      Program() {
        check();
        if (mismatch) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'versionMismatch',
            data: { detail: mismatch },
          });
        }
        if (groupMismatch) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'packageGroupMismatch',
            data: { detail: groupMismatch },
          });
        }
      },
    };
  },
};
