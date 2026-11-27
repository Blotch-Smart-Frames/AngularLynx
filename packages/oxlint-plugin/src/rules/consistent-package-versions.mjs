// The shared publish list, so this rule checks exactly the packages that get
// published. It used to keep its own list, which fell behind and missed
// @blotch/dolan and create-angular-lynx.
import {
  findAngularPeerFloorMismatches,
  findPackageGroupMismatches,
  readVersions,
} from '../../../release/src/packages.ts';

// Only check once per lint run.
let checked = false;
let mismatch = null;
let groupMismatch = null;
let peerFloorMismatch = null;

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
  // An app installs every package's peers at once, so one Angular peer that
  // starts above the rest raises the floor for all of them, while the rest
  // still promise the lower one. Dependabot raised two this way (#571).
  const peers = findAngularPeerFloorMismatches();
  if (peers.length > 0) {
    peerFloorMismatch = peers.join(', ');
  }
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that published packages have matching version numbers, ng update package groups and Angular peer floors',
    },
    messages: {
      versionMismatch:
        'Package version mismatch: {{ detail }}. All published packages, the pins between them and the floors of their peer ranges on each other must share the same version; set them with `npm run set-version <version>`.',
      packageGroupMismatch:
        'ng-update.packageGroup differs from NG_UPDATE_PACKAGE_GROUP in packages/release/src/packages.ts in: {{ detail }}. Each package `ng update` moves together must list the group in its package.json.',
      angularPeerFloorMismatch:
        "These Angular peer ranges start above the published packages' other Angular peers: {{ detail }}. An app on the lowest Angular the others allow can't install them, and that's the version the E2E tests install. Start every Angular peer at the same version; the release-minor and update-angular skills move them together.",
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
        if (peerFloorMismatch) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'angularPeerFloorMismatch',
            data: { detail: peerFloorMismatch },
          });
        }
      },
    };
  },
};
